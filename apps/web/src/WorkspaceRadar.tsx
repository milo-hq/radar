import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "./components/ui/table";
import { Button } from "./components/ui/button";
import { DataTable } from "./components/data-table";
import { RadarHistory, scanKindLabels } from "./RadarHistory";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowRight,
  CheckCircle2,
  Compass,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { api, when } from "./api";

type Recommendation = {
  id: string;
  title: string;
  buyer: string;
  problem: string;
  solution: string;
  whyPriority: string;
  feasibility: string;
  monetization: string;
  risks: string;
  nextStep: string;
  confidence: string | number;
  independentVoices: number;
  platforms: string[];
  evidence: {
    documentId: string;
    title: string;
    url: string;
    quote: string;
    source: string;
    author: string;
  }[];
};
type EvidenceCluster = {
  id: string;
  label: string;
  documentIds: string[];
  independentAccounts: number;
  sourceCount: number;
  sourceNames: string[];
  recentCount: number;
  painMentions: number;
  commercialMentions: number;
  frictionMentions: number;
  evidenceScore: number;
  dimensions: {
    recurrence: number;
    crossSource: number;
    recency: number | null;
    pain: number;
    commercial: number;
    friction: number;
  };
  unknowns: string[];
};
type RadarAnalytics = {
  version: "1";
  documentCount: number;
  uniqueContentCount: number;
  clusterCount: number;
  sourceCounts: Record<string, number>;
  clusters: EvidenceCluster[];
  limitations: string[];
};
type Scan = {
  id: string;
  kind: string;
  status:
    | "planning"
    | "collecting"
    | "analyzing"
    | "reporting"
    | "complete"
    | "failed";
  created_at: string;
  updated_at: string;
  analytics?: RadarAnalytics | null;
  liveCollection?: { total: number; sourceCounts: Record<string, number> };
  plan: {
    queries: { query: string; reason: string }[];
    toolTargets?: { product: string; focus: string }[];
  } | null;
  coverage: {
    collected: number;
    eligible: number;
    excluded: number;
    duplicates: number;
    analyzed: number;
    failedJobs: number;
    sourceCounts: Record<string, number>;
  };
  report: {
    summary: string;
    recommendations: Recommendation[];
    rejectedSummary: string;
  } | null;
  error: string | null;
  jobs: {
    type: string;
    status: string;
    last_error: string | null;
    payload: unknown;
  }[];
};
type RadarState = {
  configured: boolean;
  latest: Scan | null;
  previous?: Scan | null;
  active?: Pick<Scan, "id" | "status" | "kind"> | null;
};
const stages = [
  { id: "planning", title: "规划搜索", detail: "自动选择值得探索的需求方向" },
  { id: "collecting", title: "采集信号", detail: "跨来源查找真实讨论与产品" },
  {
    id: "analyzing",
    title: "分析证据",
    detail: "文本分组、统计与模型证据提取",
  },
  {
    id: "reporting",
    title: "给出建议",
    detail: "比较机会，说明优先级与验证方法",
  },
];
const isActive = (scan: Scan | null | undefined) =>
  !!scan && scan.status !== "complete" && scan.status !== "failed";
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);
const evidenceUnknownLabels: Record<string, string> = {
  sampling_representativeness: "样本能否代表更广泛的人群",
  market_size: "市场规模",
  verified_willingness_to_pay: "是否愿意实际付费",
  cross_platform_identity: "不同平台账号是否为同一人",
  publication_time: "部分材料的发布时间",
  author_identity: "部分来源的作者身份",
  original_source: "复制内容的原始来源",
};
const evidenceMethodNotes = [
  "按文本用词相似程度分组，使用 TF-IDF 方法。相似不代表表达相同需求；同组材料也可能关联较弱。",
  "统一大小写与空白后完全相同的内容只计一次。同内容多个账号的独立性未获证实，按保守方式合并计算。",
  "平台总数统计原始材料；复制来源冲突时不增加平台票数；日期使用全部副本均有效时的最早日期。当前样本无法证明市场规模或需求普遍程度。",
  "痛点、商业与使用阻力指标来自中英文关键词。命中词语不等于真实意图，未命中也不代表没有需求。",
  "文本统计最多处理 1000 篇材料，每篇使用正文的前 6000 个规范化字符，正文为空时使用标题。全空内容会被拒绝，长文与后续讨论可能缺失。",
  "近期指过去 30 天，占比以全部去重内容为分母。缺失、无效或未来日期标为未知；全部日期未知时不计算近期指标。",
];
const jobWarnings = (payload: unknown): string[] => {
  if (!payload || typeof payload !== "object" || !("warnings" in payload))
    return [];
  return Array.isArray(payload.warnings)
    ? payload.warnings.filter(
        (warning): warning is string => typeof warning === "string",
      )
    : [];
};

