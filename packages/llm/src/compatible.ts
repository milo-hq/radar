import { z, type ZodType } from "zod";
import type { LLMProvider, ModelRequest, ModelResult } from "./provider.js";
export interface TranslationConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}
export function translationConfig(): TranslationConfig | null {
  const apiKey = process.env.TRANSLATION_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.TRANSLATION_MODEL;
  if (!apiKey || !model) return null;
  const baseUrl =
    process.env.TRANSLATION_BASE_URL || "https://api.openai.com/v1";
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("翻译接口地址必须是无凭据、无查询参数的 HTTPS URL");
  return { apiKey, model, baseUrl: baseUrl.replace(/\/$/, "") };
}
export class CompatibleProvider implements LLMProvider {
  constructor(
    private config: TranslationConfig,
    private transport: typeof fetch = fetch,
  ) {}
  async generateStructured<T>(
    request: ModelRequest,
    schema: ZodType<T>,
  ): Promise<ModelResult<T>> {
    const response = await this.transport(
      this.config.baseUrl + "/chat/completions",
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: request.model,
          messages: [
            {
              role: "system",
              content:
                request.system +
                "\nRequired JSON schema:\n" +
                JSON.stringify(z.toJSONSchema(schema)),
            },
            { role: "user", content: JSON.stringify(request.input) },
          ],
          response_format: { type: "json_object" },
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `翻译模型接口返回 HTTP ${response.status}；请检查模型配置或稍后重试`,
      );
    const data = await response.json();
    const choice = data.choices?.[0];
    if (
      choice?.finish_reason !== "stop" ||
      typeof choice.message?.content !== "string"
    )
      throw new Error("翻译未完整返回或被模型拒绝，未保存为完整译文");
    return {
      value: schema.parse(JSON.parse(choice.message.content)),
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      estimatedCost: null,
    };
  }
  async generateText(_request: ModelRequest): Promise<ModelResult<string>> {
    throw new Error("翻译仅使用结构化模型输出");
  }
}
