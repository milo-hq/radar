import { z } from "zod";
import type { RawDocumentInput } from "../../core/src/documents.js";
const id = z.string().regex(/^t[13]_[a-z0-9]+$/);
const body = z
  .string()
  .trim()
  .min(1)
  .max(40000)
  .refine((v) => !["[deleted]", "[removed]"].includes(v));
const author = z.string().max(100).optional();
export const browserSnapshotSchema = z.object({
  url: z.url().max(2000),
  subreddit: z.string().regex(/^[A-Za-z0-9_]{2,30}$/),
  postId: z.string().regex(/^t3_[a-z0-9]+$/),
  title: z.string().trim().min(1).max(1000),
  body,
  author,
  publishedAt: z.iso.datetime().optional(),
  reportedCommentCount: z.number().int().min(0).optional(),
  comments: z
    .array(
      z.object({
        id: z.string().regex(/^t1_[a-z0-9]+$/),
        body,
        author,
        parentId: id.optional(),
        publishedAt: z.iso.datetime().optional(),
      }),
    )
    .max(30),
});
export function parseBrowserSnapshot(
  input: unknown,
  subreddit: string,
): RawDocumentInput[] {
  const s = browserSnapshotSchema.parse(input),
    u = new URL(s.url);
  const match = u.pathname.match(
    /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/|$)/,
  );
  if (
    u.origin !== "https://www.reddit.com" ||
    u.username ||
    u.password ||
    !match ||
    match[1].toLowerCase() !== subreddit.toLowerCase() ||
    s.subreddit.toLowerCase() !== subreddit.toLowerCase() ||
    `t3_${match[2]}` !== s.postId
  )
    throw Error("Invalid Reddit snapshot identity");
  const comments = [...new Map(s.comments.map((c) => [c.id, c])).values()];
  for (const c of comments) {
    if (
      c.parentId === c.id ||
      (c.parentId?.startsWith("t3_") && c.parentId !== s.postId)
    )
      throw Error("Invalid Reddit comment parent");
  }
  const canonical = `https://www.reddit.com/r/${s.subreddit}/comments/${s.postId.slice(3)}/`;
  const metadata = {
    acquisition: "browser_session",
    subreddit: s.subreddit,
    contextComplete: false,
    contextScope: "rendered_page",
    capturedCommentCount: comments.length,
    reportedCommentCount: s.reportedCommentCount ?? null,
    contextNote: "仅采集已渲染公开内容，可能存在未加载、隐藏或删除的评论。",
  };
  const identity = (a: string | undefined) =>
    a && !["[deleted]", "[removed]"].includes(a) ? a : undefined;
  return [
    {
      sourceKey: "reddit",
      externalId: s.postId,
      canonicalUrl: canonical,
      type: "post",
      title: s.title,
      body: s.body,
      authorName: identity(s.author),
      authorExternalId: identity(s.author),
      threadExternalId: s.postId,
      publishedAt: s.publishedAt,
      replyCount: s.reportedCommentCount,
      metadata,
    },
    ...comments.map((c) => ({
      sourceKey: "reddit" as const,
      externalId: c.id,
      canonicalUrl: canonical + `_/${c.id.slice(3)}/`,
      type: "comment" as const,
      body: c.body,
      authorName: identity(c.author),
      authorExternalId: identity(c.author),
      threadExternalId: s.postId,
      parentExternalId: c.parentId,
      publishedAt: c.publishedAt,
      metadata,
    })),
  ];
}
