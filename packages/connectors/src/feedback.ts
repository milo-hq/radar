import { load } from "cheerio";
import type { RawDocumentInput } from "../../core/src/documents.js";
export async function discoverFeedback(
  product: { name: string; domain: string; urls?: string[] },
  transport: typeof fetch = fetch,
) {
  const paths = (product.urls ?? [])
    .map((url) => new URL(url))
    .filter(
      (u) =>
        !["/", "/pricing", "/pricing/", "/open", "/open/"].includes(u.pathname),
    );
  const identifiers = paths.length
    ? paths.map((u) => u.host + u.pathname).slice(0, 1)
    : [product.domain];
  const queries = [...identifiers];
  if (
    product.name.trim().length >= 7 &&
    product.name.toLowerCase() !== product.domain.toLowerCase()
  )
    queries.push(product.name.trim());
  const documents: RawDocumentInput[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      tags: "comment",
      hitsPerPage: "50",
      numericFilters:
        "created_at_i>" + Math.floor(Date.now() / 1000 - 730 * 86400),
    });
    const url = "https://hn.algolia.com/api/v1/search_by_date?" + params;
    const response = await transport(url, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "VentureRadar/0.2" },
    });
    if (!response.ok)
      throw Error("Hacker News 搜索返回 HTTP " + response.status);
    const raw = await response.text();
    if (raw.length > 3_000_000) throw Error("讨论搜索响应超过限制");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.hits)) throw Error("讨论搜索返回格式无效");
    for (const hit of data.hits) {
      if (documents.length >= 40) break;
      if (
        !/^\d+$/.test(String(hit.objectID)) ||
        seen.has(String(hit.objectID)) ||
        typeof hit.comment_text !== "string"
      )
        continue;
      const original = hit.comment_text;
      const $ = load(original);
      $("p,br").prepend("\n");
      const body = $.text().trim();
      const haystack = original.toLowerCase();
      if (
        body.length < 100 ||
        body.length > 12000 ||
        !hit.author ||
        (!identifiers.some((identifier) =>
          haystack.includes(identifier.toLowerCase()),
        ) &&
          !(
            product.name.length >= 7 &&
            haystack.includes(product.name.toLowerCase())
          ))
      )
        continue;
      if (!Number.isFinite(Date.parse(hit.created_at))) continue;
      seen.add(String(hit.objectID));
      documents.push({
        sourceKey: "hn",
        externalId: String(hit.objectID),
        canonicalUrl: "https://news.ycombinator.com/item?id=" + hit.objectID,
        type: "comment",
        title: hit.story_title ?? "关于 " + product.name + " 的用户讨论",
        body,
        authorName: hit.author,
        authorExternalId: hit.author,
        threadExternalId: hit.story_id ? String(hit.story_id) : undefined,
        parentExternalId: hit.parent_id ? String(hit.parent_id) : undefined,
        publishedAt: new Date(hit.created_at).toISOString(),
        metadata: {
          provider: "hn-algolia",
          contextComplete: false,
          contextNote: "仅采集命中评论；父帖及完整讨论请打开原文链接核对",
          discoveryQuery: query,
          rawPayload: hit,
        },
      });
    }
  }
  return { documents, queryCount: queries.length };
}
