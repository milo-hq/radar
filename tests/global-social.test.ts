import assert from "node:assert/strict";
import test from "node:test";
import { collectGlobalSocial } from "../packages/connectors/src/global-social.js";
const json = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const date = "2025-04-03T02:01:00Z";
const comment = (id: string, text: string, parentId?: string) => ({
  id,
  snippet: {
    textOriginal: text,
    textDisplay: text,
    publishedAt: date,
    authorDisplayName: "Alice",
    authorChannelId: { value: "author1" },
    likeCount: 2,
    ...(parentId ? { parentId } : {}),
  },
});
const video = (id: string) => ({
  id: { videoId: id },
  snippet: {
    title: "Notion tips",
    description: "Video description",
    publishedAt: date,
    channelId: "channel1",
    channelTitle: "Creator",
  },
});
const topic = (id: number, title: string) => ({
  id,
  title,
  content: "正文",
  created: 1743645660,
  replies: 2,
  member: { id: 7, username: "alice" },
});

test("missing credentials fail before any request", async () => {
  const transport = (async () => {
    assert.fail("unexpected request");
  }) as typeof fetch;
  await assert.rejects(
    collectGlobalSocial("youtube", "Notion", { transport }),
    /credential|API key/i,
  );
  await assert.rejects(
    collectGlobalSocial("v2ex", "Notion", { transport }),
    /credential|token/i,
  );
});

test("YouTube keeps original text, dates, video context and reply provenance with bounded pagination", async () => {
  const calls: URL[] = [];
  const transport = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u);
    assert.equal(u.host, "www.googleapis.com");
    assert.equal(init?.redirect, "error");
    assert.ok(u.searchParams.get("fields"));
    if (u.pathname.endsWith("/search")) {
      assert.equal(u.searchParams.get("relevanceLanguage"), "ja");
      assert.equal(u.searchParams.has("regionCode"), false);
      return json({
        items: [video("video1"), video("video2"), video("ignored")],
      });
    }
    if (u.pathname.endsWith("/comments"))
      return json({
        items: [comment("reply1", "original reply", "top1")],
        nextPageToken: "unfetched",
      });
    assert.equal(u.searchParams.get("textFormat"), "plainText");
    if (u.searchParams.get("videoId") === "video2") return json({ items: [] });
    if (u.searchParams.has("pageToken"))
      return json({
        items: [
          {
            id: "thread2",
            snippet: {
              topLevelComment: comment("top2", "second comment"),
              totalReplyCount: 0,
            },
          },
        ],
        nextPageToken: "third",
      });
    return json({
      items: [
        {
          id: "thread1",
          snippet: {
            topLevelComment: comment("top1", "literal <tag> original"),
            totalReplyCount: 5,
          },
        },
      ],
      nextPageToken: "second",
    });
  }) as typeof fetch;
  const result = await collectGlobalSocial("youtube", "Notion", {
    apiKey: "secret",
    language: "ja",
    transport,
  });
  assert.deepEqual(result.errors, []);
  const first = result.documents.find((d) => d.externalId === "comment:top1")!;
  assert.equal(first.body, "literal <tag> original");
  assert.equal(first.parentExternalId, "video:video1");
  assert.equal(first.threadExternalId, "video:video1");
  assert.equal(first.metadata.commentThreadId, "thread1");
  assert.equal(first.publishedAt, date);
  assert.equal(first.metadata.videoTitle, "Notion tips");
  assert.equal(first.metadata.contextComplete, false);
  assert.equal(first.metadata.country, undefined);
  assert.equal(first.metadata.searchLanguage, "ja");
  const reply = result.documents.find(
    (d) => d.externalId === "comment:reply1",
  )!;
  assert.equal(reply.parentExternalId, "comment:top1");
  assert.equal(reply.threadExternalId, "video:video1");
  assert.equal(
    reply.canonicalUrl,
    "https://www.youtube.com/watch?v=video1&lc=reply1",
  );
  assert.equal(
    calls.filter((u) => u.pathname.endsWith("/commentThreads")).length,
    3,
  );
  assert.equal(calls.filter((u) => u.pathname.endsWith("/comments")).length, 1);
  assert.ok(result.documents.some((d) => d.externalId === "video:video1"));
});

