import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverFeedback } from "../packages/connectors/src/feedback.js";
test("feedback discovery keeps author/context, rejects irrelevant short data, deduplicates hits", async () => {
  const payload = {
    hits: [
      {
        objectID: "1",
        comment_text:
          '<p>I use <a href="https://buttondown.com">Buttondown</a> but exporting subscribers requires too much manual work. I have to repeat the same process every week for my newsletter.</p>',
        author: "alice",
        created_at: "2026-01-01T00:00:00.000Z",
        story_id: 10,
        parent_id: 10,
        story_title: "Email tools",
      },
      {
        objectID: "2",
        comment_text: "unrelated short snippet",
        author: "bob",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  const transport = (async () =>
    new Response(JSON.stringify(payload))) as typeof fetch;
  const result = await discoverFeedback(
    { name: "Buttondown", domain: "buttondown.com" },
    transport,
  );
  assert.equal(result.documents.length, 1);
  const d = result.documents[0];
  assert.equal(d.sourceKey, "hn");
  assert.equal(d.authorName, "alice");
  assert.equal(d.threadExternalId, "10");
  assert.equal(d.metadata.contextComplete, false);
  assert.match(d.body, /manual work/);
  assert.equal(d.canonicalUrl, "https://news.ycombinator.com/item?id=1");
  assert.equal(result.queryCount, 2);
});
test("shared platform discovery requires the product path rather than host alone", async () => {
  const hit = {
    objectID: "3",
    comment_text:
      "I use https://github.com/another/project and have trouble exporting my data every week. This is a recurring manual process that takes a lot of time.",
    author: "bob",
    created_at: "2026-01-01T00:00:00Z",
  };
  const transport = (async () =>
    new Response(JSON.stringify({ hits: [hit] }))) as typeof fetch;
  const result = await discoverFeedback(
    {
      name: "Tiny",
      domain: "github.com",
      urls: ["https://github.com/owner/tiny"],
    },
    transport,
  );
  assert.equal(result.documents.length, 0);
});
