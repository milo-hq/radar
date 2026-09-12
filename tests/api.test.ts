import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { buildApp } from "../apps/api/src/app.js";
const db = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgresql://radar@127.0.0.1:55432/radar_test",
});
const app = await buildApp(db);
after(async () => {
  await app.close();
  await db.end();
});
test("summary reports actual opportunity counts without a global activation gate", async () => {
  const result = await app.inject("/api/summary");
  assert.equal(result.statusCode, 200);
  const body = result.json();
  assert.equal(body.stage, "OPPORTUNITY_RESEARCH");
  assert.equal(
    body.opportunities,
    (await db.query("SELECT count(*)::int n FROM opportunities")).rows[0].n,
  );
  assert.equal(typeof body.documents, "number");
  assert.equal(body.qualityGate.scope, "opportunity");
  assert.equal(body.qualityGate.passed, undefined);
});
test("invalid URLs and cross-origin writes cannot queue fetches", async () => {
  const bad = await app.inject({
    method: "POST",
    url: "/api/ingest",
    payload: { source: "manual", url: "http://127.0.0.1" },
  });
  assert.equal(bad.statusCode, 400);
  const cross = await app.inject({
    method: "POST",
    url: "/api/ingest",
    headers: { origin: "https://attacker.example" },
    payload: { source: "manual", url: "https://example.com" },
  });
  assert.equal(cross.statusCode, 403);
});
test("review requires an existing document and persists apart from raw facts", async () => {
  const bad = await app.inject({
    method: "POST",
    url: `/api/documents/${crypto.randomUUID()}/review`,
    payload: { status: "accepted", note: "Read source" },
  });
  assert.equal(bad.statusCode, 404);
});
test("founder profile survives a read after update", async () => {
  const put = await app.inject({
    method: "PUT",
    url: "/api/founder",
    payload: {
      technicalStrength: "TypeScript",
      preferredProductTypes: "B2B tools",
      preferredDistribution: "SEO",
      capitalPreference: "bootstrapped",
      salesPreference: "self serve",
      avoidedMarkets: "",
      riskPreference: "low",
    },
  });
  assert.equal(put.statusCode, 200);
  const get = await app.inject("/api/founder");
  assert.equal(get.json().technicalStrength, "TypeScript");
});
test("unsupported Reddit payload is rejected without creating documents", async () => {
  const before = await app.inject("/api/summary");
  const bad = await app.inject({
    method: "POST",
    url: "/api/reddit/import",
    payload: { thread: { title: "headline only" } },
  });
  assert.equal(bad.statusCode, 400);
  const after = await app.inject("/api/summary");
  assert.equal(before.json().documents, after.json().documents);
});
test("accepting a document writes a review without mutating source body", async () => {
  const { saveDocuments } = await import("../packages/db/src/repository.js");
  const [doc] = await saveDocuments(db, [
    {
      sourceKey: "manual",
      externalId: crypto.randomUUID(),
      canonicalUrl: "https://example.com",
      type: "article",
      body: "Review test source with original content.",
      metadata: { test: true },
    },
  ]);
  const result = await app.inject({
    method: "POST",
    url: `/api/documents/${doc.id}/review`,
    payload: { status: "accepted", note: "Complete source" },
  });
  assert.equal(result.statusCode, 200);
  const detail = (await app.inject(`/api/documents/${doc.id}`)).json();
  assert.equal(detail.review_status, "accepted");
  assert.equal(detail.body, "Review test source with original content.");
  assert.equal(detail.review_note, "Complete source");
});
test("Reddit valid nested import is replay-safe and exposes thread context", async () => {
  const id = "a" + Date.now().toString(36);
  const thread = [
    {
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id,
              subreddit: "testing",
              title: "Test fixture",
              selftext: "Fixture only: a recurring manual task.",
              author: "tester",
              created_utc: 1700000000,
            },
          },
        ],
      },
    },
    {
      data: {
        children: [
          {
            kind: "t1",
            data: {
              id: id + "c",
              body: "Fixture comment with recurring workflow.",
              author: "another",
              parent_id: "t3_" + id,
              link_id: "t3_" + id,
              created_utc: 1700000001,
            },
          },
        ],
      },
    },
  ];
  const first = await app.inject({
    method: "POST",
    url: "/api/reddit/import",
    payload: { thread },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().count, 2);
  const second = await app.inject({
    method: "POST",
    url: "/api/reddit/import",
    payload: { thread },
  });
  assert.deepEqual(first.json().documents, second.json().documents);
  const detail = (
    await app.inject("/api/documents/" + first.json().documents[1])
  ).json();
  assert.equal(detail.context.length, 2);
  assert.equal(detail.parent_external_id, "t3_" + id);
  assert.equal(detail.metadata.acquisition, "manual_import");
});
test("large Reddit contexts retain root and explicitly report truncation", async () => {
  const id = "x" + Date.now().toString(36);
  const thread = [
    {
      data: {
        children: [
          {
            kind: "t3",
            data: {
              id,
              subreddit: "testing",
              title: "Long fixture",
              selftext: "Testing long thread root retention.",
            },
          },
        ],
      },
    },
    {
      data: {
        children: Array.from({ length: 301 }, (_, i) => ({
          kind: "t1",
          data: {
            id: id + i,
            body: `Fixture comment number ${i}`,
            parent_id: "t3_" + id,
            link_id: "t3_" + id,
          },
        })),
      },
    },
  ];
  const imported = await app.inject({
    method: "POST",
    url: "/api/reddit/import",
    payload: { thread },
  });
  assert.equal(imported.statusCode, 200);
  const detail = (
    await app.inject("/api/documents/" + imported.json().documents[1])
  ).json();
  assert.equal(detail.context[0].type, "post");
  assert.equal(detail.context.length, 300);
  assert.equal(detail.contextTruncated, true);
});
test("milestone document count does not grow when only a source snapshot changes", async () => {
  const { saveDocuments } = await import("../packages/db/src/repository.js");
  const doc = {
    sourceKey: "manual" as const,
    externalId: crypto.randomUUID(),
    canonicalUrl: "https://example.com/source",
    type: "article" as const,
    body: "First source snapshot.",
    metadata: { test: true },
  };
  await saveDocuments(db, [doc]);
  const first = (await app.inject("/api/summary")).json();
  await saveDocuments(db, [{ ...doc, body: "Updated source snapshot." }]);
  const second = (await app.inject("/api/summary")).json();
  assert.equal(first.documents, second.documents);
  assert.equal(second.snapshots, first.snapshots + 1);
});

