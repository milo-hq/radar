/** Opt-in live model regression: npm exec tsx scripts/eval-tool-complaints.ts */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CompatibleProvider,
  translationConfig,
} from "../packages/llm/src/compatible.js";
const config = translationConfig();
if (!config) throw Error("需要配置研究模型");
const provider = new CompatibleProvider(config);
const lines = [
  "In Boardly I export all 12 project boards every Friday and spend two hours merging them in Excel. Please add cross-project reporting; support says it is not available.",
  "I wish this app had AI. No specific task in mind.",
  "We launched an all-in-one AI platform. Sign up today!",
  "I love selling appliance parts. It is boring but profitable.",
  "How do I install this package? Answer: npm install fixed it.",
];
const schema = z.object({
  findings: z
    .array(
      z.object({
        sourceLine: z.number().int().min(0).max(4),
        problem: z.string(),
        buyer: z.string(),
        existingSolution: z.string(),
        unresolved: z.string(),
      }),
    )
    .max(8),
});
const result = await provider.generateStructured(
  {
    promptName: "radar-extract",
    promptVersion: "v2",
    model: config.model,
    system: await readFile("prompts/radar-extract/v2.md", "utf8"),
    input: {
      documents: lines.map((_, i) => ({
        id: String(i),
        title: "Synthetic regression fixture",
        metadata: {},
      })),
      lines: lines.map((quote, sourceLine) => ({
        quote,
        sourceLine,
        documentId: String(sourceLine),
      })),
    },
  },
  schema,
);
assert.ok(
  result.value.findings.some((f) => f.sourceLine === 0),
  "must retain concrete unimplemented feature request",
);
assert.ok(
  result.value.findings.every((f) => f.sourceLine === 0),
  "must reject vague wishes, advertising, general business comments and solved setup",
);
console.log(
  JSON.stringify({ passed: true, findings: result.value.findings }, null, 2),
);