export function WorkspaceRadar({
  revision,
  openDocument,
  openSettings,
}: {
  revision: number;
  openDocument: (id: string) => void;
  openSettings: () => void;
}) {
  const [crawler, setCrawler] = useState<{
    sites: {
      id: string;
      name: string;
      seed: string;
      kind: string;
      enabled: boolean;
    }[];
  } | null>(null);
  useEffect(() => {
    let alive = true;
    api<{
      sites: {
        id: string;
        name: string;
        seed: string;
        kind: string;
        enabled: boolean;
      }[];
    }>("/crawler")
      .then((value) => {
        if (alive) setCrawler(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [data, setData] = useState<RadarState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedScan, setSelectedScan] = useState<Scan | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [previousReport, setPreviousReport] = useState<Scan | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    api<RadarState>("/radar")
      .then((next) => {
        if (!alive) return;
        setData(next);
        if (next.latest?.report) setPreviousReport(next.latest);
        else if ("previous" in next) setPreviousReport(next.previous ?? null);
        setError("");
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [revision, refresh]);
  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    api<{ scan: Scan }>(`/radar/history/${selectedId}`)
      .then((value) => {
        if (alive) {
          setSelectedScan(value.scan);
          setHistoryError("");
        }
      })
      .catch(() => {
        if (alive) setHistoryError("这一轮记录读取失败，请重新选择或重试。");
      });
    return () => {
      alive = false;
    };
  }, [selectedId, revision, refresh]);
  const selectScan = (id: string | null) => {
    setSelectedId(id);
    setSelectedScan(null);
    setHistoryError("");
    setRefresh((n) => n + 1);
  };
  const scan = selectedId ? selectedScan : data?.latest;
  const latestRunning = !!data?.active;
  const running = isActive(scan);
  const reportScan = selectedId ? scan : scan?.report ? scan : previousReport;
  const report = reportScan?.report;
  async function start() {
    setStarting(true);
    setError("");
    try {
      await api("/radar", undefined, "POST");
      selectScan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "启动失败，请重试");
    } finally {
      setStarting(false);
    }
  }
  const currentStage =
    scan?.status === "complete"
      ? stages.length
      : stages.findIndex((s) => s.id === scan?.status);
  return (
    <div className="ws-radar">
      <section className="admin-page-toolbar">
        <div>
          <h1>自动发现</h1>
          <p>汇总多渠道需求，分析并比较适合独立开发者的产品机会。</p>
        </div>
        <Button
          variant="outline"
          className="button primary"
          disabled={!data?.configured || starting || latestRunning}
          onClick={start}
        >
          {starting || latestRunning ? (
            <Loader2 size={16} className="ws-radar-spin" />
          ) : (
            <Plus size={16} />
          )}
          {starting
            ? "正在启动…"
            : latestRunning
              ? "正在自动发现…"
              : "自动发现机会"}
        </Button>
      </section>
      <p className="ws-muted">
        首页默认展示全渠道发现。单来源专项和重分析保留在历史中，不会替换全渠道报告。每轮报告最多推荐
        5 项，不代表全部可做机会。
      </p>
      {data?.active && data.active.kind !== "full" && (
        <p role="status">
          {scanKindLabels[data.active.kind]}正在运行。
          <Button variant="link" onClick={() => selectScan(data.active!.id)}>
            查看专项进度
          </Button>
        </p>
      )}
      {scan && scan.kind !== "full" && (
        <p className="ws-muted">
          当前查看：{scanKindLabels[scan.kind]}。这不是全渠道扫描结果。
        </p>
      )}
      <RadarHistory
        revision={revision + refresh}
        selectedId={selectedId}
        latestId={data?.latest?.id}
        onSelect={selectScan}
      />
      {selectedId && (
        <p role="status">
          正在查看历史轮次 ·{" "}
          {selectedScan
            ? new Date(selectedScan.created_at).toLocaleString("zh-CN")
            : "读取中…"}
        </p>
      )}
      {historyError && (
        <p role="alert">
          {historyError}
          <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
            重试
          </Button>
        </p>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
          <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
            重试读取
          </Button>
        </div>
      )}
      {!data && !error && <p role="status">正在读取发现记录…</p>}
      {data && !data.configured && (
        <section className="ws-readiness">
          <div>
            <strong>连接研究模型后，就可以自动发现</strong>
            <p>
              请在设置中完成模型连接，雷达才能规划搜索、分析证据和生成建议。
            </p>
            <Button
              variant="outline"
              className="ws-text"
              onClick={openSettings}
            >
              前往设置 <ArrowRight size={14} />
            </Button>
          </div>
        </section>
      )}
      {crawler && (
        <details className="ws-panel ws-radar-plan">
          <summary>
            网页爬虫 · {crawler.sites.filter((s) => s.enabled).length} 个站点 ·
            查看实际采集进度
          </summary>
          <p className="ws-muted">
            自动发现站内详情页，提取正文；必要时运行浏览器。每站每轮最多访问 12
            页，后续扫描继续未访问页面。产品介绍用于了解竞品，不直接作为用户痛点证据。
          </p>
          <div className="admin-table-panel">
            <Table aria-label="网页采集站点">
              <TableHeader>
                <TableRow>
                  <TableHead>站点</TableHead>
                  <TableHead>类型 / 状态</TableHead>
                  <TableHead>实际采集量</TableHead>
                  <TableHead>异常</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crawler.sites
                  .filter((s) => s.enabled)
                  .map((site) => {
                    const job = scan?.jobs.find(
                      (j) =>
                        (j.payload as { siteId?: string } | null)?.siteId ===
                        site.id,
                    );
                    const payload = job?.payload as
                      | {
                          savedCount?: number;
                          crawlStats?: {
                            visited: number;
                            rendered: number;
                            cached: number;
                            blocked: number;
                            remaining: number;
                          };
                        }
                      | undefined;
                    const stats = payload?.crawlStats;
                    const state = !job
                      ? "等待下一轮扫描"
                      : ({
                          pending: "待采集",
                          running: "采集中",
                          completed: "完成",
                          succeeded: "完成",
                          failed: "失败",
                          queued: "排队中",
                        }[job.status] ?? job.status);
                    return (
                      <TableRow key={site.id}>
                        <TableCell>
                          <strong>
                            <a
                              href={safeUrl(site.seed)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {site.name}
                            </a>
                          </strong>
                        </TableCell>
                        <TableCell>
                          <span className="ws-muted">
                            {site.kind === "community"
                              ? "用户社区"
                              : site.kind === "product_directory"
                                ? "产品目录"
                                : "产品官网"}{" "}
                            · {state}
                          </span>
                        </TableCell>
                        <TableCell>
                          {!stats && "—"}
                          {stats && (
                            <p className="ws-muted">
                              访问 {stats.visited} 页 · 入库{" "}
                              {payload?.savedCount ?? 0} 篇 · 浏览器渲染{" "}
                              {stats.rendered} 页 · 缓存 {stats.cached} 篇 ·
                              受限 {stats.blocked} 页 · 待访问 {stats.remaining}{" "}
                              页
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {job?.last_error && (
                            <p className="ws-warning">{job.last_error}</p>
                          )}
                          {jobWarnings(job?.payload).map((warning, index) => (
                            <p className="ws-warning" key={index}>
                              {warning}
                            </p>
                          ))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </details>
      )}
      {scan && (
        <section className="ws-panel">
          <div className="ws-section-title">
            <div>
              <span className="ws-kicker">
                {selectedId ? "历史发现" : "本轮发现"}
              </span>
              <h2>
                {scan.status === "complete"
                  ? "发现完成"
                  : scan.status === "failed"
                    ? "本轮发现未完成"
                    : "正在从信号中筛选机会"}
              </h2>
            </div>
            <span className="ws-muted">开始于 {when(scan.created_at)}</span>
          </div>
          <ol className="ws-radar-stages" aria-label="发现进度">
            {stages.map((stage, index) => (
              <li
                key={stage.id}
                className={
                  index < currentStage
                    ? "done"
                    : index === currentStage
                      ? "current"
                      : ""
                }
                aria-current={index === currentStage ? "step" : undefined}
              >
                <span>
                  {index < currentStage ? (
                    <CheckCircle2 size={18} />
                  ) : (
                    index + 1
                  )}
                </span>
                <div>
                  <strong>{stage.title}</strong>
                  <small>{stage.detail}</small>
                </div>
              </li>
            ))}
          </ol>
          <p role="status" className="ws-muted">
            {scan.status === "failed"
              ? "本轮已停止。可重新发起发现；已有报告仍可阅读。"
              : running
                ? "扫描在后台运行，进度会自动更新。"
                : "以下覆盖数据记录本轮实际采集与筛选情况。"}
          </p>
          {scan.error && (
            <p className="ws-warning" role="alert">
              {scan.error}
            </p>
          )}
          {scan.coverage && (
            <>
              <div className="ws-coverage-grid ws-radar-coverage">
                {[
                  [
                    "采集信号",
                    scan.liveCollection?.total ?? scan.coverage.collected,
                  ],
                  ["纳入分析", scan.coverage.eligible],
                  ["已分析", scan.coverage.analyzed],
                  ["已排除", scan.coverage.excluded],
                  ["重复信号", scan.coverage.duplicates],
                  ["失败任务", scan.coverage.failedJobs],
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>
                      {value ?? (scan.status === "collecting" ? "—" : 0)}
                    </strong>
                    <small>{label}</small>
                  </div>
                ))}
              </div>
              <p className="ws-muted">
                检索渠道包括 HN、GitHub Issues、Stack Overflow、App Store 与
                WordPress
                插件评论，以及用户社区、产品目录和官网网页爬取。已连接浏览器时还会加入
                Reddit 公开讨论；启用 X 权限后也会搜索 X
                公开帖子。各渠道可能没有返回材料，实际采集量以下方数字为准。
                模型提取每篇前 4000
                字符，可能缺少完整后续讨论；搜索命中不等于需求成立。
              </p>
              {scan.liveCollection && (
                <p className="ws-muted">
                  采集中：显示已入库材料数；采集结束后统一去重、筛选和分析。
                </p>
              )}
              <div className="ws-radar-sources">
                {Object.entries(
                  scan.liveCollection?.sourceCounts ??
                    scan.coverage.sourceCounts ??
                    {},
                ).map(([source, count]) => (
                  <span className="ws-tag" key={source}>
                    {source} · {count}
                  </span>
                ))}
              </div>
            </>
          )}
          {(scan.plan as any)?.reanalysisOf && (
            <p className="ws-muted">
              本轮使用历史原文重新分析，没有新增采集。原轮次：
              {(scan.plan as any).reanalysisOf}
            </p>
          )}
          {(scan.plan as any)?.redditBrowser && (
            <p className="ws-muted">
              Reddit：{(scan.plan as any).redditBrowser.reason}
            </p>
          )}
          {(scan.plan as any)?.xBrowser && (
            <p className="ws-muted">X：{(scan.plan as any).xBrowser.reason}</p>
          )}
          {!!scan.plan?.toolTargets?.length && (
            <p className="ws-muted">
              本轮参考工具：
              {scan.plan.toolTargets.map((t) => t.product).join("、")}。
              从预设工具库轮换选取，寻找使用者抱怨、缺失功能和替代需求；列入搜索不代表已发现机会。
            </p>
          )}
          {!!scan.plan?.queries?.length && (
            <details className="ws-radar-plan">
              <summary>
                查看自动选择的搜索方向（{scan.plan.queries.length}）
              </summary>
              <ul>
                {scan.plan.queries.map((q, i) => (
                  <li key={i}>
                    <strong>{q.query}</strong>
                    <p>{q.reason}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!scan.jobs?.some(
            (job) => job.last_error || jobWarnings(job.payload).length,
          ) && (
            <details className="ws-radar-plan">
              <summary>查看采集提醒与任务异常</summary>
              {scan.jobs
                .filter(
                  (job) => job.last_error || jobWarnings(job.payload).length,
                )
                .map((job, i) => (
                  <div key={i}>
                    {job.last_error && (
                      <p className="ws-warning">
                        {job.type} · {job.status}：{job.last_error}
                      </p>
                    )}
                    {jobWarnings(job.payload).map((warning, index) => (
                      <p key={index} className="ws-warning">
                        采集提醒：{warning}
                      </p>
                    ))}
                  </div>
                ))}
            </details>
          )}
        </section>
      )}
      {scan?.analytics ? (
        <details className="ws-radar-data-details" open={!report}>
          <summary>
            本轮多维证据分析 · {scan.analytics.documentCount} 篇材料 ·{" "}
            {scan.analytics.clusterCount} 个文本分组
          </summary>
          <EvidenceDashboard
            key={scan.id}
            analytics={scan.analytics}
            openDocument={openDocument}
          />
        </details>
      ) : scan && !running ? (
        <p className="ws-muted">
          本轮没有保存多维证据统计；新一轮发现会在分析后展示。
        </p>
      ) : null}
      {report ? (
        <section aria-label="机会推荐">
          <div className="ws-section-title">
            <div>
              <span className="ws-kicker">YOUR NEXT MOVE</span>
              <h2>
                {reportScan?.id !== scan?.id
                  ? running
                    ? "上轮推荐 · 新一轮仍在进行"
                    : "上轮已完成的推荐"
                  : "优先验证这些机会"}
              </h2>
              <p>推荐是待验证的判断，排序依据与证据见每张卡片。</p>
            </div>
            <span className="ws-tag">
              {report.recommendations.length} 个建议（本轮最多 5 项）
            </span>
          </div>
          <p className="ws-radar-summary">{report.summary}</p>
          <DataTable
            key={reportScan?.id}
            label="本轮机会结果"
            data={report.recommendations.map((item, index) => ({
              ...item,
              rank: index + 1,
            }))}
            columns={[
              { accessorKey: "rank", header: "优先级" },
              {
                accessorKey: "title",
                header: "机会",
                cell: ({ row }) => (
                  <Button
                    variant="outline"
                    className="admin-record-link"
                    onClick={() => setDetailId(row.original.id)}
                  >
                    {row.original.title}
                  </Button>
                ),
              },
              { accessorKey: "buyer", header: "付费人群" },
              { accessorKey: "confidence", header: "证据置信度" },
              { accessorKey: "independentVoices", header: "独立声音" },
              {
                id: "actions",
                header: "操作",
                cell: ({ row }) => (
                  <Button
                    variant="outline"
                    className="button"
                    onClick={() => setDetailId(row.original.id)}
                  >
                    查看分析
                  </Button>
                ),
              },
            ]}
          />
          {report.recommendations
            .filter((item) => item.id === detailId)
            .map((item) => (
              <section key={item.id} className="admin-result-detail">
                <Button
                  variant="outline"
                  className="button"
                  onClick={() => setDetailId(null)}
                >
                  收起分析
                </Button>
                <RecommendationCard
                  item={item}
                  rank={report.recommendations.indexOf(item) + 1}
                  openDocument={openDocument}
                />
              </section>
            ))}
          {!report.recommendations.length && (
            <div className="ws-panel ws-empty">
              <Compass size={28} />
              <h3>本轮没有足够依据推荐具体机会</h3>
              <p>可以检查采集覆盖与排除原因，或再次发起发现。</p>
            </div>
          )}
          {report.rejectedSummary && (
            <section className="ws-panel">
              <h3>哪些方向没有入选，为什么</h3>
              <p className="ws-radar-copy">{report.rejectedSummary}</p>
            </section>
          )}
        </section>
      ) : (
        !running &&
        data && (
          <section className="ws-panel ws-empty">
            <Compass size={32} />
            <h2>
              {scan?.status === "failed"
                ? "这次还没有生成推荐"
                : "你的下一款产品，可以从这里开始"}
            </h2>
            <p>
              点击「自动发现机会」，雷达会自行规划搜索，并把真实讨论整理成有优先级的产品建议。
            </p>
          </section>
        )
      )}
    </div>
  );
}
function EvidenceDashboard({
  analytics,
  openDocument,
}: {
  analytics: RadarAnalytics;
  openDocument: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visibleClusters = showAll
    ? analytics.clusters
    : analytics.clusters.slice(0, 8);
  return (
    <section className="ws-panel ws-radar-analytics" aria-label="多维证据看板">
      <div className="ws-section-title">
        <div>
          <span className="ws-kicker">EVIDENCE EXPLORER</span>
          <h2>先看证据，再判断机会</h2>
          <p>本轮材料的文本统计已就绪，无需等待模型推荐。</p>
        </div>
        <span className="ws-tag">TF-IDF 文本相似分组</span>
      </div>
      <div className="ws-coverage-grid ws-radar-analytics-counts">
        {[
          ["分析材料", analytics.documentCount],
          ["去重内容", analytics.uniqueContentCount],
          ["文本分组", analytics.clusterCount],
          ["来源平台", Object.keys(analytics.sourceCounts).length],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="ws-radar-sources">
        {Object.entries(analytics.sourceCounts).map(([source, count]) => (
          <span className="ws-tag" key={source}>
            {source} · {count} 篇
          </span>
        ))}
      </div>
      <p className="ws-radar-analytics-note">
        分数仅表示优先检查证据的顺序，不代表产品可行性、商业价值或已验证的付费意愿。
        文本相似可能来自共同用词，请展开原文核对；账号数不等于独立真实人数。
      </p>
      <div className="ws-radar-clusters">
        {visibleClusters.map((cluster) => (
          <EvidenceClusterCard
            key={cluster.id}
            cluster={cluster}
            openDocument={openDocument}
          />
        ))}
      </div>
      {analytics.clusters.length > 8 && (
        <Button
          variant="outline"
          className="ws-text ws-radar-cluster-toggle"
          onClick={() => setShowAll((value) => !value)}
          aria-expanded={showAll}
        >
          {showAll
            ? "收起其余分组"
            : `展开其余 ${analytics.clusters.length - 8} 个分组`}
        </Button>
      )}
      {!analytics.clusters.length && (
        <p className="ws-muted">本轮没有可展示的文本分组。</p>
      )}
      {analytics.limitations.length > 0 && (
        <details className="ws-radar-plan">
          <summary>统计方法与数据局限</summary>
          <ul>
            {evidenceMethodNotes.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
function EvidenceClusterCard({
  cluster,
  openDocument,
}: {
  cluster: EvidenceCluster;
  openDocument: (id: string) => void;
}) {
  const dimensions = [
    ["重复出现", cluster.dimensions.recurrence],
    ["跨来源", cluster.dimensions.crossSource],
    ["近 30 天占比", cluster.dimensions.recency],
    ["痛点词", cluster.dimensions.pain],
    ["商业词", cluster.dimensions.commercial],
    ["使用阻力词", cluster.dimensions.friction],
  ] as const;
  return (
    <article className="ws-radar-cluster">
      <header>
        <div>
          <h3>{cluster.label}</h3>
          <p>
            {cluster.documentIds.length} 篇材料 · {cluster.independentAccounts}{" "}
            个来源账号 · {cluster.sourceCount} 个平台
          </p>
        </div>
        <div className="ws-radar-inspection-score">
          <strong>
            {Math.round(cluster.evidenceScore)}
            <small>/100</small>
          </strong>
          <span>证据检查优先分</span>
        </div>
      </header>
      <p className="ws-muted">
        {cluster.sourceNames.join(" / ") || "来源待确认"}
      </p>
      <dl className="ws-radar-dimensions">
        {dimensions.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value === null ? "未知" : `${Math.round(value)} / 100`}</dd>
            {value !== null && (
              <meter
                min={0}
                max={100}
                value={value}
                aria-label={`${label}指标`}
              />
            )}
          </div>
        ))}
      </dl>
      <p className="ws-radar-cluster-counts">
        近 30 天材料 {cluster.recentCount} · 痛点提及 {cluster.painMentions} ·
        商业提及 {cluster.commercialMentions} · 使用阻力提及{" "}
        {cluster.frictionMentions}
      </p>
      {cluster.unknowns.length > 0 && (
        <p className="ws-radar-unknowns">
          <strong>待核实：</strong>
          {[
            ...new Set(
              cluster.unknowns.map(
                (key) => evidenceUnknownLabels[key] ?? "其他证据缺口",
              ),
            ),
          ].join("；")}
        </p>
      )}
      <details className="ws-radar-plan">
        <summary>查看分组原文（{cluster.documentIds.length}）</summary>
        <div className="ws-radar-document-buttons">
          {cluster.documentIds.map((id, index) => (
            <Button
              variant="outline"
              className="ws-text"
              key={id}
              onClick={() => openDocument(id)}
              aria-label={`${cluster.label}：查看原文 ${index + 1}`}
            >
              原文 {index + 1} <ArrowRight size={13} />
            </Button>
          ))}
        </div>
      </details>
    </article>
  );
}
function RecommendationCard({
  item,
  rank,
  openDocument,
}: {
  item: Recommendation;
  rank: number;
  openDocument: (id: string) => void;
}) {
  const confidence =
    typeof item.confidence === "number"
      ? `${Math.round(item.confidence <= 1 ? item.confidence * 100 : item.confidence)}%`
      : { high: "高", medium: "中", low: "低" }[String(item.confidence)] ||
        item.confidence ||
        "待确认";
  return (
    <article className="ws-panel ws-radar-card">
      <header>
        <span className="ws-radar-rank">{String(rank).padStart(2, "0")}</span>
        <div>
          <span className="ws-kicker">
            {rank === 1 ? "优先验证" : "备选方向"}
          </span>
          <h2>{item.title}</h2>
        </div>
        <span className="ws-tag">置信度 {confidence}</span>
      </header>
      <div className="ws-radar-priority">
        <strong>为什么排在这里</strong>
        <p>{item.whyPriority || "优先级依据待补充"}</p>
      </div>
      <dl className="ws-radar-facts">
        {[
          ["谁可能付费", item.buyer],
          ["他们遇到什么问题", item.problem],
          ["可以做什么", item.solution],
          ["一个人做是否可行", item.feasibility],
          ["如何收费", item.monetization],
          ["风险与尚未证实的假设", item.risks],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "待验证"}</dd>
          </div>
        ))}
      </dl>
      <div className="ws-radar-next">
        <ArrowRight size={19} />
        <div>
          <strong>第一步：先验证，再投入开发</strong>
          <p>{item.nextStep || "验证方法待补充"}</p>
        </div>
      </div>
      <div className="ws-section-title ws-radar-evidence-heading">
        <h3>支持证据</h3>
        <span className="ws-muted">
          {item.independentVoices ?? 0} 个来源账号 ·{" "}
          {(item.platforms ?? []).join(" / ") || "平台待确认"}
        </span>
      </div>
      {(item.evidence ?? []).map((evidence, i) => (
        <blockquote
          className="ws-radar-evidence"
          key={`${evidence.documentId}-${i}`}
        >
          <p>{evidence.quote || "未提供原文摘录"}</p>
          <footer>
            <div>
              <strong>{evidence.title || "来源记录"}</strong>
              <small>
                {[evidence.source, evidence.author].filter(Boolean).join(" · ")}
              </small>
            </div>
            <div className="ws-inline">
              {evidence.documentId && (
                <Button
                  variant="outline"
                  className="ws-text"
                  onClick={() => openDocument(evidence.documentId)}
                >
                  查看原文
                </Button>
              )}
              {safeUrl(evidence.url) && (
                <a
                  href={safeUrl(evidence.url)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`打开来源：${evidence.title}`}
                >
                  <ExternalLink size={15} />
                </a>
              )}
            </div>
          </footer>
        </blockquote>
      ))}
      {!item.evidence?.length && (
        <p className="ws-warning">这项建议未附原文证据，需补证后再决定。</p>
      )}
    </article>
  );
}
