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
  app.post("/api/radar", async (_r, reply) => {
    if (!configured())
      return reply.code(409).send({ error: "请先配置研究模型 API" });
    return { scanId: await startScan(db) };
  });
}
