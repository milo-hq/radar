import { expireBrowserJobs } from "../packages/db/src/reddit-browser.js";
import { parseBrowserSnapshot } from "../packages/connectors/src/reddit-browser.js";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { buildApp } from "../apps/api/src/app.js";
import { advanceScans } from "../packages/radar/src/radar.js";
import { claimJob } from "../packages/db/src/jobs.js";
const db = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgresql://radar@127.0.0.1:55432/radar_test",
});
const app = await buildApp(db);
const scanIds: string[] = [];
after(async () => {
  await app.inject({
    method: "POST",
    url: "/api/reddit-browser/disconnect",
    payload: {},
  });
  await db.query(
    "UPDATE radar_scans SET status='failed' WHERE id=ANY($1::uuid[])",
    [scanIds],
  );
  await db.query(
    "UPDATE jobs SET status='failed' WHERE payload->>'scanId'=ANY($1::text[]) AND status IN ('pending','running')",
    [scanIds],
  );
  await app.close();
  await db.end();
});
const origin = "chrome-extension://" + "a".repeat(32);
const fixture = {
  url: "https://www.reddit.com/r/SaaS/comments/abc123/example/",
  subreddit: "SaaS",
  postId: "t3_abc123",
  title: "Docs search is expensive",
  body: "We spend hours finding answers in documentation.",
  reportedCommentCount: 5,
  comments: [
    {
      id: "t1_xyz123",
      body: "Search is still broken.",
      parentId: "t3_abc123",
      author: "reader",
    },
  ],
};
const request = (
  path: string,
  payload: any = {},
  token?: string,
  from?: string,
) =>
  app.inject({
    method: "POST",
    url: "/api/reddit-browser/" + path,
    payload,
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(from ? { origin: from } : {}),
    },
  });

test("paired browser leases, partial snapshots, replay, pause and resumption preserve real documents", async () => {
  const pair = await request("pair");
  assert.equal(pair.statusCode, 200);
  const token = pair.json().token;
  assert.equal((await request("claim", {}, undefined, origin)).statusCode, 401);
  assert.equal(
    (await request("claim", {}, token, "https://evil.example")).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/ingest",
        headers: { origin, authorization: "Bearer " + token },
        payload: { source: "manual", url: "https://example.com" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await request("heartbeat", { ready: true }, token, origin)).statusCode,
    200,
  );
  await request("heartbeat", { enabled: false }, token, origin);
  assert.equal(
    (await request("start")).statusCode,
    409,
    "stopping an idle browser prevents more work",
  );
  await request("heartbeat", { ready: true }, token, origin);
  const start = await request("start");
  assert.equal(start.statusCode, 200);
  const ids = start.json().jobIds;
  if (start.json().scanId) scanIds.push(start.json().scanId);
  const [id] = ids;
  assert.equal(
    await claimJob(db, id),
    null,
    "normal worker cannot steal browser task",
  );
  const claim = await request("claim", {}, token, origin);
  assert.equal(claim.statusCode, 200);
  const job = claim.json().job;
  assert.ok(job?.lock_token);
  assert.equal(
    (await request("claim", {}, token, origin)).json().job,
    null,
    "only one live browser lease",
  );
  const snapshot = {
    ...fixture,
    subreddit: job.payload.subreddit,
    url: `https://www.reddit.com/r/${job.payload.subreddit}/comments/abc123/example/`,
  };
  const bad = await request(
    "snapshot",
    { jobId: job.id, lease: crypto.randomUUID(), snapshot },
    token,
    origin,
  );
  assert.equal(bad.statusCode, 409);
  assert.equal(
    (
      await request(
        "snapshot",
        {
          jobId: job.id,
          lease: job.lock_token,
          snapshot: {
            ...snapshot,
            url: "https://evil.example/r/SaaS/comments/abc123/",
          },
        },
        token,
        origin,
      )
    ).statusCode,
    400,
  );
  const upload = () =>
    request(
      "snapshot",
      { jobId: job.id, lease: job.lock_token, snapshot },
      token,
      origin,
    );
  assert.equal((await upload()).statusCode, 200);
  assert.equal((await upload()).json().duplicate, true);
  const docs = (
    await db.query(
      "SELECT d.* FROM discovery_documents dd JOIN raw_documents d ON d.id=dd.document_id WHERE dd.job_id=$1",
      [job.id],
    )
  ).rows;
  assert.equal(docs.length, 2);
  assert.equal(docs[0].metadata.contextComplete, false);
  assert.equal(docs[0].metadata.capturedCommentCount, 1);
  assert.equal(docs[0].metadata.reportedCommentCount, 5);
  assert.equal(
    (
      await request(
        "pause",
        { jobId: job.id, lease: job.lock_token, reason: "login_required" },
        token,
        origin,
      )
    ).statusCode,
    200,
  );
  assert.equal((await request("claim", {}, token, origin)).json().job, null);
  await request("heartbeat", { ready: true }, token, origin);
  const resumed = (await request("claim", {}, token, origin)).json().job;
  assert.equal(resumed.id, job.id);
  assert.notEqual(resumed.lock_token, job.lock_token);
  assert.equal(
    (
      await request(
        "complete",
        { jobId: resumed.id, lease: resumed.lock_token },
        token,
        origin,
      )
    ).statusCode,
    200,
  );
  const saved = (await db.query("SELECT * FROM jobs WHERE id=$1", [job.id]))
    .rows[0];
  assert.equal(saved.status, "succeeded");
  assert.equal(saved.payload.matchedCount, 2);
  await db.query(
    "UPDATE jobs SET payload=payload||jsonb_build_object('deadlineAt',(now()-interval '1 minute')::text) WHERE id=ANY($1::uuid[]) AND status='pending'",
    [ids],
  );
  await advanceScans(db);
  const scan = (
    await db.query("SELECT * FROM radar_scans WHERE id=$1", [
      start.json().scanId,
    ])
  ).rows[0];
  assert.equal(
    scan.status,
    "analyzing",
    "partial Reddit documents enter the existing analysis pipeline after other jobs time out",
  );
  assert.equal(scan.coverage.sourceCounts.reddit, 2);
  const retry = await app.inject({
    method: "POST",
    url: `/api/jobs/${ids.find((id: string) => id !== job.id)}/retry`,
    payload: {},
  });
  assert.equal(
    retry.statusCode,
    409,
    "terminal browser runs must be recollected as a new scan, never revived without reanalysis",
  );
  await request("disconnect");
  assert.equal(
    (await request("heartbeat", { ready: true }, token, origin)).statusCode,
    401,
  );
  await db.query(
    "UPDATE jobs SET status='failed' WHERE id=ANY($1::uuid[]) AND status='pending'",
    [ids],
  );
});