test("topic discovery validates sources and reuses active jobs per query", async () => {
  const app = await buildApp(db);
  try {
    const query = "topic-test-" + crypto.randomUUID();
    const request = {
      method: "POST" as const,
      url: "/api/discovery",
      payload: { query, sources: ["github", "hn", "stackoverflow"] },
    };
    const first = await app.inject(request),
      second = await app.inject(request);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json().jobIds, second.json().jobIds);
    assert.equal(first.json().jobIds.length, 3);
    assert.equal(
      (
        await app.inject({
          ...request,
          payload: { query, sources: ["untrusted"] },
        })
      ).statusCode,
      400,
    );
    const results = await app.inject(
      `/api/discovery/${first.json().jobIds[0]}/documents`,
    );
    assert.deepEqual(results.json().items, []);
  } finally {
    await app.close();
  }
});

test("topic provider reservation permits only one concurrent request slot", async () => {
  const { reserveDiscoverySlot } = await import(
    "../packages/db/src/discovery.js"
  );
  const previous = (
    await db.query(
      "SELECT discovery_available_at FROM sources WHERE id='github'",
    )
  ).rows[0].discovery_available_at;
  try {
    await db.query(
      "UPDATE sources SET discovery_available_at=null WHERE id='github'",
    );
    const slots = await Promise.all([
      reserveDiscoverySlot(db, "github"),
      reserveDiscoverySlot(db, "github"),
    ]);
    assert.equal(slots.filter((x) => x === null).length, 1);
    assert.equal(slots.filter((x) => x instanceof Date).length, 1);
  } finally {
    await db.query(
      "UPDATE sources SET discovery_available_at=$1 WHERE id='github'",
      [previous],
    );
  }
});

