import type { Pool } from "pg";
import type { ZodType } from "zod";
import { readFile } from "node:fs/promises";
import { hash } from "../../core/src/documents.js";
import { safeError } from "../../db/src/jobs.js";
import type { LLMProvider, ModelRequest, ModelResult } from "./provider.js";
export async function runStructured<T>(
  db: Pool,
  provider: LLMProvider,
  request: Omit<ModelRequest, "system">,
  schema: ZodType<T>,
): Promise<ModelResult<T>> {
  if (
    !/^[a-z-]+$/.test(request.promptName) ||
    !/^v\d+$/.test(request.promptVersion)
  )
    throw new Error("Invalid prompt identifier");
  const system = await readFile(
    `prompts/${request.promptName}/${request.promptVersion}.md`,
    "utf8",
  );
  const started = Date.now();
  let result: ModelResult<T> | undefined,
    error: unknown,
    schemaValid = false;
  try {
    result = await provider.generateStructured({ ...request, system }, schema);
    result.value = schema.parse(result.value);
    schemaValid = true;
    return result;
  } catch (e) {
    error = e;
    throw e;
  } finally {
    await db.query(
      "INSERT INTO model_runs(prompt_name,prompt_version,prompt_hash,model,input_tokens,output_tokens,estimated_cost,latency_ms,schema_valid,success,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        request.promptName,
        request.promptVersion,
        hash(system),
        request.model,
        result?.inputTokens ?? null,
        result?.outputTokens ?? null,
        result?.estimatedCost ?? null,
        Date.now() - started,
        schemaValid,
        !error,
        error ? safeError(error) : null,
      ],
    );
  }
}
