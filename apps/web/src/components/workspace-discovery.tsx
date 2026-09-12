import { useEffect, useState } from "react";
import { api, when } from "../api";
const channels = {
  hn: "Hacker News",
  github: "GitHub Issues",
  stackoverflow: "Stack Overflow",
};
export function WorkspaceDiscovery({
  revision,
  notice,
  openDocument,
}: {
  revision: number;
  notice: (s: string) => void;
  openDocument: (id: string) => void;
}) {
  const [query, setQuery] = useState("invoice"),
    [sources, setSources] = useState<string[]>(Object.keys(channels)),
    [jobs, setJobs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [docs, setDocs] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api("/discovery")
      .then((r) => alive && setJobs(r.items))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [revision]);
  useEffect(() => {
    let alive = true;
    setDocs([]);
    if (selected)
      api(`/discovery/${selected}/documents`)
        .then((r) => alive && setDocs(r.items))
        .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [selected, revision]);
  return (
    <>
      <section className="ws-panel">
        <h2>从需求主题出发，跨产品搜索</h2>
        <p className="ws-muted">
          检索最近两年的公开讨论，每渠道每次最多30条。GitHub匹配标题并优先显示讨论较多的问题。结果是待筛选材料；Issue、问题或评论不等于付费需求，也可能已有解决方案。
        </p>
        <form
          className="ws-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/discovery", { query, sources });
              notice("主题搜索已排队，结果按渠道分别显示");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            主题 / 搜索词
            <input
              required
              minLength={2}
              maxLength={150}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如 invoice、email automation、data export"
            />
          </label>
          <div className="ws-inline">
            {Object.entries(channels).map(([key, name]) => (
              <label className="ws-channel" key={key}>
                <input
                  type="checkbox"
                  checked={sources.includes(key)}
                  onChange={(e) =>
                    setSources(
                      e.target.checked
                        ? [...sources, key]
                        : sources.filter((s) => s !== key),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
          <p className="ws-muted">公开英文渠道建议使用英文关键词。示例主题：</p>
          <div className="ws-inline">
            {["invoice", "email automation", "data export"].map((q) => (
              <button
                type="button"
                className="button"
                key={q}
                onClick={() => setQuery(q)}
              >
                {q}
              </button>
            ))}
          </div>
          <button className="button primary" disabled={busy || !sources.length}>
            {busy ? "提交中…" : "搜索新主题"}
          </button>
        </form>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="ws-discovery-grid">
        <section className="ws-panel">
          <h2>采集记录</h2>
          <p className="ws-muted">
            新来源数按平台原文ID去重。渠道限流时按要求延后；失败原因保留。
          </p>
          {jobs.map((j) => (
            <button
              className={
                "ws-discovery-job " + (selected === j.id ? "selected" : "")
              }
              key={j.id}
              onClick={() => setSelected(j.id)}
            >
              <strong>
                {j.payload.query} ·{" "}
                {channels[j.payload.source as keyof typeof channels]}
              </strong>
              <span>
                {
                  {
                    pending: "等待执行",
                    running: "采集中",
                    succeeded: "完成",
                    failed: "失败",
                  }[j.status as string]
                }{" "}
                · {when(j.created_at)}
              </span>
              {j.status === "succeeded" && (
                <span>
                  匹配 {j.payload.matchedCount} 条 · 新增 {j.payload.savedCount}{" "}
                  条
                </span>
              )}
              {j.last_error && (
                <span className="ws-warning">{j.last_error}</span>
              )}
            </button>
          ))}
          {!jobs.length && <p>尚未搜索主题。</p>}
        </section>
        <section className="ws-panel">
          <h2>主题材料 {selected ? `· ${docs.length} 条` : ""}</h2>
          <p className="ws-muted">
            先核对原文；发现真实产品后可加入参考产品，再关联更多官网、定价和用户材料做研究。
          </p>
          {!selected && <p>选择左侧采集记录查看结果。</p>}
          {selected && !docs.length && (
            <p>该记录尚无材料。请查看采集状态和错误；空结果不会补造数据。</p>
          )}
          {docs.map((d) => (
            <article className="ws-discovery-doc" key={d.id}>
              <button className="ws-text" onClick={() => openDocument(d.id)}>
                {d.title || "原始讨论"}
              </button>
              <small>
                {d.author_name || "作者未知"} · {when(d.published_at)}
              </small>
              <p>{d.excerpt}</p>
              <small>
                {d.metadata.license && <>{d.metadata.license} · </>}
                {d.metadata.contextNote}
                {d.metadata.isAnswered ? " · 平台标记已有回答" : ""}
                {d.metadata.state === "closed"
                  ? " · Issue已关闭，需核对解决方式"
                  : d.metadata.state === "open"
                    ? " · Issue仍开放"
                    : ""}
              </small>
              <div className="ws-inline">
                <a href={d.canonical_url} target="_blank" rel="noreferrer">
                  打开来源 ↗
                </a>
                {d.metadata.repositoryUrl && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const p = await api("/products", {
                          name: d.metadata.repositoryName,
                          url: d.metadata.repositoryUrl,
                        });
                        await api(`/products/${p.id}/documents`, {
                          documentId: d.id,
                        });
                        notice(
                          "参考项目已加入，材料已关联；可前往参考产品研究",
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    加入参考产品
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
