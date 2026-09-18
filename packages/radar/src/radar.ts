import { contextReviewSchema, contextBlocker } from "./evidence-context.js";
import { ensureToolTargets, productQuery } from "../../db/src/tool-search.js";
import {
  enqueueBrowserJobs,
  enqueueXBrowserJobs,
  expireBrowserJobs,
} from "../../db/src/reddit-browser.js";
import {
  analyzeDocuments,
  extractionBatches,
  crawlerSites,
} from "./data-engine.js";
import { publishReviewedReport, demandEvidenceBlocker } from "./quality.js";
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
        source:
          d.source_id === "web"
            ? (d.metadata?.sourceHost ?? "web")
            : d.source_id,
        author: d.author_name,
        authorExternalId:
          d.source_id === "wordpress" ? null : d.author_external_id,
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
        "INSERT INTO radar_scans(status,plan) VALUES('planning','{\"kind\":\"full\"}') RETURNING id",
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
async function emptyReport(
  c: PoolClient,
  id: string,
  coverage: any,
  reasons: string[] = [],
) {
  await c.query(
    "UPDATE radar_scans SET status='complete',coverage=$2,report=$3,updated_at=now() WHERE id=$1",
    [
      id,
      JSON.stringify(coverage),
      JSON.stringify({
        summary: "本轮没有足够的未解决需求证据，暂不推荐开发。",
        recommendations: [],
        rejectedSummary:
          coverage.analyzed > 0
            ? `已分析 ${coverage.analyzed} 份材料，未保留具备直接使用者痛点依据的候选。${[...new Set(reasons)].join("；")}。这不代表没有市场，需要补充具体工具的使用者抱怨与未解决请求。`
            : "本轮没有可纳入分析的原文，具体采集、重复、排除和失败数量见覆盖统计。",
      }),
    ],
  );
}
export async function advanceScans(db: Pool) {
  await expireBrowserJobs(db);
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
      const stage = jobs.filter(
        (j) =>
          j.type === stageType ||
          (scan.status === "analyzing" && j.type === "RADAR_ANALYZE"),
      );
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
        await enqueue(
          c,
          "RADAR_ANALYZE",
          { scanId: scan.id, documentIds: eligible.map((d) => d.id) },
          `radar-analyze:${scan.id}`,
        );
        await c.query(
          "UPDATE radar_scans SET status='analyzing',coverage=$2,updated_at=now() WHERE id=$1",
          [scan.id, JSON.stringify(coverage)],
        );
      } else {
        const successful = stage.filter(
          (j) => j.type === "RADAR_EXTRACT" && j.status === "succeeded",
        );
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
  engine: {
    analyze?: typeof analyzeDocuments;
    sites?: typeof crawlerSites;
  } = {},
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
      {
        promptName,
        promptVersion: [
          "radar-extract",
          "radar-audit",
          "radar-report",
        ].includes(promptName)
          ? "v3"
          : "v2",
        model,
        input,
      },
      schema,
    );
  if (job.type === "RADAR_ANALYZE") {
    const docs = (
      await db.query(
        "SELECT * FROM raw_documents WHERE id=ANY($1::uuid[]) ORDER BY id",
        [job.payload.documentIds],
      )
    ).rows;
    const analytics = await (engine.analyze ?? analyzeDocuments)(docs);
    await save(db, job, async (c) => {
      for (const [index, documentIds] of extractionBatches(analytics).entries())
        await enqueue(
          c,
          "RADAR_EXTRACT",
          { scanId: job.payload.scanId, documentIds },
          `radar-extract:${job.payload.scanId}:${index}`,
        );
      await c.query(
        "UPDATE radar_scans SET analytics=$2,updated_at=now() WHERE id=$1",
        [job.payload.scanId, JSON.stringify(analytics)],
      );
    });
    return;
  }
  if (job.type === "RADAR_PLAN") {
    if (
      !(
        await db.query(
          "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
          [job.id, job.lock_token],
        )
      ).rowCount
    )
      throw Error("自动发现任务租约失效");
    const websites = (await (engine.sites ?? crawlerSites)()).filter(
      (site) => site.enabled,
    );
    await save(db, job, async (c) => {
      const targets = await ensureToolTargets(c, job.payload.scanId);
      // Keep each channel on the same product instead of allowing generic model queries.
      const value = {
        queries: targets.map((t) => ({
          query: productQuery(t, "general"),
          reason: `核对 ${t.product} 的 ${t.focus} 相关使用限制、替代需求和手工绕行；缺口尚待原文验证。`,
        })),
      };
      const browserConnection = (
        await c.query(
          "SELECT id,x_enabled FROM reddit_browser_connection WHERE id AND enabled AND pause_reason IS NULL AND last_seen_at>now()-interval '90 seconds'",
        )
      ).rows[0];
      const connected = !!browserConnection;
      const xBrowser = {
        included: connected && browserConnection.x_enabled,
        reason:
          connected && browserConnection.x_enabled
            ? "通过已授权浏览器搜索 X 工具痛点"
            : "X 浏览器权限未启用或浏览器离线",
      };
      if (xBrowser.included) await enqueueXBrowserJobs(c, job.payload.scanId);
      if (connected) await enqueueBrowserJobs(c, job.payload.scanId);
      const redditBrowser = {
        included: connected,
        reason: connected
          ? "通过已登录浏览器采集公开社区"
          : "浏览器未连接或已暂停，本轮未采集 Reddit",
      };
      for (const site of websites) {
        const child = await enqueue(
          c,
          "DISCOVER_TOPIC",
          {
            scanId: job.payload.scanId,
            source: "web",
            siteId: site.id,
            query: site.name,
            name: `网页爬取 · ${site.name}`,
          },
          `radar-crawl:${job.payload.scanId}:${site.id}`,
        );
        await c.query("UPDATE jobs SET max_attempts=2 WHERE id=$1", [child.id]);
      }
      for (const q of value.queries)
        for (const source of [
          "hn",
          "github",
          "stackoverflow",
          "appstore",
          "wordpress",
        ]) {
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
        "UPDATE radar_scans SET status='collecting',plan=plan||$2::jsonb,updated_at=now() WHERE id=$1",
        [
          job.payload.scanId,
          JSON.stringify({ ...value, websites, redditBrowser, xBrowser }),
        ],
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
            pageKind: d.metadata.pageKind,
            sourceHost: d.metadata.sourceHost,
          },
          truncated: d.body.length > 4000,
        })),
        lines: lines.map((l, index) => ({ ...l, sourceLine: index })),
      },
      schema,
    );
    // Separate evidence-role review reads context instead of trusting the selected line.
    const reviewInput = value.findings.map((f, findingIndex) => {
      const doc = docs.find((d) => d.id === lines[f.sourceLine].documentId)!;
      return {
        findingIndex,
        lines: String(doc.body)
          .slice(0, 12000)
          .split(/\r?\n/)
          .filter((line) => line.trim())
          .map((quote, index) => ({ index, quote })),
        truncated: doc.body.length > 12000,
        contextComplete: doc.metadata?.contextComplete ?? false,
      };
    });
    if (
      !(
        await db.query(
          "UPDATE jobs SET locked_until=now()+interval '120 seconds' WHERE id=$1 AND lock_token=$2 AND status='running' AND locked_until>now()",
          [job.id, job.lock_token],
        )
      ).rowCount
    )
      throw Error("自动发现任务租约失效");
    const reviewed = value.findings.length
      ? (
          await run(
            "radar-context",
            { candidates: reviewInput },
            contextReviewSchema,
          )
        ).value.reviews
      : [];
    if (
      reviewed.length !== value.findings.length ||
      new Set(reviewed.map((r) => r.findingIndex)).size !==
        value.findings.length ||
      reviewed.some((r) => r.findingIndex >= value.findings.length)
    )
      throw Error("上下文核验结果不完整或重复，不能发布需求信号");
    const grounded = reviewed.map((r) => {
      const original = reviewInput[r.findingIndex].lines;
      for (const index of [r.painLine, r.unresolvedLine])
        if (index !== null && !original[index])
          throw Error("上下文核验引用不存在的行号");
      return {
        ...r,
        painQuote: r.painLine === null ? "" : original[r.painLine].quote,
        unresolvedQuote:
          r.unresolvedLine === null ? "" : original[r.unresolvedLine].quote,
      };
    });
    const reviews = new Map(grounded.map((r) => [r.findingIndex, r]));
    const reasonFor = (index: number) =>
      contextBlocker(
        reviews.get(index)!,
        reviewInput[index].lines.map((l) => l.quote).join("\n"),
      );
    const productIds = new Set(
      docs
        .filter((d) =>
          ["product", "product_directory"].includes(d.metadata?.pageKind),
        )
        .map((d) => d.id),
    );
    const rejected = value.findings.flatMap((f, index) => {
      const evidence = lines[f.sourceLine];
      const reason = productIds.has(evidence.documentId)
        ? "官网/目录不能作为需求证据"
        : (demandEvidenceBlocker(evidence.quote) ?? reasonFor(index));
      return reason ? [{ evidence, reason }] : [];
    });
    const findings = value.findings
      .map((f, index) => ({ ...f, contextReview: reviews.get(index)! }))
      .filter(
        (f, index) =>
          !reasonFor(index) &&
          !productIds.has(lines[f.sourceLine].documentId) &&
          !demandEvidenceBlocker(lines[f.sourceLine].quote),
      )
      .map((f, index) => ({
        ...f,
        id: `${job.id}:${index}`,
        evidence: {
          ...lines[f.sourceLine],
          quote: f.contextReview.painQuote,
        },
      }));
    await save(db, job, async (c) => {
      await c.query(
        "INSERT INTO radar_batches(job_id,scan_id,result) VALUES($1,$2,$3)",
        [
          job.id,
          job.payload.scanId,
          JSON.stringify({
            findings,
            rejected,
            contextReviews: grounded,
            evidencePolicy: "context-v2",
          }),
        ],
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
  const findings = batches
    .flatMap((b) => b.result.findings)
    .filter((f) => !demandEvidenceBlocker(f.evidence.quote));
  if (!findings.length) {
    await save(db, job, async (c) =>
      emptyReport(
        c,
        scan.id,
        scan.coverage,
        batches.flatMap((b) =>
          (b.result.rejected ?? []).map((r: any) => r.reason),
        ),
      ),
    );
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
    {
      findings,
      coverage: scan.coverage,
      preferences,
      founder,
      analytics: scan.analytics
        ? {
            ...scan.analytics,
            clusters: scan.analytics.clusters.slice(0, 50),
            note: "仅传入前50个文本统计分组；并非商业价值排名",
          }
        : null,
    },
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
    {
      draft: value,
      findings,
      founder,
      coverage: scan.coverage,
      analytics: scan.analytics
        ? { ...scan.analytics, clusters: scan.analytics.clusters.slice(0, 50) }
        : null,
    },
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
