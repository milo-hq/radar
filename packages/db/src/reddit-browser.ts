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
  await db.query(
    `UPDATE jobs SET status='failed',last_error='浏览器采集等待超时；请恢复连接后重新采集',locked_until=null,updated_at=now() WHERE payload->>'transport'='reddit_browser' AND status IN ('pending','running') AND ((payload->>'deadlineAt')::timestamptz<now() OR (status='running' AND locked_until<now() AND attempts>=max_attempts))`,
  );
}

export async function enqueueXBrowserJobs(c: PoolClient, scanId: string) {
  const ids: string[] = [];
  for (const target of await ensureToolTargets(c, scanId)) {
    const query = productQuery(target, "x");
    const job = await enqueue(
      c,
      "DISCOVER_TOPIC",
      {
        source: "x",
        referenceTool: target.product,
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
  return ids;
}
