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
    const job = await claimJob(pool);
    if (!job) {
      await delay(2000);
      continue;
    }
    try {
      if (job.type === "ANALYZE_PRODUCT") {
        const config = translationConfig();
        if (!config) throw new Error("尚未配置研究模型");
        await researchProduct(pool, job.payload.productId, job.id, {
          provider: new CompatibleProvider(config),
          model: config.model,
          lockToken: job.lock_token,
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
