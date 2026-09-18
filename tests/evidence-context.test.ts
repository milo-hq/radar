import { test } from "node:test";
import assert from "node:assert/strict";
import { contextBlocker } from "../packages/radar/src/evidence-context.js";
const body = "I use ToolX every week. I still merge its CSV files manually.";
const review = {
  role: "direct_user",
  status: "unresolved",
  tool: "ToolX",
  task: "合并报表",
  painQuote: "I still merge its CSV files manually.",
  unresolvedQuote: "I still merge its CSV files manually.",
  reason: "当前手工绕行",
};
test("context gate preserves direct unmet requests with exact original anchors", () => {
  assert.equal(contextBlocker(review, body), null);
  assert.ok(
    contextBlocker({ ...review, painQuote: "Invented complaint" }, body),
  );
  assert.ok(contextBlocker({ ...review, unresolvedQuote: "" }, body));
});
test("completed demos, marketing and unknown context do not become direct demand", () => {
  for (const role of ["seller", "secondhand", "unknown"])
    assert.ok(contextBlocker({ ...review, role }, body));
  for (const status of ["resolved", "unknown"])
    assert.ok(contextBlocker({ ...review, status }, body));
  assert.ok(contextBlocker({ ...review, tool: "" }, body));
});
