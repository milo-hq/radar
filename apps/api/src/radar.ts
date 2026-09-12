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
      .object({ offset: z.coerce.number().int().min(0).max(100000).default(0) })
      .safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "无效的历史页码" });
    const rows = (
      await db.query(
        `SELECT id,status,created_at,updated_at,coverage,
      CASE WHEN report IS NULL THEN NULL ELSE jsonb_array_length(COALESCE(report->'recommendations','[]'::jsonb)) END AS opportunity_count
      FROM radar_scans ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $1`,
        [parsed.data.offset],
      )
    ).rows;
    return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
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
