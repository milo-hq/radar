import type { Pool, PoolClient } from "pg";
import {
  normalizeDocument,
  type RawDocumentInput,
} from "../../core/src/documents.js";
import { transaction } from "./index.js";
export async function insertDocuments(
  c: PoolClient,
  inputs: RawDocumentInput[],
) {
  const rows = [];
  for (const input of inputs) {
    const d = normalizeDocument(input);
    const params = [
      d.sourceKey,
      d.externalId,
      d.canonicalUrl,
      d.type,
      d.title ?? null,
      d.body,
      d.authorExternalId ?? null,
      d.authorName ?? null,
      d.parentExternalId ?? null,
      d.threadExternalId ?? null,
      d.publishedAt ?? null,
      d.engagementScore ?? null,
      d.replyCount ?? null,
      d.normalizedContentHash,
      d.snapshotHash,
      JSON.stringify(d.metadata),
    ];
    let row = (
      await c.query(
        `INSERT INTO raw_documents(source_id,external_id,canonical_url,type,title,body,author_external_id,author_name,parent_external_id,thread_external_id,published_at,engagement_score,reply_count,normalized_content_hash,snapshot_hash,metadata) VALUES(${params.map((_, i) => "$" + (i + 1)).join(",")}) ON CONFLICT DO NOTHING RETURNING *`,
        params,
      )
    ).rows[0];
    if (!row)
      row = (
        await c.query(
          "SELECT * FROM raw_documents WHERE source_id=$1 AND external_id=$2 AND snapshot_hash=$3",
          [d.sourceKey, d.externalId, d.snapshotHash],
        )
      ).rows[0];
    await c.query(
      "INSERT INTO content_groups(normalized_content_hash) VALUES($1) ON CONFLICT DO NOTHING",
      [d.normalizedContentHash],
    );
    await c.query(
      "INSERT INTO content_group_documents SELECT id,$2 FROM content_groups WHERE normalized_content_hash=$1 ON CONFLICT DO NOTHING",
      [d.normalizedContentHash, row.id],
    );
    rows.push(row);
  }
  return rows;
}
export async function saveDocuments(pool: Pool, docs: RawDocumentInput[]) {
  return transaction(pool, (c) => insertDocuments(c, docs));
}
export async function linkProduct(
  c: PoolClient,
  name: string,
  url: string,
  docs: any[],
) {
  const domain = new URL(docs[0]?.canonical_url ?? url).hostname.replace(
    /^www\./,
    "",
  );
  const canonical = docs[0]?.canonical_url ?? url;
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [domain]);
  let product = (
    await c.query(
      "SELECT p.* FROM product_identifiers i JOIN winning_products p ON p.id=i.product_id WHERE i.url=$1",
      [canonical],
    )
  ).rows[0];
  if (
    !product &&
    ["/", "/pricing", "/open"].includes(
      new URL(canonical).pathname.replace(/\/$/, "") || "/",
    )
  ) {
    const matches = (
      await c.query("SELECT * FROM winning_products WHERE domain=$1", [domain])
    ).rows;
    if (matches.length === 1) product = matches[0];
  }
  if (!product)
    product = (
      await c.query(
        "INSERT INTO winning_products(domain,name) VALUES($1,$2) RETURNING *",
        [domain, name || domain],
      )
    ).rows[0];
  await c.query(
    "INSERT INTO product_identifiers VALUES($1,$2) ON CONFLICT DO NOTHING",
    [product.id, canonical],
  );
  for (const doc of docs)
    await c.query(
      "INSERT INTO product_documents VALUES($1,$2) ON CONFLICT DO NOTHING",
      [product.id, doc.id],
    );
  return product;
}
