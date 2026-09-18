import { z } from "zod";
import type { RawDocumentInput } from "../../core/src/documents.js";
const snapshot = z.object({
  url: z.url().max(2000),
  postId: z.string().regex(/^\d{1,30}$/),
  author: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  body: z.string().trim().min(1).max(40000),
  publishedAt: z.iso.datetime().optional(),
});
export function parseXSnapshot(
  input: unknown,
  searchQuery: string,
): RawDocumentInput[] {
  const s = snapshot.parse(input),
    u = new URL(s.url);
  const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
  if (
    u.origin !== "https://x.com" ||
    u.username ||
    u.password ||
    !m ||
    m[1].toLowerCase() !== s.author.toLowerCase() ||
    m[2] !== s.postId
  )
    throw Error("Invalid X snapshot identity");
  return [
    {
      sourceKey: "x",
      externalId: s.postId,
      canonicalUrl: `https://x.com/${s.author}/status/${s.postId}`,
      type: "post",
      body: s.body,
      title: s.body.slice(0, 160),
      authorName: s.author,
      authorExternalId: s.author.toLowerCase(),
      publishedAt: s.publishedAt,
      metadata: {
        acquisition: "browser_session",
        searchQuery,
        contextComplete: false,
        contextScope: "rendered_search_post",
        contextNote:
          "仅采集搜索页已渲染的帖子正文；未展开长文、引用帖及回复，不代表完整讨论。",
      },
    },
  ];
}