test("radar history is paginated and old scans remain addressable", async () => {
  const list = await app.inject("/api/radar/history?offset=0");
  assert.equal(list.statusCode, 200);
  assert.ok(Array.isArray(list.json().items));
  assert.equal(typeof list.json().hasMore, "boolean");
  const row = (
    await db.query("SELECT id FROM radar_scans ORDER BY created_at,id LIMIT 1")
  ).rows[0];
  if (row) {
    const detail = await app.inject(`/api/radar/history/${row.id}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().scan.id, row.id);
    assert.ok(Array.isArray(detail.json().scan.jobs));
  }
  assert.equal(
    (await app.inject("/api/radar/history/not-an-id")).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject(
        "/api/radar/history/00000000-0000-4000-8000-000000000000",
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await app.inject("/api/radar/history?offset=-1")).statusCode,
    400,
  );
});

test("radar history validates filters and returns filtered counts with bounded pages", async () => {
  for (const query of [
    "limit=11",
    "limit=100",
    "limit=-1",
    "offset=1.5",
    "offset=100001",
    "status=unknown",
    "order=random",
    "q=" + "x".repeat(201),
  ]) {
    assert.equal(
      (await app.inject(`/api/radar/history?${query}`)).statusCode,
      400,
      query,
    );
  }
  const marker = `history-${crypto.randomUUID()}`;
  const ids: string[] = [];
  try {
    for (let i = 0; i < 23; i++) {
      const result = await db.query(
        "INSERT INTO radar_scans(status,created_at,report,coverage) VALUES($1,$2,$3,$4) RETURNING id",
        [
          i === 22 ? "failed" : "complete",
          new Date(Date.UTC(2026, 0, 1, 0, i)),
          JSON.stringify({
            summary: `${marker} summary`,
            recommendations: [{ title: `${marker} title ${i}` }],
          }),
          JSON.stringify({ collected: i }),
        ],
      );
      ids.push(result.rows[0].id);
    }
    const first = await app.inject(
      `/api/radar/history?q=${marker}&limit=10&order=asc`,
    );
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().total, 23);
    assert.equal(first.json().limit, 10);
    assert.equal(first.json().offset, 0);
    assert.equal(first.json().hasMore, true);
    assert.deepEqual(
      first.json().items.map((item: { id: string }) => item.id),
      ids.slice(0, 10),
    );
    const last = await app.inject(
      `/api/radar/history?q=${marker}&limit=10&offset=20&order=asc`,
    );
    assert.equal(last.json().total, 23);
    assert.equal(last.json().hasMore, false);
    assert.deepEqual(
      last.json().items.map((item: { id: string }) => item.id),
      ids.slice(20),
    );
    const descending = await app.inject(
      `/api/radar/history?q=${marker}&limit=20`,
    );
    assert.equal(descending.json().items.length, 20);
    assert.equal(descending.json().items[0].id, ids[22]);
    const all = await app.inject(
      `/api/radar/history?q=${marker}&limit=50&status=complete`,
    );
    assert.equal(all.json().total, 22);
    assert.equal(all.json().items.length, 22);
    assert.equal(all.json().hasMore, false);
    const failed = await app.inject(
      `/api/radar/history?q=${marker}&status=failed`,
    );
    assert.equal(failed.json().total, 1);
    assert.equal(failed.json().items[0].id, ids[22]);
    for (const q of [ids[0], `${marker} title 0`, `${marker} summary`]) {
      const found = await app.inject(
        `/api/radar/history?q=${encodeURIComponent(q)}&limit=50`,
      );
      assert.ok(
        found.json().items.some((item: { id: string }) => item.id === ids[0]),
        q,
      );
    }
    const emptyPage = await app.inject(
      `/api/radar/history?q=${marker}&offset=50`,
    );
    assert.equal(emptyPage.json().total, 23);
    assert.deepEqual(emptyPage.json().items, []);
    assert.equal(emptyPage.json().hasMore, false);
    const literal = await app.inject(
      `/api/radar/history?q=${encodeURIComponent(marker + "%")}`,
    );
    assert.equal(
      literal.json().total,
      0,
      "Search metacharacters must remain literal",
    );
  } finally {
    await db.query("DELETE FROM radar_scans WHERE id=ANY($1::uuid[])", [ids]);
  }
});
