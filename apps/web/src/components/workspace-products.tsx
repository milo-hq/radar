import { useEffect, useState } from "react";
import { ArrowRight, FileText, Plus, Search, Sparkles } from "lucide-react";
import { api, when } from "../api";
export function WorkspaceProducts({
  products,
  jobs,
  configured,
  openDocument,
  openOpportunity,
  notice,
  importSource,
}: {
  products: any[];
  jobs: any[];
  configured: boolean;
  openDocument: (id: string) => void;
  openOpportunity: (id: string) => void;
  notice: (s: string) => void;
  importSource: () => void;
}) {
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [attach, setAttach] = useState<string | null>(null);
  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="ws-section-title">
        <p className="ws-muted">
          {products.length} 个参考产品 ·
          将官网、评论、论坛讨论和收入来源放在一起研究
        </p>
        <div className="ws-inline">
          <button className="button" onClick={importSource}>
            导入网页
          </button>
          <button
            className="button primary"
            onClick={() => setCreating(!creating)}
          >
            <Plus size={16} />
            手动添加产品
          </button>
        </div>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {!configured && (
        <div className="ws-readiness">
          <Sparkles size={19} />
          <div>
            <strong>研究模型尚未配置</strong>
            <p>
              仍可手动创建机会、补充声明与核对证据。配置模型后即可生成研究草稿。
            </p>
          </div>
        </div>
      )}
      {creating && (
        <form
          className="ws-panel ws-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act("create", async () => {
              await api("/products", { name, url });
              setCreating(false);
              setName("");
              setUrl("");
              notice("参考产品已创建，请关联研究材料");
            });
          }}
        >
          <h2>添加参考产品</h2>
          <div className="ws-fields">
            <label>
              产品名称
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
              />
            </label>
            <label>
              官网地址
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
          </div>
          <p className="ws-muted">
            这里只建立产品档案。使用「导入网页」采集正文，再将材料关联到产品。
          </p>
          <div className="ws-inline">
            <button className="button primary" disabled={!!busy}>
              创建产品
            </button>
            <button
              className="button"
              type="button"
              onClick={() => setCreating(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <div className="ws-product-grid">
        {products.map((p) => {
          const pending = jobs.find(
            (j) =>
              j.type === "ANALYZE_PRODUCT" &&
              j.payload?.productId === p.id &&
              ["pending", "running"].includes(j.status),
          );
          return (
            <article className="ws-panel ws-product" key={p.id}>
              <div className="ws-inline">
                <span className="ws-product-mark">{p.name.slice(0, 1)}</span>
                <div>
                  <h2>{p.name}</h2>
                  <span className="ws-muted">
                    {p.domain || p.url || "手动参考产品"}
                  </span>
                </div>
              </div>
              <div className="ws-section-title">
                <h3>
                  研究材料{" "}
                  <span className="ws-muted">{p.documents?.length || 0}</span>
                </h3>
                <button
                  className="ws-text"
                  onClick={() => setAttach(attach === p.id ? null : p.id)}
                >
                  <Plus size={14} />
                  关联原文
                </button>
              </div>
              {attach === p.id && (
                <AttachDocument
                  product={p}
                  notice={notice}
                  close={() => setAttach(null)}
                />
              )}
              {p.documents?.length ? (
                <div className="ws-product-docs">
                  {p.documents.map((d: any) => (
                    <button key={d.id} onClick={() => openDocument(d.id)}>
                      <FileText size={16} />
                      <span>{d.title || d.url || "原始材料"}</span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ws-muted ws-product-empty">
                  尚无研究材料。导入官网、定价页或用户讨论，再关联到这里。
                </p>
              )}
              <div className="ws-product-actions">
                <button
                  className="button primary"
                  disabled={
                    !!busy || !!pending || !configured || !p.documents?.length
                  }
                  onClick={() =>
                    void act(p.id, async () => {
                      await api(`/products/${p.id}/research`, {});
                      notice("研究已排队，结果将出现在机会草稿中");
                    })
                  }
                >
                  <Sparkles size={15} />
                  {pending
                    ? pending.status === "running"
                      ? "正在研究…"
                      : "研究已排队"
                    : busy === p.id
                      ? "提交中…"
                      : "研究机会"}
                </button>
                <button
                  className="button"
                  disabled={!!busy}
                  onClick={() =>
                    void act("draft-" + p.id, async () => {
                      const o = await api("/opportunities", {
                        productId: p.id,
                        title: p.name + " · 新机会",
                        dossier: {},
                      });
                      notice("机会草稿已创建");
                      openOpportunity(o.id);
                    })
                  }
                >
                  手动建草稿
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!products.length && (
        <section className="ws-panel ws-empty">
          <Sparkles size={30} />
          <h2>从一个真实产品开始</h2>
          <p>
            选择你想研究的市场，导入产品官网和真实用户讨论。
            <br />
            系统提出机会草稿，由你核对证据并决定是否投入。
          </p>
          <button className="button primary" onClick={importSource}>
            <Plus size={15} />
            导入第一个产品
          </button>
        </section>
      )}
    </>
  );
}
function AttachDocument({
  product,
  notice,
  close,
}: {
  product: any;
  notice: (s: string) => void;
  close: () => void;
}) {
  const [search, setSearch] = useState(""),
    [docs, setDocs] = useState<any[]>([]),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const t = setTimeout(
      () =>
        api(
          "/documents?offset=" +
            offset +
            "&search=" +
            encodeURIComponent(search),
        )
          .then((d) => {
            if (active) {
              setDocs(d.items);
              setTotal(d.total);
            }
          })
          .catch((e) => active && setError(e.message)),
      180,
    );
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search, offset]);
  return (
    <div className="ws-attach">
      <label>
        <Search size={14} />
        查找原文
        <input
          placeholder="搜索整个原文库…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="ws-attach-results">
        {docs.map((d) => (
          <button
            key={d.id}
            disabled={
              busy ||
              product.documents?.some((existing: any) => existing.id === d.id)
            }
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/products/${product.id}/documents`, {
                  documentId: d.id,
                });
                notice("研究材料已关联");
                close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span>{d.title || d.excerpt || d.canonical_url}</span>
            <Plus size={14} />
          </button>
        ))}
      </div>
      {!docs.length && <p className="ws-muted">没有匹配原文，请先导入网页。</p>}
      <div className="ws-inline">
        <button
          className="ws-text"
          disabled={!offset}
          onClick={() => setOffset(offset - 50)}
        >
          上一页
        </button>
        <span>{total} 条原文</span>
        <button
          className="ws-text"
          disabled={offset + 50 >= total}
          onClick={() => setOffset(offset + 50)}
        >
          下一页
        </button>
        <button className="ws-text" onClick={close}>
          收起
        </button>
      </div>
    </div>
  );
}
export function WorkspaceJobs({
  jobs,
  products,
  notice,
}: {
  jobs: any[];
  products: any[];
  notice: (s: string) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  return (
    <section className="ws-panel ws-jobs">
      <div className="ws-section-title">
        <div>
          <h2>研究与采集活动</h2>
          <p>后台状态每 5 秒更新，研究完成后在机会草稿中查看结果。</p>
        </div>
        <span className="ws-tag">实时队列</span>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {jobs.length ? (
        jobs.slice(0, 12).map((j) => (
          <div className="ws-job" key={j.id}>
            <span className={"ws-job-dot " + j.status} />
            <div>
              <strong>
                {j.type === "ANALYZE_PRODUCT"
                  ? "机会研究 · " +
                    (products.find((p) => p.id === j.payload?.productId)
                      ?.name ||
                      j.payload?.productId ||
                      "")
                  : j.payload?.name || j.payload?.url || "原文采集"}
              </strong>
              <small>
                {when(j.created_at)} · 尝试 {j.attempts} / {j.max_attempts}
              </small>
              {j.last_error && <p className="ws-warning">{j.last_error}</p>}
            </div>
            <span className="ws-tag">
              {(
                {
                  succeeded: "已完成",
                  pending: "等待执行",
                  running: "处理中",
                  failed: "失败",
                } as Record<string, string>
              )[j.status] || j.status}
            </span>
            {j.status === "failed" && (
              <button
                className="ws-text"
                disabled={!!busy}
                onClick={async () => {
                  setBusy(j.id);
                  setError("");
                  try {
                    await api(`/jobs/${j.id}/retry`, {});
                    notice("任务已重新排队");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                重试
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="ws-muted">
          暂无任务。导入来源或研究产品后，进度会显示在这里。
        </p>
      )}
    </section>
  );
}
