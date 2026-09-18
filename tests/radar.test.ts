import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  startScan,
  advanceScans,
  runRadarJob,
  selectDocuments,
} from "../packages/radar/src/radar.js";
import { enqueue, claimJob, type Job } from "../packages/db/src/jobs.js";
import { saveDocuments } from "../packages/db/src/repository.js";
import type {
  LLMProvider,
  ModelRequest,
} from "../packages/llm/src/provider.js";

const db = new pg.Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgresql://radar@127.0.0.1:55432/radar_test",
});
const scans = new Set<string>();
const model = `radar-fixture-${crypto.randomUUID()}`;
afterEach(async () => {
  // Only retire this suite's work. Raw documents are immutable audit records.
  for (const id of scans) {
    await db.query(
      "UPDATE jobs SET status='failed',locked_until=null WHERE payload->>'scanId'=$1 AND status IN ('pending','running')",
      [id],
    );
    await db.query(
      "UPDATE radar_scans SET status='failed' WHERE id=$1 AND status NOT IN ('complete','failed')",
      [id],
    );
  }
});
after(() => db.end());
const provider = (
  respond: (request: ModelRequest) => unknown | Promise<unknown>,
): LLMProvider => ({
  async generateStructured<T>(request: ModelRequest) {
    return {
      value: (await respond(request)) as T,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCost: null,
    };
  },
  async generateText() {
    throw Error("unexpected text generation");
  },
});
const plan = {
  queries: [
    "invoice reconciliation",
    "team scheduling",
    "vendor onboarding",
    "support triage",
  ].map((query) => ({
    query,
    reason: "Specific unresolved workflow to investigate",
  })),
};
async function scan(status = "collecting") {
  const id = (
    await db.query("INSERT INTO radar_scans(status) VALUES($1) RETURNING id", [
      status,
    ])
  ).rows[0].id as string;
  scans.add(id);
  return id;
}
async function job(
  scanId: string,
  type: string,
  payload = {},
  status = "pending",
) {
  const value = await enqueue(
    db,
    type,
    { scanId, ...payload },
    crypto.randomUUID(),
  );
  if (status !== "pending")
    await db.query("UPDATE jobs SET status=$2 WHERE id=$1", [value.id, status]);
  return value;
}
async function claimed(value: Job) {
  const result = await claimJob(db, value.id);
  assert.ok(result);
  return result;
}
async function state(id: string) {
  return (await db.query("SELECT * FROM radar_scans WHERE id=$1", [id]))
    .rows[0];
}
async function jobs(id: string, type: string) {
  return (
    await db.query(
      "SELECT * FROM jobs WHERE payload->>'scanId'=$1 AND type=$2 ORDER BY id",
      [id, type],
    )
  ).rows;
}
async function documents(count: number, metadata = {}) {
  const key = crypto.randomUUID();
  return saveDocuments(
    db,
    Array.from({ length: count }, (_, i) => ({
      sourceKey: "github" as const,
      externalId: `${key}-${i}`,
      canonicalUrl: `https://github.com/fixture/issues/${key}-${i}`,
      type: "article" as const,
      title: `Workflow ${i}`,
      body: `Context ${key}-${i}\n\n  Exact unresolved request ${i}.  `,
      authorName: `author-${i}`,
      authorExternalId: `stable-author-${key}-${i}`,
      metadata: { test: true, ...metadata },
    })),
  );
}
async function link(discovery: Job, docs: any[]) {
  for (const d of docs)
    await db.query(
      "INSERT INTO discovery_documents(job_id,document_id) VALUES($1,$2)",
      [discovery.id, d.id],
    );
}
const finding = (sourceLine: number) => ({
  sourceLine,
  problem: "Manual workflow",
  buyer: "Operations team",
  existingSolution: "Spreadsheet",
  unresolved: "Repeated manual entry",
});
const recommendation = (findingIds: string[]) => ({
  title: "Workflow assistant",
  buyer: "Operations team",
  problem: "Manual entry",
  solution: "Automate entry",
  whyPriority: "Recurring work",
  feasibility: "Small integration",
  monetization: "Subscription hypothesis",
  risks: "Unverified willingness to pay",
  nextStep: "Interview buyers",
  findingIds,
});

