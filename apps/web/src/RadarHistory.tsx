import { useEffect, useState } from "react";
import { api } from "./api";

type Entry = {
  id: string;
  status: string;
  created_at: string;
  opportunity_count: number | null;
  coverage: { collected?: number } | null;
};
const labels: Record<string, string> = {
  planning: "规划中",
  collecting: "采集中",
  analyzing: "分析中",
  reporting: "生成报告",
  complete: "已完成",
  failed: "失败",
};
export function RadarHistory({
  revision,
  selectedId,
  latestId,
  onSelect,
}: {
  revision: number;
  selectedId: string | null;
  latestId?: string;
  onSelect: (id: string | null) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Entry[]; hasMore: boolean } | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api<{ items: Entry[]; hasMore: boolean }>(`/radar/history?offset=${offset}`)
      .then((value) => {
        if (alive) {
          setData(value);
          setError("");
        }
      })
      .catch(() => {
        if (alive) setError("历史记录暂时无法读取");
      });
    return () => {
      alive = false;
    };
  }, [revision, offset]);
  return (
    <section className="ws-panel" aria-label="发现历史">
      <div className="ws-section-title">
        <div>
          <span className="ws-kicker">发现历史</span>
          <h2>每一轮发现，都可以回看</h2>
        </div>
        <button className="button" onClick={() => onSelect(null)}>
          查看最新一轮
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p>正在读取历史…</p>
      ) : (
        <>
          <div className="ws-radar-history-list">
            {data.items.map((item) => (
              <button
                key={item.id}
                className="ws-radar-history-item"
                aria-pressed={(selectedId ?? latestId) === item.id}
                onClick={() => onSelect(item.id)}
              >
                <strong>
                  {new Date(item.created_at).toLocaleString("zh-CN", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </strong>
                <span>
                  {labels[item.status] ?? item.status} ·{" "}
                  {item.opportunity_count === null
                    ? "机会待生成"
                    : `${item.opportunity_count} 个机会`}{" "}
                  · 采集 {item.coverage?.collected ?? 0} 篇
                </span>
              </button>
            ))}
          </div>
          {!data.items.length && (
            <p className="ws-muted">尚无发现记录，开始第一轮后会自动保留。</p>
          )}
          {(offset > 0 || data.hasMore) && (
            <div className="ws-radar-history-pages">
              <button
                className="button"
                disabled={offset === 0}
                onClick={() => {
                  setData(null);
                  setOffset((n) => Math.max(0, n - 20));
                }}
              >
                上一页
              </button>
              <span>第 {offset / 20 + 1} 页</span>
              <button
                className="button"
                disabled={!data.hasMore}
                onClick={() => {
                  setData(null);
                  setOffset((n) => n + 20);
                }}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
