import { publishReviewedReport } from "./quality.js";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { transaction } from "../../db/src/index.js";
import { enqueue, finishJob, type Job } from "../../db/src/jobs.js";
import { runStructured } from "../../llm/src/run.js";
import type { LLMProvider } from "../../llm/src/provider.js";

const preferences = ["美国→中东", "美国→欧洲", "美国→亚洲（不含中国）"];
const text = z.string().min(1).max(3000);
export const planSchema = z
  .object({
    queries: z
      .array(
        z.object({ query: z.string().trim().min(2).max(60), reason: text }),
      )
      .length(4),
  })
  .refine(
    (p) => new Set(p.queries.map((q) => q.query.toLowerCase())).size === 4,
    "探索词必须不同",
  );
export function selectDocuments(rows: any[]) {
  const seen = new Set<string>(),
    content = new Set<string>();
  const eligible: any[] = [];
  let duplicates = 0,
    excluded = 0;
  const sourceCounts: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.source_id}:${row.external_id}`;
    const body = String(row.body)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    if (content.has(body)) {
      duplicates++;
      continue;
    }
    content.add(body);
    sourceCounts[row.source_id] = (sourceCounts[row.source_id] ?? 0) + 1;
    if (row.metadata?.state === "closed" || row.metadata?.isAnswered === true) {
      excluded++;
      continue;
    }
    eligible.push(row);
  }
  return {
    eligible,
    coverage: {
      collected: rows.length,
      eligible: eligible.length,
      excluded,
      duplicates,
      analyzed: 0,
      failedJobs: 0,
      sourceCounts,
    },
  };
}
export function sourceLines(docs: any[]) {
  return docs.flatMap((d) =>
    String(d.body)
      .slice(0, 4000)
      .split(/\r?\n/)
      .map((quote) => ({
        documentId: d.id,
        title: d.title,
        url: d.canonical_url,
        source: d.source_id,
        author: d.author_name,
        authorExternalId: d.author_external_id,
        quote,
      }))
      .filter((l) => l.quote.trim().length > 0),
  );
}
export async function startScan(db: Pool) {
  return transaction(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('radar-start'))");
    const active = (
      await c.query(
        "SELECT id FROM radar_scans WHERE status NOT IN ('complete','failed') ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    if (active) return active.id as string;
    const scan = (
      await c.query(
        "INSERT INTO radar_scans(status) VALUES('planning') RETURNING id",
      )
    ).rows[0];
    await enqueue(
      c,
      "RADAR_PLAN",
      { scanId: scan.id },
      `radar-plan:${scan.id}`,
    );
    return scan.id as string;
  });
}
async function emptyReport(c: PoolClient, id: string, coverage: any) {
  await c.query(
    "UPDATE radar_scans SET status='complete',coverage=$2,report=$3,updated_at=now() WHERE id=$1",
    [
      id,
      JSON.stringify(coverage),
      JSON.stringify({
        summary: "本轮没有足够的未解决需求证据，暂不推荐开发。",
        recommendations: [],
        rejectedSummary:
          "采集为空、内容重复或问题已有解答。可以启动下一轮探索其他方向；渠道失败情况见采集覆盖。",
      }),
    ],
  );
}
export async function advanceScans(db: Pool) {
  await transaction(db, async (c) => {
    const scans = (
      await c.query(
        "SELECT * FROM radar_scans WHERE status NOT IN ('complete','failed') FOR UPDATE SKIP LOCKED",
      )
    ).rows;
    for (const scan of scans) {
      const jobs = (
        await c.query("SELECT * FROM jobs WHERE payload->>'scanId'=$1", [
          scan.id,
        ])
      ).rows;
      const stageType = (
        {
          planning: "RADAR_PLAN",
          collecting: "DISCOVER_TOPIC",
          analyzing: "RADAR_EXTRACT",
          reporting: "RADAR_REPORT",
        } as Record<string, string>
      )[scan.status];
      const stage = jobs.filter((j) => j.type === stageType);
      if (
        !stage.length ||
        stage.some((j) => ["pending", "running"].includes(j.status))
      )
        continue;
      if (scan.status === "planning" || scan.status === "reporting") {
        if (stage.some((j) => j.status === "failed"))
          await c.query(
            "UPDATE radar_scans SET status='failed',error=$2,updated_at=now() WHERE id=$1",
            [scan.id, stage.find((j) => j.status === "failed").last_error],
          );
        continue;
      }
      if (scan.status === "collecting") {
        const rows = (
          await c.query(
            "SELECT DISTINCT d.* FROM discovery_documents dd JOIN jobs j ON j.id=dd.job_id JOIN raw_documents d ON d.id=dd.document_id WHERE j.payload->>'scanId'=$1 ORDER BY d.collected_at DESC",
            [scan.id],
          )
        ).rows;
        const { eligible, coverage } = selectDocuments(rows);
        coverage.failedJobs = jobs.filter((j) => j.status === "failed").length;
        if (!eligible.length) {
          await emptyReport(c, scan.id, coverage);
          continue;
        }
        for (let i = 0; i < eligible.length; i += 30)
          await enqueue(
            c,
            "RADAR_EXTRACT",
            {
              scanId: scan.id,
              documentIds: eligible.slice(i, i + 30).map((d) => d.id),
            },
            `radar-extract:${scan.id}:${i}`,
          );
        await c.query(
          "UPDATE radar_scans SET status='analyzing',coverage=$2,updated_at=now() WHERE id=$1",
          [scan.id, JSON.stringify(coverage)],
        );
      } else {
        const successful = stage.filter((j) => j.status === "succeeded");
        if (!successful.length) {
          await c.query(
            "UPDATE radar_scans SET status='failed',error='所有需求分析批次失败，请检查模型配置或稍后重试。',updated_at=now() WHERE id=$1",
            [scan.id],
          );
          continue;
        }
        const coverage = {
          ...scan.coverage,
          analyzed: successful.reduce(
            (n, j) => n + j.payload.documentIds.length,
            0,
          ),
          failedJobs: jobs.filter((j) => j.status === "failed").length,
        };
        await enqueue(
          c,
          "RADAR_REPORT",
          { scanId: scan.id },
          `radar-report:${scan.id}`,
        );
        await c.query(
          "UPDATE radar_scans SET status='reporting',coverage=$2,updated_at=now() WHERE id=$1",
          [scan.id, JSON.stringify(coverage)],
        );
      }
    }
  });
}
async function save(db: Pool, job: Job, fn: (c: PoolClient) => Promise<void>) {
  await transaction(db, async (c) => {
    // Same lock order as coordinator; stale attempts can never publish output.
    await c.query("SELECT id FROM radar_scans WHERE id=$1 FOR UPDATE", [
      job.payload.scanId,
    ]);
    if (!(await finishJob(c, job))) throw Error("自动发现任务租约失效");
    await fn(c);
  });
}
export async function runRadarJob(
  db: Pool,
  job: Job,
  provider: LLMProvider,
  model: string,
) {
  if (
    !(
      await db.query(
        "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
        [job.id, job.lock_token],
      )
    ).rowCount
  )
    throw Error("自动发现任务租约失效");
  const run = <T>(promptName: string, input: unknown, schema: z.ZodType<T>) =>
    runStructured(
      db,
      provider,
      { promptName, promptVersion: "v1", model, input },
      schema,
    );
  if (job.type === "RADAR_PLAN") {
    const previous = (
      await db.query(
        "SELECT plan FROM radar_scans WHERE id<>$1 ORDER BY created_at DESC LIMIT 8",
        [job.payload.scanId],
      )
    ).rows;
    const founder =
      (await db.query("SELECT profile FROM founder_profiles WHERE id=1"))
        .rows[0]?.profile ?? {};
    const { value } = await run(
      "radar-plan",
      {
        preferences,
        founder,
        previous,
        currentDate: new Date().toISOString().slice(0, 10),
      },
      planSchema,
    );
    await save(db, job, async (c) => {
      for (const q of value.queries)
        for (const source of ["hn", "github", "stackoverflow"]) {
          const child = await enqueue(
            c,
            "DISCOVER_TOPIC",
            {
              scanId: job.payload.scanId,
              source,
              query: q.query,
              name: `自动发现 · ${q.query} · ${source}`,
            },
            `radar-collect:${job.payload.scanId}:${source}:${q.query}`,
          );
          await c.query("UPDATE jobs SET max_attempts=1 WHERE id=$1", [
            child.id,
          ]);
        }
      await c.query(
        "UPDATE radar_scans SET status='collecting',plan=$2,updated_at=now() WHERE id=$1",
        [job.payload.scanId, JSON.stringify(value)],
      );
    });
    return;
  }
  if (job.type === "RADAR_EXTRACT") {
    const docs = (
      await db.query(
        "SELECT * FROM raw_documents WHERE id=ANY($1::uuid[]) ORDER BY id",
        [job.payload.documentIds],
      )
    ).rows;
    const lines = sourceLines(docs);
    const schema = z.object({
      findings: z
        .array(
          z.object({
            sourceLine: z
              .number()
              .int()
              .min(0)
              .max(lines.length - 1),
            problem: text,
            buyer: text,
            existingSolution: text,
            unresolved: text,
          }),
        )
        .max(8),
    });
    const { value } = await run(
      "radar-extract",
      {
        truncation: "每篇仅分析前4000字符；无完整上下文，不视为全网结论。",
        documents: docs.map((d) => ({
          id: d.id,
          title: d.title,
          metadata: {
            state: d.metadata.state,
            isAnswered: d.metadata.isAnswered,
            contextNote: d.metadata.contextNote,
          },
          truncated: d.body.length > 4000,
        })),
        lines: lines.map((l, index) => ({ ...l, sourceLine: index })),
      },
      schema,
    );
    const findings = value.findings.map((f, index) => ({
      ...f,
      id: `${job.id}:${index}`,
      evidence: lines[f.sourceLine],
    }));
    await save(db, job, async (c) => {
      await c.query(
        "INSERT INTO radar_batches(job_id,scan_id,result) VALUES($1,$2,$3)",
        [job.id, job.payload.scanId, JSON.stringify({ findings })],
      );
    });
    return;
  }
  const scan = (
    await db.query("SELECT * FROM radar_scans WHERE id=$1", [
      job.payload.scanId,
    ])
  ).rows[0];
  const batches = (
    await db.query(
      "SELECT result FROM radar_batches WHERE scan_id=$1 ORDER BY job_id",
      [job.payload.scanId],
    )
  ).rows;
  const findings = batches.flatMap((b) => b.result.findings);
  if (!findings.length) {
    await save(db, job, async (c) => emptyReport(c, scan.id, scan.coverage));
    return;
  }
  const ids = findings.map((f) => f.id) as [string, ...string[]];
  const schema = z.object({
    summary: text,
    recommendations: z
      .array(
        z.object({
          title: text,
          buyer: text,
          problem: text,
          solution: text,
          whyPriority: text,
          feasibility: text,
          monetization: text,
          risks: text,
          nextStep: text,
          findingIds: z.array(z.enum(ids)).min(1).max(12),
        }),
      )
      .max(5),
    rejectedSummary: text,
  });
  const founder =
    (await db.query("SELECT profile FROM founder_profiles WHERE id=1")).rows[0]
      ?.profile ?? {};
  const { value } = await run(
    "radar-report",
    { findings, coverage: scan.coverage, preferences, founder },
    schema,
  );
  // A second pass examines the draft against the original evidence, not its own claims.
  if (
    !(
      await db.query(
        "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
        [job.id, job.lock_token],
      )
    ).rowCount
  )
    throw Error("自动发现任务租约失效");
  const { value: reviewed } = await run(
    "radar-audit",
    { draft: value, findings, founder, coverage: scan.coverage },
    schema,
  );
  const approved = publishReviewedReport(
    reviewed.recommendations,
    scan.coverage.analyzed ?? 0,
  );
  const report = {
    ...approved,
    recommendations: approved.recommendations.map((r, index) => {
      const evidence = [...new Set(r.findingIds)]
        .map((id) => findings.find((f) => f.id === id).evidence)
        .filter(
          (e, i, a) =>
            a.findIndex(
              (v) => v.documentId === e.documentId && v.quote === e.quote,
            ) === i,
        );
      const voices = new Set(
        evidence
          .filter((e) => e.authorExternalId)
          .map((e) => `${e.source}:${e.authorExternalId}`),
      ).size;
      const platforms = [...new Set<string>(evidence.map((e) => e.source))];
      return {
        ...r,
        id: `${scan.id}:${index}`,
        evidence,
        independentVoices: voices,
        platforms,
        confidence:
          voices >= 3 && platforms.length >= 2
            ? "多来源信号，仍需付费验证"
            : "探索假设，证据有限",
      };
    }),
  };
  await save(db, job, async (c) => {
    await c.query(
      "UPDATE radar_scans SET status='complete',report=$2,updated_at=now() WHERE id=$1",
      [scan.id, JSON.stringify(report)],
    );
  });
}
