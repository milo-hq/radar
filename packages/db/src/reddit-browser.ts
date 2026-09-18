import type { PoolClient, Pool } from "pg";
import { enqueue } from "./jobs.js";
export const redditCommunities = [
  "SaaS",
  "smallbusiness",
  "Entrepreneur",
  "SideProject",
];
// Search for observed tool friction, not general startup stories.
export const redditComplaintQueries: Record<string, string> = {
  SaaS: '("alternative" OR "too expensive" OR "missing feature") (software OR tool)',
  smallbusiness:
    '(software OR app) ("frustrating" OR "manual" OR "alternative")',
  Entrepreneur: '(software OR tool) ("wish" OR "expensive" OR "frustrating")',
  SideProject: '(tool OR app) ("missing" OR "wish" OR "alternative")',
};
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
        query: redditComplaintQueries[subreddit],
        searchQuery: redditComplaintQueries[subreddit],
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

export const xComplaintQueries = [
  '(software OR app) "too expensive" -filter:retweets',
  '(software OR tool) "alternative" -filter:retweets',
  '(app OR tool) "missing feature" -filter:retweets',
  '(software OR tool) "manual" "wish" -filter:retweets',
];
export async function enqueueXBrowserJobs(c: PoolClient, scanId: string) {
  const ids: string[] = [];
  for (const query of xComplaintQueries) {
    const job = await enqueue(
      c,
      "DISCOVER_TOPIC",
      {
        source: "x",
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