test("concurrent scan starts share one plan; planning creates 20 searches and one job per enabled website", async () => {
  const ids = await Promise.all(Array.from({ length: 8 }, () => startScan(db)));
  assert.equal(new Set(ids).size, 1);
  const id = ids[0];
  scans.add(id);
  const planned = await jobs(id, "RADAR_PLAN");
  assert.equal(planned.length, 1);
  await runRadarJob(
    db,
    await claimed(planned[0]),
    provider(() => plan),
    model,
    {
      sites: async () => [
        {
          id: "test_site",
          name: "Test community",
          seed: "https://example.com/",
          kind: "community",
          enabled: true,
        },
      ],
    },
  );
  assert.equal((await state(id)).status, "collecting");
  const children = await jobs(id, "DISCOVER_TOPIC");
  assert.equal(children.length, 21);
  assert.equal(
    new Set(children.map((j) => `${j.payload.source}:${j.payload.query}`)).size,
    21,
  );
  for (const source of [
    "hn",
    "github",
    "stackoverflow",
    "appstore",
    "wordpress",
  ])
    assert.equal(children.filter((j) => j.payload.source === source).length, 4);
  assert.ok(
    children.every(
      (j) => j.max_attempts === (j.payload.source === "web" ? 2 : 1),
    ),
  );
  assert.equal(
    children.find((j) => j.payload.source === "web").payload.siteId,
    "test_site",
  );
  assert.equal(await startScan(db), id);
});

test("coordinator waits for pending and running collectors, then records failed channels and no eligible evidence", async () => {
  const id = await scan();
  const done = await job(id, "DISCOVER_TOPIC", {}, "succeeded");
  const pending = await job(id, "DISCOVER_TOPIC");
  await link(done, await documents(1, { state: "closed" }));
  await advanceScans(db);
  assert.equal((await state(id)).status, "collecting");
  await claimed(pending);
  await advanceScans(db);
  assert.equal((await state(id)).status, "collecting");
  await db.query(
    "UPDATE jobs SET status='failed',last_error='Provider unavailable' WHERE id=$1",
    [pending.id],
  );
  await advanceScans(db);
  const result = await state(id);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.report.recommendations, []);
  assert.equal(result.coverage.failedJobs, 1);
  assert.equal(result.coverage.excluded, 1);
  assert.equal(result.coverage.eligible, 0);
  assert.equal((await jobs(id, "RADAR_EXTRACT")).length, 0);
});

test("every eligible document reaches a batch and coverage counts only successful analysis", async () => {
  const id = await scan();
  const collector = await job(id, "DISCOVER_TOPIC", {}, "succeeded");
  const docs = await documents(65);
  await link(collector, docs);
  await job(id, "DISCOVER_TOPIC", {}, "failed");
  await advanceScans(db);
  assert.equal((await jobs(id, "RADAR_EXTRACT")).length, 0);
  await advanceScans(db);
  assert.equal((await state(id)).status, "analyzing");
  const analysisJob = (await jobs(id, "RADAR_ANALYZE"))[0];
  await runRadarJob(
    db,
    await claimed(analysisJob),
    provider(() => {
      throw Error("Python stage must not call LLM");
    }),
    model,
    { analyze: async (rows) => fakeAnalytics(rows) },
  );
  assert.equal((await state(id)).analytics.documentCount, 65);
  const batches = await jobs(id, "RADAR_EXTRACT");
  assert.deepEqual(
    batches.map((j) => j.payload.documentIds.length).sort((a, b) => a - b),
    [5, 30, 30],
  );
  assert.deepEqual(
    new Set(batches.flatMap((j) => j.payload.documentIds)),
    new Set(docs.map((d) => d.id)),
  );
  await advanceScans(db);
  assert.equal((await state(id)).status, "analyzing");
  const failed = batches.find((j) => j.payload.documentIds.length === 5)!;
  await db.query(
    "UPDATE jobs SET status=CASE WHEN id=$2 THEN 'failed' ELSE 'succeeded' END WHERE payload->>'scanId'=$1 AND type='RADAR_EXTRACT'",
    [id, failed.id],
  );
  await advanceScans(db);
  await advanceScans(db);
  const result = await state(id);
  assert.equal(result.status, "reporting");
  assert.equal(result.coverage.collected, 65);
  assert.equal(result.coverage.eligible, 65);
  assert.equal(result.coverage.analyzed, 60);
  assert.equal(result.coverage.failedJobs, 2);
  assert.equal((await jobs(id, "RADAR_REPORT")).length, 1);
});

