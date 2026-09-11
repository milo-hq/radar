import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
export function ImportDialog({
  close,
  notice,
}: {
  close: () => void;
  notice: (m: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [mode, setMode] = useState("winner"),
    [url, setUrl] = useState(""),
    [name, setName] = useState(""),
    [json, setJson] = useState(""),
    [scheduled, setScheduled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "json") {
        const result = await api("/reddit/import", {
          thread: JSON.parse(json),
        });
        notice(`已处理 ${result.count} 条 Reddit 原文；重复快照自动去重`);
      } else {
        await api(scheduled ? "/sources" : "/ingest", {
          source: mode,
          url,
          name,
          ...(scheduled ? { intervalHours: 24 } : {}),
        });
        notice(scheduled ? "来源已加入每日采集" : "已加入采集队列");
      }
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label="导入真实来源"
      onCancel={close}
    >
      <form onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="eyebrow">ADD REAL MARKET DATA</span>
            <h2>导入一个真实来源</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={close}
            aria-label="关闭导入"
          >
            <X size={20} />
          </button>
        </div>
        <p className="muted">系统保留来源正文，不从链接推断收入或市场需求。</p>
        <label>
          来源类型
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setError("");
            }}
          >
            <option value="winner">产品 / Winner Radar</option>
            <option value="manual">市场网页 / Manual URL</option>
            <option value="reddit">Reddit 线程 / OAuth</option>
            <option value="json">Reddit 原始线程 JSON</option>
          </select>
        </label>
        {mode === "json" ? (
          <>
            <label>
              完整线程 JSON
              <textarea
                rows={11}
                required
                value={json}
                onChange={(e) => setJson(e.target.value)}
                placeholder="粘贴 [post Listing, comments Listing] 原始 JSON"
              />
            </label>
            <p className="form-help">
              保留
              post、comments、replies、parent_id、link_id。标题或搜索摘要不能代替完整正文。导入被标注为手工来源。
            </p>
          </>
        ) : (
          <>
            <label>
              公开网页 URL
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  mode === "reddit"
                    ? "https://www.reddit.com/r/…/comments/…"
                    : "https://product.com/pricing"
                }
              />
            </label>
            {mode === "winner" && (
              <label>
                产品名称
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：Plausible Analytics"
                  maxLength={200}
                />
              </label>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={scheduled}
                onChange={(e) => setScheduled(e.target.checked)}
              />
              每天重新采集一次
            </label>
            {mode === "reddit" && (
              <p className="form-help">
                需要服务端 REDDIT_ACCESS_TOKEN。未配置时可使用原始线程 JSON
                导入。
              </p>
            )}
          </>
        )}
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="button" type="button" onClick={close}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "提交中…" : "导入来源"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
