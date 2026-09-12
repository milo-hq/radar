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
    [localize, setLocalize] = useState<string | null>(null),
    [sourceMarket, setSourceMarket] = useState("美国"),
    [targetMarket, setTargetMarket] = useState("中东"),
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
      <div className="ws-readiness">
        <Search size={19} />
        <div>
          <strong>先收集反馈，再研究未被满足的需求</strong>
          <p>
            「发现用户反馈」检索 Hacker News
            最近两年的产品相关讨论，每个产品单次最多收集 40
            条。讨论会加入研究材料，仍需核对相关性与上下文，不能直接视为已证实的痛点。采集完成后，再点击「研究机会」。发现反馈不需要研究模型。
          </p>
        </div>
      </div>
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
          const discovery = jobs.find(
            (j) =>
              j.type === "DISCOVER_FEEDBACK" &&
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
              {localize === p.id && (
                <form
                  className="ws-form ws-localize"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("localize-" + p.id, async () => {
                      await api(`/products/${p.id}/research`, {
                        localization: { sourceMarket, targetMarket },
                      });
                      notice("跨地区本地化研究已排队；结果仍需A/B证据分别核对");
                      setLocalize(null);
                    });
                  }}
                >
                  <h3>跨地区本地化研究</h3>
                  <p className="ws-muted">
                    借鉴已验证模式，寻找当地差异。A的成功不能证明B的需求；模型不能替代当地竞品调查。
                  </p>
                  <div className="ws-inline">
                    {["中东", "欧洲", "亚洲（不含中国）"].map((region) => (
                      <button
                        className="button"
                        type="button"
                        key={region}
                        onClick={() => {
                          setSourceMarket("美国");
                          setTargetMarket(region);
                        }}
                      >
                        美国 → {region}
                      </button>
                    ))}
                  </div>
                  <label>
                    来源地区 A
                    <input
                      required
                      maxLength={100}
                      value={sourceMarket}
                      onChange={(e) => setSourceMarket(e.target.value)}
                    />
                  </label>
                  <label>
                    目标地区 B
                    <input
                      required
                      maxLength={100}
                      value={targetMarket}
                      onChange={(e) => setTargetMarket(e.target.value)}
                    />
                  </label>
                  <button
                    className="button primary"
                    disabled={
                      !!busy || !!pending || !configured || !p.documents?.length
                    }
                  >
                    开始本地化研究
                  </button>
                </form>
              )}
              <div className="ws-product-actions">
                <button
                  className="button"
                  disabled={!!busy || !!discovery}
                  onClick={() =>
                    void act("discover-" + p.id, async () => {
                      await api(`/products/${p.id}/discover`, {});
                      notice(
                        "用户反馈发现已排队；完成后核对讨论，再发起机会研究",
                      );
                    })
                  }
                >
                  <Search size={15} />
                  {discovery
                    ? discovery.status === "running"
                      ? "正在发现反馈…"
                      : "反馈发现已排队"
                    : busy === "discover-" + p.id
                      ? "提交中…"
                      : "发现用户反馈"}
                </button>
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
                  onClick={() => setLocalize(localize === p.id ? null : p.id)}
                >
                  本地化研究
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
          <p>
            后台状态每 5 秒更新。反馈发现补充原文材料；机会研究生成待核对草稿。
          </p>
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
                {["ANALYZE_PRODUCT", "DISCOVER_FEEDBACK"].includes(j.type)
                  ? (j.type === "DISCOVER_FEEDBACK"
                      ? "反馈发现 · "
                      : "机会研究 · ") +
                    (products.find((p) => p.id === j.payload?.productId)
                      ?.name ||
                      j.payload?.productId ||
                      "")
                  : j.payload?.name || j.payload?.url || "原文采集"}
              </strong>
              <small>
                {when(j.created_at)} · 尝试 {j.attempts} / {j.max_attempts}
              </small>
              {j.type === "DISCOVER_FEEDBACK" && j.status === "succeeded" && (
                <small>
                  {typeof j.payload?.savedCount === "number"
                    ? `已保存 ${j.payload.savedCount} 条讨论`
                    : "反馈发现已完成"}
                  {typeof j.payload?.queryCount === "number"
                    ? ` · 已执行 ${j.payload.queryCount} 次检索`
                    : ""}
                  {" · 讨论待核对，可在产品研究材料中查看"}
                </small>
              )}
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
