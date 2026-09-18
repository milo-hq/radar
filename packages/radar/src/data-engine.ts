import { createHash } from "node:crypto";
import { z } from "zod";
import { rawDocumentSchema } from "../../core/src/documents.js";
const score = z.number().min(0).max(100);
export const analyticsSchema = z.object({
  version: z.literal("1"),
  documentCount: z.number().int().nonnegative(),
  uniqueContentCount: z.number().int().nonnegative(),
  clusterCount: z.number().int().nonnegative(),
  sourceCounts: z.record(z.string(), z.number().int().nonnegative()),
  clusters: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        documentIds: z.array(z.string()).min(1),
        independentAccounts: z.number().int().nonnegative(),
        sourceCount: z.number().int().nonnegative(),
        sourceNames: z.array(z.string()),
        recentCount: z.number().int().nonnegative(),
        painMentions: z.number().int().nonnegative(),
        commercialMentions: z.number().int().nonnegative(),
        frictionMentions: z.number().int().nonnegative(),
        evidenceScore: score,
        dimensions: z.object({
          recurrence: score,
          crossSource: score,
          recency: score.nullable(),
          pain: score,
          commercial: score,
          friction: score,
        }),
        unknowns: z.array(z.string()),
      }),
    )
    .max(1000),
  limitations: z.array(z.string()),
});
export type Analytics = z.infer<typeof analyticsSchema>;
async function request(
  path: string,
  input: unknown,
  transport: typeof fetch = fetch,
) {
  const base = (process.env.DATA_ENGINE_URL ?? "http://127.0.0.1:8000").replace(
    /\/$/,
    "",
  );
  let response: Response;
  try {
    response = await transport(base + path, {
      method: input === undefined ? "GET" : "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw Error("Python 数据引擎暂不可用或超时，请检查 data-engine 服务");
  }
  if (!response.ok)
    throw Object.assign(Error(`Python 数据引擎返回 HTTP ${response.status}`), {
      cooldownSeconds: Number(response.headers.get("retry-after")) || 0,
    });
  const reader = response.body?.getReader();
  if (!reader) throw Error("Python 数据引擎响应为空");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 8_000_000) {
      await reader.cancel();
      throw Error("Python 数据引擎响应超过限制");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function analyzeDocuments(rows: any[], transport?: typeof fetch) {
  const documents = rows.map((d) => ({
    id: d.id,
    source:
      d.source_id === "web" ? (d.metadata?.sourceHost ?? "web") : d.source_id,
    externalId: d.external_id,
    title: d.title ?? "",
    body: d.body.slice(0, 40000),
    authorId: d.source_id === "wordpress" ? null : d.author_external_id,
    publishedAt: d.published_at ? new Date(d.published_at).toISOString() : null,
    metadata: {
      pageKind: d.metadata?.pageKind,
      rating: d.metadata?.rating,
      country: d.metadata?.country,
      productId: d.metadata?.productId,
      bodyTruncated: d.body.length > 40000,
      fullContentHash: createHash("sha256").update(d.body).digest("hex"),
    },
  }));
  const result = analyticsSchema.parse(
    await request("/analyze", { documents }, transport),
  );
  const ids = result.clusters.flatMap((c) => c.documentIds),
    expected = new Set(rows.map((d) => d.id));
  if (
    result.documentCount !== rows.length ||
    result.clusterCount !== result.clusters.length ||
    ids.length !== expected.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !expected.has(id))
  )
    throw Error("Python 分析未完整覆盖本轮来源或引用未知文档");
  return result;
}
export async function collectReviews(
  source: "appstore" | "wordpress",
  query: string,
  transport?: typeof fetch,
  country = "us",
) {
  if (!/^[a-z]{2}$/.test(country)) throw Error("Invalid storefront country");
  const result = z
    .object({
      documents: z.array(rawDocumentSchema).max(40),
      cooldownSeconds: z.number().nonnegative(),
      quotaRemaining: z.number().nullable(),
      errors: z.array(z.string()),
      applications: z.number().int().nonnegative(),
    })
    .parse(await request("/collect", { source, query, country }, transport));
  if (result.documents.some((d) => d.sourceKey !== source))
    throw Error("Python 采集返回了不匹配的来源");
  return result;
}
/** Group similar material together without dropping any eligible source. */
export function extractionBatches(analytics: Analytics, size = 30) {
  const ids = analytics.clusters.flatMap((c) => c.documentIds),
    batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size)
    batches.push(ids.slice(i, i + size));
  return batches;
}

export const crawlerSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  seed: z.url(),
  kind: z.string(),
  enabled: z.boolean(),
});
export async function crawlerSites(transport?: typeof fetch) {
  return z
    .object({ sites: z.array(crawlerSiteSchema).max(30) })
    .parse(await request("/crawl/sites", undefined, transport)).sites;
}
export async function crawlSite(
  siteId: string,
  replayKey: string,
  transport?: typeof fetch,
) {
  const result = z
    .object({
      documents: z.array(rawDocumentSchema).max(12),
      cooldownSeconds: z.number().nonnegative(),
      quotaRemaining: z.number().nullable(),
      errors: z.array(z.string()),
      applications: z.number().nonnegative(),
      stats: z.object({
        siteId: z.string(),
        siteName: z.string(),
        visited: z.number().nonnegative(),
        discovered: z.number().nonnegative(),
        rendered: z.number().nonnegative(),
        cached: z.number().nonnegative(),
        blocked: z.number().nonnegative(),
        remaining: z.number().nonnegative(),
      }),
    })
    .parse(await request("/crawl", { siteId, replayKey }, transport));
  if (
    result.stats.siteId !== siteId ||
    result.documents.some((d) => d.sourceKey !== "web")
  )
    throw Error("爬虫返回了不匹配的站点或来源");
  return result;
}
