import { z } from "zod";
import { crawlerSites } from "../../../packages/radar/src/data-engine.js";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { startScan } from "../../../packages/radar/src/radar.js";
import { translationConfig } from "../../../packages/llm/src/compatible.js";
export function registerRadar(app: FastifyInstance, db: Pool) {
  const configured = () => {
    try {
      return !!translationConfig();
    } catch {
      return false;
    }
  };
  app.get("/api/crawler", async (_r, reply) => {
    try {
      return { configured: true, sites: await crawlerSites() };
    } catch {
      return reply
        .code(503)
        .send({ configured: false, sites: [], error: "爬虫服务暂不可用" });
    }
  });
  app.get("/api/radar", async () => {
    const latest =
      (
        await db.query(
          "SELECT * FROM radar_scans ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0] ?? null;
    if (latest)
      latest.jobs = (
        await db.query(
          "SELECT id,type,status,payload,last_error,run_at FROM jobs WHERE payload->>'scanId'=$1 ORDER BY created_at",
          [latest.id],
        )
      ).rows;
    const previous =
      (
        await db.query(
          "SELECT * FROM radar_scans WHERE status='complete' ORDER BY created_at DESC LIMIT 1",
        )
      ).rows[0] ?? null;
    return { configured: configured(), latest, previous };
  });
  app.get("/api/radar/history", async (request, reply) => {
    const parsed = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        limit: z.coerce
          .number()
          .refine((n) => [10, 20, 50].includes(n))
          .default(20),
        q: z.string().trim().max(200).default(""),
        status: z
          .enum([
            "all",
            "planning",
            "collecting",
            "analyzing",
            "reporting",
            "complete",
            "failed",
          ])
          .default("all"),
        order: z.enum(["asc", "desc"]).default("desc"),
      })
      .safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "无效的历史筛选或分页参数" });
    const { offset, limit, q, status, order } = parsed.data;
    const search = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const where = `WHERE ($1::text = 'all' OR status = $1)
      AND ($2::text = '' OR id::text ILIKE $3 OR report->>'title' ILIKE $3
        OR report->>'summary' ILIKE $3 OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(report->'recommendations', '[]'::jsonb)) AS recommendation
          WHERE recommendation->>'title' ILIKE $3
        ))`;
    const direction = order === "asc" ? "ASC" : "DESC";
    const [page, count] = await Promise.all([
      db.query(
        `SELECT id,status,created_at,updated_at,coverage,
      CASE WHEN report IS NULL THEN NULL ELSE jsonb_array_length(COALESCE(report->'recommendations','[]'::jsonb)) END AS opportunity_count
      FROM radar_scans ${where} ORDER BY created_at ${direction},id ${direction} LIMIT $4 OFFSET $5`,
        [status, q, search, limit + 1, offset],
      ),
      db.query(`SELECT count(*)::int AS total FROM radar_scans ${where}`, [
        status,
        q,
        search,
      ]),
    ]);
    return {
      items: page.rows.slice(0, limit),
      hasMore: page.rows.length > limit,
      total: count.rows[0].total,
      offset,
      limit,
    };
  });
  app.get("/api/radar/history/:id", async (request, reply) => {
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: "无效的发现记录编号" });
    const scan = (
      await db.query("SELECT * FROM radar_scans WHERE id=$1", [parsed.data.id])
    ).rows[0];
    if (!scan) return reply.code(404).send({ error: "发现记录不存在" });
    scan.jobs = (
      await db.query(
        "SELECT id,type,status,payload,last_error,run_at FROM jobs WHERE payload->>'scanId'=$1 ORDER BY created_at",
        [scan.id],
      )
    ).rows;
    return { scan };
  });
  app.post("/api/radar", async (_r, reply) => {
    if (!configured())
      return reply.code(409).send({ error: "请先配置研究模型 API" });
    return { scanId: await startScan(db) };
  });
}