test("browser replies retain a known parent even when its deleted body was excluded", () => {
  const docs = parseBrowserSnapshot(
    {
      ...fixture,
      comments: [{ ...fixture.comments[0], parentId: "t1_removedparent" }],
    },
    "SaaS",
  );
  assert.equal(docs[1].parentExternalId, "t1_removedparent");
  assert.equal(docs[1].metadata.contextComplete, false);
});

test("X requires browser capability, persists public posts and old clients cannot claim X", async () => {
  const token = (await request("pair")).json().token;
  await request("heartbeat", { ready: true }, token, origin);
  assert.equal((await request("start", { source: "x" })).statusCode, 409);
  await request("heartbeat", { ready: true, xEnabled: true }, token, origin);
  const start = await request("start", { source: "x" });
  assert.equal(start.statusCode, 200);
  const scanId = start.json().scanId;
  assert.ok(scanId);
  scanIds.push(scanId);
  const ids = start.json().jobIds;
  assert.equal((await request("start", { source: "reddit" })).statusCode, 409);
  assert.equal(ids.length, 8);
  // Legacy heartbeat explicitly removes capability; it must not receive X jobs.
  await request("heartbeat", { ready: true }, token, origin);
  assert.equal((await request("claim", {}, token, origin)).json().job, null);
  await request("heartbeat", { ready: true, xEnabled: true }, token, origin);
  const job = (await request("claim", {}, token, origin)).json().job;
  assert.equal(job.payload.source, "x");
  const payload = {
    jobId: job.id,
    lease: job.lock_token,
    snapshot: {
      url: "https://x.com/buyer/status/123456789",
      postId: "123456789",
      author: "buyer",
      body: "I spend hours exporting invoices manually.",
    },
  };
  assert.equal(
    (await request("snapshot", payload, token, origin)).json().count,
    1,
  );
  assert.equal(
    (await request("snapshot", payload, token, origin)).json().duplicate,
    true,
  );
  const doc = (
    await db.query(
      "SELECT d.* FROM raw_documents d JOIN discovery_documents dd ON dd.document_id=d.id WHERE dd.job_id=$1",
      [job.id],
    )
  ).rows[0];
  assert.equal((await app.inject("/api/documents?source=x")).statusCode, 200);
  assert.equal(doc.source_id, "x");
  assert.equal(doc.metadata.contextComplete, false);
  await request(
    "complete",
    { jobId: job.id, lease: job.lock_token },
    token,
    origin,
  );
  await db.query(
    "UPDATE jobs SET status='failed' WHERE id=ANY($1::uuid[]) AND status='pending'",
    [ids],
  );
  await advanceScans(db);
  assert.equal(
    (await db.query("SELECT status FROM radar_scans WHERE id=$1", [scanId]))
      .rows[0].status,
    "analyzing",
  );
});

test("offline browser jobs expire early without discarding live leases or fresh work", async () => {
  const ids: string[] = [];
  const saved = (
    await db.query("SELECT * FROM reddit_browser_connection WHERE id")
  ).rows[0];
  try {
    await db.query(
      "UPDATE reddit_browser_connection SET last_seen_at=now()-interval '10 minutes' WHERE id",
    );
    for (const [status, age, lease] of [
      ["pending", 10, null],
      ["running", 10, -5],
      ["running", 10, 2],
      ["pending", 1, null],
    ] as const) {
      const r = await db.query(
        "INSERT INTO jobs(type,payload,idempotency_key,status,created_at,locked_until) VALUES('DISCOVER_TOPIC',$1,$2,$3,now()-make_interval(mins=>$4),CASE WHEN $5::int IS NULL THEN null ELSE now()+make_interval(mins=>$5) END) RETURNING id",
        [
          JSON.stringify({
            transport: "reddit_browser",
            source: "x",
            deadlineAt: new Date(Date.now() + 20 * 60000).toISOString(),
          }),
          crypto.randomUUID(),
          status,
          age,
          lease,
        ],
      );
      ids.push(r.rows[0].id);
    }
    await expireBrowserJobs(db);
    const states = await Promise.all(
      ids.map(
        async (id) =>
          (
            await db.query("SELECT status,last_error FROM jobs WHERE id=$1", [
              id,
            ])
          ).rows[0],
      ),
    );
    assert.deepEqual(
      states.map((s) => s.status),
      ["failed", "failed", "running", "pending"],
    );
    assert.match(states[0].last_error, /离线/);
  } finally {
    await db.query(
      "UPDATE jobs SET status='failed',locked_until=null WHERE id=ANY($1::uuid[])",
      [ids],
    );
    await db.query(
      "UPDATE reddit_browser_connection SET last_seen_at=$1 WHERE id",
      [saved.last_seen_at],
    );
  }
});
