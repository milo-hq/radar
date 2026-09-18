import { load } from "cheerio";
import { z } from "zod";
import type { RawDocumentInput } from "../../core/src/documents.js";

type Source = "youtube" | "v2ex";
type Options = {
  apiKey?: string;
  token?: string;
  language?: string;
  node?: string;
  transport?: typeof fetch;
  /** May shorten the 80-second collection budget for interactive callers. */
  budgetMs?: number;
};
type Result = {
  documents: RawDocumentInput[];
  cooldownSeconds: number;
  quotaRemaining: number | null;
  errors: string[];
};
const ytId = z
  .string()
  .regex(/^[\w.-]+$/)
  .max(500);
const ytComment = z.object({
  id: ytId,
  snippet: z.object({
    textOriginal: z.string().optional(),
    textDisplay: z.string(),
    publishedAt: z.iso.datetime(),
    authorDisplayName: z.string().optional(),
    authorChannelId: z.object({ value: z.string() }).optional(),
    likeCount: z.number().optional(),
    parentId: ytId.optional(),
  }),
});
const ytVideo = z.object({
  id: z.object({ videoId: ytId }),
  snippet: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.iso.datetime(),
    channelId: z.string().optional(),
    channelTitle: z.string().optional(),
  }),
});
const ytThread = z.object({
  id: ytId,
  snippet: z.object({
    topLevelComment: ytComment,
    totalReplyCount: z.number().nonnegative(),
  }),
});
const vMember = z
  .object({
    id: z.number().int().positive().optional(),
    username: z.string().optional(),
  })
  .optional();
const vTopic = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  content: z.string(),
  created: z.number().nonnegative(),
  replies: z.number().nonnegative(),
  member: vMember,
});
const vReply = z.object({
  id: z.number().int().positive(),
  content: z.string(),
  created: z.number().nonnegative(),
  member: vMember,
});
const plain = (html: string) => {
  const $ = load(html);
  $("script,style").remove();
  $("br,p,li").prepend("\n");
  return $.text().trim();
};
const iso = (seconds: number) => {
  const d = new Date(seconds * 1000);
  if (!Number.isFinite(+d)) throw Error("invalid source date");
  return d.toISOString();
};
const intentWords = new Set(
  "a an the i my for with in of to and or app apps software tool tools review reviews alternative alternatives frustrated frustrating frustration complaint complaints problem problems issue issues need want expensive slow broken sucks help best how not working".split(
    " ",
  ),
);
function anchorFor(query: string) {
  const quoted = query.match(/^\s*["“]([^"”]+)["”]/)?.[1];
  return (
    quoted ??
    query
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu)
      ?.find((t) => !intentWords.has(t)) ??
    ""
  )
    .normalize("NFKC")
    .toLowerCase();
}

