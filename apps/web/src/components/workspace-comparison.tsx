import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "./ui/table";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { api, when } from "../api";
const dimensions = [
  ["demand", "需求强度", "25%"],
  ["value", "付费价值", "25%"],
  ["feasibility", "开发可行性", "20%"],
  ["acquisition", "获客可行性", "15%"],
  ["fit", "个人匹配", "15%"],
] as const;
export function SourceCoverage({ summary }: { summary: any }) {
  const names: Record<string, string> = {
    winner: "产品官网 / 定价页",
    hn: "Hacker News 评论",
    github: "GitHub Issues",
    stackoverflow: "Stack Overflow",
    appstore: "App Store 用户评论",
    wordpress: "WordPress 插件评价",
    web: "网页爬取",
    manual: "手动网页",
    reddit: "Reddit",
  };
  return (
    <section className="ws-panel ws-coverage">
      <h2>实际数据覆盖</h2>
      <div className="ws-coverage-grid">
        {(summary?.sourceCoverage ?? []).map((s: any) => (
          <div key={s.id}>
            <strong>{s.documents}</strong>
            <span>{names[s.id] ?? s.name}</span>
            <small>
              {s.snapshots} 个原文版本
              {s.id === "reddit" && !summary?.redditConfigured
                ? " · 未配置"
                : ""}
            </small>
          </div>
        ))}
      </div>
      <p className="ws-muted">
        当前参考产品 {summary?.products ?? 0} 个。HN
        按已有产品检索，每次最多40条；单次研究最多使用2篇产品材料与6篇外部材料。数量按来源去重，版本更新不算新增来源。
      </p>
      <p className="ws-muted">
        「主题发现」已接入 GitHub Issues、Stack Overflow 与 HN
        关键词搜索。Reddit、产品评论站尚未接入主题搜索；这些技术社区仍不能代表全部用户。
      </p>
    </section>
  );
}
export function WorkspaceComparison({
  revision,
  jobs,
  opportunities,
  summary,
  notice,
  openOpportunity,
}: {
  revision: number;
  jobs: any[];
  opportunities: any[];
  summary: any;
  notice: (s: string) => void;
  openOpportunity: (id: string) => void;
}) {
  const [latest, setLatest] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api("/comparison")
      .then((r) => {
        if (active) {
          setLatest(r.latest);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [revision]);
  const job = jobs.find((j) => j.type === "COMPARE_OPPORTUNITIES");
  const pending = job && ["pending", "running"].includes(job.status);
  return (
    <>
      <SourceCoverage summary={summary} />
      <section className="ws-panel">
        <div className="ws-section-title">
          <div>
            <h2>先验证哪个机会</h2>
            <p className="ws-muted">
              对全部未放弃草稿做同一标准的横向评估。结果是模型估计，需结合原文核对。
            </p>
          </div>
          <Button
            variant="outline"
            className="button primary"
            disabled={
              busy ||
              pending ||
              !summary?.researchConfigured ||
              !opportunities.length
            }
            onClick={async () => {
              setBusy(true);
              try {
                await api("/comparison", {});
                notice("机会比较已排队");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "提交中…"
              : pending
                ? "正在评估…"
                : latest
                  ? "重新评估全部机会"
                  : "评估全部机会"}
          </Button>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        {job?.status === "failed" && (
          <p className="alert">最近评估失败：{job.last_error}，可重新评估。</p>
        )}
        <p className="ws-muted">
          五项均为1–5分，越高越有利。权重：需求25%、价值25%、开发20%、获客15%、个人匹配15%。未知不按0分处理，已知权重不足60%或少于三个维度则暂不排序。比较分是已知项的加权均值，不是成功概率。疑似被现有产品覆盖的方案先核对差异，暂不排名；没有用户痛点声明时需求最多2分。
        </p>
        {!latest && (
          <div className="ws-empty">
            <h3>目前还没有跨机会比较</h3>
            <p>
              评估后可同时查看价值、成本、主要未知与下一步验证动作。先填写创始人设置，才能评估与你的匹配度。
            </p>
          </div>
        )}
        {latest && (
          <>
            <p className={latest.stale ? "alert" : "ws-muted"}>
              {latest.stale
                ? "资料、机会或证据已变化：以下排序已过期，请重新评估。"
                : "评估时间：" + when(latest.created_at)}
            </p>
            <div className="ws-comparison-scroll">
              <Table className="ws-comparison-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>暂定验证顺序</TableHead>
                    {dimensions.map(([key, label, weight]) => (
                      <TableHead key={key}>
                        {label}
                        <small>{weight}</small>
                      </TableHead>
                    ))}
                    <TableHead>证据与下一步</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latest.result.items.map((o: any, i: number) => {
                    const original = opportunities.find((p) => p.id === o.id);
                    return (
                      <TableRow key={o.id}>
                        <TableCell>
                          <span className="ws-tag">
                            {latest.stale
                              ? "排序已过期"
                              : o.score == null
                                ? o.priorityBlocker
                                  ? "存在阻断 · 暂不排名"
                                  : o.differentiation === "overlap"
                                    ? "现有方案已覆盖 · 待核对"
                                    : "信息不足"
                                : `#${latest.result.items.findIndex((item: any) => item.score === o.score) + 1} · 预估 ${o.score}/5`}
                          </span>
                          <Button
                            variant="outline"
                            className="ws-text"
                            onClick={() => openOpportunity(o.id)}
                          >
                            {original?.title ?? "机会已移除"}
                          </Button>
                          <small>已知权重 {o.coverage}%</small>
                        </TableCell>
                        {dimensions.map(([key]) => (
                          <TableCell key={key}>
                            <strong>
                              {o[key].score ?? "未知"}
                              {o[key].score != null && <small>/5</small>}
                            </strong>
                            <p>{o[key].reason}</p>
                          </TableCell>
                        ))}
                        <TableCell>
                          <span className="ws-tag">
                            已核对痛点 {o.acceptedPain} · 商业{" "}
                            {o.acceptedCommercial}
                          </span>
                          <p>
                            {o.priorityBlocker && (
                              <>
                                <b>已记录阻断：</b>
                                {o.priorityBlocker}
                                <br />
                              </>
                            )}
                            <b>差异检查（模型）：</b>
                            {o.differentiationReason ??
                              "未做差异检查，请重新评估"}
                          </p>
                          <p>
                            <b>最大未知：</b>
                            {o.biggestUnknown}
                          </p>
                          <p>
                            <b>建议验证：</b>
                            {o.nextStep}
                          </p>
                          <Button
                            variant="outline"
                            className="ws-text"
                            onClick={() => openOpportunity(o.id)}
                          >
                            打开方案与证据 →
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
