import { z } from "zod";
import type { Pool, PoolClient } from "pg";
const text = z.string().max(6000).default("");
export const dossierSchema = z.object({
  opportunityType: z.enum(["workflow", "localization"]).default("workflow"),
  sourceMarket: text,
  targetMarket: text,
  entryMarket: text,
  sourceSuccess: text,
  localAlternatives: text,
  localDemand: text,
  localizationStrategy: text,
  transferRisks: text,
  customer: text,
  buyer: text,
  job: text,
  gap: text,
  currentSolution: text,
  comparisonBlocker: text,
  unmetNeed: text,
  whyUnsolved: text,
  soloWedge: text,
  offer: text,
  monetization: text,
  acquisition: text,
  buildEstimate: text,
  maintenance: text,
  risks: text,
  unknowns: text,
  validation: z
    .object({
      test: text,
      budget: text,
      duration: text,
      success: text,
      kill: text,
    })
    .default({ test: "", budget: "", duration: "", success: "", kill: "" }),
});
export const claimSchema = z.object({
  productId: z.uuid(),
  documentId: z.uuid(),
  kind: z.enum(["market", "pain", "revenue", "distribution"]),
  statement: z.string().trim().min(1).max(6000),
  quote: z.string().min(1).max(12000),
});
export function readiness(claims: any[], dossier: any = {}) {
  const accepted = claims.filter((c) => c.review_status === "accepted");
  const missing = [];
  if (dossier.opportunityType === "localization") {
    const a = (dossier.sourceMarket ?? "").trim().toLowerCase(),
      b = (dossier.targetMarket ?? "").trim().toLowerCase();
    if (!a || !b || a === b) missing.push("请填写不同的来源地区A与目标地区B");
    if (
      !accepted.some((c) => c.kind === "revenue" && c.market_role === "source")
    )
      missing.push("缺少人工确认的A地区收入证据（不能只用定价证明成功）");
    if (!accepted.some((c) => c.kind === "pain" && c.market_role === "target"))
      missing.push("缺少人工确认的B地区需求/痛点证据");
    return { ready: missing.length === 0, missing };
  }
  if (!accepted.some((c) => ["market", "revenue"].includes(c.kind)))
    missing.push("缺少人工确认的产品 / 商业证据");
  if (!accepted.some((c) => c.kind === "pain"))
    missing.push("缺少人工确认的需求 / 痛点证据");
  return { ready: missing.length === 0, missing };
}
export async function getOpportunity(db: Pool | PoolClient, id: string) {
  const o = (
    await db.query(
      "SELECT o.*,p.name product_name FROM opportunities o JOIN winning_products p ON p.id=o.product_id WHERE o.id=$1",
      [id],
    )
  ).rows[0];
  if (!o) return null;
  o.claims = (
    await db.query(
      "SELECT c.*,oc.review_status,oc.market_role,d.canonical_url url,d.collected_at FROM opportunity_claims oc JOIN evidence_claims c ON c.id=oc.claim_id JOIN raw_documents d ON d.id=c.raw_document_id WHERE oc.opportunity_id=$1 ORDER BY c.created_at",
      [id],
    )
  ).rows;
  o.readiness = readiness(o.claims, o.dossier);
  o.decisions = (
    await db.query(
      "SELECT * FROM opportunity_decisions WHERE opportunity_id=$1 ORDER BY created_at DESC",
      [id],
    )
  ).rows;
  return o;
}
export async function insertClaim(
  db: PoolClient,
  input: z.infer<typeof claimSchema>,
  origin: "human" | "model",
) {
  const doc = (
    await db.query("SELECT body FROM raw_documents WHERE id=$1", [
      input.documentId,
    ])
  ).rows[0];
  if (!doc || !input.quote.trim() || !doc.body.includes(input.quote))
    throw Object.assign(new Error("原文不存在或摘录与原文不一致"), {
      statusCode: 400,
    });
  const { rows } = await db.query(
    `INSERT INTO evidence_claims(product_id,raw_document_id,kind,statement,quote,origin) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(product_id,raw_document_id,kind,identity_hash) DO UPDATE SET statement=evidence_claims.statement RETURNING *`,
    [
      input.productId,
      input.documentId,
      input.kind,
      input.statement,
      input.quote,
      origin,
    ],
  );
  if (rows[0].statement !== input.statement || rows[0].quote !== input.quote)
    throw new Error("声明标识冲突，未保存");
  await db.query(
    "INSERT INTO product_documents VALUES($1,$2) ON CONFLICT DO NOTHING",
    [input.productId, input.documentId],
  );
  return rows[0];
}
