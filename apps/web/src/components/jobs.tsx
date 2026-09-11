import { Clock3 } from "lucide-react";
import { api, when } from "../api";
import { Badge } from "./primitives";
export function Jobs({
  jobs,
  notice,
}: {
  jobs: any[];
  notice: (m: string) => void;
}) {
  return (
    <section className="panel jobs">
      <div className="panel-heading">
        <div>
          <h2>采集活动</h2>
          <p>每次任务都有状态，失败也保留记录。</p>
        </div>
        <Clock3 size={18} />
      </div>
      {jobs.length ? (
        jobs.map((j) => (
          <div className="job-row" key={j.id}>
            <span className={"job-dot " + j.status} />
            <div>
              <strong>{j.payload.name || j.payload.url}</strong>
              <small>
                {j.last_error ||
                  `${when(j.created_at)} · 第 ${j.attempts} / ${j.max_attempts} 次尝试`}
              </small>
            </div>
            <Badge
              tone={
                j.status === "succeeded"
                  ? "green"
                  : j.status === "failed"
                    ? "amber"
                    : "neutral"
              }
            >
              {
                {
                  succeeded: "采集成功",
                  pending: "等待执行",
                  running: "正在采集",
                  failed: "采集失败",
                }[j.status as string]
              }
            </Badge>
            {j.status === "failed" && (
              <button
                className="text-button"
                onClick={() =>
                  api(`/jobs/${j.id}/retry`, {})
                    .then(() => notice("任务已重新排队"))
                    .catch((e) => notice(e.message))
                }
              >
                重试
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="quiet-empty">
          暂无采集任务。导入来源后，Worker 将自动开始处理。
        </div>
      )}
    </section>
  );
}