/** Official bounded discovery. Language is a search hint, never a user's location. */
export async function collectGlobalSocial(
  source: Source,
  query: string,
  options: Options,
): Promise<Result> {
  const credential = (
    source === "youtube" ? options.apiKey : options.token
  )?.trim();
  if (!credential)
    throw Error(
      source === "youtube"
        ? "youtube API key credential is missing"
        : "v2ex token credential is missing",
    );
  const node = options.node ?? "apps";
  if (source === "v2ex" && !/^[A-Za-z0-9_-]{1,80}$/.test(node))
    throw Error("v2ex node is invalid");
  if (!query.trim()) throw Error(`${source} query is empty`);
  const deadline = AbortSignal.timeout(
    Math.max(1, Math.min(80_000, Math.floor(options.budgetMs ?? 80_000))),
  );
  // A shared deadline applies to fetch and every body read, including transports
  // which do not themselves reject when their signal is aborted.
  async function withinBudget<T>(
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (signal.aborted) throw Error("deadline");
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(Error("deadline"));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([operation(), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
  const result: Result = {
    documents: [],
    cooldownSeconds: 0,
    quotaRemaining: null,
    errors: [],
  };
  const seen = new Set<string>();
  const add = (doc: RawDocumentInput) => {
    if (doc.body.trim() && !seen.has(doc.externalId)) {
      seen.add(doc.externalId);
      result.documents.push(doc);
    }
  };
  const partial = (label: string, error: unknown) => {
    // Only our own sanitized errors reach this path; never expose URLs, credentials or upstream bodies.
    result.errors.push(
      `${source} ${label}: ${error instanceof Error ? error.message : "invalid response"}`,
    );
  };
  async function request(path: string, params: Record<string, string> = {}) {
    if (deadline.aborted) throw Error(`${source} collection deadline exceeded`);
    const requestSignal = AbortSignal.any([
      deadline,
      AbortSignal.timeout(25_000),
    ]);
    const u = new URL(
      path,
      source === "youtube"
        ? "https://www.googleapis.com/youtube/v3/"
        : "https://www.v2ex.com/api/v2/",
    );
    for (const [key, value] of Object.entries(params))
      u.searchParams.set(key, value);
    if (source === "youtube") u.searchParams.set("key", credential!);
    let response: Response;
    try {
      response = await withinBudget(requestSignal, () =>
        (options.transport ?? fetch)(u.toString(), {
          method: "GET",
          redirect: "error",
          signal: requestSignal,
          headers: {
            Accept: "application/json",
            ...(source === "v2ex"
              ? { Authorization: `Bearer ${credential}` }
              : {}),
          },
        }),
      );
    } catch {
      if (deadline.aborted)
        throw Error(`${source} collection deadline exceeded`);
      throw Error(`${source} request failed (network, timeout or redirect)`);
    }
    const remaining = response.headers.get("x-rate-limit-remaining");
    if (remaining !== null && /^\d+$/.test(remaining))
      result.quotaRemaining = Number(remaining);
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const delay =
        retry && /^\d+$/.test(retry)
          ? Number(retry)
          : retry
            ? Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000))
            : 0;
      const reset = Number(response.headers.get("x-rate-limit-reset"));
      if (response.status === 403 || response.status === 429)
        result.cooldownSeconds = Math.max(
          result.cooldownSeconds,
          60,
          Number.isFinite(delay) ? delay : 0,
          reset > 0 ? Math.ceil(reset - Date.now() / 1000) : 0,
          delay ? 0 : 3600,
        );
      throw Object.assign(Error(`${source} HTTP ${response.status}`), {
        cooldownSeconds: result.cooldownSeconds,
      });
    }
    let data: unknown;
    const reader = response.body?.getReader();
    try {
      if (!reader) throw Error();
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      for (;;) {
        const { done, value } = await withinBudget(requestSignal, () =>
          reader.read(),
        );
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4_000_000) {
          await reader.cancel();
          throw Error();
        }
        text += decoder.decode(value, { stream: true });
      }
      data = JSON.parse(text + decoder.decode());
    } catch {
      void reader?.cancel().catch(() => {});
      if (deadline.aborted)
        throw Error(`${source} collection deadline exceeded`);
      throw Error(`${source} invalid or oversized JSON payload`);
    }
    const parsed =
      source === "youtube"
        ? z
            .object({
              items: z.array(z.unknown()),
              nextPageToken: z.string().optional(),
            })
            .safeParse(data)
        : z
            .object({ success: z.literal(true), result: z.array(z.unknown()) })
            .safeParse(data);
    if (!parsed.success) throw Error(`${source} invalid API payload`);
    return "items" in parsed.data
      ? { items: parsed.data.items, nextPageToken: parsed.data.nextPageToken }
      : { items: parsed.data.result, nextPageToken: undefined };
  }
  function parse<T>(
    schema: z.ZodType<T>,
    value: unknown,
    label: string,
  ): T | undefined {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      result.errors.push(`${source} invalid ${label} item`);
      return;
    }
    return parsed.data;
  }
  if (source === "youtube") {
    const search = await request("search", {
      part: "snippet",
      type: "video",
      q: query,
      maxResults: "2",
      fields:
        "items(id/videoId,snippet(title,description,publishedAt,channelId,channelTitle))",
      ...(options.language ? { relevanceLanguage: options.language } : {}),
    });
    for (const item of search.items.slice(0, 2)) {
      if (deadline.aborted) break;
      const video = parse(ytVideo, item, "video");
      if (!video) continue;
      const id = video.id.videoId,
        thread = `video:${id}`,
        url = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      const metadata = {
        collectionMethod: "official_api",
        searchQuery: query,
        searchLanguage: options.language,
        videoId: id,
        videoTitle: plain(video.snippet.title),
        videoDescription: video.snippet.description,
        contextComplete: false,
        contextNote:
          "Bounded sample: up to 2 comment pages and 1 reply page per thread; not complete conversation.",
      };
      add({
        sourceKey: "youtube",
        externalId: thread,
        threadExternalId: thread,
        canonicalUrl: url,
        type: "post",
        title: plain(video.snippet.title),
        body: video.snippet.description.trim() || plain(video.snippet.title),
        publishedAt: video.snippet.publishedAt,
        authorExternalId: video.snippet.channelId,
        authorName: video.snippet.channelTitle,
        metadata,
      });
      const addComment = (
        comment: z.infer<typeof ytComment>,
        commentThreadId: string,
        parent: string,
        replyCount?: number,
      ) =>
        add({
          sourceKey: "youtube",
          externalId: `comment:${comment.id}`,
          canonicalUrl: `${url}&lc=${encodeURIComponent(comment.id)}`,
          type: "comment",
          body: comment.snippet.textOriginal ?? comment.snippet.textDisplay,
          authorName: comment.snippet.authorDisplayName,
          authorExternalId: comment.snippet.authorChannelId?.value,
          parentExternalId: parent,
          threadExternalId: thread,
          publishedAt: comment.snippet.publishedAt,
          engagementScore: comment.snippet.likeCount,
          replyCount,
          metadata: { ...metadata, commentThreadId },
        });
      let pageToken: string | undefined;
      const fetchedParents = new Set<string>();
      for (let page = 0; page < 2; page++) {
        try {
          const comments = await request("commentThreads", {
            part: "snippet",
            videoId: id,
            maxResults: "20",
            textFormat: "plainText",
            fields:
              "nextPageToken,items(id,snippet(totalReplyCount,topLevelComment(id,snippet(textOriginal,textDisplay,publishedAt,authorDisplayName,authorChannelId,likeCount))))",
            ...(pageToken ? { pageToken } : {}),
          });
          for (const item of comments.items.slice(0, 20)) {
            if (deadline.aborted) break;
            const entry = parse(ytThread, item, "comment thread");
            if (!entry) continue;
            const top = entry.snippet.topLevelComment;
            addComment(top, entry.id, thread, entry.snippet.totalReplyCount);
            if (
              entry.snippet.totalReplyCount > 0 &&
              !fetchedParents.has(top.id)
            ) {
              fetchedParents.add(top.id);
              try {
                const replies = await request("comments", {
                  part: "snippet",
                  parentId: top.id,
                  maxResults: "20",
                  textFormat: "plainText",
                  fields:
                    "nextPageToken,items(id,snippet(textOriginal,textDisplay,publishedAt,authorDisplayName,authorChannelId,likeCount,parentId))",
                });
                for (const item of replies.items.slice(0, 20)) {
                  const reply = parse(ytComment, item, "reply");
                  if (!reply) continue;
                  if (reply.snippet.parentId !== top.id) {
                    result.errors.push("youtube invalid reply parent");
                    continue;
                  }
                  addComment(reply, entry.id, `comment:${top.id}`);
                }
              } catch (error) {
                partial("replies", error);
              }
            }
          }
          if (!comments.nextPageToken || comments.nextPageToken === pageToken)
            break;
          pageToken = comments.nextPageToken;
        } catch (error) {
          partial("comments", error);
          break;
        }
      }
    }
  } else {
    const anchor = anchorFor(query);
    if (!anchor) throw Error("v2ex query requires a product anchor");
    const topics: z.infer<typeof vTopic>[] = [],
      topicIds = new Set<number>();
    for (let page = 1; page <= 2; page++) {
      let listing;
      try {
        listing = await request(`nodes/${node}/topics`, { p: String(page) });
      } catch (error) {
        if (page === 1) throw error;
        partial("topic page", error);
        break;
      }
      for (const item of listing.items) {
        const topic = parse(vTopic, item, "topic");
        if (!topic) continue;
        const text = `${topic.title} ${plain(topic.content)}`
          .normalize("NFKC")
          .toLowerCase();
        const matches = /^[a-z0-9._+-]+$/.test(anchor)
          ? text.match(/[a-z0-9][a-z0-9._+-]*/g)?.includes(anchor)
          : text.includes(anchor);
        if (matches && !topicIds.has(topic.id) && topics.length < 3) {
          topics.push(topic);
          topicIds.add(topic.id);
        }
      }
      if (!listing.items.length || topics.length >= 3) break;
    }
    for (const topic of topics) {
      const thread = `topic:${topic.id}`,
        url = `https://www.v2ex.com/t/${topic.id}`;
      const metadata = {
        collectionMethod: "official_api",
        collectionScope: "node_recent_topics",
        node,
        searchQuery: query,
        searchLanguage: options.language,
        productAnchor: anchor,
        topicId: topic.id,
        topicTitle: plain(topic.title),
        topicBody: plain(topic.content),
        contextComplete: false,
        contextNote:
          "Local product filtering of up to 2 recent node pages; up to 2 reply pages. Not a site-wide search or complete conversation.",
      };
      try {
        add({
          sourceKey: "v2ex",
          externalId: thread,
          threadExternalId: thread,
          canonicalUrl: url,
          type: "post",
          title: plain(topic.title),
          body: plain(topic.content) || plain(topic.title),
          publishedAt: iso(topic.created),
          authorName: topic.member?.username,
          authorExternalId: topic.member?.id
            ? String(topic.member.id)
            : topic.member?.username,
          replyCount: topic.replies,
          metadata,
        });
        if (!topic.replies) continue;
        for (let page = 1; page <= 2; page++) {
          const replies = await request(`topics/${topic.id}/replies`, {
            p: String(page),
          });
          for (const item of replies.items) {
            const reply = parse(vReply, item, "reply");
            if (!reply) continue;
            add({
              sourceKey: "v2ex",
              externalId: `reply:${reply.id}`,
              canonicalUrl: `${url}?p=${page}#r_${reply.id}`,
              type: "comment",
              body: plain(reply.content),
              parentExternalId: thread,
              threadExternalId: thread,
              publishedAt: iso(reply.created),
              authorName: reply.member?.username,
              authorExternalId: reply.member?.id
                ? String(reply.member.id)
                : reply.member?.username,
              metadata: { ...metadata, replyId: reply.id },
            });
          }
          if (!replies.items.length) break;
        }
      } catch (error) {
        partial("topic replies", error);
      }
    }
  }
  return result;
}
