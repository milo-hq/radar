import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import { transaction } from "../../../packages/db/src/index.js";
import { insertDocuments } from "../../../packages/db/src/repository.js";
import {
  enqueueBrowserJobs,
  enqueueXBrowserJobs,
  expireBrowserJobs,
  redditCommunities,
} from "../../../packages/db/src/reddit-browser.js";
import { parseBrowserSnapshot } from "../../../packages/connectors/src/reddit-browser.js";
import { parseXSnapshot } from "../../../packages/connectors/src/x-browser.js";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const leaseSchema = z.object({ jobId: z.uuid(), lease: z.uuid() });
const reasons = z.enum([
  "login_required",
  "challenge",
  "page_changed",
  "browser_closed",
  "user_paused",
  "permission_required",
]);
const conflict = () =>
  Object.assign(Error("Browser lease expired"), { statusCode: 409 });
async function browserAuthenticated(db: Pool | PoolClient, r: FastifyRequest) {
  const token = r.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return false;
  const hash = (
    await db.query("SELECT token_hash FROM reddit_browser_connection WHERE id")
  ).rows[0]?.token_hash;
  return (
    typeof hash === "string" &&
    hash.length === 64 &&
    timingSafeEqual(Buffer.from(hash), Buffer.from(digest(token)))
  );
}
async function browserTransaction<T>(
  db: Pool,
  r: FastifyRequest,
  fn: (c: PoolClient) => Promise<T>,
) {
  return transaction(db, async (c) => {
    await c.query(
      "SELECT id FROM reddit_browser_connection WHERE id FOR UPDATE",
    );
    if (!(await browserAuthenticated(c, r)))
      throw Object.assign(Error("Browser connection revoked"), {
        statusCode: 401,
      });
    return fn(c);
  });
}
async function held(c: PoolClient, data: z.infer<typeof leaseSchema>) {
  const row = (
    await c.query(
      "SELECT * FROM jobs WHERE id=$1 AND lock_token=$2 AND payload->>'transport'='reddit_browser' AND status='running' AND locked_until>now() AND (payload->>'deadlineAt')::timestamptz>now() FOR UPDATE",
      [data.jobId, data.lease],
    )
  ).rows[0];
  if (!row) throw conflict();
  return row;
}
export function registerRedditBrowser(app: FastifyInstance, db: Pool) {
  app.get("/api/reddit-browser", async () => {
    const connection = (
      await db.query(
        "SELECT enabled,x_enabled,last_seen_at,pause_reason,token_hash IS NOT NULL paired,last_seen_at>now()-interval '90 seconds' online FROM reddit_browser_connection WHERE id",
      )
    ).rows[0];
    const jobs = (
      await db.query(
        "SELECT id,status,payload,last_error,created_at FROM jobs WHERE payload->>'transport'='reddit_browser' ORDER BY created_at DESC LIMIT 12",
      )
    ).rows;
    return { connection, jobs, communities: redditCommunities };
  });
  app.post("/api/reddit-browser/pair", async () => {
    const token = randomBytes(32).toString("hex");
    await transaction(db, async (c) => {
      await c.query(
        "UPDATE reddit_browser_connection SET token_hash=$1,enabled=false,last_seen_at=null,pause_reason=null WHERE id",
        [digest(token)],
      );
      await c.query(
        "UPDATE jobs SET status='pending',locked_until=null,lock_token=null,attempts=greatest(0,attempts-1) WHERE payload->>'transport'='reddit_browser' AND status='running'",
      );
    });
    return { token };
  });
  app.post("/api/reddit-browser/disconnect", async () => {
    await transaction(db, async (c) => {
      await c.query(
        "UPDATE reddit_browser_connection SET token_hash=null,enabled=false,last_seen_at=null,pause_reason=null WHERE id",
      );
      await c.query(
        "UPDATE jobs SET status='failed',locked_until=null,last_error='浏览器连接已断开' WHERE payload->>'transport'='reddit_browser' AND status IN ('pending','running')",
      );
    });
    return { ok: true };
  });
  app.post("/api/reddit-browser/start", async (r, reply) =>
    transaction(db, async (c) => {
      const source = z
        .object({ source: z.enum(["reddit", "x"]).default("reddit") })
        .parse(r.body ?? {}).source;
      const connected = (
        await c.query(
          "SELECT id,x_enabled FROM reddit_browser_connection WHERE id AND enabled AND pause_reason IS NULL AND last_seen_at>now()-interval '90 seconds' FOR UPDATE",
        )
      ).rows[0];
      if (!connected)
        return reply.code(409).send({ error: "请先连接并启动浏览器扩展" });
      if (source === "x" && !connected.x_enabled)
        return reply.code(409).send({ error: "请先在扩展中启用 X 访问权限" });
      await expireBrowserJobs(c);
      const active = (
        await c.query(
          "SELECT id,payload->>'source' source FROM jobs WHERE payload->>'transport'='reddit_browser' AND status IN ('pending','running')",
        )
      ).rows;
      if (active.length) {
        const sameSource = active.filter((j) => j.source === source);
        if (!sameSource.length)
          return reply.code(409).send({
            error: "另一来源正在采集，请等当前浏览器任务完成后再启动",
          });
        return { jobIds: sameSource.map((j) => j.id) };
      }
      const scan = (
        await c.query(
          "INSERT INTO radar_scans(status,plan) VALUES('collecting',$1) RETURNING id",
          [
            JSON.stringify({
              kind: source,
              [source === "x" ? "xBrowser" : "redditBrowser"]: {
                included: true,
                reason: "浏览器专项采集",
              },
            }),
          ],
        )
      ).rows[0];
      return {
        scanId: scan.id,
        jobIds: await (
          source === "x" ? enqueueXBrowserJobs : enqueueBrowserJobs
        )(c, scan.id),
      };
    }),
  );
  const agent = (
    path: string,
    handler: (r: FastifyRequest) => Promise<unknown>,
  ) =>
    app.post("/api/reddit-browser/" + path, async (r, reply) => {
      if (!(await browserAuthenticated(db, r)))
        return reply.code(401).send({ error: "浏览器连接码无效，请重新配对" });
      return handler(r);
    });
  agent("heartbeat", async (r) => {
    const b = z
      .object({
        ready: z.boolean().default(false),
        xEnabled: z.boolean().default(false),
        enabled: z.boolean().default(true),
        jobId: z.uuid().optional(),
        lease: z.uuid().optional(),
      })
      .parse(r.body);
    return browserTransaction(db, r, async (c) => {
      await c.query(
        "SELECT id FROM reddit_browser_connection WHERE id FOR UPDATE",
      );
      if (b.jobId) {
        const data = leaseSchema.parse(b);
        await held(c, data);
        await c.query(
          "UPDATE jobs SET locked_until=now()+interval '3 minutes' WHERE id=$1",
          [b.jobId],
        );
      }
      await c.query(
        "UPDATE reddit_browser_connection SET last_seen_at=now(),enabled=$2,x_enabled=$3,pause_reason=CASE WHEN $1 THEN null ELSE pause_reason END WHERE id",
        [b.ready, b.enabled, b.xEnabled],
      );
      return { ok: true };
    });
  });
  agent("claim", async (r) =>
    browserTransaction(db, r, async (c) => {
      const connection = (
        await c.query(
          "SELECT * FROM reddit_browser_connection WHERE id FOR UPDATE",
        )
      ).rows[0];
      await expireBrowserJobs(c);
      if (!connection.enabled || connection.pause_reason) return { job: null };
      if (
        (
          await c.query(
            "SELECT id FROM jobs WHERE payload->>'transport'='reddit_browser' AND status='running' AND locked_until>now()",
          )
        ).rowCount
      )
        return { job: null };
      const job =
        (
          await c.query(
            "UPDATE jobs SET status='running',attempts=attempts+1,lock_token=gen_random_uuid(),locked_until=now()+interval '3 minutes',last_error=null,updated_at=now() WHERE id=(SELECT id FROM jobs WHERE payload->>'transport'='reddit_browser' AND (payload->>'source'<>'x' OR $1::boolean) AND attempts<max_attempts AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<now())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,payload,lock_token",
            [connection.x_enabled],
          )
        ).rows[0] ?? null;
      return { job };
    }),
  );
  agent("snapshot", async (r) => {
    const b = leaseSchema.extend({ snapshot: z.unknown() }).parse(r.body);
    return browserTransaction(db, r, async (c) => {
      const job = await held(c, b),
        docs =
          job.payload.source === "x"
            ? parseXSnapshot(b.snapshot, job.payload.searchQuery)
            : parseBrowserSnapshot(b.snapshot, job.payload.subreddit);
      const inserted = await c.query(
        "INSERT INTO reddit_browser_snapshots VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id",
        [job.id, docs[0].externalId],
      );
      if (!inserted.rowCount) return { duplicate: true, count: 0 };
      const rows = await insertDocuments(c, docs);
      for (const d of rows)
        await c.query(
          "INSERT INTO discovery_documents VALUES($1,$2) ON CONFLICT DO NOTHING",
          [job.id, d.id],
        );
      await c.query(
        "UPDATE jobs SET payload=payload||jsonb_build_object('matchedCount',(SELECT count(*) FROM discovery_documents WHERE job_id=$1),'capturedThreads',(SELECT count(*) FROM reddit_browser_snapshots WHERE job_id=$1)),locked_until=now()+interval '3 minutes',updated_at=now() WHERE id=$1",
        [job.id],
      );
      return { duplicate: false, count: rows.length };
    });
  });
  agent("complete", async (r) =>
    browserTransaction(db, r, async (c) => {
      const b = leaseSchema
        .extend({ warnings: z.array(z.string().max(200)).max(10).default([]) })
        .parse(r.body);
      await held(c, b);
      await c.query(
        "UPDATE jobs SET status='succeeded',locked_until=null,payload=payload||jsonb_build_object('warnings',$2::jsonb),updated_at=now() WHERE id=$1",
        [b.jobId, JSON.stringify(b.warnings)],
      );
      return { ok: true };
    }),
  );
  agent("pause", async (r) =>
    browserTransaction(db, r, async (c) => {
      const b = leaseSchema.extend({ reason: reasons }).parse(r.body);
      await c.query(
        "SELECT id FROM reddit_browser_connection WHERE id FOR UPDATE",
      );
      await held(c, b);
      await c.query(
        "UPDATE reddit_browser_connection SET pause_reason=$1,enabled=false,last_seen_at=now() WHERE id",
        [b.reason],
      );
      await c.query(
        "UPDATE jobs SET status='pending',attempts=greatest(0,attempts-1),locked_until=null,lock_token=null,last_error=$2,updated_at=now() WHERE id=$1",
        [b.jobId, `等待浏览器恢复：${b.reason}`],
      );
      return { ok: true };
    }),
  );
}
