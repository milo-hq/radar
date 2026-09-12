import { createHash } from "node:crypto";
import { z } from "zod";
export const rawDocumentSchema = z.object({
  sourceKey: z.enum([
    "manual",
    "winner",
    "reddit",
    "hn",
    "github",
    "stackoverflow",
  ]),
  externalId: z.string().min(1).max(1000),
  canonicalUrl: z.url(),
  type: z.enum([
    "post",
    "comment",
    "review",
    "issue",
    "job",
    "article",
    "product",
  ]),
  title: z.string().optional(),
  body: z.string().min(1).max(2_000_000),
  authorExternalId: z.string().optional(),
  authorName: z.string().optional(),
  parentExternalId: z.string().optional(),
  threadExternalId: z.string().optional(),
  publishedAt: z.iso.datetime().optional(),
  engagementScore: z.number().optional(),
  replyCount: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type RawDocumentInput = z.infer<typeof rawDocumentSchema>;
export interface DiscoveredItem {
  url: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
}
export interface SourceConnector {
  discover(cursor?: string): Promise<DiscoveredItem[]>;
  fetch(item: DiscoveredItem): Promise<RawDocumentInput>;
  fetchContext?(item: DiscoveredItem): Promise<RawDocumentInput[]>;
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function normalizeDocument(input: RawDocumentInput) {
  const doc = rawDocumentSchema.parse(input);
  if (!doc.body.trim() || ["[removed]", "[deleted]"].includes(doc.body.trim()))
    throw new Error("Source has no usable body");
  return {
    ...doc,
    normalizedContentHash: hash(
      doc.body.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
    ),
    snapshotHash: hash(JSON.stringify(doc)),
  };
}
export function evidenceDiversity(
  docs: ReturnType<typeof normalizeDocument>[],
) {
  const authors = new Set<string>(),
    voices = new Set<string>(),
    content = new Set<string>(),
    platforms = new Set<string>();
  for (const d of docs) {
    platforms.add(d.sourceKey);
    if (d.authorExternalId) authors.add(`${d.sourceKey}:${d.authorExternalId}`);
    if (d.authorExternalId && !content.has(d.normalizedContentHash))
      voices.add(
        `${d.sourceKey}:${d.threadExternalId ?? d.externalId}:${d.authorExternalId}`,
      );
    content.add(d.normalizedContentHash);
  }
  return {
    uniqueAuthors: authors.size,
    independentVoices: voices.size,
    contentGroups: content.size,
    platforms: platforms.size,
  };
}
