import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { researchProduct } from "../packages/opportunities/src/research.js";
import { saveDocuments } from "../packages/db/src/repository.js";
import type {
  LLMProvider,
  ModelRequest,
} from "../packages/llm/src/provider.js";
const db = new pg.Pool({
  connectionString: "postgresql://radar@127.0.0.1:55432/radar_test",
});
after(() => db.end());
test("research never invents quotes and commits only with a valid lease", async () => {
  const p = (
    await db.query(
      "INSERT INTO winning_products(domain,name) VALUES($1,$2) RETURNING id",
      ["example.com", "research-test"],
    )
  ).rows[0];
  const [doc] = await saveDocuments(db, [
    {
      sourceKey: "winner",
      externalId: crypto.randomUUID(),
      canonicalUrl: "https://example.com/research",
      body: "Product overview.\nA $9 plan exists.",
      type: "article",
      metadata: { test: true },
    },
  ]);
  await db.query("INSERT INTO product_documents VALUES($1,$2)", [p.id, doc.id]);
  const j = (
    await db.query(
      "INSERT INTO jobs(type,payload,idempotency_key) VALUES('ANALYZE_PRODUCT',$1,$2) RETURNING id",
      [JSON.stringify({ productId: p.id }), crypto.randomUUID()],
    )
  ).rows[0];
  const token = crypto.randomUUID();
  await db.query(
    "UPDATE jobs SET status='running',lock_token=$2,locked_until=now()+interval '120 seconds' WHERE id=$1",
    [j.id, token],
  );
  let invalid = true;
  const provider: LLMProvider = {
    async generateStructured<T>(req: ModelRequest) {
      return {
        value: (req.promptName === "opportunity-evidence"
          ? {
              claims: [
                {
                  kind: "pain",
                  statement: "存在付费方案",
                  sourceLine: invalid ? 9999 : 1,
                },
              ],
            }
          : {
              proposals: [{ title: "细分方案", dossier: {}, claimIds: ["C0"] }],
            }) as T,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCost: null,
      };
    },
    async generateText() {
      throw Error("unused");
    },
  };
  await assert.rejects(
    researchProduct(db, p.id, j.id, {
      provider,
      model: "fixture",
      lockToken: token,
      checkLease: async () => true,
    }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM opportunities WHERE research_job_id=$1",
        [j.id],
      )
    ).rows[0].n,
    0,
  );
  invalid = false;
  await assert.rejects(
    researchProduct(db, p.id, j.id, {
      provider,
      model: "fixture",
      lockToken: token,
      checkLease: async () => false,
    }),
    /租约/,
  );
  await assert.rejects(
    researchProduct(db, p.id, j.id, {
      provider,
      model: "fixture",
      lockToken: crypto.randomUUID(),
      checkLease: async () => true,
    }),
    /租约/,
  );
  await researchProduct(db, p.id, j.id, {
    provider,
    model: "fixture",
    lockToken: token,
    localization: { sourceMarket: "美国", targetMarket: "亚洲（不含中国）" },
    checkLease: async () => true,
  });
  await researchProduct(db, p.id, j.id, {
    provider,
    model: "fixture",
    lockToken: token,
    localization: { sourceMarket: "美国", targetMarket: "亚洲（不含中国）" },
    checkLease: async () => true,
  });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM opportunities WHERE research_job_id=$1",
        [j.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("SELECT status FROM jobs WHERE id=$1", [j.id])).rows[0]
      .status,
    "succeeded",
  );
  const c = (
    await db.query("SELECT * FROM evidence_claims WHERE product_id=$1", [p.id])
  ).rows[0];
  const localized = (
    await db.query(
      "SELECT dossier FROM opportunities WHERE research_job_id=$1",
      [j.id],
    )
  ).rows[0].dossier;
  assert.equal(localized.opportunityType, "localization");
  assert.equal(localized.targetMarket, "亚洲（不含中国）");
  assert.equal(localized.sourceMarket, "美国");
  assert.equal(c.quote, "A $9 plan exists.");
  assert.equal(c.review_status, "pending");
  assert.equal(c.kind, "market");
  assert.match(c.statement, /产品方声明/);
});
