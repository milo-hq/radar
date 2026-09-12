import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverTopic } from "../packages/connectors/src/topic.js";
test("github topic search preserves issue/repository provenance and filters PR, foreign URL, duplicates", async () => {
  const item = {
    id: 123,
    html_url: "https://github.com/acme/tool/issues/1",
    title: "Export invoices",
    body: "We need a way to export all invoices together because the current workflow requires manually downloading every single file.",
    user: { id: 4, login: "alice" },
    created_at: new Date().toISOString(),
    state: "open",
  };
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        items: [
          item,
          item,
          { ...item, id: 124, pull_request: {} },
          { ...item, id: 125, html_url: "https://evil.test/x" },
        ],
      }),
    )) as typeof fetch;
  const result = await discoverTopic("github", "invoice", fetcher);
  assert.equal(result.documents.length, 1);
  assert.equal(
    result.documents[0].metadata.repositoryUrl,
    "https://github.com/acme/tool",
  );
  assert.equal(result.documents[0].metadata.contextComplete, false);
});
test("Stack Overflow preserves answered status, attribution and API backoff", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        backoff: 30,
        items: [
          {
            question_id: 1,
            link: "https://stackoverflow.com/questions/1/example",
            title: "Export &amp; automate",
            body: "<p>How can I export this recurring report without manually repeating all the steps each month? I need to automate this workflow.</p>",
            owner: { user_id: 2, display_name: "Alice" },
            creation_date: Math.floor(Date.now() / 1000),
            is_answered: true,
            content_license: "CC BY-SA 4.0",
          },
        ],
      }),
    )) as typeof fetch;
  const r = await discoverTopic("stackoverflow", "export", fetcher);
  assert.equal(r.cooldownSeconds, 30);
  assert.equal(r.documents[0].metadata.isAnswered, true);
  assert.equal(r.documents[0].title, "Export & automate");
});