test("extraction rejects invented source lines and report rejects invented IDs before preserving exact evidence", async () => {
  const id = await scan("analyzing");
  const [doc] = await documents(1);
  const extract = await claimed(
    await job(id, "RADAR_EXTRACT", { documentIds: [doc.id] }),
  );
  await assert.rejects(
    runRadarJob(
      db,
      extract,
      provider(() => ({ findings: [finding(999)] })),
      model,
    ),
  );
  assert.equal(
    (await db.query("SELECT * FROM radar_batches WHERE scan_id=$1", [id]))
      .rowCount,
    0,
  );
  await runRadarJob(
    db,
    extract,
    provider((request) => {
      assert.equal(request.promptName, "radar-extract");
      assert.equal((request.input as any).lines[1].sourceLine, 1);
      return { findings: [finding(1), finding(0)] };
    }),
    model,
  );
  const batch = (
    await db.query("SELECT result FROM radar_batches WHERE scan_id=$1", [id])
  ).rows[0].result;
  assert.equal(batch.findings[0].evidence.quote, doc.body.split("\n")[2]);
  assert.equal(batch.findings[0].evidence.documentId, doc.id);
  await advanceScans(db);
  const report = await claimed((await jobs(id, "RADAR_REPORT"))[0]);
  await assert.rejects(
    runRadarJob(
      db,
      report,
      provider(() => ({
        summary: "Potential workflow",
        recommendations: [recommendation(["fabricated-id"])],
        rejectedSummary: "Limited evidence",
      })),
      model,
    ),
  );
  assert.equal((await state(id)).report, null);
  await runRadarJob(
    db,
    report,
    provider((request) => {
      const findings = (request.input as any).findings;
      return {
        summary: "Potential workflow",
        recommendations: [recommendation(findings.map((f: any) => f.id))],
        rejectedSummary: "Limited evidence",
      };
    }),
    model,
  );
  const result = await state(id);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.report.recommendations[0].findingIds, [
    `${extract.id}:0`,
    `${extract.id}:1`,
  ]);
  assert.equal(
    result.report.recommendations[0].evidence[0].quote,
    doc.body.split("\n")[2],
  );
  assert.equal(result.report.recommendations[0].evidence.length, 2);
  assert.equal(
    result.report.recommendations[0].evidence[1].quote,
    doc.body.split("\n")[0],
  );
  assert.equal(result.report.recommendations[0].independentVoices, 1);
  assert.deepEqual(result.report.recommendations[0].platforms, ["github"]);
});

test("lease lost during model generation cannot publish a plan or mark the stale attempt successful", async () => {
  const id = await scan("planning");
  const current = await claimed(await job(id, "RADAR_PLAN"));
  await assert.rejects(
    runRadarJob(
      db,
      current,
      provider(async () => {
        await db.query(
          "UPDATE jobs SET lock_token=gen_random_uuid() WHERE id=$1",
          [current.id],
        );
        return plan;
      }),
      model,
    ),
    /租约/,
  );
  assert.equal((await state(id)).status, "planning");
  assert.deepEqual((await state(id)).plan, {});
  assert.equal((await jobs(id, "DISCOVER_TOPIC")).length, 0);
  assert.equal((await jobs(id, "RADAR_PLAN"))[0].status, "running");
});

test("all failed analysis batches fail the scan without generating a report", async () => {
  const id = await scan("analyzing");
  await job(id, "RADAR_EXTRACT", { documentIds: [] }, "failed");
  await advanceScans(db);
  assert.equal((await state(id)).status, "failed");
  assert.match((await state(id)).error, /所有需求分析批次失败/);
  assert.equal((await jobs(id, "RADAR_REPORT")).length, 0);
});

