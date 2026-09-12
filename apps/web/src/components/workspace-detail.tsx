import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Check, FileText, Plus, Save } from "lucide-react";
import { api, when } from "../api";
import {
  decisionNames,
  emptyDossier,
  fields,
  kinds,
  reviews,
  Status,
  validationFields,
  type Claim,
  type Dossier,
  type Opportunity,
} from "./workspace-model";

export function WorkspaceDetail({
  id,
  products,
  revision,
  back,
  openDocument,
  notice,
}: {
  id: string;
  products: any[];
  revision: number;
  back: () => void;
  openDocument: (id: string) => void;
  notice: (s: string) => void;
}) {
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null),
    [title, setTitle] = useState(""),
    [dossier, setDossier] = useState<Dossier>(emptyDossier),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [claims, setClaims] = useState<Claim[]>([]),
    [claimId, setClaimId] = useState(""),
    [adding, setAdding] = useState(false),
    [decision, setDecision] = useState("WATCH"),
    [reason, setReason] = useState("");
  useEffect(() => {
    let active = true;
    api<Opportunity>("/opportunities/" + id)
      .then(async (o) => {
        if (!active) return;
        setOpportunity(o);
        const c = await api("/claims?productId=" + o.product_id);
        if (active) setClaims(c.items);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [id, revision]);
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      notice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!opportunity)
    return (
      <section className="ws-panel ws-empty">
        {error || "正在读取机会档案…"}
        <button className="button" onClick={back}>
          返回机会
        </button>
      </section>
    );
  const o = opportunity,
    product = products.find((p) => p.id === o.product_id),
    available = claims.filter(
      (c) => !o.claims.some((linked) => linked.id === c.id),
    );
  function startEdit() {
    setTitle(o.title);
    setDossier({
      ...emptyDossier(),
      ...o.dossier,
      validation: { ...emptyDossier().validation, ...o.dossier?.validation },
    });
    setEditing(true);
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await perform(async () => {
      await api("/opportunities/" + id, { title, dossier }, "PATCH");
      setOpportunity({ ...o, title, dossier });
      setEditing(false);
    }, "机会档案已保存");
  }
  return (
    <>
      <button className="ws-back" onClick={back}>
        <ArrowLeft size={16} />
        全部机会
      </button>
      <div className="ws-detail-heading">
        <div>
          <div className="ws-inline">
            <Status opportunity={o} />
            <span className="ws-muted">
              参考产品 · {product?.name || "未关联产品"}
            </span>
          </div>
          <h1>{o.title}</h1>
          <p>机会方案是待验证的假设。只有经你核对的声明才计入证据门槛。</p>
        </div>
        <button className="button" disabled={editing} onClick={startEdit}>
          <Save size={16} />
          编辑档案
        </button>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className={"ws-readiness " + (o.readiness?.ready ? "ready" : "")}>
        <Check size={19} />
        <div>
          <strong>
            {o.readiness?.ready
              ? "已具备进入候选的最低证据"
              : "继续补证，暂存为草稿"}
          </strong>
          <p>
            {o.readiness?.ready
              ? "市场或收入证据 + 需求证据已接受。候选资格不代表商业成功。"
              : "需要关联参考产品，并接受至少一条市场或收入声明、一条需求声明。"}
            {o.readiness?.missing?.length ? (
              <span className="ws-missing">
                缺少：{o.readiness.missing.join(" · ")}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <div className="ws-detail-grid">
        <div>
          <section className="ws-panel">
            <div className="ws-section-title">
              <div>
                <span className="ws-kicker">01 / OPPORTUNITY</span>
                <h2>具体做什么，为谁而做</h2>
              </div>
              <span className="ws-tag">推断与计划</span>
            </div>
            {editing ? (
              <form onSubmit={save} className="ws-form">
                <label>
                  机会名称
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <div className="ws-fields">
                  {fields.map(([key, label, placeholder]) => (
                    <label key={key}>
                      {label}
                      <textarea
                        rows={3}
                        placeholder={placeholder}
                        value={dossier[key] || ""}
                        onChange={(e) =>
                          setDossier({ ...dossier, [key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
                <h3>验证计划</h3>
                <div className="ws-fields">
                  {validationFields.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <textarea
                        rows={2}
                        value={dossier.validation[key] || ""}
                        onChange={(e) =>
                          setDossier({
                            ...dossier,
                            validation: {
                              ...dossier.validation,
                              [key]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="ws-inline">
                  <button disabled={busy} className="button primary">
                    {busy ? "保存中…" : "保存档案"}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setEditing(false)}
                  >
                    取消编辑
                  </button>
                </div>
              </form>
            ) : (
              <dl className="ws-dossier">
                {fields.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd className={!o.dossier?.[key] ? "ws-unknown" : ""}>
                      {o.dossier?.[key] || "未知 · 等待研究或补充"}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="ws-panel">
            <div className="ws-section-title">
              <div>
                <span className="ws-kicker">02 / EVIDENCE</span>
                <h2>逐条核对证据</h2>
                <p>检查原文是否支持声明；接受声明与接受原文是两项独立判断。</p>
              </div>
              <button className="button" onClick={() => setAdding(!adding)}>
                <Plus size={15} />
                补充证据
              </button>
            </div>
            {adding && (
              <AddClaim
                productId={o.product_id}
                documents={product?.documents || []}
                opportunityId={id}
                notice={notice}
                done={() => setAdding(false)}
                openDocument={openDocument}
              />
            )}
            {available.length > 0 && (
              <form
                className="ws-link-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(async () => {
                    await api(`/opportunities/${id}/claims`, { claimId });
                    setClaimId("");
                  }, "已有声明已关联");
                }}
              >
                <label>
                  关联此产品的已有声明
                  <select
                    required
                    value={claimId}
                    onChange={(e) => setClaimId(e.target.value)}
                  >
                    <option value="">选择声明…</option>
                    {available.map((c) => (
                      <option key={c.id} value={c.id}>
                        {kinds[c.kind]} · {c.statement}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button" disabled={!claimId || busy}>
                  关联
                </button>
              </form>
            )}
            {!o.claims.length && (
              <div className="ws-empty">
                <FileText size={25} />
                <h3>还没有支持这份机会的声明</h3>
                <p>补充产品关联原文中的精确摘录，或在参考产品页发起研究。</p>
              </div>
            )}
            {o.claims.map((c) => (
              <article className="ws-claim" key={c.id}>
                <div className="ws-inline">
                  <span className="ws-tag">{kinds[c.kind] || c.kind}</span>
                  <span
                    className={
                      "ws-tag " +
                      (c.review_status === "accepted"
                        ? "green"
                        : c.review_status === "rejected"
                          ? "muted"
                          : "amber")
                    }
                  >
                    {reviews[c.review_status]}
                  </span>
                </div>
                <h3>{c.statement}</h3>
                <blockquote>{c.quote}</blockquote>
                <div className="ws-claim-actions">
                  <button
                    className="ws-text"
                    onClick={() => openDocument(c.raw_document_id)}
                  >
                    <FileText size={14} />
                    查看原文与译文
                  </button>
                  <div className="ws-inline">
                    {(["accepted", "rejected", "pending"] as const).map(
                      (status) => (
                        <button
                          key={status}
                          className={
                            "button " + (status === "accepted" ? "primary" : "")
                          }
                          disabled={busy || c.review_status === status}
                          onClick={() =>
                            void perform(
                              () =>
                                api(
                                  "/claims/" + c.id,
                                  { reviewStatus: status, opportunityId: id },
                                  "PATCH",
                                ),
                              "声明审核已更新",
                            )
                          }
                        >
                          {status === "accepted"
                            ? "接受声明"
                            : status === "rejected"
                              ? "排除"
                              : "待核对"}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </article>
            ))}
          </section>
        </div>
        <aside>
          <section className="ws-panel">
            <div className="ws-section-title">
              <div>
                <span className="ws-kicker">03 / DECISION</span>
                <h2>决定下一步</h2>
              </div>
            </div>
            <p className="ws-muted">
              每次决策保留历史。开始验证前，请在档案中填写完整验证计划。
            </p>
            <dl className="ws-validation">
              {validationFields.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{o.dossier?.validation?.[key] || "尚未填写"}</dd>
                </div>
              ))}
            </dl>
            <button className="ws-text" onClick={startEdit}>
              编辑验证计划
            </button>
            <form
              className="ws-form ws-decision"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await api(`/opportunities/${id}/decisions`, {
                    decision,
                    reason,
                  });
                  setReason("");
                }, "决策已记录");
              }}
            >
              <label>
                决策
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  {Object.entries(decisionNames).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                决策理由
                <textarea
                  required
                  rows={3}
                  placeholder="依据是什么？接下来要解决哪个未知？"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {decision === "VALIDATE" &&
                (!o.readiness?.ready ||
                  validationFields.some(
                    ([key]) => !o.dossier?.validation?.[key]?.trim(),
                  )) && (
                  <p className="ws-warning">
                    请先达到候选证据门槛，并填写全部五项验证条件。
                  </p>
                )}
              <button
                className="button primary"
                disabled={
                  busy ||
                  editing ||
                  (decision === "VALIDATE" &&
                    (!o.readiness?.ready ||
                      validationFields.some(
                        ([key]) => !o.dossier?.validation?.[key]?.trim(),
                      )))
                }
              >
                记录决策
              </button>
            </form>
          </section>
          <section className="ws-panel">
            <h2>决策历史</h2>
            {o.decisions?.length ? (
              <ol className="ws-timeline">
                {o.decisions.map((d) => (
                  <li key={d.id}>
                    <strong>{decisionNames[d.decision] || d.decision}</strong>
                    <small>{when(d.created_at)}</small>
                    <p>{d.reason}</p>
                    {d.snapshot?.dossier?.validation && (
                      <details>
                        <summary>当时的验证计划</summary>
                        {validationFields.map(([k, label]) => (
                          <p key={k}>
                            {label}：
                            {d.snapshot.dossier.validation[k] || "未知"}
                          </p>
                        ))}
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="ws-muted">
                尚无决策。保留观察理由，也保留放弃原因。
              </p>
            )}
          </section>
          <details className="ws-panel">
            <summary>研究时的创始人配置</summary>
            {o.founder_snapshot && Object.keys(o.founder_snapshot).length ? (
              <dl className="ws-validation">
                {Object.entries(o.founder_snapshot).map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {(
                        {
                          technicalStrength: "技术优势",
                          preferredProductTypes: "偏好产品类型",
                          preferredDistribution: "偏好获客",
                          capitalPreference: "资金偏好",
                          salesPreference: "销售偏好",
                          avoidedMarkets: "避开的市场",
                          riskPreference: "风险偏好",
                          hoursPerWeek: "每周投入",
                          maxBuildWeeks: "最长工期",
                          budget: "预算",
                          maintenanceTolerance: "维护承受度",
                        } as Record<string, string>
                      )[key] || key}
                    </dt>
                    <dd>{String(value || "未知")}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="ws-muted">创建时未配置约束。</p>
            )}
          </details>
        </aside>
      </div>
    </>
  );
}
function AddClaim({
  productId,
  documents,
  opportunityId,
  notice,
  done,
  openDocument,
}: {
  productId: string;
  documents: any[];
  opportunityId: string;
  notice: (s: string) => void;
  done: () => void;
  openDocument: (id: string) => void;
}) {
  const [documentId, setDocumentId] = useState(""),
    [document, setDocument] = useState<any>(null),
    [kind, setKind] = useState("pain"),
    [statement, setStatement] = useState(""),
    [quote, setQuote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setDocument(null);
    setQuote("");
    if (documentId)
      api("/documents/" + documentId)
        .then((d) => active && setDocument(d))
        .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [documentId]);
  return (
    <form
      className="ws-form ws-add-claim"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const claim = await api("/claims", {
            productId,
            documentId,
            kind,
            statement,
            quote,
          });
          await api(`/opportunities/${opportunityId}/claims`, {
            claimId: claim.id,
          });
          notice("证据声明已添加，等待人工核对");
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>从原文补充声明</h3>
      <label>
        关联原文
        <select
          required
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
        >
          <option value="">选择产品的研究材料…</option>
          {documents.map((d) => (
            <option value={d.id} key={d.id}>
              {d.title || d.url || d.id}
            </option>
          ))}
        </select>
      </label>
      {!documents.length && (
        <p className="ws-warning">请先到参考产品页关联研究材料。</p>
      )}
      {document && (
        <>
          <button
            type="button"
            className="ws-text"
            onClick={() => openDocument(documentId)}
          >
            打开原文与中文阅读
          </button>
          <details open>
            <summary>原始正文 · 选择并复制精确摘录</summary>
            <pre className="ws-source">{document.body}</pre>
          </details>
        </>
      )}
      <label>
        证据类型
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(kinds).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        声明
        <textarea
          required
          rows={2}
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="这段原文能够支持的具体判断"
        />
      </label>
      <label>
        精确原文摘录
        <textarea
          required
          rows={3}
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="直接复制原文中的连续片段，不使用译文或改写"
        />
      </label>
      {quote && document && !document.body.includes(quote) && (
        <p className="ws-warning">
          摘录与原文不一致，请直接复制原文中的连续片段。
        </p>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="ws-inline">
        <button
          className="button primary"
          disabled={
            busy || !document || !quote || !document.body.includes(quote)
          }
        >
          添加待核对声明
        </button>
        <button className="button" type="button" onClick={done}>
          取消
        </button>
      </div>
    </form>
  );
}
