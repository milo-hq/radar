import { collectReviews } from "../../../packages/radar/src/data-engine.js";
import {
  advanceScans,
  runRadarJob,
} from "../../../packages/radar/src/radar.js";
import { reserveDiscoverySlot } from "../../../packages/db/src/discovery.js";
import { discoverTopic } from "../../../packages/connectors/src/topic.js";
import { compareOpportunities } from "../../../packages/opportunities/src/comparison.js";
import { discoverFeedback } from "../../../packages/connectors/src/feedback.js";
import { researchProduct } from "../../../packages/opportunities/src/research.js";
import {
  translationConfig,
  CompatibleProvider,
} from "../../../packages/llm/src/compatible.js";
import { translateDocument } from "../../../packages/translation/src/translate.js";
import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { pool, transaction } from "../../../packages/db/src/index.js";
import {
  claimJob,
  finishJob,
  failJob,
  scheduleDue,
  safeError,
} from "../../../packages/db/src/jobs.js";
import {
  insertDocuments,
  linkProduct,
} from "../../../packages/db/src/repository.js";
import { ManualURLConnector } from "../../../packages/connectors/src/manual.js";
import { RedditConnector } from "../../../packages/connectors/src/reddit.js";
let stop = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stop = true;
  });
console.log("Venture Radar worker ready");
while (!stop) {
  try {
    await scheduleDue(pool);
    await advanceScans(pool);
    const job = await claimJob(pool);
    if (!job) {
      await delay(2000);
      continue;
    }
    try {
      if (job.type.startsWith("RADAR_")) {
        const config = translationConfig();
        if (!config) throw Error("尚未配置研究模型");
        await runRadarJob(
          pool,
          job,
          new CompatibleProvider(config),
          config.model,
        );
        continue;
      }
      if (job.type === "DISCOVER_TOPIC") {
        const { source, query } = job.payload;
        const cooldown = await reserveDiscoverySlot(pool, source);
        if (cooldown) {
          await pool.query(
            "UPDATE jobs SET status='pending',attempts=attempts-1,run_at=$3,locked_until=null,lock_token=null WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
            [job.id, job.lock_token, cooldown],
          );
          continue;
        }
        try {
          const result = ["appstore", "wordpress"].includes(source)
            ? await collectReviews(source, query)
            : await discoverTopic(source, query);
          await transaction(pool, async (c) => {
            if (!(await finishJob(c, job))) throw Error("主题采集租约失效");
            const before = (
              await c.query(
                "SELECT count(DISTINCT external_id)::int n FROM raw_documents WHERE source_id=$1",
                [source],
              )
            ).rows[0].n;
            const rows = await insertDocuments(c, result.documents);
            for (const row of rows)
              await c.query(
                "INSERT INTO discovery_documents VALUES($1,$2) ON CONFLICT DO NOTHING",
                [job.id, row.id],
              );
            const after = (
              await c.query(
                "SELECT count(DISTINCT external_id)::int n FROM raw_documents WHERE source_id=$1",
                [source],
              )
            ).rows[0].n;
            await c.query(
              "UPDATE jobs SET payload=payload||$2::jsonb WHERE id=$1",
              [
                job.id,
                JSON.stringify({
                  savedCount: after - before,
                  matchedCount: rows.length,
                  quotaRemaining: result.quotaRemaining,
                  warnings: "errors" in result ? result.errors : [],
                }),
              ],
            );
            await c.query(
              "UPDATE sources SET discovery_available_at=greatest(discovery_available_at,now()+($2 * interval '1 second')) WHERE id=$1",
              [
                source,
                Math.max(result.cooldownSeconds, source === "github" ? 7 : 1),
              ],
            );
          });
        } catch (e) {
          const seconds = Number((e as any).cooldownSeconds) || 0;
          if (seconds > 0)
            await pool.query(
              "UPDATE sources SET discovery_available_at=greatest(discovery_available_at,now()+($2 * interval '1 second')) WHERE id=$1",
              [source, Math.min(seconds, 86400)],
            );
          throw e;
        }
        continue;
      }
      if (job.type === "DISCOVER_FEEDBACK") {
        const product = (
          await pool.query("SELECT * FROM winning_products WHERE id=$1", [
            job.payload.productId,
          ])
        ).rows[0];
        if (!product) throw Error("参考产品不存在");
        const urls = (
          await pool.query(
            "SELECT url FROM product_identifiers WHERE product_id=$1",
            [product.id],
          )
        ).rows.map((row) => row.url);
        const result = await discoverFeedback({ ...product, urls });
        await transaction(pool, async (c) => {
          if (!(await finishJob(c, job))) throw Error("采集任务租约失效");
          const before = (
            await c.query(
              "SELECT count(DISTINCT (d.source_id,d.external_id))::int n FROM product_documents pd JOIN raw_documents d ON d.id=pd.raw_document_id WHERE pd.product_id=$1",
              [product.id],
            )
          ).rows[0].n;
          const rows = await insertDocuments(c, result.documents);
          for (const row of rows)
            await c.query(
              "INSERT INTO product_documents VALUES($1,$2) ON CONFLICT DO NOTHING",
              [product.id, row.id],
            );
          const after = (
            await c.query(
              "SELECT count(DISTINCT (d.source_id,d.external_id))::int n FROM product_documents pd JOIN raw_documents d ON d.id=pd.raw_document_id WHERE pd.product_id=$1",
              [product.id],
            )
          ).rows[0].n;
          await c.query(
            "UPDATE jobs SET payload=payload || $2::jsonb WHERE id=$1",
            [
              job.id,
              JSON.stringify({
                savedCount: after - before,
                matchedCount: rows.length,
                queryCount: result.queryCount,
              }),
            ],
          );
        });
        continue;
      }
      if (job.type === "COMPARE_OPPORTUNITIES") {
        const config = translationConfig();
        if (!config) throw Error("尚未配置研究模型");
        await compareOpportunities(
          pool,
          job,
          new CompatibleProvider(config),
          config.model,
        );
        continue;
      }
      if (job.type === "ANALYZE_PRODUCT") {
        const config = translationConfig();
        if (!config) throw new Error("尚未配置研究模型");
        await researchProduct(pool, job.payload.productId, job.id, {
          provider: new CompatibleProvider(config),
          model: config.model,
          lockToken: job.lock_token,
          localization: job.payload.localization,
          checkLease: async () =>
            !!(
              await pool.query(
                "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
                [job.id, job.lock_token],
              )
            ).rowCount,
        });
        console.log(`Completed opportunity research ${job.id}`);
        continue;
      }
      if (job.type === "TRANSLATE_DOCUMENT") {
        const config = translationConfig();
        if (!config) throw new Error("尚未配置中文翻译模型");
        await translateDocument(pool, job.payload.documentId, {
          provider: new CompatibleProvider(config),
          model: config.model,
          checkLease: async () =>
            !!(
              await pool.query(
                "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
                [job.id, job.lock_token],
              )
            ).rowCount,
        });
        if (!(await finishJob(pool, job))) throw new Error("翻译任务租约失效");
        console.log(`Completed Chinese translation ${job.id}`);
        continue;
      }
      const { source, url, name } = job.payload;
      const connector =
        source === "reddit"
          ? new RedditConnector()
          : new ManualURLConnector(source === "winner" ? "winner" : "manual");
      const docs =
        connector instanceof RedditConnector
          ? await connector.fetchContext({ url })
          : [await connector.fetch({ url })];
      await transaction(pool, async (c) => {
        if (!(await finishJob(c, job)))
          throw new Error("Job lease lost; discard this attempt");
        const rows = await insertDocuments(c, docs);
        if (source === "winner") await linkProduct(c, name, url, rows);
      });
      console.log(`Completed ${job.id}: ${docs.length} source documents`);
    } catch (e) {
      await failJob(pool, job, e);
      console.error(`Job ${job.id}: ${safeError(e)}`);
    }
  } catch (e) {
    console.error(safeError(e));
    await delay(5000);
  }
}
await pool.end();