test("a content-duplicate latest snapshot still suppresses the source's older unresolved snapshot", () => {
  const selected = selectDocuments([
    {
      id: "B-open",
      source_id: "github",
      external_id: "B",
      body: "Shared text",
      metadata: { state: "open" },
    },
    {
      id: "A-new",
      source_id: "github",
      external_id: "A",
      body: "Shared text",
      metadata: { state: "closed" },
    },
    {
      id: "A-old",
      source_id: "github",
      external_id: "A",
      body: "Old unresolved text",
      metadata: { state: "open" },
    },
  ]);
  assert.deepEqual(
    selected.eligible.map((d) => d.id),
    ["B-open"],
  );
});

test("report counts stable author IDs across platforms even when display names match", async () => {
  const id = await scan("reporting");
  const extract = await job(
    id,
    "RADAR_EXTRACT",
    { documentIds: [] },
    "succeeded",
  );
  const findings = [
    { source: "github", authorExternalId: "user-1" },
    { source: "github", authorExternalId: "user-2" },
    { source: "stackoverflow", authorExternalId: "user-1" },
    { source: "github", authorExternalId: "user-1" },
    { source: "github", authorExternalId: null },
  ].map((identity, index) => ({
    ...finding(0),
    id: `${extract.id}:${index}`,
    evidence: {
      documentId: crypto.randomUUID(),
      title: "Fixture",
      url: "https://example.com",
      quote: `Request ${index}`,
      author: "Same display name",
      ...identity,
    },
  }));
  await db.query(
    "INSERT INTO radar_batches(job_id,scan_id,result) VALUES($1,$2,$3)",
    [extract.id, id, JSON.stringify({ findings })],
  );
  await runRadarJob(
    db,
    await claimed(await job(id, "RADAR_REPORT")),
    provider(() => ({
      summary: "Cross-platform requests",
      recommendations: [recommendation(findings.map((f) => f.id))],
      rejectedSummary: "Payment remains unverified",
    })),
    model,
  );
  const result = (await state(id)).report.recommendations[0];
  assert.equal(result.independentVoices, 3);
  assert.deepEqual(result.platforms, ["github", "stackoverflow"]);
  assert.match(result.confidence, /多来源信号/);
});

async function reportFixture() {
  const id = await scan("analyzing");
  const [doc] = await documents(1);
  await runRadarJob(
    db,
    await claimed(await job(id, "RADAR_EXTRACT", { documentIds: [doc.id] })),
    provider(() => ({ findings: [finding(1)] })),
    model,
  );
  await advanceScans(db);
  const current = await claimed((await jobs(id, "RADAR_REPORT"))[0]);
  return { id, current };
}

test("audit receives original evidence and publishes only the reviewed report", async () => {
  const { id, current } = await reportFixture();
  const calls: string[] = [];
  let draft: any;
  await runRadarJob(
    db,
    current,
    provider((request) => {
      calls.push(request.promptName);
      const input = request.input as any;
      if (request.promptName === "radar-report") {
        draft = {
          summary: "Draft summary",
          recommendations: [
            {
              ...recommendation([input.findings[0].id]),
              title: "Unsupported government OSINT platform",
            },
            {
              ...recommendation([input.findings[0].id]),
              title: "Narrow workflow assistant",
            },
          ],
          rejectedSummary: "Nothing rejected",
        };
        return draft;
      }
      assert.equal(request.promptName, "radar-audit");
      assert.deepEqual(input.draft, draft);
      assert.equal(
        input.findings[0].evidence.quote.trim(),
        "Exact unresolved request 0.",
      );
      assert.equal(
        input.findings[0].id,
        draft.recommendations[1].findingIds[0],
      );
      return {
        summary: "Reviewed summary",
        recommendations: [input.draft.recommendations[1]],
        rejectedSummary: "Unsupported government scope rejected",
      };
    }),
    model,
  );
  assert.deepEqual(calls, ["radar-report", "radar-audit"]);
  const result = await state(id);
  assert.equal(result.status, "complete");
  assert.match(result.report.summary, /保留 1 个待验证方向/);
  assert.notEqual(result.report.summary, "Reviewed summary");
  assert.match(result.report.rejectedSummary, /最终发布检查另排除 0 项/);
  assert.deepEqual(
    result.report.recommendations.map((r: any) => r.title),
    ["Narrow workflow assistant"],
  );
  assert.equal((await jobs(id, "RADAR_REPORT"))[0].status, "succeeded");
});