test("V2EX filters by product anchor, keeps topic and reply IDs and fetches at most two pages", async () => {
  const calls: URL[] = [];
  const transport = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u);
    assert.equal(u.host, "www.v2ex.com");
    assert.equal(init?.redirect, "error");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer secret",
    );
    if (u.pathname.includes("/nodes/"))
      return json(
        {
          success: true,
          result:
            u.searchParams.get("p") === "1"
              ? [topic(10, "Notion 笔记体验"), topic(11, "完全无关")]
              : [topic(12, "Notion alternatives")],
        },
        200,
        { "X-Rate-Limit-Remaining": "100" },
      );
    return json({
      success: true,
      result:
        u.searchParams.get("p") === "1"
          ? [
              {
                id: 20 + Number(u.pathname.split("/")[4]),
                content: "<p>需要离线支持</p>",
                created: 1743645660,
                member: { id: 8, username: "bob" },
              },
            ]
          : [],
    });
  }) as typeof fetch;
  const result = await collectGlobalSocial(
    "v2ex",
    "Notion frustrated alternative",
    { token: "secret", transport },
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.quotaRemaining, 100);
  assert.equal(result.documents.filter((d) => d.type === "post").length, 2);
  assert.ok(!result.documents.some((d) => d.externalId === "topic:11"));
  const reply = result.documents.find((d) => d.externalId === "reply:30")!;
  assert.equal(reply.body, "需要离线支持");
  assert.equal(reply.parentExternalId, "topic:10");
  assert.equal(reply.threadExternalId, "topic:10");
  assert.equal(reply.metadata.topicTitle, "Notion 笔记体验");
  assert.equal(reply.metadata.collectionScope, "node_recent_topics");
  assert.equal(calls.filter((u) => u.pathname.includes("/nodes/")).length, 2);
  assert.equal(calls.length, 6);
});

test("initial HTTP and malformed responses fail explicitly without credential leakage", async () => {
  for (const source of ["youtube", "v2ex"] as const) {
    await assert.rejects(
      collectGlobalSocial(source, "Notion", {
        apiKey: "secret",
        token: "secret",
        transport: (async () =>
          json({}, 429, { "Retry-After": "90" })) as typeof fetch,
      }),
      (err: any) =>
        /HTTP 429/.test(err.message) &&
        err.cooldownSeconds >= 90 &&
        !err.message.includes("secret"),
    );
    await assert.rejects(
      collectGlobalSocial(source, "Notion", {
        apiKey: "secret",
        token: "secret",
        transport: (async () => json({ wrong: [] })) as typeof fetch,
      }),
      /invalid|格式/i,
    );
    await assert.rejects(
      collectGlobalSocial(source, "Notion", {
        apiKey: "secret",
        token: "secret",
        transport: (async () => {
          throw Error("https://bad.invalid/?key=secret");
        }) as typeof fetch,
      }),
      (err: any) => !err.message.includes("secret"),
    );
  }
});

test("partial failures preserve collected context and expose cooldown and errors", async () => {
  const transport = (async (input: URL | RequestInfo) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith("/search"))
      return json({ items: [video("video1")] });
    if (u.searchParams.has("pageToken")) return json({}, 403);
    if (u.pathname.endsWith("/comments")) return json({ invalid: true });
    return json({
      items: [
        {
          id: "thread1",
          snippet: {
            topLevelComment: comment("top1", "Need export"),
            totalReplyCount: 1,
          },
        },
      ],
      nextPageToken: "second",
    });
  }) as typeof fetch;
  const result = await collectGlobalSocial("youtube", "Notion", {
    apiKey: "secret",
    transport,
  });
  assert.equal(result.documents.length, 2);
  assert.equal(result.errors.length, 2);
  assert.ok(result.cooldownSeconds >= 60);
  assert.ok(result.errors.every((error) => !error.includes("secret")));
});

