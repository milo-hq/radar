import { registerRadar } from "./radar.js";
import { registerDiscovery } from "./discovery.js";
import { registerOpportunities } from "./opportunities.js";
import { translationConfig } from "../../../packages/llm/src/compatible.js";
import { registerTranslations } from "./translations.js";
import Fastify from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { transaction } from "../../../packages/db/src/index.js";
import { enqueue, safeError } from "../../../packages/db/src/jobs.js";
import { saveDocuments } from "../../../packages/db/src/repository.js";
import { assertPublicUrl } from "../../../packages/connectors/src/http.js";
import { parseRedditThread } from "../../../packages/connectors/src/reddit.js";
const uuid = z.uuid();
const ingestSchema = z.object({
  source: z.enum(["manual", "winner", "reddit"]),
  url: z.url().max(2000),
  name: z.string().max(200).default(""),
});
const founderSchema = z.object({
  technicalStrength: z.string().max(2000),
  preferredProductTypes: z.string().max(2000),
  preferredDistribution: z.string().max(2000),
  capitalPreference: z.string().max(2000),
  salesPreference: z.string().max(2000),
  avoidedMarkets: z.string().max(2000),
  riskPreference: z.string().max(2000),
  hoursPerWeek: z.string().max(100).optional(),
  maxBuildWeeks: z.string().max(100).optional(),
  budget: z.string().max(200).optional(),
  maintenanceTolerance: z.string().max(2000).optional(),
});
export async function buildApp(db: Pool) {
  const app = Fastify({ bodyLimit: 3_000_000, logger: false });
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host?.split(":")[0];
    if (host && !["localhost", "127.0.0.1"].includes(host))
      return reply.code(403).send({ error: "Local access only" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin
    ) {
      let origin = "";
      try {
        origin = new URL(req.headers.origin).origin;
      } catch {}
      const allowed = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        `http://127.0.0.1:${process.env.PORT ?? 4317}`,
        `http://localhost:${process.env.PORT ?? 4317}`,
      ];
      if (!allowed.includes(origin))
        return reply
          .code(403)
          .send({ error: "Cross-origin writes are not allowed" });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const clientError =
      e instanceof z.ZodError ||
      /allowed|Expected|requires|required|invalid|Reddit|Source|URL/i.test(
        e.message,
      );
    reply.code(clientError ? 400 : (e.statusCode ?? 500)).send({
      error: clientError
        ? safeError(e)
        : "Request failed; check the server or database connection",
    });
    if (!clientError) console.error(safeError(e));
  });
  app.get("/api/health", async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });
  app.get("/api/summary", async () => {
    const counts = (
      await db.query(
        `SELECT (SELECT count(DISTINCT (source_id,external_id))::int FROM raw_documents) documents,(SELECT count(*)::int FROM raw_documents) snapshots,(SELECT count(DISTINCT external_id)::int FROM raw_documents WHERE source_id='reddit') reddit,(SELECT count(*)::int FROM winning_products) products,(SELECT count(*)::int FROM revenue_signals) revenue,(SELECT count(*)::int FROM document_reviews WHERE status='accepted') reviewed,(SELECT count(*)::int FROM content_groups) content_groups,(SELECT count(*)::int FROM jobs WHERE status='failed') failed_jobs,(SELECT count(*)::int FROM jobs WHERE status IN ('pending','running')) active_jobs`,
      )
    ).rows[0];
    return {
      ...counts,
      stage: "OPPORTUNITY_RESEARCH",
      opportunities: (
        await db.query("SELECT count(*)::int n FROM opportunities")
      ).rows[0].n,
      qualityGate: {
        scope: "opportunity",
        reason: "每个机会按市场与需求证据独立审核；不受全局采集数量限制",
      },
      redditConfigured: !!process.env.REDDIT_ACCESS_TOKEN,
      llmConfigured: (() => {
        try {
          return !!translationConfig();
        } catch {
          return false;
        }
      })(),
      vectorAvailable: !!(
        await db.query("SELECT 1 FROM pg_extension WHERE extname='vector'")
      ).rowCount,
    };
  });
  app.get("/api/documents", async (req) => {
    const q = z
      .object({
        search: z.string().max(300).default(""),
        source: z
          .enum([
            "all",
            "manual",
            "winner",
            "reddit",
            "hn",
            "github",
            "stackoverflow",
            "appstore",
            "wordpress",
            "web",
          ])
          .default("all"),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const params = [`%${q.search}%`, q.source, q.offset];
    const result = await db.query(
      `SELECT d.id,d.source_id,d.external_id,d.canonical_url,d.type,d.title,t.result->>'titleZh' title_zh,left(t.result->>'bodyZh',260) excerpt_zh,left(d.body,260) excerpt,d.author_name,d.thread_external_id,d.parent_external_id,d.published_at,d.collected_at,d.normalized_content_hash,d.metadata->>'subreddit' subreddit,d.metadata->>'contextComplete' context_complete,coalesce(r.status,'pending') review_status FROM raw_documents d LEFT JOIN document_translations t ON t.raw_document_id=d.id AND t.prompt_version='v1' LEFT JOIN document_reviews r ON r.raw_document_id=d.id WHERE (d.title ILIKE $1 OR d.body ILIKE $1 OR t.result->>'titleZh' ILIKE $1 OR t.result->>'bodyZh' ILIKE $1) AND ($2='all' OR d.source_id=$2) ORDER BY d.collected_at DESC,d.id LIMIT 50 OFFSET $3`,
      params,
    );
    const count = (
      await db.query(
        `SELECT count(*)::int n FROM raw_documents d LEFT JOIN document_translations t ON t.raw_document_id=d.id AND t.prompt_version='v1' WHERE (d.title ILIKE $1 OR d.body ILIKE $1 OR t.result->>'titleZh' ILIKE $1 OR t.result->>'bodyZh' ILIKE $1) AND ($2='all' OR d.source_id=$2)`,
        params.slice(0, 2),
      )
    ).rows[0].n;
    return { items: result.rows, total: count };
  });
  app.get("/api/documents/:id", async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const doc = (
      await db.query(
        "SELECT d.*,coalesce(r.status,'pending') review_status,r.note review_note FROM raw_documents d LEFT JOIN document_reviews r ON r.raw_document_id=d.id WHERE d.id=$1",
        [id],
      )
    ).rows[0];
    if (!doc) return reply.code(404).send({ error: "Document not found" });
    const context = doc.thread_external_id
      ? (
          await db.query(
            `SELECT * FROM (SELECT DISTINCT ON(external_id) id,external_id,parent_external_id,type,title,left(body,300) excerpt,author_name,collected_at FROM raw_documents WHERE source_id=$1 AND thread_external_id=$2 ORDER BY external_id,collected_at DESC) latest ORDER BY CASE WHEN type='post' THEN 0 ELSE 1 END,external_id LIMIT 301`,
            [doc.source_id, doc.thread_external_id],
          )
        ).rows
      : [];
    return {
      ...doc,
      context: context.slice(0, 300),
      contextTruncated: context.length > 300,
      contextLimit: 300,
    };
  });
  app.post("/api/documents/:id/review", async (req, reply) => {
    const id = uuid.parse((req.params as any).id),
      body = z
        .object({
          status: z.enum(["accepted", "rejected", "pending"]),
          note: z.string().max(3000).default(""),
        })
        .parse(req.body);
    if (
      !(await db.query("SELECT 1 FROM raw_documents WHERE id=$1", [id]))
        .rowCount
    )
      return reply.code(404).send({ error: "Document not found" });
    await transaction(db, async (c) => {
      await c.query(
        "INSERT INTO document_reviews(raw_document_id,status,note) VALUES($1,$2,$3) ON CONFLICT(raw_document_id) DO UPDATE SET status=$2,note=$3,reviewed_at=now()",
        [id, body.status, body.note],
      );
      await c.query(
        "INSERT INTO audit_logs(action,entity_id,details) VALUES('review_document',$1,$2)",
        [id, JSON.stringify(body)],
      );
    });
    return { ok: true };
  });
  app.get("/api/products", async () => ({
    items: (
      await db.query(
        `SELECT p.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'url',d.canonical_url,'collected_at',d.collected_at)) FROM product_documents pd JOIN raw_documents d ON d.id=pd.raw_document_id WHERE pd.product_id=p.id),'[]') documents,(SELECT count(*)::int FROM revenue_signals r WHERE r.product_id=p.id) revenue_count FROM winning_products p ORDER BY created_at DESC`,
      )
    ).rows,
  }));
  app.post("/api/ingest", async (req) => {
    const data = ingestSchema.parse(req.body);
    assertPublicUrl(data.url);
    if (data.source === "reddit" && !process.env.REDDIT_ACCESS_TOKEN)
      throw new Error(
        "Reddit requires an OAuth token; use thread JSON import instead",
      );
    return enqueue(
      db,
      "FETCH_SOURCE",
      data,
      `fetch:${data.source}:${data.url}:${Math.floor(Date.now() / 60_000)}`,
    );
  });
  app.post("/api/reddit/import", async (req) => {
    const { thread } = z.object({ thread: z.unknown() }).parse(req.body);
    const docs = parseRedditThread(thread, "manual_import");
    const saved = await saveDocuments(db, docs);
    return { count: saved.length, documents: saved.map((d) => d.id) };
  });
  app.get("/api/jobs", async () => ({
    items: (
      await db.query(
        "SELECT id,type,payload,status,attempts,max_attempts,last_error,run_at,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 60",
      )
    ).rows,
  }));
  app.post("/api/jobs/:id/retry", async (req, reply) => {
    const id = uuid.parse((req.params as any).id);
    const result = await db.query(
      "UPDATE jobs SET status='pending',attempts=0,run_at=now(),lock_token=null,locked_until=null,updated_at=now() WHERE id=$1 AND status='failed' RETURNING id",
      [id],
    );
    if (!result.rowCount)
      return reply.code(409).send({ error: "Only failed jobs can be retried" });
    return { ok: true };
  });
  app.get("/api/sources", async () => ({
    items: (await db.query("SELECT * FROM query_profiles ORDER BY next_run_at"))
      .rows,
  }));
  app.post("/api/sources", async (req) => {
    const data = ingestSchema
      .extend({ intervalHours: z.number().int().min(1).max(720).default(24) })
      .parse(req.body);
    assertPublicUrl(data.url);
    return (
      await db.query(
        "INSERT INTO query_profiles(source_id,url,name,interval_hours) VALUES($1,$2,$3,$4) ON CONFLICT(source_id,url) DO UPDATE SET enabled=true,interval_hours=$4,name=$3 RETURNING *",
        [data.source, data.url, data.name, data.intervalHours],
      )
    ).rows[0];
  });
  app.patch("/api/sources/:id", async (req, reply) => {
    const id = uuid.parse((req.params as any).id),
      { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const result = await db.query(
      "UPDATE query_profiles SET enabled=$2 WHERE id=$1 RETURNING *",
      [id, enabled],
    );
    if (!result.rowCount)
      return reply.code(404).send({ error: "Source not found" });
    return result.rows[0];
  });
  app.get(
    "/api/founder",
    async () =>
      (await db.query("SELECT profile FROM founder_profiles WHERE id=1"))
        .rows[0].profile,
  );
  app.put("/api/founder", async (req) => {
    const profile = founderSchema.parse(req.body);
    await db.query(
      "UPDATE founder_profiles SET profile=$1,updated_at=now() WHERE id=1",
      [JSON.stringify(profile)],
    );
    return profile;
  });
  app.get("/api/model-runs", async () => ({
    items: (
      await db.query(
        "SELECT * FROM model_runs ORDER BY created_at DESC LIMIT 50",
      )
    ).rows,
  }));
  registerTranslations(app, db);
  registerOpportunities(app, db);
  registerDiscovery(app, db);
  registerRadar(app, db);
  return app;
}