test("lease lost during audit cannot publish either draft or reviewed report", async () => {
  const { id, current } = await reportFixture();
  const calls: string[] = [];
  await assert.rejects(
    runRadarJob(
      db,
      current,
      provider(async (request) => {
        calls.push(request.promptName);
        const input = request.input as any;
        if (request.promptName === "radar-audit") {
          await db.query(
            "UPDATE jobs SET lock_token=gen_random_uuid() WHERE id=$1",
            [current.id],
          );
          return input.draft;
        }
        return {
          summary: "Draft summary",
          recommendations: [recommendation([input.findings[0].id])],
          rejectedSummary: "Limited evidence",
        };
      }),
      model,
    ),
    /租约/,
  );
  assert.deepEqual(calls, ["radar-report", "radar-audit"]);
  const result = await state(id);
  assert.equal(result.status, "reporting");
  assert.equal(result.report, null);
  assert.equal((await jobs(id, "RADAR_REPORT"))[0].status, "running");
});

test("audit cannot introduce unrecognized evidence IDs", async () => {
  const { id, current } = await reportFixture();
  await assert.rejects(
    runRadarJob(
      db,
      current,
      provider((request) => ({
        summary: "Draft summary",
        recommendations: [
          recommendation([
            request.promptName === "radar-audit"
              ? "invented-by-audit"
              : (request.input as any).findings[0].id,
          ]),
        ],
        rejectedSummary: "Limited evidence",
      })),
      model,
    ),
  );
  assert.equal((await state(id)).report, null);
  assert.equal((await jobs(id, "RADAR_REPORT"))[0].status, "running");
});

test("publication gate drops institutional buyers, broad scope and unsupported market claims even when audit approves", async () => {
  const { id, current } = await reportFixture();
  const calls: string[] = [];
  await runRadarJob(
    db,
    current,
    provider((request) => {
      calls.push(request.promptName);
      const input = request.input as any;
      if (request.promptName === "radar-audit") return input.draft;
      const base = recommendation([input.findings[0].id]);
      return {
        summary:
          "All four ideas have strong proven demand and should be built immediately",
        rejectedSummary: "Every proposal is approved",
        recommendations: [
          {
            ...base,
            title: "Government OSINT",
            buyer: "Government investigation departments",
          },
          {
            ...base,
            title: "多场景 RPA 自动化平台",
            solution: "跨系统流程自动适配，覆盖端到端业务流程",
          },
          {
            ...base,
            title: "Unproven market winner",
            whyPriority: "没有竞品，付费意愿高",
          },
          {
            ...base,
            title: "CSV duplicate review",
            solution: "Highlight duplicate CSV rows for manual review",
            whyPriority:
              "One observed manual task; willingness to pay remains unverified",
          },
        ],
      };
    }),
    model,
  );
  assert.deepEqual(calls, ["radar-report", "radar-audit"]);
  const result = await state(id);
  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.report.recommendations.map((r: any) => r.title),
    ["CSV duplicate review"],
  );
  assert.match(result.report.summary, /本轮分析 1 份材料，保留 1 个待验证方向/);
  assert.match(result.report.summary, /付费意愿及竞品缺口仍需核实/);
  assert.doesNotMatch(result.report.summary, /strong proven demand/);
  assert.match(result.report.rejectedSummary, /另排除 3 项/);
  assert.match(result.report.rejectedSummary, /机构采购/);
  assert.match(result.report.rejectedSummary, /产品范围过大/);
  assert.match(result.report.rejectedSummary, /市场、付费或竞品断言/);
});

test("publication gate emits a conservative no-build report when every audited recommendation is blocked", async () => {
  const { id, current } = await reportFixture();
  await runRadarJob(
    db,
    current,
    provider((request) => {
      const input = request.input as any;
      return request.promptName === "radar-audit"
        ? input.draft
        : {
            summary: "Build this now",
            rejectedSummary: "Nothing rejected",
            recommendations: [
              {
                ...recommendation([input.findings[0].id]),
                buyer: "政府情报机构",
              },
            ],
          };
    }),
    model,
  );
  const result = await state(id);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.report.recommendations, []);
  assert.match(result.report.summary, /暂不建议投入开发/);
  assert.match(result.report.rejectedSummary, /另排除 1 项/);
});

