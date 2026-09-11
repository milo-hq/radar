import { Check, ExternalLink, Link2, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, when } from "../api";
import { Badge } from "./primitives";
export function EvidenceDrawer({
  id,
  close,
  select,
  notice,
}: {
  id: string;
  close: () => void;
  select: (id: string) => void;
  notice: (m: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [doc, setDoc] = useState<any>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [tab, setTab] = useState("body"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    let active = true;
    setDoc(null);
    setError("");
    setTab("body");
    api("/documents/" + id)
      .then((d) => {
        if (active) {
          setDoc(d);
          setNote(d.review_note || "");
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [id]);
  async function review(status: string) {
    setBusy(true);
    try {
      await api(`/documents/${id}/review`, { status, note });
      setDoc({ ...doc, review_status: status });
      notice(
        status === "accepted"
          ? "原文已接受；这不代表需求已验证"
          : "原文已排除，原始记录仍然保留",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label="原文证据检查"
      onCancel={close}
    >
      <div className="drawer-header">
        <span>
          <ShieldCheck size={17} /> EVIDENCE INSPECTOR
        </span>
        <button className="icon-button" onClick={close} aria-label="关闭证据">
          <X size={21} />
        </button>
      </div>
      {error && <div className="alert">{error}</div>}
      {!doc ? (
        <div className="quiet-empty">正在读取原文…</div>
      ) : (
        <div className="drawer-content">
          <div className="row gap">
            <Badge tone="green">RAW SOURCE</Badge>
            <Badge>{doc.type.toUpperCase()}</Badge>
            <Badge>{doc.review_status}</Badge>
          </div>
          <h2>{doc.title || doc.body.slice(0, 110)}</h2>
          <a
            className="external-source"
            href={doc.canonical_url}
            target="_blank"
            rel="noreferrer"
          >
            <Link2 size={15} />
            {doc.canonical_url}
            <ExternalLink size={14} />
          </a>
          <div className="evidence-meta">
            <div>
              来源
              <strong>
                {doc.source_id}
                {doc.metadata.subreddit ? " · r/" + doc.metadata.subreddit : ""}
              </strong>
            </div>
            <div>
              采集时间<strong>{when(doc.collected_at)}</strong>
            </div>
            <div>
              发布时间
              <strong>
                {doc.published_at ? when(doc.published_at) : "UNKNOWN"}
              </strong>
            </div>
            <div>
              作者<strong>{doc.author_name || "UNKNOWN"}</strong>
            </div>
            <div>
              获取方式<strong>{doc.metadata.acquisition}</strong>
            </div>
            <div>
              商业结论置信度<strong>未提取 / UNKNOWN</strong>
            </div>
          </div>
          <div className="evidence-note">
            <ShieldCheck size={16} />
            <span>
              原文不可变。来源中的自述尚未独立验证，不能直接作为市场事实。
            </span>
          </div>
          <div className="tabs">
            <button
              className={tab === "body" ? "selected" : ""}
              onClick={() => setTab("body")}
            >
              原始正文
            </button>
            <button
              className={tab === "context" ? "selected" : ""}
              onClick={() => setTab("context")}
            >
              线程上下文 <span>{doc.context.length}</span>
            </button>
            <button
              className={tab === "payload" ? "selected" : ""}
              onClick={() => setTab("payload")}
            >
              原始 Payload
            </button>
          </div>
          {tab === "body" ? (
            <pre className="source-body">{doc.body}</pre>
          ) : tab === "payload" ? (
            <pre className="payload-body">
              {typeof doc.metadata.rawPayload === "string"
                ? doc.metadata.rawPayload
                : JSON.stringify(doc.metadata.rawPayload, null, 2)}
            </pre>
          ) : (
            <div>
              {doc.contextTruncated && (
                <div className="alert">
                  线程超过展示上限，当前显示含根帖的前 300
                  条。完整采集内容仍保留在原文库中。
                </div>
              )}
              {doc.metadata.contextComplete === false && (
                <div className="alert">
                  返回数据包含 more 节点，线程上下文不完整。
                </div>
              )}
              {doc.context.length ? (
                doc.context.map((d: any) => (
                  <button
                    className="context-row"
                    key={d.id}
                    onClick={() => select(d.id)}
                  >
                    <small>
                      {d.author_name || "未知作者"} · {d.external_id}
                      <br />
                      父节点：{d.parent_external_id || "线程根节点"}
                    </small>
                    <p>{d.title || d.excerpt}</p>
                  </button>
                ))
              ) : (
                <div className="quiet-empty">此来源不是 Reddit 线程。</div>
              )}
            </div>
          )}
          <div className="review-box">
            <h3>人工质量检查</h3>
            <label>
              检查备注
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="正文是否完整？与产品或用户问题是否相关？"
              />
            </label>
            <div className="row gap">
              <button
                disabled={busy}
                className="button primary"
                onClick={() => review("accepted")}
              >
                <Check size={16} />
                接受原文
              </button>
              <button
                disabled={busy}
                className="button"
                onClick={() => review("rejected")}
              >
                排除原文
              </button>
            </div>
          </div>
          <small className="hash">
            CONTENT HASH · {doc.normalized_content_hash}
          </small>
        </div>
      )}
    </dialog>
  );
}
