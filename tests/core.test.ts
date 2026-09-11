import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDocument,
  evidenceDiversity,
} from "../packages/core/src/documents.js";
import { parseRedditThread } from "../packages/connectors/src/reddit.js";
import {
  assertPublicUrl,
  assertPublicAddress,
} from "../packages/connectors/src/http.js";
const base = {
  sourceKey: "manual" as const,
  externalId: "one",
  canonicalUrl: "https://example.com/a",
  type: "article" as const,
  body: " Exact  Source\nTEXT ",
  metadata: {},
};
test("normalization preserves raw text while copied text joins one content group", () => {
  const a = normalizeDocument(base),
    b = normalizeDocument({ ...base, body: "exact source text" });
  assert.equal(a.body, " Exact  Source\nTEXT ");
  assert.equal(a.normalizedContentHash, b.normalizedContentHash);
  assert.notEqual(a.snapshotHash, b.snapshotHash);
});
test("same author in a thread and duplicate content do not inflate independent voices", () => {
  const docs = [
    {
      ...base,
      sourceKey: "reddit" as const,
      authorExternalId: "alice",
      threadExternalId: "t3_a",
    },
    {
      ...base,
      sourceKey: "reddit" as const,
      externalId: "two",
      body: "different",
      authorExternalId: "alice",
      threadExternalId: "t3_a",
    },
    {
      ...base,
      sourceKey: "reddit" as const,
      externalId: "three",
      authorExternalId: "bob",
      threadExternalId: "t3_b",
    },
    {
      ...base,
      sourceKey: "reddit" as const,
      externalId: "four",
      body: "no identity",
    },
  ].map(normalizeDocument);
  assert.deepEqual(evidenceDiversity(docs), {
    uniqueAuthors: 2,
    independentVoices: 1,
    contentGroups: 3,
    platforms: 1,
  });
});
const post = {
  kind: "t3",
  data: {
    id: "abc",
    name: "t3_abc",
    title: "Workflow",
    selftext: "We pay for this tool",
    author: "founder",
    subreddit: "smallbusiness",
    created_utc: 1700000000,
    permalink: "/r/smallbusiness/comments/abc/workflow/",
    num_comments: 3,
  },
};
const child = {
  kind: "t1",
  data: {
    id: "c2",
    name: "t1_c2",
    body: "Costs two hours every week",
    author: "[deleted]",
    parent_id: "t1_c1",
    link_id: "t3_abc",
    created_utc: 1700000001,
  },
};
const comment = {
  kind: "t1",
  data: {
    id: "c1",
    name: "t1_c1",
    body: "We still use Excel",
    author: "alice",
    parent_id: "t3_abc",
    link_id: "t3_abc",
    replies: {
      data: { children: [child, { kind: "more", data: { count: 2 } }] },
    },
  },
};
export const thread: any = [
  { data: { children: [post] } },
  { data: { children: [comment] } },
];
test("Reddit nested comments retain parent/thread and flag missing context", () => {
  const docs = parseRedditThread(thread, "manual_import");
  assert.equal(docs.length, 3);
  assert.equal(docs[2].parentExternalId, "t1_c1");
  assert.equal(docs[2].threadExternalId, "t3_abc");
  assert.equal(docs[2].authorExternalId, undefined);
  assert.equal(docs[0].metadata.contextComplete, false);
  assert.equal(docs[1].body, "We still use Excel");
});
test("empty listings and removed content cannot become market evidence", () => {
  assert.throws(() =>
    parseRedditThread(
      [{ data: { children: [] } }, { data: { children: [] } }],
      "manual_import",
    ),
  );
  const removed = structuredClone(thread);
  removed[0].data.children[0].data.selftext = "[removed]";
  assert.throws(() => parseRedditThread(removed, "manual_import"));
});
test("unsafe URLs and private, mapped, reserved IPs are rejected", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://user:pass@example.com",
    "http://127.0.0.1",
    "http://localhost",
    "http://[::1]",
    "http://169.254.169.254",
  ])
    assert.throws(() => assertPublicUrl(url));
  for (const ip of [
    "10.0.0.1",
    "127.0.0.1",
    "::ffff:127.0.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "::1",
    "0.0.0.0",
    "100.64.0.1",
  ])
    assert.throws(() => assertPublicAddress(ip));
  assert.equal(
    assertPublicUrl("https://example.com/pricing").hostname,
    "example.com",
  );
  assert.doesNotThrow(() => assertPublicAddress("93.184.216.34"));
});
test("HTML extraction retains block boundaries without leaking scripts", async () => {
  const { extractHtml } = await import("../packages/connectors/src/manual.js");
  const { body, title } = extractHtml(
    "<html><head><title>Pricing</title></head><body><nav>Menu</nav><main><h1>Plans</h1><p>Starter</p><p>$9 / month</p><script>secret()</script></main></body></html>",
  );
  assert.equal(title, "Pricing");
  assert.equal(body, "Plans\nStarter\n$9 / month");
});
test("Reddit rejects comments with root parents from another thread", () => {
  const input = structuredClone(thread);
  input[1].data.children[0].data.parent_id = "t3_other";
  assert.throws(
    () => parseRedditThread(input, "manual_import"),
    /thread|parent/i,
  );
});
test("Reddit rejects replies whose declared parent differs from nesting", () => {
  const input = structuredClone(thread);
  input[1].data.children[0].data.replies.data.children[0].data.parent_id =
    "t1_other";
  assert.throws(
    () => parseRedditThread(input, "manual_import"),
    /thread|parent/i,
  );
});