function fakeAnalytics(rows: any[]) {
  return {
    version: "1" as const,
    documentCount: rows.length,
    uniqueContentCount: rows.length,
    clusterCount: 1,
    sourceCounts: { github: rows.length },
    clusters: [
      {
        id: "cluster-test",
        label: "workflow",
        documentIds: rows.map((r) => r.id),
        independentAccounts: rows.length,
        sourceCount: 1,
        sourceNames: ["github"],
        recentCount: 0,
        painMentions: 0,
        commercialMentions: 0,
        frictionMentions: 0,
        evidenceScore: 0,
        dimensions: {
          recurrence: 0,
          crossSource: 0,
          recency: null,
          pain: 0,
          commercial: 0,
          friction: 0,
        },
        unknowns: ["verified_willingness_to_pay"],
      },
    ],
    limitations: ["test fixture"],
  };
}
test("Python stage is lease fenced and engine failures cannot publish analytics", async () => {
  const id = await scan("analyzing"),
    docs = await documents(2);
  const j = await claimed(
    await job(id, "RADAR_ANALYZE", { documentIds: docs.map((d) => d.id) }),
  );
  await assert.rejects(
    runRadarJob(
      db,
      j,
      provider(() => null),
      model,
      {
        analyze: async () => {
          throw Error("engine offline");
        },
      },
    ),
    /engine offline/,
  );
  assert.equal((await state(id)).analytics, null);
  assert.equal((await jobs(id, "RADAR_EXTRACT")).length, 0);
  await assert.rejects(
    runRadarJob(
      db,
      j,
      provider(() => null),
      model,
      {
        analyze: async (rows) => {
          await db.query(
            "UPDATE jobs SET lock_token=gen_random_uuid() WHERE id=$1",
            [j.id],
          );
          return fakeAnalytics(rows);
        },
      },
    ),
    /租约失效/,
  );
  assert.equal((await state(id)).analytics, null);
});

test("online Reddit browser joins each scan and offline browsers are explicitly skipped", async () => {
  await db.query(
    "UPDATE reddit_browser_connection SET enabled=true,x_enabled=false,last_seen_at=now(),pause_reason=null WHERE id",
  );
  try {
    const id = await scan("planning");
    await runRadarJob(
      db,
      await claimed(await job(id, "RADAR_PLAN")),
      provider(() => plan),
      model,
      { sites: async () => [] },
    );
    const collectors = await jobs(id, "DISCOVER_TOPIC");
    assert.equal(
      collectors.filter((j) => j.payload.transport === "reddit_browser").length,
      4,
    );
    await db.query(
      "UPDATE reddit_browser_connection SET x_enabled=true WHERE id",
    );
    const withX = await scan("planning");
    await runRadarJob(
      db,
      await claimed(await job(withX, "RADAR_PLAN")),
      provider(() => plan),
      model,
      { sites: async () => [] },
    );
    assert.equal(
      (await jobs(withX, "DISCOVER_TOPIC")).filter(
        (j) => j.payload.source === "x",
      ).length,
      4,
    );
    assert.equal((await state(withX)).plan.xBrowser.included, true);
    await db.query(
      "UPDATE reddit_browser_connection SET enabled=false,x_enabled=false WHERE id",
    );
    const offline = await scan("planning");
    await runRadarJob(
      db,
      await claimed(await job(offline, "RADAR_PLAN")),
      provider(() => plan),
      model,
      { sites: async () => [] },
    );
    assert.equal(
      (await jobs(offline, "DISCOVER_TOPIC")).filter(
        (j) => j.payload.source === "reddit",
      ).length,
      0,
    );
    assert.match((await state(offline)).plan.redditBrowser.reason, /未连接/);
  } finally {
    await db.query(
      "UPDATE reddit_browser_connection SET enabled=false WHERE id",
    );
  }
});