test("V2EX invalid node cannot redirect credentials and unrelated results produce no documents", async () => {
  await assert.rejects(
    collectGlobalSocial("v2ex", "Notion", {
      token: "secret",
      node: "../../evil",
    }),
    /node/i,
  );
  const result = await collectGlobalSocial("v2ex", "Notion alternative", {
    token: "secret",
    transport: (async () =>
      json({
        success: true,
        result: [topic(12, "another alternative")],
      })) as typeof fetch,
  });
  assert.deepEqual(result.documents, []);
  assert.deepEqual(result.errors, []);
});

test("V2EX matches a product beside Chinese text and uses actual reply anchors", async () => {
  const result = await collectGlobalSocial("v2ex", "Notion alternative", {
    token: "secret",
    transport: (async (input: URL | RequestInfo) => {
      const u = new URL(String(input));
      if (u.searchParams.get("p") === "2")
        return json({ success: true, result: [] });
      if (u.pathname.includes("/nodes/"))
        return json({
          success: true,
          result: [
            topic(10, "Notion笔记体验"),
            topic(11, "Notional unrelated"),
          ],
        });
      return json({
        success: true,
        result: [{ id: 99, content: "reply", created: 1743645660 }],
      });
    }) as typeof fetch,
  });
  assert.equal(result.documents.length, 2);
  assert.equal(
    result.documents[1].canonicalUrl,
    "https://www.v2ex.com/t/10?p=1#r_99",
  );
});

test("V2EX bounds topic fan-out and keeps partial results when a reply page fails", async () => {
  const requestedTopics: string[] = [];
  const result = await collectGlobalSocial("v2ex", "Notion", {
    token: "secret",
    transport: (async (input: URL | RequestInfo) => {
      const u = new URL(String(input));
      if (u.pathname.includes("/nodes/"))
        return json({
          success: true,
          result: [
            topic(1, "Notion"),
            topic(2, "Notion"),
            topic(3, "Notion"),
            topic(4, "Notion"),
          ],
        });
      requestedTopics.push(u.pathname);
      if (u.pathname.includes("/topics/1/"))
        return json({ success: false, message: "secret upstream body" });
      return json({ success: true, result: [] });
    }) as typeof fetch,
  });
  assert.equal(result.documents.length, 3);
  assert.equal(result.errors.length, 1);
  assert.equal(requestedTopics.length, 3);
  assert.ok(!requestedTopics.some((p) => p.includes("/4/")));
  assert.ok(!result.errors[0].includes("secret"));
});

test("YouTube rejects mismatched reply parents and reports malformed items", async () => {
  const result = await collectGlobalSocial("youtube", "Notion", {
    apiKey: "secret",
    transport: (async (input: URL | RequestInfo) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("/search"))
        return json({ items: [video("video1")] });
      if (u.pathname.endsWith("/comments"))
        return json({ items: [comment("wrong", "wrong thread", "another")] });
      return json({
        items: [
          {
            id: "thread1",
            snippet: {
              topLevelComment: comment("top1", "need sync"),
              totalReplyCount: 1,
            },
          },
          { id: "malformed" },
        ],
      });
    }) as typeof fetch,
  });
  assert.equal(result.documents.length, 2);
  assert.equal(result.errors.length, 2);
  assert.ok(!result.documents.some((d) => d.body === "wrong thread"));
});

test(
  "shared collection deadline bounds stalled requests and body reads, retains context, and stops fan-out",
  { timeout: 300 },
  async () => {
    for (const stall of ["request", "body"]) {
      let calls = 0;
      let signal: AbortSignal | undefined;
      const keepAlive = setTimeout(() => {}, 500);
      try {
        const result = await collectGlobalSocial("youtube", "Notion", {
          apiKey: "secret",
          budgetMs: 25,
          transport: (async (_input: URL | RequestInfo, init?: RequestInit) => {
            calls++;
            signal = init?.signal ?? undefined;
            if (calls === 1)
              return json({ items: [video("video1"), video("video2")] });
            if (stall === "request") return new Promise<Response>(() => {});
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"items":['));
                },
              }),
            );
          }) as typeof fetch,
        });
        assert.equal(calls, 2);
        assert.equal(signal?.aborted, true);
        assert.equal(result.documents.length, 1);
        assert.match(result.errors.join(" "), /deadline|budget/i);
      } finally {
        clearTimeout(keepAlive);
      }
    }
  },
);
