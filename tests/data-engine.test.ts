import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDocuments,
  collectReviews,
  crawlSite,
  crawlerSites,
  extractionBatches,
} from "../packages/radar/src/data-engine.js";
const rows = [
  {
    id: "a",
    source_id: "hn",
    external_id: "1",
    title: "Pain",
    body: "Manual invoice reconciliation is expensive",
    author_external_id: "u",
    published_at: null,
    metadata: {},
  },
];
const cluster = {
  id: "c",
  label: "Pain",
  documentIds: ["a"],
  independentAccounts: 1,
  sourceCount: 1,
  sourceNames: ["hn"],
  recentCount: 0,
  painMentions: 1,
  commercialMentions: 0,
  frictionMentions: 1,
  evidenceScore: 25,
  dimensions: {
    recurrence: 0,
    crossSource: 0,
    recency: null,
    pain: 100,
    commercial: 0,
    friction: 100,
  },
  unknowns: ["verified_willingness_to_pay"],
};
const output = {
  version: "1",
  documentCount: 1,
  uniqueContentCount: 1,
  clusterCount: 1,
  sourceCounts: { hn: 1 },
  clusters: [cluster],
  limitations: ["keyword heuristic"],
};
const respond = (value: unknown) =>
  (async () => new Response(JSON.stringify(value))) as typeof fetch;
test("Python adapter preserves missing dates and validates complete partition before batching", async () => {
  const result = await analyzeDocuments(rows, (async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    assert.equal(input.documents[0].publishedAt, null);
    assert.equal(input.documents[0].authorId, "u");
    return new Response(JSON.stringify(output));
  }) as typeof fetch);
  assert.equal(result.clusters[0].dimensions.recency, null);
  assert.deepEqual(extractionBatches(result), [["a"]]);
  await assert.rejects(
    analyzeDocuments(
      rows,
      respond({ ...output, clusters: [{ ...cluster, documentIds: ["fake"] }] }),
    ),
    /未知文档/,
  );
  await assert.rejects(
    analyzeDocuments(
      rows,
      respond({
        ...output,
        clusters: [{ ...cluster, documentIds: ["a", "a"] }],
      }),
    ),
    /完整覆盖/,
  );
  await assert.rejects(
    analyzeDocuments(rows, respond({ ...output, clusters: [] })),
    /完整覆盖/,
  );
});
test("engine network failure and invalid payload never become a successful zero report", async () => {
  await assert.rejects(
    analyzeDocuments(rows, (async () => {
      throw Error("private connection details");
    }) as typeof fetch),
    /Python 数据引擎暂不可用/,
  );
  await assert.rejects(
    analyzeDocuments(
      rows,
      respond({ ...output, clusters: [{ ...cluster, evidenceScore: 101 }] }),
    ),
  );
});
test("Python collection validates sources and retains partial failure notices", async () => {
  const doc = {
    sourceKey: "wordpress",
    externalId: "plugin:1",
    canonicalUrl: "https://wordpress.org/support/topic/review/",
    type: "review",
    body: "Pricing is too expensive for a small shop.",
    metadata: { productId: "plugin" },
  };
  const result = await collectReviews(
    "wordpress",
    "invoice",
    respond({
      documents: [doc],
      cooldownSeconds: 30,
      quotaRemaining: null,
      errors: ["Second feed unavailable"],
      applications: 1,
    }),
  );
  assert.equal(result.documents[0].sourceKey, "wordpress");
  assert.equal(result.errors.length, 1);
  await assert.rejects(
    collectReviews(
      "wordpress",
      "invoice",
      respond({
        documents: [{ ...doc, sourceKey: "invented" }],
        cooldownSeconds: 0,
        quotaRemaining: null,
        errors: [],
        applications: 1,
      }),
    ),
  );
});

test("long-document fingerprints preserve distinct tails and WordPress display names stay unknown identities", async () => {
  const long = {
    ...rows[0],
    source_id: "wordpress",
    body: "x".repeat(40000) + "unique tail",
    author_external_id: "https://profiles.wordpress.org/unverified/",
  };
  await analyzeDocuments([long], (async (_url, init) => {
    const doc = JSON.parse(String(init?.body)).documents[0];
    assert.equal(doc.body.length, 40000);
    assert.equal(doc.metadata.bodyTruncated, true);
    assert.match(doc.metadata.fullContentHash, /^[0-9a-f]{64}$/);
    assert.equal(doc.authorId, null);
    return new Response(JSON.stringify(output));
  }) as typeof fetch);
});

test("crawler catalog uses GET and batches preserve replay identity and provenance", async () => {
  const site = {
    id: "demo",
    name: "Demo",
    seed: "https://example.com/",
    kind: "community",
    enabled: true,
  };
  assert.equal(
    (
      await crawlerSites((async (_url, init) => {
        assert.equal(init?.method, "GET");
        return new Response(JSON.stringify({ sites: [site] }));
      }) as typeof fetch)
    )[0].id,
    "demo",
  );
  const result = {
    documents: [
      {
        sourceKey: "web",
        externalId: "https://example.com/t/1",
        canonicalUrl: "https://example.com/t/1",
        type: "post",
        body: "Actual discussion",
        metadata: { pageKind: "community" },
      },
    ],
    cooldownSeconds: 0,
    quotaRemaining: null,
    errors: [],
    applications: 0,
    stats: {
      siteId: "demo",
      siteName: "Demo",
      visited: 1,
      discovered: 2,
      rendered: 0,
      cached: 0,
      blocked: 0,
      remaining: 1,
    },
  };
  await crawlSite("demo", "job-1", (async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      siteId: "demo",
      replayKey: "job-1",
    });
    return new Response(JSON.stringify(result));
  }) as typeof fetch);
  await assert.rejects(crawlSite("wrong", "job-1", respond(result)));
  await assert.rejects(
    crawlSite(
      "demo",
      "job-1",
      respond({
        ...result,
        documents: [{ ...result.documents[0], sourceKey: "hn" }],
      }),
    ),
  );
});
