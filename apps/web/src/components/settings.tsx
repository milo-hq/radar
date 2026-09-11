import { Database, Layers3, Pause, Play, Radio, Telescope } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Badge } from "./primitives";
export function Settings({
  summary,
  revision,
  notice,
}: {
  summary: any;
  revision: number;
  notice: (m: string) => void;
}) {
  const [translationState, setTranslationState] = useState<any>(null);
  const [profile, setProfile] = useState<Record<string, string> | null>(null),
    [sources, setSources] = useState<any[]>([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    api("/founder")
      .then(setProfile)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    api("/translation-config")
      .then(setTranslationState)
      .catch((e) => setError(e.message));
    api("/sources")
      .then((d) => setSources(d.items))
      .catch((e) => setError(e.message));
  }, [revision]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/founder", profile, "PUT");
      notice("创始人配置已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const fields: Record<string, string> = {
    technicalStrength: "技术优势",
    preferredProductTypes: "偏好产品类型",
    preferredDistribution: "偏好获客方式",
    capitalPreference: "资金偏好",
    salesPreference: "销售偏好",
    avoidedMarkets: "避开的市场",
    riskPreference: "风险偏好",
  };
  return (
    <div className="settings-grid">
      <form className="panel settings-form" onSubmit={save}>
        <h2>Founder fit</h2>
        <p className="muted">
          由你定义适合自己的机会。空字段保持未知，不自动推断。
        </p>
        {error && <div className="alert">{error}</div>}
        {profile ? (
          Object.entries(fields).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={profile[key] || ""}
                onChange={(e) =>
                  setProfile({ ...profile, [key]: e.target.value })
                }
                placeholder="尚未配置"
                maxLength={2000}
              />
            </label>
          ))
        ) : (
          <p>读取配置…</p>
        )}
        <button className="button primary" disabled={!profile || saving}>
          {saving ? "保存中…" : "保存配置"}
        </button>
      </form>
      <div>
        <section className="panel connection-panel">
          <h2>连接状态</h2>
          <div className="connection-row">
            <div>
              <strong>中文阅读助手</strong>
              <small>
                {translationState?.configured
                  ? translationState.model
                  : "在 .env 配置 TRANSLATION_API_KEY / MODEL / BASE_URL"}
              </small>
            </div>
            <Badge tone={translationState?.configured ? "green" : "neutral"}>
              {translationState?.configured ? "可用" : "待配置"}
            </Badge>
          </div>
          {[
            {
              name: "PostgreSQL",
              icon: Database,
              ok: !!summary,
              detail: "持久化原文与任务队列",
            },
            {
              name: "Reddit OAuth",
              icon: Radio,
              ok: summary?.redditConfigured,
              detail: "可使用线程 JSON 手工导入",
            },
            {
              name: "pgvector",
              icon: Layers3,
              ok: summary?.vectorAvailable,
              detail: "原始采集阶段不依赖向量",
            },
            {
              name: "LLM Provider",
              icon: Telescope,
              ok: false,
              detail: "质量门禁前不启用模型分析",
            },
          ].map(({ name, icon: Icon, ok, detail }) => (
            <div className="connection-row" key={name}>
              <Icon size={18} />
              <div>
                <strong>{name}</strong>
                <small>{detail}</small>
              </div>
              <Badge tone={ok ? "green" : "neutral"}>
                {ok ? "可用" : "未启用"}
              </Badge>
            </div>
          ))}
        </section>
        <section className="panel schedules">
          <h2>定期采集</h2>
          <p className="muted">导入来源时勾选每日采集。暂停不删除历史原文。</p>
          {sources.length ? (
            sources.map((s) => (
              <div className="schedule-row" key={s.id}>
                <div>
                  <strong>{s.name || new URL(s.url).hostname}</strong>
                  <small>
                    每 {s.interval_hours} 小时 ·{" "}
                    {s.enabled ? "已启用" : "已暂停"}
                  </small>
                </div>
                <button
                  className="icon-button"
                  aria-label={s.enabled ? "暂停采集" : "启用采集"}
                  onClick={() =>
                    api("/sources/" + s.id, { enabled: !s.enabled }, "PATCH")
                      .then(() =>
                        notice(s.enabled ? "已暂停采集" : "已启用采集"),
                      )
                      .catch((e) => notice(e.message))
                  }
                >
                  {s.enabled ? <Pause size={17} /> : <Play size={17} />}
                </button>
              </div>
            ))
          ) : (
            <p className="quiet-empty">尚未添加定期来源。</p>
          )}
        </section>
      </div>
    </div>
  );
}
