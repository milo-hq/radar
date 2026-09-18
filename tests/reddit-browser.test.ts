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
