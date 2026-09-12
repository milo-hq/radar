import { useEffect, useState } from "react";
import {
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
type Scan = {
  id: string;
  status:
    | "planning"
    | "collecting"
    | "analyzing"
    | "reporting"
    | "complete"
    | "failed";
  created_at: string;
  updated_at: string;
  plan: { queries: { query: string; reason: string }[] } | null;
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
};
const stages = [
  { id: "planning", title: "规划搜索", detail: "自动选择值得探索的需求方向" },
  { id: "collecting", title: "采集信号", detail: "跨来源查找真实讨论与产品" },
  { id: "analyzing", title: "核验证据", detail: "去重、筛选并分析独立声音" },
  {
    id: "reporting",
    title: "给出建议",
    detail: "比较机会，说明优先级与验证方法",
  },
];
const isActive = (scan: Scan | null | undefined) =>
  !!scan && scan.status !== "complete" && scan.status !== "failed";
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined);

export function WorkspaceRadar({
  revision,
  openDocument,
  openSettings,
}: {
  revision: number;
  openDocument: (id: string) => void;
  openSettings: () => void;
}) {
  const [data, setData] = useState<RadarState | null>(null);
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
  const scan = data?.latest;
  const running = isActive(scan);
  const reportScan = scan?.report ? scan : previousReport;
  const report = reportScan?.report;
  async function start() {
    setStarting(true);
    setError("");
    try {
      await api("/radar", undefined, "POST");
      setRefresh((n) => n + 1);
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
      <section className="ws-radar-hero">
        <div>
          <span className="ws-kicker">AUTONOMOUS OPPORTUNITY RADAR</span>
          <h1>
            还没想好做什么？
            <br />
            先让真实需求指路。
          </h1>
          <p>
            自动寻找需求信号、核对来源，再告诉你谁可能付费、值得做什么，以及第一步怎么验证。
          </p>
          <button
            className="button primary"
            disabled={!data?.configured || starting || running}
            onClick={start}
          >
            {starting || running ? (
              <Loader2 size={17} className="ws-radar-spin" />
            ) : (
              <Compass size={17} />
            )}
            {starting
              ? "正在启动…"
              : running
                ? "正在自动发现…"
                : "自动发现机会"}
            {!running && !starting && <ArrowRight size={16} />}
          </button>
          <small>
            无需选主题 · 结果以真实采集证据为准 · 可随时离开，稍后回来查看
          </small>
        </div>
        <div className="ws-radar-principles">
          <span>从「不知道做什么」到</span>
          <strong>有依据的下一步</strong>
          <p>
            <CheckCircle2 size={15} />
            明确的付费人群与痛点
          </p>
          <p>
            <CheckCircle2 size={15} />
            适合独立开发者的最小方案
          </p>
          <p>
            <CheckCircle2 size={15} />
            可回看原文的证据与风险
          </p>
        </div>
      </section>
      {error && (
        <div className="alert" role="alert">
          {error}
          <button onClick={() => setRefresh((n) => n + 1)}>重试读取</button>
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
            <button className="ws-text" onClick={openSettings}>
              前往设置 <ArrowRight size={14} />
            </button>
          </div>
        </section>
      )}
      {scan && (
        <section className="ws-panel">
          <div className="ws-section-title">
            <div>
              <span className="ws-kicker">本轮发现</span>
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
                  ["采集信号", scan.coverage.collected],
                  ["纳入分析", scan.coverage.eligible],
                  ["已分析", scan.coverage.analyzed],
                  ["已排除", scan.coverage.excluded],
                  ["重复信号", scan.coverage.duplicates],
                  ["失败任务", scan.coverage.failedJobs],
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>{value ?? 0}</strong>
                    <small>{label}</small>
                  </div>
                ))}
              </div>
              <p className="ws-muted">
                本轮检索 HN、GitHub Issues、Stack
                Overflow；这些渠道偏向技术社区。每篇分析前 4000
                字符，缺少完整后续讨论，搜索命中不等于需求成立。
              </p>
              <div className="ws-radar-sources">
                {Object.entries(scan.coverage.sourceCounts ?? {}).map(
                  ([source, count]) => (
                    <span className="ws-tag" key={source}>
                      {source} · {count}
                    </span>
                  ),
                )}
              </div>
            </>
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
          {!!scan.jobs?.some((job) => job.last_error) && (
            <details className="ws-radar-plan">
              <summary>查看任务异常</summary>
              {scan.jobs
                .filter((job) => job.last_error)
                .map((job, i) => (
                  <p key={i} className="ws-warning">
                    {job.type} · {job.status}：{job.last_error}
                  </p>
                ))}
            </details>
          )}
        </section>
      )}
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
              {report.recommendations.length} 个建议
            </span>
          </div>
          <p className="ws-radar-summary">{report.summary}</p>
          {report.recommendations.map((recommendation, index) => (
            <RecommendationCard
              key={recommendation.id || index}
              item={recommendation}
              rank={index + 1}
              openDocument={openDocument}
            />
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
                <button
                  className="ws-text"
                  onClick={() => openDocument(evidence.documentId)}
                >
                  查看原文
                </button>
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
