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
