import { z } from "zod";
import type { Pool } from "pg";
import type { LLMProvider } from "../../llm/src/provider.js";
import { runStructured } from "../../llm/src/run.js";
import { transaction } from "../../db/src/index.js";
import { dossierSchema, insertClaim } from "./service.js";
export async function researchProduct(
  db: Pool,
  productId: string,
  jobId: string,
  config: {
    provider: LLMProvider;
    model: string;
    checkLease: () => Promise<boolean>;
    lockToken?: string;
  },
) {
  if (!(await config.checkLease())) throw Error("研究任务租约失效");
  if (
    (
      await db.query("SELECT 1 FROM opportunities WHERE research_job_id=$1", [
        jobId,
      ])
    ).rowCount
  )
    return;
  const product = (
    await db.query("SELECT * FROM winning_products WHERE id=$1", [productId])
  ).rows[0];
  if (!product) throw Error("参考产品不存在");
  const founder = (
    await db.query("SELECT profile FROM founder_profiles WHERE id=1")
  ).rows[0].profile;
  const availableDocs = (
    await db.query(
      `SELECT * FROM (SELECT latest.*,row_number() OVER(PARTITION BY (source_id='winner') ORDER BY collected_at DESC) AS source_rank FROM (SELECT DISTINCT ON(d.canonical_url) d.id,d.title,d.body,d.source_id,d.published_at,d.metadata,d.author_external_id,d.thread_external_id,d.normalized_content_hash,d.canonical_url,d.collected_at FROM product_documents pd JOIN raw_documents d ON d.id=pd.raw_document_id WHERE pd.product_id=$1 ORDER BY d.canonical_url,d.collected_at DESC) latest) ranked WHERE source_rank <= 100 ORDER BY collected_at DESC`,
      [productId],
    )
  ).rows;
  const seenContent = new Set<string>(),
    seenVoices = new Set<string>();
  const diverse = availableDocs.filter((d) => {
    const voice = d.author_external_id
      ? `${d.source_id}:${d.thread_external_id || d.canonical_url}:${d.author_external_id}`
      : null;
    if (
      seenContent.has(d.normalized_content_hash) ||
      (voice && seenVoices.has(voice))
    )
      return false;
    seenContent.add(d.normalized_content_hash);
    if (voice) seenVoices.add(voice);
    return true;
  });
  const docs = [
    ...diverse.filter((d) => d.source_id === "winner").slice(0, 2),
    ...diverse.filter((d) => d.source_id !== "winner").slice(0, 6),
  ];
  const lines: { id: number; documentId: string; text: string }[] = [];
  for (const doc of docs)
    for (const line of doc.body.slice(0, 12000).split("\n"))
      if (line.trim())
        lines.push({ id: lines.length, documentId: doc.id, text: line });
  if (!lines.length) throw Error("没有可用研究原文");
  const evidenceSchema = z.object({
    claims: z
      .array(
        z.object({
          kind: z.enum(["market", "pain", "revenue", "distribution"]),
          statement: z.string().trim().min(1).max(6000),
          sourceLine: z
            .number()
            .int()
            .min(0)
            .max(lines.length - 1),
        }),
      )
      .max(12),
  });
  const coverage = docs.map((d) => ({
    id: d.id,
    url: d.canonical_url,
    title: d.title,
    collectedAt: d.collected_at,
    publishedAt: d.published_at,
    author: d.author_external_id,
    thread: d.thread_external_id,
    contextComplete: d.metadata?.contextComplete ?? null,
    contextNote: d.metadata?.contextNote ?? null,
    truncated: d.body.length > 12000,
    provenance:
      d.source_id === "winner"
        ? "product-controlled source"
        : "external source, provenance requires review",
  }));
  const { value: evidence } = await runStructured(
    db,
    config.provider,
    {
      promptName: "opportunity-evidence",
      promptVersion: "v1",
      model: config.model,
      input: {
        product: { id: product.id, name: product.name },
        documents: coverage,
        sourceLines: lines,
      },
    },
    evidenceSchema,
  );
  if (!(await config.checkLease())) throw Error("研究任务租约失效");
  for (const claim of evidence.claims) {
    const doc = docs.find((d) => d.id === lines[claim.sourceLine].documentId);
    if (doc?.source_id === "winner") {
      if (claim.kind === "pain") claim.kind = "market";
      claim.statement = "产品方声明：" + claim.statement;
    }
  }
  const claims = evidence.claims.map((c, i) => ({
    id: `C${i}`,
    kind: c.kind,
    statement: c.statement,
    quote: lines[c.sourceLine].text,
    documentId: lines[c.sourceLine].documentId,
  }));
  const ids = claims.map((c) => c.id);
  const proposalSchema = z.object({
    proposals: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(300),
          dossier: dossierSchema,
          claimIds: ids.length
            ? z.array(z.enum(ids as [string, ...string[]])).max(12)
            : z.array(z.string()).max(0),
        }),
      )
      .min(1)
      .max(3),
  });
  const { value: proposalResult } = await runStructured(
    db,
    config.provider,
    {
      promptName: "opportunity-proposal",
      promptVersion: "v1",
      model: config.model,
      input: {
        product: { id: product.id, name: product.name },
        founder,
        documents: coverage,
        claims,
      },
    },
    proposalSchema,
  );
  for (const proposal of proposalResult.proposals) {
    proposal.dossier.gap = "待验证假设：" + proposal.dossier.gap;
    proposal.dossier.unmetNeed =
      "待核对的需求假设：" + proposal.dossier.unmetNeed;
    proposal.dossier.whyUnsolved =
      "待验证的原因假设：" + proposal.dossier.whyUnsolved;
    proposal.dossier.soloWedge = "待验证的方案：" + proposal.dossier.soloWedge;
    if (!evidence.claims.some((c) => c.kind === "pain"))
      proposal.dossier.unknowns =
        "需求尚未验证：当前材料缺少独立用户痛点证据。" +
        proposal.dossier.unknowns;
  }
  const value = {
    claims: evidence.claims,
    proposals: proposalResult.proposals,
  };
  if (!(await config.checkLease())) throw Error("研究任务租约失效");
  return transaction(db, async (c) => {
    const j = (
      await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [jobId])
    ).rows[0];
    if (
      config.lockToken &&
      (!j ||
        j.status !== "running" ||
        j.lock_token !== config.lockToken ||
        new Date(j.locked_until).getTime() <= Date.now())
    )
      throw Error("研究任务租约失效");
    if (
      (
        await c.query("SELECT 1 FROM opportunities WHERE research_job_id=$1", [
          jobId,
        ])
      ).rowCount
    )
      return;
    const ids: string[] = [];
    for (const claim of value.claims) {
      const line = lines[claim.sourceLine];
      const c1 = await insertClaim(
        c,
        {
          productId,
          documentId: line.documentId,
          kind: claim.kind,
          statement: claim.statement,
          quote: line.text,
        },
        "model",
      );
      ids.push(c1.id);
    }
    for (const proposal of value.proposals) {
      const o = (
        await c.query(
          "INSERT INTO opportunities(product_id,title,dossier,founder_snapshot,research_job_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            productId,
            proposal.title,
            JSON.stringify(proposal.dossier),
            JSON.stringify(founder),
            jobId,
          ],
        )
      ).rows[0];
      for (const claimId of proposal.claimIds)
        await c.query(
          "INSERT INTO opportunity_claims(opportunity_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [o.id, ids[Number(claimId.slice(1))]],
        );
    }
    if (config.lockToken)
      await c.query(
        "UPDATE jobs SET status='succeeded',locked_until=null,lock_token=null,last_error=null,updated_at=now() WHERE id=$1",
        [jobId],
      );
  });
}
