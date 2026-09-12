import { z } from "zod";
import type { Pool } from "pg";
import { hash } from "../../core/src/documents.js";
import { runStructured } from "../../llm/src/run.js";
import type { LLMProvider } from "../../llm/src/provider.js";
export const VERSION = "v1";
export const partSchema = z.object({
  titleZh: z.string().min(1),
  bodyZh: z.string().min(1),
  keyPoints: z
    .array(
      z.object({ textZh: z.string().min(1), sourceQuote: z.string().min(1) }),
    )
    .max(3),
});
export type ChinesePart = z.infer<typeof partSchema>;
export function splitText(text: string, limit = 4000): string[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Invalid chunk size");
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let start = 0; start < chars.length; ) {
    let end = Math.min(start + limit, chars.length);
    if (end < chars.length) {
      for (let i = end - 1; i > start + limit / 2; i--)
        if (chars[i] === "\n") {
          end = i + 1;
          break;
        }
    }
    chunks.push(chars.slice(start, end).join(""));
    start = end;
  }
  return chunks;
}
export function validatePart(value: unknown, source: string): ChinesePart {
  const part = partSchema.parse(value);
  for (const point of part.keyPoints)
    if (!point.sourceQuote.trim() || !source.includes(point.sourceQuote))
      throw new Error("中文要点引用不在原文中，结果已拒绝");
  return part;
}
export async function translateDocument(
  db: Pool,
  id: string,
  config: {
    provider: LLMProvider;
    model: string;
    checkLease?: () => Promise<boolean>;
  },
): Promise<ChinesePart> {
  const cached = (
    await db.query(
      "SELECT result FROM document_translations WHERE raw_document_id=$1 AND prompt_version=$2",
      [id, VERSION],
    )
  ).rows[0];
  if (cached) return cached.result;
  const doc = (
    await db.query("SELECT title,body FROM raw_documents WHERE id=$1", [id])
  ).rows[0];
  if (!doc) throw new Error("原文不存在");
  const chunks = splitText(doc.body);
  if (chunks.length > 50)
    throw new Error("原文超过单次翻译上限（约20万字）；请拆分来源后重试");
  const parts: ChinesePart[] = [];
  for (let i = 0; i < chunks.length; i++) {
    if (config.checkLease && !(await config.checkLease()))
      throw new Error("翻译任务租约失效");
    const existing = (
      await db.query(
        "SELECT result,source_hash FROM translation_chunks WHERE raw_document_id=$1 AND prompt_version=$2 AND part_index=$3 AND model=$4",
        [id, VERSION, i, config.model],
      )
    ).rows[0];
    if (existing?.source_hash === hash(chunks[i])) {
      parts.push(validatePart(existing.result, chunks[i]));
      continue;
    }
    const sourceQuoteCandidates = chunks[i].split("\n").filter((line) => line.trim());
    const schema = partSchema.extend({
      keyPoints: z.array(z.object({
        textZh: z.string().min(1),
        sourceLine: z.number().int().min(0).max(sourceQuoteCandidates.length - 1),
      })).max(3),
    });
    const { value } = await runStructured(
      db,
      config.provider,
      {
        promptName: "translate-chinese",
        promptVersion: VERSION,
        model: config.model,
        input: {
          title: doc.title || "Untitled source",
          body: chunks[i],
          sourceQuoteCandidates,
          partIndex: i + 1,
          partCount: chunks.length,
        },
      },
      schema,
    );
    const part = validatePart({
      ...value,
      keyPoints: value.keyPoints.map((point) => ({
        textZh: point.textZh,
        sourceQuote: sourceQuoteCandidates[point.sourceLine],
      })),
    }, chunks[i]);
    if (config.checkLease && !(await config.checkLease()))
      throw new Error("翻译任务租约失效");
    await db.query(
      "INSERT INTO translation_chunks(raw_document_id,prompt_version,part_index,source_hash,model,result) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [id, VERSION, i, hash(chunks[i]), config.model, JSON.stringify(part)],
    );
    parts.push(part);
  }
  if (config.checkLease && !(await config.checkLease()))
    throw new Error("翻译任务租约失效");
  const result = {
    titleZh: parts[0].titleZh,
    bodyZh: parts.map((p) => p.bodyZh).join("\n\n"),
    keyPoints: parts.flatMap((p) => p.keyPoints),
  };
  await db.query(
    "INSERT INTO document_translations(raw_document_id,prompt_version,model,result) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [id, VERSION, config.model, JSON.stringify(result)],
  );
  return result;
}
