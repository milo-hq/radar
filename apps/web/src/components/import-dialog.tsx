import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ArrowRight, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../api";
export function ImportDialog({
  close,
  notice,
}: {
  close: () => void;
  notice: (m: string) => void;
}) {
  const [mode, setMode] = useState("winner"),
    [url, setUrl] = useState(""),
    [name, setName] = useState(""),
    [json, setJson] = useState(""),
    [scheduled, setScheduled] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        aria-label="导入真实来源"
        showCloseButton={false}
      >
        <form className="space-y-4" onSubmit={submit}>
          <div className="modal-heading">
            <div>
              <DialogTitle>导入一个真实来源</DialogTitle>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={close}
              aria-label="关闭导入"
            >
              <X size={20} />
            </Button>
          </div>
          <DialogDescription>
            系统保留来源正文，不从链接推断收入或市场需求。
          </DialogDescription>
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
                <Textarea
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
                <Input
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
                  <Input
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：Plausible Analytics"
                    maxLength={200}
                  />
                </label>
              )}
              <label className="checkbox">
                <Checkbox
                  checked={scheduled}
                  onCheckedChange={(checked) => setScheduled(checked === true)}
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
            <Button variant="outline" size="sm" type="button" onClick={close}>
              取消
            </Button>
            <Button size="sm" disabled={busy}>
              {busy ? "提交中…" : "导入来源"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
