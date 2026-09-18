import type { Pool, PoolClient } from "pg";
import { transaction } from "./index.js";
export interface Job {
  id: string;
  type: string;
  payload: Record<string, any>;
  lock_token: string;
  attempts: number;
  max_attempts: number;
}
type Queryable = Pool | PoolClient;
export async function enqueue(
  db: Queryable,
  type: string,
  payload: Record<string, unknown>,
  key: string,
) {
  const result = await db.query(
    "INSERT INTO jobs(type,payload,idempotency_key) VALUES($1,$2,$3) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *",
    [type, JSON.stringify(payload), key],
  );
  return result.rows[0] as Job;
}
export async function claimJob(db: Pool, id?: string): Promise<Job | null> {
  return transaction(db, async (c) => {
    await c.query(
      "UPDATE jobs SET status='failed',last_error='Worker lease expired at retry limit',updated_at=now() WHERE payload->>'transport' IS DISTINCT FROM 'reddit_browser' AND status='running' AND locked_until<now() AND attempts>=max_attempts",
    );
    const result = await c.query(
      `UPDATE jobs SET status='running',attempts=attempts+1,lock_token=gen_random_uuid(),locked_until=now()+interval '120 seconds',updated_at=now() WHERE id=(SELECT id FROM jobs WHERE payload->>'transport' IS DISTINCT FROM 'reddit_browser' AND ($1::uuid IS NULL OR id=$1) AND attempts<max_attempts AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<now())) ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
      [id ?? null],
    );
    return result.rows[0] ?? null;
  });
}
export async function finishJob(db: Queryable, job: Job) {
  return !!(
    await db.query(
      "UPDATE jobs SET status='succeeded',locked_until=null,last_error=null,updated_at=now() WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
      [job.id, job.lock_token],
    )
  ).rowCount;
}
export function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    process.env.REDDIT_ACCESS_TOKEN,
    process.env.YOUTUBE_API_KEY,
    process.env.V2EX_ACCESS_TOKEN,
    process.env.TRANSLATION_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.DATABASE_URL,
  ])
    if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.slice(0, 600);
}
export async function failJob(db: Queryable, job: Job, error: unknown) {
  await db.query(
    "UPDATE jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,run_at=now()+make_interval(secs=>LEAST(300,5*power(2,attempts-1))::int),locked_until=null,last_error=$3,updated_at=now() WHERE id=$1 AND lock_token=$2 AND status='running'",
    [job.id, job.lock_token, safeError(error)],
  );
}
export async function scheduleDue(db: Pool) {
  await transaction(db, async (c) => {
    const due = (
      await c.query(
        "SELECT * FROM query_profiles WHERE enabled AND next_run_at<=now() FOR UPDATE SKIP LOCKED LIMIT 10",
      )
    ).rows;
    for (const p of due) {
      await enqueue(
        c,
        "FETCH_SOURCE",
        { url: p.url, source: p.source_id, name: p.name },
        `schedule:${p.id}:${new Date(p.next_run_at).toISOString()}`,
      );
      await c.query(
        "UPDATE query_profiles SET next_run_at=now()+make_interval(hours=>interval_hours) WHERE id=$1",
        [p.id],
      );
    }
  });
}
