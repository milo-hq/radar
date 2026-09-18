/** Opt-in live model evaluation. Synthetic fixtures never enter the evidence database. */
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  CompatibleProvider,
  translationConfig,
} from "../packages/llm/src/compatible.js";
import {
  contextReviewSchema,
  contextBlocker,
} from "../packages/radar/src/evidence-context.js";
const config = translationConfig();
if (!config)
  throw Error(
    "Configure the research model before running this paid live evaluation",
  );
const fixtures = [
  {
    body: "Built an n8n workflow that automates quote-request handling for suppliers. It now drafts all the replies for me.",
    keep: false,
  },
  {
    body: "I gave an agent access to Notion. The gateway blocked the write as designed. This is a demonstration of our permission guard, not a bug in Notion.",
    keep: false,
  },
  {
    body: "Cal.com's founder needed an open-source alternative to Calendly, so he built one. Today it is available.",
    keep: false,
  },
  {
    body: "I use ToolX every week to export 12 client reports. I built a script, but its exports still omit the customer ID, so I spend two hours matching rows by hand. I need the customer ID included in exports.",
    keep: true,
  },
];
const response = await new CompatibleProvider(config).generateStructured(
  {
    promptName: "radar-context",
    promptVersion: "v2",
    model: config.model,
    system: await readFile("prompts/radar-context/v2.md", "utf8"),
    input: {
      candidates: fixtures.map((f, findingIndex) => ({
        findingIndex,
        lines: [{ index: 0, quote: f.body }],
        contextComplete: true,
        truncated: false,
      })),
    },
  },
  contextReviewSchema,
);
const { reviews } = contextReviewSchema.parse(response.value);
assert.equal(reviews.length, fixtures.length);
assert.equal(new Set(reviews.map((r) => r.findingIndex)).size, fixtures.length);
for (const review of reviews) {
  const fixture = fixtures[review.findingIndex];
  assert.ok(fixture);
  const reason = contextBlocker(
    {
      ...review,
      painQuote: review.painLine === 0 ? fixture.body : "",
      unresolvedQuote: review.unresolvedLine === 0 ? fixture.body : "",
    },
    fixture.body,
  );
  console.log(
    JSON.stringify({
      case: review.findingIndex,
      role: review.role,
      status: review.status,
      kept: !reason,
      reason,
    }),
  );
  assert.equal(!reason, fixture.keep);
}
console.log(
  "4/4 live context fixtures passed; no raw evidence records created.",
);
