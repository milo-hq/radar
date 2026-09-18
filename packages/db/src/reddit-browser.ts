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
  for (const subreddit of redditCommunities) {
    const job = await enqueue(
      c,
      "DISCOVER_TOPIC",
      {
        source: "reddit",
        transport: "reddit_browser",
        subreddit,
        query: `r/${subreddit}`,
        name: `浏览器采集 · r/${subreddit}`,
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
