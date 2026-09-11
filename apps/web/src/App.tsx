import {
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowUpRight,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Layers3,
  Plus,
  Radar,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Telescope,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "./api";
import { DocumentList } from "./components/document-list";
import { EvidenceDrawer } from "./components/evidence-drawer";
import { ImportDialog } from "./components/import-dialog";
import { Jobs } from "./components/jobs";
import { Badge, Empty } from "./components/primitives";
import { Settings } from "./components/settings";
const navigation = [
  { label: "Radar", cn: "雷达总览", icon: Radar },
  { label: "Products", cn: "产品候选", icon: Box },
  { label: "Signals", cn: "原始信号", icon: Radio },
  { label: "Problems", cn: "问题聚类", icon: Layers3 },
  { label: "Opportunities", cn: "商业机会", icon: Telescope },
  { label: "Graveyard", cn: "决策归档", icon: Archive },
  { label: "Settings", cn: "设置", icon: Settings2 },
];
type Page = (typeof navigation)[number]["label"];
export default function App() {
  const [page, setPage] = useState<Page>("Radar"),
    [summary, setSummary] = useState<any>(null),
    [products, setProducts] = useState<any[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [docs, setDocs] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [source, setSource] = useState("all"),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [importOpen, setImportOpen] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);
  useEffect(() => {
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([api("/summary"), api("/products"), api("/jobs")])
      .then(([s, p, j]) => {
        if (active) {
          setSummary(s);
          setProducts(p.items);
          setJobs(j.items);
          setError("");
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        api(
          `/documents?search=${encodeURIComponent(search)}&source=${source}&offset=${offset}`,
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
      clearTimeout(timer);
    };
  }, [search, source, offset, revision]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  function go(next: Page) {
    setPage(next);
    setOffset(0);
    setSearch("");
    setSource("all");
  }
  const notice = (message: string) => {
    setToast(message);
    refresh();
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Radar");
          }}
        >
          <span className="brandmark">
            <Radar size={24} />
          </span>
          <span>
            venture<span className="brand-light">radar</span>
            <small>FOUNDER INTELLIGENCE</small>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <Badge>V1 α</Badge>
        </div>
        <nav aria-label="主导航">
          {navigation.map(({ label, cn, icon: Icon }) => (
            <button
              key={label}
              aria-label={label + " " + cn}
              className={"nav-item " + (page === label ? "active" : "")}
              onClick={() => go(label)}
            >
              <Icon size={18} />
              <span>
                {label}
                <small>{cn}</small>
              </span>
              {label === "Signals" && !!summary?.documents && (
                <span className="nav-count">{summary.documents}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="principle">
            <ShieldCheck size={18} />
            <span>
              Evidence over opinion<small>每个判断，回到证据。</small>
            </span>
          </div>
          <div className="profile">
            <span className="avatar">F</span>
            <div>
              Founder workspace<small>本地 · 私人工作台</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="top-right">
            <span className="connection">
              <span className={"online-dot " + (!summary ? "offline" : "")} />
              {summary ? "数据库已连接" : "等待数据库"}
            </span>
            <button
              className="icon-button"
              onClick={refresh}
              aria-label="刷新数据"
            >
              <RefreshCw size={16} />
            </button>
            <span className="avatar small">F</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "Radar"
                  ? "YOUR NEXT MOVE STARTS WITH PROOF"
                  : "VENTURE RADAR / " + page.toUpperCase()}
              </div>
              <h1>
                {navigation.find((n) => n.label === page)?.cn}
                <span>{page === "Radar" ? "Radar overview" : page}</span>
              </h1>
              <p>
                {page === "Radar"
                  ? "找到已经有人付费、仍然值得深入调查的市场。"
                  : page === "Signals"
                    ? "查看完整原文、来源与上下文，先确认数据值得相信。"
                    : page === "Products"
                      ? "从真实产品开始。候选不等于赢家，定价不等于收入。"
                      : page === "Settings"
                        ? "配置你的优势、数据来源与采集节奏。"
                        : "以可信证据为前提，逐层推进创始人决策。"}
              </p>
            </div>
            <button
              className="button primary"
              onClick={() => setImportOpen(true)}
            >
              <Plus size={17} />
              导入来源
            </button>
          </div>
          {error && (
            <div className="alert" role="alert">
              <AlertCircle size={18} />
              {error}
              <button onClick={refresh}>重试</button>
            </div>
          )}
          {page === "Radar" && (
            <>
              <div className="focus-banner">
                <div className="focus-icon">
                  <Radar size={24} />
                </div>
                <div>
                  <div className="row gap">
                    <strong>先建立可信的输入层</strong>
                    <Badge tone="green">FOUNDATION ALPHA</Badge>
                  </div>
                  <p>
                    当前阶段：真实市场采集与人工检查。质量门禁通过后，进入痛点提取与机会研究。
                  </p>
                </div>
                <button onClick={() => go("Signals")}>
                  检查证据 <ArrowRight size={16} />
                </button>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "产品候选",
                    value: summary?.products,
                    target: 200,
                    caption: "M1 目标 · 200 个真实产品",
                    icon: Box,
                  },
                  {
                    label: "市场原文",
                    value: summary?.documents,
                    target: 500,
                    caption: `M1 目标 500 · 已存 ${summary?.snapshots ?? 0} 个快照`,
                    icon: FileText,
                  },
                  {
                    label: "Reddit 原文",
                    value: summary?.reddit,
                    target: 300,
                    caption: summary?.redditConfigured
                      ? "OAuth 已配置"
                      : "等待 OAuth 或线程 JSON 导入",
                    icon: Radio,
                  },
                  {
                    label: "人工接受",
                    value: summary?.reviewed,
                    target: summary?.documents || 1,
                    caption: "原文质量审核 · 非需求验证",
                    icon: ShieldCheck,
                  },
                ].map(({ label, value, target, caption, icon: Icon }) => (
                  <div className="stat-card" key={label}>
                    <div className="stat-label">
                      {label}
                      <Icon size={17} />
                    </div>
                    <div className="stat-value">
                      {value ?? "—"}
                      <span>
                        {label === "Reddit 原文"
                          ? "条"
                          : label === "人工接受"
                            ? "条已检查"
                            : `/ ${target}`}
                      </span>
                    </div>
                    <div className="progress">
                      <i
                        style={{
                          width:
                            Math.min(100, ((value ?? 0) / target) * 100) + "%",
                        }}
                      />
                    </div>
                    <small>{caption}</small>
                  </div>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>值得检查的产品</h2>
                      <p>Winner-first · 从可追溯的产品原文开始</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => go("Products")}
                    >
                      全部产品 <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {products.length ? (
                    <div className="winner-list">
                      {products.slice(0, 4).map((p, i) => (
                        <button
                          className="winner-row"
                          key={p.id}
                          onClick={() => setSelected(p.documents[0]?.id)}
                        >
                          <span className={"product-logo color-" + i}>
                            {p.name.slice(0, 1)}
                          </span>
                          <span className="winner-info">
                            <strong>{p.name}</strong>
                            <small>{p.domain}</small>
                          </span>
                          <span className="winner-proof">
                            <Badge>待验证</Badge>
                            <small>{p.documents.length} 条来源</small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="让第一个真实产品进入雷达"
                      description="导入产品官网、定价页或公开收入来源。系统保留原文，你来判断它证明了什么。"
                      action={
                        <button
                          className="button"
                          onClick={() => setImportOpen(true)}
                        >
                          <Plus size={15} />
                          添加产品来源
                        </button>
                      }
                    />
                  )}
                  <div className="panel-foot">
                    <ShieldCheck size={14} /> 收入信号未验证前，不自动升级 Proof
                    Level。
                  </div>
                </section>
                <section className="panel journey">
                  <div className="panel-heading">
                    <div>
                      <h2>证据 → 决策</h2>
                      <p>保持顺序，减少未知变量</p>
                    </div>
                    <span className="tiny-label">01 / 04</span>
                  </div>
                  {[
                    {
                      n: "01",
                      title: "真实市场与产品",
                      text: "采集原文 · 检查来源 · 保留上下文",
                      active: true,
                    },
                    {
                      n: "02",
                      title: "需求与商业证据",
                      text: "痛点提取 · 收入验证 · 问题聚类",
                    },
                    {
                      n: "03",
                      title: "机会与反方研究",
                      text: "SEO · Bull / Bear · Evidence Judge",
                    },
                    {
                      n: "04",
                      title: "创始人决策",
                      text: "WATCH / VALIDATE / KILL",
                    },
                  ].map((s) => (
                    <div
                      className={"journey-step " + (s.active ? "current" : "")}
                      key={s.n}
                    >
                      <span>{s.n}</span>
                      <div>
                        <strong>{s.title}</strong>
                        <small>{s.text}</small>
                      </div>
                      {s.active && <span className="online-dot" />}
                    </div>
                  ))}
                  <div className="journey-note">
                    当前门禁 <strong>输入质量尚待验证</strong>
                    <small>完整 V1 的规模与质量标准独立验收。</small>
                  </div>
                </section>
              </div>
              <section className="panel recent">
                <div className="panel-heading">
                  <div>
                    <h2>最新市场原文</h2>
                    <p>原始事实层 · 机械解析，不做 AI 改写</p>
                  </div>
                  <button className="text-button" onClick={() => go("Signals")}>
                    查看全部 <ArrowUpRight size={15} />
                  </button>
                </div>
                <DocumentList docs={docs.slice(0, 4)} select={setSelected} />
              </section>
              <Jobs jobs={jobs.slice(0, 6)} notice={notice} />
            </>
          )}
          {page === "Products" && (
            <>
              <div className="section-bar">
                <span>{products.length} 个真实产品候选</span>
                <Badge tone="amber">收入证据需单独核验</Badge>
              </div>
              <div className="product-grid">
                {products.map((p, i) => (
                  <section className="panel product-card" key={p.id}>
                    <div className="row between">
                      <span className={"product-logo color-" + (i % 4)}>
                        {p.name[0]}
                      </span>
                      <Badge>PROOF {p.proof_level} / 6</Badge>
                    </div>
                    <h2>{p.name}</h2>
                    <a
                      href={"https://" + p.domain}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.domain}
                      <ExternalLink size={13} />
                    </a>
                    <div className="product-facts">
                      <span>
                        目标客户
                        <strong>{p.target_customer || "UNKNOWN"}</strong>
                      </span>
                      <span>
                        变现方式<strong>{p.monetization}</strong>
                      </span>
                      <span>
                        收入信号
                        <strong>
                          {p.revenue_count
                            ? `${p.revenue_count} 条`
                            : "尚未验证"}
                        </strong>
                      </span>
                    </div>
                    <div className="product-source-title">
                      原始来源 · {p.documents.length}
                    </div>
                    {p.documents.map((d: any) => (
                      <button
                        key={d.id}
                        className="source-link"
                        onClick={() => setSelected(d.id)}
                      >
                        <FileText size={15} />
                        <span>{d.title || d.url}</span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </section>
                ))}
              </div>
              {!products.length && (
                <section className="panel">
                  <Empty
                    title="没有产品候选"
                    description="选择「导入来源 → 产品 / Winner」添加真实网页。"
                    action={
                      <button
                        className="button"
                        onClick={() => setImportOpen(true)}
                      >
                        导入第一个产品
                      </button>
                    }
                  />
                </section>
              )}
            </>
          )}
          {page === "Signals" && (
            <section className="panel">
              <div className="filter-bar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="搜索原始文档"
                    placeholder="搜索标题或原文中的关键词…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                  />
                </div>
                <select
                  aria-label="筛选来源"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="all">全部来源</option>
                  <option value="winner">Winner Radar</option>
                  <option value="reddit">Reddit</option>
                  <option value="manual">Manual URL</option>
                </select>
                <span className="muted">{total} 个快照</span>
              </div>
              <DocumentList docs={docs} select={setSelected} />
              <div className="pagination">
                <span>
                  显示 {total ? offset + 1 : 0}–{Math.min(offset + 50, total)} /{" "}
                  {total}
                </span>
                <button
                  className="icon-button"
                  disabled={!offset}
                  onClick={() => setOffset((n) => n - 50)}
                  aria-label="上一页"
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  className="icon-button"
                  disabled={offset + 50 >= total}
                  onClick={() => setOffset((n) => n + 50)}
                  aria-label="下一页"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </section>
          )}
          {["Problems", "Opportunities", "Graveyard"].includes(page) && (
            <section className="panel gate-panel">
              <Empty
                title={
                  page === "Problems"
                    ? "先确认痛点来自真实用户"
                    : page === "Opportunities"
                      ? "好的机会，需要先有证据"
                      : "保留失败，也保留教训"
                }
                description={
                  page === "Problems"
                    ? "问题聚类尚未启用。完成来源质量检查后，将按 JTBD、工作流与用户角色匹配，避免仅靠语义相似度合并。"
                    : page === "Opportunities"
                      ? "机会引擎尚未启用。主列表必须同时有产品 / 市场证据和需求 / 痛点证据，不能用 AI 想象补齐。"
                      : "决策归档尚未启用。未来被 KILL 的机会将保留原因、错误假设、投入与教训。"
                }
                action={
                  <button
                    className="button primary"
                    onClick={() => go("Signals")}
                  >
                    返回证据检查 <ArrowRight size={16} />
                  </button>
                }
              />
              <div className="gate-bottom">
                <Badge tone="amber">QUALITY GATE</Badge>
                <span>本次交付输入层；不以占位内容冒充研究结果。</span>
              </div>
            </section>
          )}
          {page === "Settings" && (
            <Settings summary={summary} revision={revision} notice={notice} />
          )}
          <footer>
            <span>
              VENTURE RADAR <b>·</b> Evidence-driven venture intelligence
            </span>
            <span>Local workspace / Foundation v0.1</span>
          </footer>
        </main>
      </div>
      {importOpen && (
        <ImportDialog close={() => setImportOpen(false)} notice={notice} />
      )}
      {selected && (
        <EvidenceDrawer
          id={selected}
          close={() => setSelected(null)}
          select={setSelected}
          notice={notice}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
