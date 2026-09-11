import type { ZodType } from "zod";
export interface ModelRequest {
  promptName: string;
  promptVersion: string;
  system: string;
  input: unknown;
  model: string;
}
export interface ModelResult<T> {
  value: T;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
}
export interface LLMProvider {
  generateStructured<T>(
    request: ModelRequest,
    schema: ZodType<T>,
  ): Promise<ModelResult<T>>;
  generateText(request: ModelRequest): Promise<ModelResult<string>>;
}
export class DisabledProvider implements LLMProvider {
  async generateStructured<T>(
    _request: ModelRequest,
    _schema: ZodType<T>,
  ): Promise<ModelResult<T>> {
    throw new Error("LLM_DISABLED: source-quality gate has not been approved");
  }
  async generateText(_request: ModelRequest): Promise<ModelResult<string>> {
    throw new Error("LLM_DISABLED: source-quality gate has not been approved");
  }
}
