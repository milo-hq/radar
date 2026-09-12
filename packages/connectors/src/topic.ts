import { load } from "cheerio";
import type { RawDocumentInput } from "../../core/src/documents.js";
export type TopicSource = "hn" | "github" | "stackoverflow";
const plain = (s: string) => {
  const $ = load(s);
  $("p,br,li").prepend("\n");
  $("script,style").remove();
  return $.text().trim();
};
const validUrl = (s: unknown, host: string) => {
  try {
    const u = new URL(String(s));
    return u.protocol === "https:" && u.hostname === host;
  } catch {
    return false;
  }
};
export async function discoverTopic(
  source: TopicSource,
  query: string,
  transport: typeof fetch = fetch,
) {
  const since = new Date(Date.now() - 730 * 86400000),
    cutoff = since.toISOString().slice(0, 10);
  const urls = {
    hn:
      "https://hn.algolia.com/api/v1/search_by_date?" +
      new URLSearchParams({
        query,
        tags: "comment",
        hitsPerPage: "30",
        numericFilters: "created_at_i>" + Math.floor(+since / 1000),
      }),
    github:
      "https://api.github.com/search/issues?" +
      new URLSearchParams({
        q: `${query} in:title is:issue is:public created:>=${cutoff}`,
        sort: "comments",
        order: "desc",
        per_page: "30",
      }),
    stackoverflow:
      "https://api.stackexchange.com/2.3/search/advanced?" +
      new URLSearchParams({
        q: query,
        site: "stackoverflow",
        pagesize: "30",
        sort: "activity",
        order: "desc",
        fromdate: String(Math.floor(+since / 1000)),
        filter: "withbody",
      }),
  };
  const response = await transport(urls[source], {
    redirect: "error",
    signal: AbortSignal.timeout(25000),
    headers: { "User-Agent": "VentureRadar/0.3", Accept: "application/json" },
  });
  if (!response.ok)
    throw Object.assign(Error(`${source} 搜索返回 HTTP ${response.status}`), {
      cooldownSeconds:
        response.status === 403 || response.status === 429
          ? Math.max(60, Number(response.headers.get("retry-after")) || 3600)
          : 0,
    });
  const reader = response.body?.getReader();
  if (!reader) throw Error("搜索返回空响应");
  let raw = "",
    bytes = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4_000_000) {
      await reader.cancel();
      throw Error("搜索响应超过4MB限制");
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  const data = JSON.parse(raw);
  if (data.error_id)
    throw Object.assign(
      Error(`${source}: ${data.error_message ?? "API error"}`),
      { cooldownSeconds: data.backoff ?? 60 },
    );
  const hits = source === "hn" ? data.hits : data.items;
  if (!Array.isArray(hits)) throw Error("搜索结果格式无效");
  const documents: RawDocumentInput[] = [],
    seen = new Set<string>();
  for (const h of hits.slice(0, 30)) {
    let d: RawDocumentInput;
    if (source === "github") {
      if (
        h.pull_request ||
        !validUrl(h.html_url, "github.com") ||
        typeof h.body !== "string" ||
        !h.user?.login
      )
        continue;
      const match = new URL(h.html_url).pathname.match(
        /^\/([^/]+)\/([^/]+)\/issues\/(\d+)$/,
      );
      if (!match) continue;
      d = {
        sourceKey: source,
        externalId: String(h.id),
        canonicalUrl: h.html_url,
        type: "issue",
        title: h.title,
        body: h.body,
        authorName: h.user.login,
        authorExternalId: String(h.user.id),
        threadExternalId: String(h.id),
        publishedAt: h.created_at,
        metadata: {
          repositoryUrl: `https://github.com/${match[1]}/${match[2]}`,
          repositoryName: `${match[1]}/${match[2]}`,
          state: h.state,
          contextComplete: false,
          contextNote: "仅采集Issue正文；未加载评论、关闭原因和维护者回应",
          rawPayload: h,
        },
      };
    } else if (source === "stackoverflow") {
      if (!validUrl(h.link, "stackoverflow.com") || typeof h.body !== "string")
        continue;
      d = {
        sourceKey: source,
        externalId: String(h.question_id),
        canonicalUrl: h.link,
        type: "post",
        title: plain(h.title ?? ""),
        body: plain(h.body),
        authorName: h.owner?.display_name
          ? plain(h.owner.display_name)
          : undefined,
        authorExternalId: h.owner?.user_id
          ? String(h.owner.user_id)
          : undefined,
        threadExternalId: String(h.question_id),
        publishedAt: new Date(h.creation_date * 1000).toISOString(),
        metadata: {
          isAnswered: h.is_answered,
          contextComplete: false,
          contextNote: "仅采集问题正文，未加载回答；问题可能已有解决方案",
          license: h.content_license ?? "查看原文许可",
          attributionUrl: h.link,
          rawPayload: h,
        },
      };
    } else {
      if (
        !/^\d+$/.test(String(h.objectID)) ||
        typeof h.comment_text !== "string"
      )
        continue;
      d = {
        sourceKey: source,
        externalId: String(h.objectID),
        canonicalUrl: "https://news.ycombinator.com/item?id=" + h.objectID,
        type: "comment",
        title: h.story_title ?? `HN · ${query}`,
        body: plain(h.comment_text),
        authorName: h.author,
        authorExternalId: h.author,
        threadExternalId: h.story_id ? String(h.story_id) : undefined,
        parentExternalId: h.parent_id ? String(h.parent_id) : undefined,
        publishedAt: h.created_at,
        metadata: {
          contextComplete: false,
          contextNote: "仅采集命中评论，完整讨论及父帖需打开原文核对",
          rawPayload: h,
        },
      };
    }
    if (
      !/^\d+$/.test(d.externalId) ||
      seen.has(d.externalId) ||
      d.body.length < 80 ||
      d.body.length > 40000 ||
      !d.publishedAt ||
      !Number.isFinite(Date.parse(d.publishedAt)) ||
      Date.parse(d.publishedAt) < +since
    )
      continue;
    seen.add(d.externalId);
    documents.push({
      ...d,
      metadata: {
        ...d.metadata,
        discoveryQuery: query,
        provider: source,
        searchMatchOnly: true,
        searchUrl: urls[source],
      },
    });
  }
  return {
    documents,
    cooldownSeconds: Math.max(0, Number(data.backoff) || 0),
    quotaRemaining: data.quota_remaining ?? null,
  };
}
