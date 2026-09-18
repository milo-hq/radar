import {
  globalPolicy,
  localizedToolQuery,
} from "../../core/src/discovery-policy.js";
import { ensureToolTargets, productQuery } from "./tool-search.js";
import type { PoolClient, Pool } from "pg";
import { enqueue } from "./jobs.js";
export const redditCommunities = [
  "SaaS",
  "smallbusiness",
  "Entrepreneur",
  "SideProject",
];
export async function enqueueBrowserJobs(c: PoolClient, scanId?: string) {
  const ids: string[] = [];
  const targets = await ensureToolTargets(c, scanId);
  for (const [index, subreddit] of redditCommunities.entries()) {
    const target = targets[index];
    const job = await enqueue(
      c,
      "DISCOVER_TOPIC",
      {
        source: "reddit",
        transport: "reddit_browser",
        subreddit,
        query: productQuery(target, "reddit"),
        referenceTool: target.product,
        searchQuery: productQuery(target, "reddit"),
        name: `工具痛点搜索 · r/${subreddit}`,
        scanId,
        deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
      `reddit-browser:${scanId ?? crypto.randomUUID()}:${subreddit}`,
    );
    await c.query("UPDATE jobs SET max_attempts=5 WHERE id=$1", [job.id]);
    ids.push(job.id);
  }
  return ids;
}
export async function expireBrowserJobs(db: Pool | PoolClient) {
  // An offline extension cannot finish its queued work. Preserve any live lease
  // and allow a short reconnection window before advancing with partial evidence.
  await db.query(
    `UPDATE jobs SET status='failed',last_error='浏览器离线超过5分钟，本轮跳过剩余浏览器采集；已保存材料继续分析，恢复连接后可开启新一轮',locked_until=null,updated_at=now()
     WHERE payload->>'transport'='reddit_browser' AND status IN ('pending','running')
       AND created_at<now()-interval '5 minutes'
       AND (locked_until IS NULL OR locked_until<now())
       AND NOT EXISTS (SELECT 1 FROM reddit_browser_connection WHERE id AND last_seen_at>now()-interval '5 minutes')`,
  );
  await db.query(
    `UPDATE jobs SET status='failed',last_error='浏览器采集等待超时；请恢复连接后重新采集',locked_until=null,updated_at=now() WHERE payload->>'transport'='reddit_browser' AND status IN ('pending','running') AND ((payload->>'deadlineAt')::timestamptz<now() OR (status='running' AND locked_until<now() AND attempts>=max_attempts))`,
  );
}

export async function enqueueXBrowserJobs(c: PoolClient, scanId: string) {
  const ids: string[] = [];
  const targets = await ensureToolTargets(c, scanId);
  const plan = (
    await c.query("SELECT plan FROM radar_scans WHERE id=$1", [scanId])
  ).rows[0].plan;
  const policy = plan.policy ?? globalPolicy(0);
  for (const [index, target] of targets.entries()) {
    for (const searchLanguage of [
      "en",
      policy.searchLanguages[1 + (index % 2)],
    ]) {
      const query =
        searchLanguage === "en"
          ? productQuery(target, "x")
          : localizedToolQuery(target.product, searchLanguage) +
            " -filter:retweets";
      const job = await enqueue(
        c,
        "DISCOVER_TOPIC",
        {
          source: "x",
          referenceTool: target.product,
          searchLanguage,
          transport: "reddit_browser",
          searchQuery: query,
          query,
          name: `X 工具痛点 · ${query}`,
          scanId,
          deadlineAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        },
        `x-browser:${scanId}:${query}`,
      );
      await c.query("UPDATE jobs SET max_attempts=5 WHERE id=$1", [job.id]);
      ids.push(job.id);
    }
  }
  return ids;
}
