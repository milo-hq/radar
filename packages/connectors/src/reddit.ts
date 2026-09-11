import { z } from "zod";
import type {
  RawDocumentInput,
  SourceConnector,
  DiscoveredItem,
} from "../../core/src/documents.js";
import { fetchPublic } from "./http.js";
const nodeSchema: z.ZodType<any> = z.lazy(() =>
  z.object({ kind: z.string(), data: z.record(z.string(), z.any()) }),
);
const payloadSchema = z.tuple([
  z.object({ data: z.object({ children: z.array(nodeSchema) }) }),
  z.object({ data: z.object({ children: z.array(nodeSchema) }) }),
]);
const validBody = (text: unknown): text is string =>
  typeof text === "string" &&
  text.trim().length > 0 &&
  !["[removed]", "[deleted]"].includes(text.trim());
export function parseRedditThread(
  payload: unknown,
  acquisition: "manual_import" | "oauth",
): RawDocumentInput[] {
  const [posts, comments] = payloadSchema.parse(payload);
  const post = posts.data.children.find((n) => n.kind === "t3")?.data;
  if (
    !post ||
    !validBody(post.selftext) ||
    typeof post.id !== "string" ||
    typeof post.subreddit !== "string"
  )
    throw new Error(
      "A Reddit self-text post with meaningful body and thread context is required",
    );
  const thread = `t3_${post.id}`;
  let more = 0;
  const nodes: any[] = [];
  function walk(children: any[], expectedParent = thread, depth = 0) {
    if (depth > 50) throw new Error("Reddit reply depth exceeds 50");
    for (const n of children) {
      if (n.kind === "more") {
        more++;
        continue;
      }
      if (n.kind !== "t1") continue;
      if (n.data.parent_id !== expectedParent)
        throw new Error(
          "Comment parent does not match containing thread or reply",
        );
      nodes.push(n.data);
      if (nodes.length > 2000)
        throw new Error("Thread import exceeds 2000 comments");
      const replies = n.data.replies;
      if (replies && typeof replies === "object")
        walk(
          z.array(nodeSchema).parse(replies.data?.children),
          `t1_${n.data.id}`,
          depth + 1,
        );
    }
  }
  walk(comments.data.children);
  const common = {
    acquisition,
    subreddit: post.subreddit,
    contextComplete: more === 0,
    omittedMoreCount: more,
    capturedCommentCount: nodes.filter((n) => validBody(n.body)).length,
    contextScope: "returned_listing",
  };
  function doc(data: any, type: "post" | "comment"): RawDocumentInput {
    const id = z
      .string()
      .regex(/^[a-z0-9]+$/i)
      .parse(data.id);
    const author =
      typeof data.author === "string" &&
      !["[deleted]", "[removed]"].includes(data.author)
        ? data.author
        : undefined;
    if (
      type === "comment" &&
      ((data.link_id && data.link_id !== thread) ||
        !/^t[13]_[a-z0-9]+$/i.test(data.parent_id ?? ""))
    )
      throw new Error("Comment has invalid thread or parent identity");
    const canonicalUrl = `https://www.reddit.com/r/${encodeURIComponent(post.subreddit)}/comments/${post.id}/${type === "comment" ? `_/${id}/` : ""}`;
    return {
      sourceKey: "reddit",
      externalId: `${type === "post" ? "t3" : "t1"}_${id}`,
      canonicalUrl,
      type,
      body: type === "post" ? data.selftext : data.body,
      title: type === "post" ? data.title : undefined,
      authorExternalId: author,
      authorName: author,
      parentExternalId: type === "comment" ? data.parent_id : undefined,
      threadExternalId: thread,
      publishedAt:
        typeof data.created_utc === "number"
          ? new Date(data.created_utc * 1000).toISOString()
          : undefined,
      engagementScore: typeof data.score === "number" ? data.score : undefined,
      replyCount:
        typeof data.num_comments === "number" ? data.num_comments : undefined,
      metadata: { ...common, rawPayload: data },
    };
  }
  return [
    doc(post, "post"),
    ...nodes.filter((n) => validBody(n.body)).map((n) => doc(n, "comment")),
  ];
}
export class RedditConnector implements SourceConnector {
  constructor(
    private token = process.env.REDDIT_ACCESS_TOKEN,
    private urls: string[] = [],
  ) {}
  async discover() {
    return this.urls.map((url) => ({ url }));
  }
  async fetch(item: DiscoveredItem) {
    return (await this.fetchContext(item))[0];
  }
  async fetchContext(item: DiscoveredItem) {
    if (!this.token)
      throw new Error(
        "REDDIT_NOT_CONFIGURED: configure OAuth token or import a Reddit thread JSON",
      );
    const url = new URL(item.url);
    if (
      !["www.reddit.com", "reddit.com", "old.reddit.com"].includes(url.hostname)
    )
      throw new Error("Expected a canonical Reddit thread URL");
    const match = url.pathname.match(
      /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)/i,
    );
    if (!match) throw new Error("Expected /r/subreddit/comments/thread URL");
    const result = await fetchPublic(
      `https://oauth.reddit.com/r/${match[1]}/comments/${match[2]}?limit=100&raw_json=1`,
      {
        Authorization: `Bearer ${this.token}`,
        "User-Agent":
          process.env.REDDIT_USER_AGENT ??
          "VentureRadar/0.1 (internal research)",
      },
    );
    return parseRedditThread(JSON.parse(result.text), "oauth");
  }
}
