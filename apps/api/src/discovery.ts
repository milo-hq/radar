import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { transaction } from "../../../packages/db/src/index.js";
import { enqueue } from "../../../packages/db/src/jobs.js";
export function registerDiscovery(app: FastifyInstance, db: Pool) {
  app.post("/api/discovery", async (r) => {
    const b = z
      .object({
        query: z.string().trim().min(2).max(150),
        sources: z
          .array(z.enum(["hn", "github", "stackoverflow"]))
          .min(1)
          .max(3),
      })
      .parse(r.body);
    return transaction(db, async (c) => {
      const jobs = [];
      for (const source of [...new Set(b.sources)].sort()) {
        await c.query("SELECT id FROM sources WHERE id=$1 FOR UPDATE", [
          source,
        ]);
        const active = (
          await c.query(
            "SELECT id FROM jobs WHERE type='DISCOVER_TOPIC' AND payload->>'source'=$1 AND payload->>'query'=$2 AND status IN ('pending','running')",
            [source, b.query],
          )
        ).rows[0];
        if (active) {
          jobs.push(active.id);
          continue;
        }
        const job = await enqueue(
          c,
          "DISCOVER_TOPIC",
          { source, query: b.query, name: `主题发现 · ${b.query} · ${source}` },
          "topic:" + crypto.randomUUID(),
        );
        await c.query(
          "UPDATE jobs SET max_attempts=1,run_at=greatest(now(),coalesce((SELECT discovery_available_at FROM sources WHERE id=$2),now())) WHERE id=$1",
          [job.id, source],
        );
        jobs.push(job.id);
      }
      return { jobIds: jobs };
    });
  });
  app.get("/api/discovery", async () => ({
    items: (
      await db.query(
        "SELECT id,status,payload,last_error,created_at,run_at FROM jobs WHERE type='DISCOVER_TOPIC' ORDER BY created_at DESC LIMIT 60",
      )
    ).rows,
  }));
  app.get("/api/discovery/:id/documents", async (r) => {
    const id = z.uuid().parse((r.params as any).id);
    return {
      items: (
        await db.query(
          "SELECT d.id,d.source_id,d.title,left(d.body,350) excerpt,d.canonical_url,d.author_name,d.published_at,d.metadata FROM discovery_documents dd JOIN raw_documents d ON d.id=dd.document_id WHERE dd.job_id=$1 ORDER BY d.published_at DESC",
          [id],
        )
      ).rows.map((d) => ({
        ...d,
        metadata: {
          repositoryUrl: d.metadata.repositoryUrl,
          repositoryName: d.metadata.repositoryName,
          contextNote: d.metadata.contextNote,
          isAnswered: d.metadata.isAnswered,
          state: d.metadata.state,
          license: d.metadata.license,
        },
      })),
    };
  });
}
