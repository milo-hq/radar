import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "../../../packages/db/src/index.js";
import { enqueue } from "../../../packages/db/src/jobs.js";
import { translationConfig } from "../../../packages/llm/src/compatible.js";
import {
  dossierSchema,
  claimSchema,
  insertClaim,
  getOpportunity,
} from "../../../packages/opportunities/src/service.js";
const idOf = (r: any) => z.uuid().parse(r.params.id);
function error(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}
function configured() {
  try {
    return !!translationConfig();
  } catch {
    return false;
  }
}
export function registerOpportunities(app: FastifyInstance, db: Pool) {
  app.get("/api/workspace", async () => {
    const rows = (await db.query("SELECT id,status FROM opportunities")).rows;
    const values = await Promise.all(rows.map((r) => getOpportunity(db, r.id)));
    return {
      opportunities: rows.length,
      products: (await db.query("SELECT count(*)::int n FROM winning_products"))
        .rows[0].n,
      claims: (await db.query("SELECT count(*)::int n FROM evidence_claims"))
        .rows[0].n,
      ready: values.filter((o) => o.status !== "KILL" && o.readiness.ready)
        .length,
      drafts: values.filter((o) => o.status !== "KILL" && !o.readiness.ready)
        .length,
      killed: values.filter((o) => o.status === "KILL").length,
      researchConfigured: configured(),
      llmConfigured: configured(),
      redditConfigured: !!process.env.REDDIT_ACCESS_TOKEN,
      vectorAvailable: !!(
        await db.query("SELECT 1 FROM pg_extension WHERE extname='vector'")
      ).rowCount,
    };
  });
  app.get("/api/opportunities", async () => ({
    items: await Promise.all(
      (
        await db.query("SELECT id FROM opportunities ORDER BY created_at DESC")
      ).rows.map((o) => getOpportunity(db, o.id)),
    ),
  }));
  app.get(
    "/api/opportunities/:id",
    async (r) =>
      (await getOpportunity(db, idOf(r))) ?? error("机会不存在", 404),
  );
  app.post("/api/opportunities", async (r) => {
    const b = z
      .object({
        productId: z.uuid(),
        title: z.string().trim().min(1).max(300),
        dossier: dossierSchema.default(dossierSchema.parse({})),
      })
      .parse(r.body);
    if (
      !(
        await db.query("SELECT 1 FROM winning_products WHERE id=$1", [
          b.productId,
        ])
      ).rowCount
    )
      error("参考产品不存在", 404);
    return (
      await db.query(
        "INSERT INTO opportunities(product_id,title,dossier,founder_snapshot) VALUES($1,$2,$3,(SELECT profile FROM founder_profiles WHERE id=1)) RETURNING *",
        [b.productId, b.title, JSON.stringify(b.dossier)],
      )
    ).rows[0];
  });
  app.patch("/api/opportunities/:id", async (r) => {
    const b = z
      .object({
        title: z.string().trim().min(1).max(300).optional(),
        dossier: dossierSchema.optional(),
      })
      .parse(r.body);
    return transaction(db, async (c) => {
      const old = (
        await c.query("SELECT * FROM opportunities WHERE id=$1 FOR UPDATE", [
          idOf(r),
        ])
      ).rows[0];
      if (!old) error("机会不存在", 404);
      await c.query(
        "UPDATE opportunities SET title=$2,dossier=$3,updated_at=now() WHERE id=$1",
        [
          old.id,
          b.title ?? old.title,
          JSON.stringify(b.dossier ?? old.dossier),
        ],
      );
      return { ok: true };
    });
  });
  app.post("/api/opportunities/:id/claims", async (r) => {
    const b = z.object({ claimId: z.uuid() }).parse(r.body);
    const o = await getOpportunity(db, idOf(r));
    if (!o) error("机会不存在", 404);
    const claim = (
      await db.query("SELECT * FROM evidence_claims WHERE id=$1", [b.claimId])
    ).rows[0];
    if (!claim) error("声明不存在", 404);
    await db.query(
      "INSERT INTO opportunity_claims(opportunity_id,claim_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [o.id, b.claimId],
    );
    return { ok: true };
  });
  app.get("/api/claims", async (r) => {
    const q = z.object({ productId: z.uuid().optional() }).parse(r.query);
    return {
      items: (
        await db.query(
          "SELECT c.*,d.canonical_url url FROM evidence_claims c JOIN raw_documents d ON d.id=c.raw_document_id WHERE ($1::uuid IS NULL OR c.product_id=$1) ORDER BY c.created_at DESC",
          [q.productId ?? null],
        )
      ).rows,
    };
  });
  app.post("/api/claims", async (r) => {
    const b = claimSchema.parse(r.body);
    if (
      !(
        await db.query("SELECT 1 FROM winning_products WHERE id=$1", [
          b.productId,
        ])
      ).rowCount
    )
      error("参考产品不存在", 404);
    return transaction(db, (c) => insertClaim(c, b, "human"));
  });
  app.patch("/api/claims/:id", async (r) => {
    const b = z
      .object({
        reviewStatus: z.enum(["accepted", "rejected", "pending"]),
        opportunityId: z.uuid().optional(),
      })
      .parse(r.body);
    return transaction(db, async (c) => {
      if (b.opportunityId) {
        const linked = await c.query(
          "UPDATE opportunity_claims SET review_status=$3 WHERE opportunity_id=$1 AND claim_id=$2 RETURNING claim_id",
          [b.opportunityId, idOf(r), b.reviewStatus],
        );
        if (!linked.rowCount) error("机会未关联该声明", 404);
      }
      const row = await c.query(
        "UPDATE evidence_claims SET review_status=$2,reviewed_at=now() WHERE id=$1 RETURNING id",
        [idOf(r), b.reviewStatus],
      );
      if (!row.rowCount) error("声明不存在", 404);
      await c.query(
        "INSERT INTO audit_logs(action,entity_id,details) VALUES('review_claim',$1,$2)",
        [idOf(r), JSON.stringify(b)],
      );
      return { ok: true };
    });
  });
  app.post("/api/opportunities/:id/decisions", async (r) => {
    const b = z
      .object({
        decision: z.enum(["WATCH", "VALIDATE", "KILL"]),
        reason: z.string().trim().min(1).max(6000),
      })
      .parse(r.body);
    return transaction(db, async (c) => {
      await c.query("SELECT id FROM opportunities WHERE id=$1 FOR UPDATE", [
        idOf(r),
      ]);
      // Lock the reviewed evidence while making an auditable decision.
      await c.query(
        "SELECT c.id FROM evidence_claims c JOIN opportunity_claims oc ON oc.claim_id=c.id WHERE oc.opportunity_id=$1 FOR SHARE OF c",
        [idOf(r)],
      );
      const o = await getOpportunity(c, idOf(r));
      if (!o) error("机会不存在", 404);
      if (b.decision === "VALIDATE") {
        if (!o.readiness.ready) error("先核对市场与需求证据，再进入验证");
        const v = dossierSchema.parse(o.dossier).validation;
        if (Object.values(v).some((x) => !x.trim()))
          error("请填写验证方式、预算、期限、成功和终止条件");
      }
      await c.query(
        "INSERT INTO opportunity_decisions(opportunity_id,decision,reason,snapshot) VALUES($1,$2,$3,$4)",
        [
          o.id,
          b.decision,
          b.reason,
          JSON.stringify({
            dossier: o.dossier,
            claims: o.claims,
            readiness: o.readiness,
            founder: o.founder_snapshot,
          }),
        ],
      );
      await c.query(
        "UPDATE opportunities SET status=$2,updated_at=now() WHERE id=$1",
        [o.id, b.decision],
      );
      return { ok: true };
    });
  });
  app.post("/api/products", async (r) => {
    const b = z
      .object({ name: z.string().trim().min(1).max(300), url: z.url() })
      .parse(r.body);
    const url = new URL(b.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      error("请使用公开产品网址");
    return transaction(db, async (c) => {
      const old = (
        await c.query(
          "SELECT p.* FROM product_identifiers i JOIN winning_products p ON p.id=i.product_id WHERE url=$1",
          [url.href],
        )
      ).rows[0];
      if (old) return old;
      const p = (
        await c.query(
          "INSERT INTO winning_products(domain,name) VALUES($1,$2) RETURNING *",
          [url.hostname, b.name],
        )
      ).rows[0];
      await c.query("INSERT INTO product_identifiers VALUES($1,$2)", [
        p.id,
        url.href,
      ]);
      return p;
    });
  });
  app.post("/api/products/:id/documents", async (r) => {
    const b = z.object({ documentId: z.uuid() }).parse(r.body);
    if (
      !(await db.query("SELECT 1 FROM winning_products WHERE id=$1", [idOf(r)]))
        .rowCount ||
      !(
        await db.query("SELECT 1 FROM raw_documents WHERE id=$1", [
          b.documentId,
        ])
      ).rowCount
    )
      error("产品或原文不存在", 404);
    await db.query(
      "INSERT INTO product_documents VALUES($1,$2) ON CONFLICT DO NOTHING",
      [idOf(r), b.documentId],
    );
    return { ok: true };
  });
  app.post("/api/products/:id/research", async (r) => {
    const id = idOf(r);
    if (!configured()) error("请先配置研究模型（复用中文翻译 API 配置）", 503);
    if (
      !(
        await db.query("SELECT 1 FROM product_documents WHERE product_id=$1", [
          id,
        ])
      ).rowCount
    )
      error("请先关联产品官网、评论或需求原文");
    return transaction(db, async (c) => {
      await c.query("SELECT id FROM winning_products WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      const active = (
        await c.query(
          "SELECT id FROM jobs WHERE type='ANALYZE_PRODUCT' AND payload->>'productId'=$1 AND status IN ('pending','running') LIMIT 1",
          [id],
        )
      ).rows[0];
      if (active) return { jobId: active.id };
      const job = await enqueue(
        c,
        "ANALYZE_PRODUCT",
        { productId: id, name: "机会研究" },
        "research:" + id + ":" + crypto.randomUUID(),
      );
      await c.query("UPDATE jobs SET max_attempts=2 WHERE id=$1", [job.id]);
      return { jobId: job.id };
    });
  });
}
