import { transaction } from "../../../packages/db/src/index.js";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { translationConfig } from "../../../packages/llm/src/compatible.js";
import { enqueue, safeError } from "../../../packages/db/src/jobs.js";
import { VERSION } from "../../../packages/translation/src/translate.js";
function availability() {
  try {
    const config = translationConfig();
    return {
      configured: !!config,
      model: config?.model ?? null,
      configError: null as string | null,
    };
  } catch (e) {
    return { configured: false, model: null, configError: safeError(e) };
  }
}
export function registerTranslations(app: FastifyInstance, db: Pool) {
  app.get("/api/translation-config", async () => {
    return availability();
  });
  app.get("/api/documents/:id/chinese", async (req, reply) => {
    const id = z.uuid().parse((req.params as any).id);
    if (
      !(await db.query("SELECT 1 FROM raw_documents WHERE id=$1", [id]))
        .rowCount
    )
      return reply.code(404).send({ error: "原文不存在" });
    const translation = (
      await db.query(
        "SELECT result,model,created_at FROM document_translations WHERE raw_document_id=$1 AND prompt_version=$2",
        [id, VERSION],
      )
    ).rows[0];
    const job =
      (
        await db.query(
          "SELECT id,status,attempts,max_attempts,last_error FROM jobs WHERE idempotency_key=$1",
          [`translate:${id}:${VERSION}`],
        )
      ).rows[0] ?? null;
    const completed = (
      await db.query(
        "SELECT count(*)::int n FROM translation_chunks WHERE raw_document_id=$1 AND prompt_version=$2",
        [id, VERSION],
      )
    ).rows[0].n;
    return {
      translation: translation ?? null,
      job,
      completedChunks: completed,
      ...availability(),
    };
  });
  app.post("/api/documents/:id/chinese", async (req, reply) => {
    const id = z.uuid().parse((req.params as any).id);
    if (
      !(await db.query("SELECT 1 FROM raw_documents WHERE id=$1", [id]))
        .rowCount
    )
      return reply.code(404).send({ error: "原文不存在" });
    const cached = (
      await db.query(
        "SELECT 1 FROM document_translations WHERE raw_document_id=$1 AND prompt_version=$2",
        [id, VERSION],
      )
    ).rowCount;
    if (cached) return { cached: true };
    if (!translationConfig())
      return reply.code(503).send({
        error:
          "尚未配置中文翻译模型。请在项目 .env 填写 TRANSLATION_API_KEY、TRANSLATION_MODEL 和 TRANSLATION_BASE_URL，然后重启 API/Worker。",
      });
    const job = await transaction(db, async (c) => {
      const queued = await enqueue(
        c,
        "TRANSLATE_DOCUMENT",
        { documentId: id, name: "中文翻译与要点" },
        `translate:${id}:${VERSION}`,
      );
      await c.query(
        "UPDATE jobs SET max_attempts=2,status=CASE WHEN status='failed' THEN 'pending' ELSE status END,attempts=CASE WHEN status='failed' THEN 0 ELSE attempts END,run_at=CASE WHEN status='failed' THEN now() ELSE run_at END WHERE id=$1",
        [queued.id],
      );
      return queued;
    });
    return reply.code(202).send({ jobId: job.id });
  });
}
