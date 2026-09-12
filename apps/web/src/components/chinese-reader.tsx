import { Button } from "./ui/button";
import { Languages, RefreshCw, ArrowRight, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, when } from "../api";
export function ChineseReader({
  id,
  onOriginal,
}: {
  id: string;
  onOriginal: () => void;
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    api(`/documents/${id}/chinese`)
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [id, tick]);
  useEffect(() => {
    if (
      !state?.job ||
      !["pending", "running"].includes(state.job.status) ||
      state.translation
    )
      return;
    const t = setInterval(() => setTick((n) => n + 1), 2500);
    return () => clearInterval(t);
  }, [state]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      await api(`/documents/${id}/chinese`, {});
      setTick((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!state)
    return (
      <div className="quiet-empty">
        正在读取中文内容…{error && <p role="alert">{error}</p>}
      </div>
    );
  const translation = state.translation;
  return (
    <section className="chinese-reader" aria-label="中文译文与关键信息">
      {state.configError && (
        <div className="alert" role="alert">
          {state.configError}
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {translation ? (
        <>
          <div className="translation-meta">
            <span>
              <CheckCircle2 size={14} />
              中文内容已缓存
            </span>
            <small>
              {translation.model} · {when(translation.created_at)}
            </small>
          </div>
          <h3 className="chinese-title">{translation.result.titleZh}</h3>
          <p className="translation-disclaimer">
            AI
            辅助翻译与摘要，不是独立核验的事实。金额、定价和收入结论请对照原文。
          </p>
          {translation.result.keyPoints.length > 0 && (
            <div className="chinese-points">
              <h3>关键信息</h3>
              {translation.result.keyPoints.map((p: any, i: number) => (
                <div className="chinese-point" key={i}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p>{p.textZh}</p>
                    <details>
                      <summary>对照原文摘录</summary>
                      <blockquote>{p.sourceQuote}</blockquote>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="translated-heading">
            <h3>全文中文译文</h3>
            <Button variant="outline" className="text-button" onClick={onOriginal}>
              切换原文 <ArrowRight size={14} />
            </Button>
          </div>
          <pre className="source-body translated-body">
            {translation.result.bodyZh}
          </pre>
        </>
      ) : (
        <div className="translation-empty">
          <div className="empty-icon">
            <Languages size={25} />
          </div>
          <h3>
            {state.job?.status === "running"
              ? "正在翻译并整理关键信息"
              : state.job?.status === "pending"
                ? "中文处理任务已排队"
                : "用中文阅读这条证据"}
          </h3>
          <p>
            全文分段翻译，保留品牌、金额与上下文。每条中文要点附原文摘录，生成后自动缓存。
          </p>
          {state.job && ["pending", "running"].includes(state.job.status) ? (
            <div className="translation-progress" role="status">
              <RefreshCw size={15} />
              已完成 {state.completedChunks} 个段落，完成后自动显示。
            </div>
          ) : (
            <>
              <Button variant="outline"
                className="button primary"
                onClick={generate}
                disabled={busy || !state.configured}
              >
                <Languages size={16} />
                {busy
                  ? "提交中…"
                  : state.job?.status === "failed"
                    ? "重试中文翻译"
                    : "生成中文译文与要点"}
              </Button>
              {state.job?.last_error && (
                <div className="alert" role="alert">
                  {state.job.last_error}
                </div>
              )}
            </>
          )}
          {!state.configured && (
            <div className="translation-setup">
              <strong>还需要配置翻译模型</strong>
              <p>
                请在项目的 .env 中填写以下配置，再重启服务。API Key
                只留在服务端，不要发到聊天里。
              </p>
              <pre>
                TRANSLATION_API_KEY=你的密钥{"\n"}TRANSLATION_MODEL=你的模型名称
                {"\n"}TRANSLATION_BASE_URL=服务商的API地址
              </pre>
              <small>
                支持 OpenAI 及兼容 Chat Completions / JSON 输出的接口。
              </small>
            </div>
          )}
          <Button variant="outline" className="text-button" onClick={onOriginal}>
            先查看原文 <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </section>
  );
}
