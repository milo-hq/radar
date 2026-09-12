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
  assert.equal(body.opportunities, (await db.query("SELECT count(*)::int n FROM opportunities")).rows[0].n);
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
