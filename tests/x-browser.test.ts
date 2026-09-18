import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXSnapshot } from "../packages/connectors/src/x-browser.js";
const post = {
  url: "https://x.com/buyer/status/123456",
  postId: "123456",
  author: "buyer",
  body: "Tool exports require hours of manual work.",
  publishedAt: "2026-09-18T00:00:00.000Z",
};
test("X identity is canonical and incomplete context remains explicit", () => {
  const [doc] = parseXSnapshot(post, "software manual");
  assert.equal(doc.sourceKey, "x");
  assert.equal(doc.externalId, "123456");
  assert.equal(doc.authorExternalId, "buyer");
  assert.equal(doc.metadata.contextComplete, false);
  assert.equal(doc.metadata.searchQuery, "software manual");
  for (const url of [
    "https://evil.example/buyer/status/123456",
    "https://x.com/buyer/status/999",
    "https://x.com/other/status/123456",
    "https://x.com/messages/123456",
    "https://user@x.com/buyer/status/123456",
  ])
    assert.throws(() => parseXSnapshot({ ...post, url }, "query"));
  assert.throws(() => parseXSnapshot({ ...post, body: "" }, "query"));
});
