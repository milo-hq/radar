import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import "dotenv/config";
import { saveDocuments } from "../packages/db/src/repository.js";
import {
  enqueue,
  claimJob,
  finishJob,
  failJob,
} from "../packages/db/src/jobs.js";
const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgresql://radar@127.0.0.1:55432/radar_test",
});
after(() => pool.end());
const externalId = `test-${crypto.randomUUID()}`;
const doc = {
  sourceKey: "manual" as const,
  externalId,
  canonicalUrl: "https://example.com",
  type: "article" as const,
  body: "This is a preserved market source.",
  metadata: { test: true },
};
test("immutable snapshots deduplicate replay and append changed sources", async () => {
  const [a] = await saveDocuments(pool, [doc]);
  const [b] = await saveDocuments(pool, [doc]);
  assert.equal(a.id, b.id);
  const [c] = await saveDocuments(pool, [
    { ...doc, body: "A changed market source." },
  ]);
  assert.notEqual(a.id, c.id);
  await assert.rejects(
    pool.query("UPDATE raw_documents SET body=$1 WHERE id=$2", [
      "changed",
      a.id,
    ]),
    /immutable/,
  );
  await assert.rejects(
    pool.query("DELETE FROM raw_documents WHERE id=$1", [a.id]),
    /immutable/,
  );
});
test("queue idempotency, concurrent claim, fencing and retry limit hold in Postgres", async () => {
  const key = crypto.randomUUID();
  const job = await enqueue(
    pool,
    "FETCH_SOURCE",
    { url: "https://example.com", test: true },
    key,
  );
  const again = await enqueue(
    pool,
    "FETCH_SOURCE",
    { url: "https://example.com" },
    key,
  );
  assert.equal(again.id, job.id);
  const claimed = await Promise.all([
    claimJob(pool, job.id),
    claimJob(pool, job.id),
  ]);
  assert.equal(claimed.filter(Boolean).length, 1);
  const first = claimed.find(Boolean)!;
  await pool.query(
    "UPDATE jobs SET locked_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  const second = await claimJob(pool, job.id);
  assert.ok(second);
  assert.equal(await finishJob(pool, first), false);
  await failJob(pool, second, "temporary failure");
  let row = (await pool.query("SELECT * FROM jobs WHERE id=$1", [job.id]))
    .rows[0];
  assert.equal(row.status, "pending");
  assert.ok(new Date(row.run_at).getTime() > Date.now());
  await pool.query("UPDATE jobs SET attempts=3,run_at=now() WHERE id=$1", [
    job.id,
  ]);
  const last = await claimJob(pool, job.id);
  await failJob(pool, last!, "last failure");
  row = (await pool.query("SELECT * FROM jobs WHERE id=$1", [job.id])).rows[0];
  assert.equal(row.status, "failed");
});
test("a malformed document batch rolls back every insert", async () => {
  const batchId = crypto.randomUUID();
  await assert.rejects(
    saveDocuments(pool, [
      { ...doc, externalId: batchId },
      { ...doc, externalId: batchId + "-2", body: "" },
    ]),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM raw_documents WHERE external_id=$1",
        [batchId],
      )
    ).rows[0].n,
    0,
  );
});
test("disabled model runs store failure and unknown cost instead of fabricated usage", async () => {
  const { runStructured } = await import("../packages/llm/src/run.js");
  const { DisabledProvider } = await import("../packages/llm/src/provider.js");
  const { z } = await import("zod");
  const model = "disabled-" + crypto.randomUUID();
  await assert.rejects(
    runStructured(
      pool,
      new DisabledProvider(),
      {
        promptName: "signal-extractor",
        promptVersion: "v1",
        model,
        input: { documents: [] },
      },
      z.object({ claims: z.array(z.string()) }),
    ),
    /LLM_DISABLED/,
  );
  const row = (
    await pool.query("SELECT * FROM model_runs WHERE model=$1", [model])
  ).rows[0];
  assert.equal(row.success, false);
  assert.equal(row.schema_valid, false);
  assert.equal(row.estimated_cost, null);
  assert.equal(row.input_tokens, null);
});
test("redirected product aliases resolve to the canonical source domain", async () => {
  const { transaction } = await import("../packages/db/src/index.js");
  const { linkProduct, insertDocuments } = await import(
    "../packages/db/src/repository.js"
  );
  const key = crypto.randomUUID().replaceAll("-", "");
  const canonical = `https://${key}.example.com/pricing`;
  const result = await transaction(pool, async (c) => {
    const rows = await insertDocuments(c, [
      { ...doc, externalId: key, canonicalUrl: canonical },
    ]);
    return linkProduct(
      c,
      "Alias Product",
      `https://alias-${key}.example.com`,
      rows,
    );
  });
  assert.equal(result.domain, `${key}.example.com`);
});
