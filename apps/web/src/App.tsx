import {
  WorkspaceComparison,
  SourceCoverage,
} from "./components/workspace-comparison";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { api } from "./api";
import { DocumentList } from "./components/document-list";
import { EvidenceDrawer } from "./components/evidence-drawer";
import { ImportDialog } from "./components/import-dialog";
import { Settings } from "./components/settings";
import { WorkspaceDetail } from "./components/workspace-detail";
import {
  WorkspaceJobs,
  WorkspaceProducts,
} from "./components/workspace-products";
import {
  isKilled,
  Status,
  type Opportunity,
} from "./components/workspace-model";
import "./workspace.css";
const navigation = [
  { id: "opportunities", title: "机会工作台", icon: Compass },
  { id: "comparison", title: "机会比较", icon: Compass },
  { id: "products", title: "参考产品", icon: BookOpen },
  { id: "documents", title: "原文库", icon: FileText },
  { id: "settings", title: "创始人设置", icon: Settings2 },
];
export default function App() {
  const [page, setPage] = useState("opportunities"),
    [summary, setSummary] = useState<any>(null),
    [products, setProducts] = useState<any[]>([]),
    [opportunities, setOpportunities] = useState<Opportunity[]>([]),
    [jobs, setJobs] = useState<any[]>([]),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [importOpen, setImportOpen] = useState(false),
    [documentId, setDocumentId] = useState<string | null>(null),
    [opportunityId, setOpportunityId] = useState<string | null>(null),
    [filter, setFilter] = useState("drafts"),
    [query, setQuery] = useState("");
  const refresh = () => setRevision((n) => n + 1);
  const notice = (s: string) => {
    setToast(s);
    refresh();
  };
  const openOpportunity = (id: string) => {
    setPage("opportunities");
    setOpportunityId(id);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      api("/workspace"),
      api("/products"),
      api("/opportunities"),
      api("/jobs"),
    ])
      .then(([s, p, o, j]) => {
        if (active) {
          setSummary(s);
          setProducts(p.items);
          setOpportunities(o.items);
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
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const drafts = opportunities.filter(
      (o) => !isKilled(o) && !o.readiness?.ready,
    ),
    ready = opportunities.filter((o) => !isKilled(o) && o.readiness?.ready),
    killed = opportunities.filter(isKilled);
  const visible = (
    filter === "drafts" ? drafts : filter === "ready" ? ready : killed
  ).filter((o) =>
    (o.title + " " + (o.dossier?.customer || "") + " " + (o.dossier?.gap || ""))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="workspace">
      <aside className="ws-sidebar">
        <a
          href="#"
          className="ws-brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("opportunities");
            setOpportunityId(null);
          }}
        >
          <span>
            <Compass size={26} />
          </span>
          <div>
            机会雷达<small>INDEPENDENT FOUNDER</small>
          </div>
        </a>
        <div className="ws-nav-caption">你的研究工作台</div>
        <nav aria-label="主导航">
          {navigation.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setOpportunityId(null);
              }}
            >
              <Icon size={18} />
              {title}
              {id === "opportunities" && <span>{opportunities.length}</span>}
            </button>
          ))}
        </nav>
        <div className="ws-sidebar-bottom">
          <ShieldCheck size={20} />
          <strong>每个判断，回到证据</strong>
          <p>
            先找到值得验证的切口，
            <br />
            再决定把时间花在哪里。
          </p>
          <div>
            私人工作台 <span>独立开发者</span>
          </div>
        </div>
      </aside>
      <div className="ws-main">
        <header className="ws-topbar">
          <span>
            工作台 <ChevronRight size={13} />
            <strong>{navigation.find((n) => n.id === page)?.title}</strong>
          </span>
          <div className="ws-inline">
            <span className="ws-connection">
              {error ? "连接异常" : summary ? "数据已同步" : "正在连接…"}
            </span>
            <button
              className="icon-button"
              aria-label="刷新工作台"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </header>
        <main className="ws-content">
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={refresh}>重试</button>
            </div>
          )}
          {page === "opportunities" && opportunityId ? (
            <WorkspaceDetail
              key={opportunityId}
              id={opportunityId}
              products={products}
              revision={revision}
              back={() => setOpportunityId(null)}
              openDocument={setDocumentId}
              notice={notice}
            />
          ) : (
            <>
              <div className="ws-page-heading">
                <div>
                  <span className="ws-kicker">
                    {page === "opportunities"
                      ? "FROM EVIDENCE TO YOUR NEXT PRODUCT"
                      : "INDEPENDENT FOUNDER / RESEARCH WORKSPACE"}
                  </span>
                  <h1>
                    {page === "opportunities"
                      ? "找到值得你做的下一款产品"
                      : navigation.find((n) => n.id === page)?.title}
                  </h1>
                  <p>
                    {page === "opportunities"
                      ? "从真实产品出发，找到具体切口；用证据决定下一步。"
                      : page === "comparison"
                        ? "比较价值、可行性和个人匹配，决定下一步先验证什么。"
                        : page === "products"
                          ? "参考产品是研究起点。用户、任务和未被满足的需求，决定机会。"
                          : page === "documents"
                            ? "保留来源、完整上下文与中文阅读，所有声明都能追溯。"
                            : "让每次机会研究考虑你的时间、能力和可承受投入。"}
                  </p>
                </div>
                {page !== "settings" && (
                  <button
                    className="button primary"
                    onClick={() => setImportOpen(true)}
                  >
                    <Plus size={16} />
                    导入来源
                  </button>
                )}
              </div>
              {page === "opportunities" && (
                <>
                  <div className="ws-overview">
                    <div className="ws-overview-intro">
                      <span className="ws-kicker">研究 → 核对 → 验证</span>
                      <h2>
                        少一点猜测，
                        <br />
                        多一个可验证的机会。
                      </h2>
                      <p>草稿可以保留未知。候选需要市场与需求证据。</p>
                      <button
                        className="ws-text"
                        onClick={() => setPage("products")}
                      >
                        从参考产品开始 <ArrowRight size={15} />
                      </button>
                    </div>
                    {[
                      {
                        key: "drafts",
                        count: drafts.length,
                        title: "待补证草稿",
                        text: "研究假设，等待你核对",
                      },
                      {
                        key: "ready",
                        count: ready.length,
                        title: "候选机会",
                        text: "已有市场与需求证据",
                      },
                      {
                        key: "killed",
                        count: killed.length,
                        title: "已放弃",
                        text: "保留判断与决策理由",
                      },
                    ].map((s) => (
                      <button
                        key={s.key}
                        className={
                          "ws-stat " + (filter === s.key ? "active" : "")
                        }
                        onClick={() => setFilter(s.key)}
                      >
                        <strong>{summary ? s.count : "—"}</strong>
                        <span>{s.title}</span>
                        <small>{s.text}</small>
                      </button>
                    ))}
                  </div>
                  <div className="ws-list-toolbar">
                    <div
                      className="ws-tabs"
                      role="tablist"
                      aria-label="机会状态"
                    >
                      {[
                        ["drafts", "草稿", drafts.length],
                        ["ready", "候选", ready.length],
                        ["killed", "已放弃", killed.length],
                      ].map(([key, label, count]) => (
                        <button
                          key={key}
                          role="tab"
                          aria-selected={filter === key}
                          className={filter === key ? "active" : ""}
                          onClick={() => setFilter(String(key))}
                        >
                          {label}
                          <span>{count}</span>
                        </button>
                      ))}
                    </div>
                    <label className="ws-search">
                      <Search size={16} />
                      <input
                        aria-label="搜索机会"
                        placeholder="搜索机会或目标人群"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="ws-opportunity-list">
                    {visible.map((o) => (
                      <button
                        className="ws-opportunity-card"
                        key={o.id}
                        onClick={() => openOpportunity(o.id)}
                      >
                        <div className="ws-card-title">
                          <div className="ws-inline">
                            <Status opportunity={o} />
                            <span className="ws-muted">
                              {products.find((p) => p.id === o.product_id)
                                ?.name || "参考产品待关联"}
                            </span>
                          </div>
                          <ArrowRight size={18} />
                        </div>
                        <h2>{o.title}</h2>
                        <p>
                          {o.dossier?.gap ||
                            o.dossier?.offer ||
                            "具体切口尚未明确，打开档案完善机会假设。"}
                        </p>
                        <div className="ws-card-facts">
                          <span>
                            付费人群
                            <strong>
                              {o.dossier?.buyer ||
                                o.dossier?.customer ||
                                "未知"}
                            </strong>
                          </span>
                          <span>
                            最小方案
                            <strong>{o.dossier?.offer || "待补充"}</strong>
                          </span>
                          <span>
                            证据核对
                            <strong>
                              {o.claims?.filter(
                                (c) => c.review_status === "accepted",
                              ).length || 0}{" "}
                              已接受 / {o.claims?.length || 0} 条声明
                            </strong>
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  {!visible.length && (
                    <section className="ws-panel ws-empty">
                      <Compass size={32} />
                      <h2>
                        {!summary
                          ? "正在读取机会…"
                          : query
                            ? "没有匹配的机会"
                            : filter === "ready"
                              ? "还没有满足证据门槛的候选"
                              : filter === "killed"
                                ? "还没有被放弃的机会"
                                : "第一个机会，从一个真实产品开始"}
                      </h2>
                      <p>
                        {query
                          ? "试试其他关键词。"
                          : filter === "ready"
                            ? "打开草稿，核对市场或收入声明与需求声明。证据齐备后自动进入候选。"
                            : filter === "killed"
                              ? "在机会档案记录「放弃机会」，保留依据与教训。"
                              : "导入产品官网与用户讨论，发起研究，或手动记录你的具体切口。"}
                      </p>
                      {!query && (
                        <button
                          className="button"
                          onClick={() =>
                            filter === "ready"
                              ? setFilter("drafts")
                              : setPage("products")
                          }
                        >
                          {filter === "ready" ? "检查机会草稿" : "查看参考产品"}
                          <ArrowRight size={15} />
                        </button>
                      )}
                    </section>
                  )}
                  <WorkspaceJobs
                    jobs={jobs}
                    products={products}
                    notice={notice}
                  />
                </>
              )}
              {page === "comparison" && (
                <WorkspaceComparison
                  revision={revision}
                  jobs={jobs}
                  opportunities={opportunities}
                  summary={summary}
                  notice={notice}
                  openOpportunity={openOpportunity}
                />
              )}
              {page === "products" && (
                <>
                  <SourceCoverage summary={summary} />
                  <WorkspaceProducts
                    products={products}
                    jobs={jobs}
                    configured={!!summary?.researchConfigured}
                    openDocument={setDocumentId}
                    openOpportunity={openOpportunity}
                    notice={notice}
                    importSource={() => setImportOpen(true)}
                  />
                  <WorkspaceJobs
                    jobs={jobs}
                    products={products}
                    notice={notice}
                  />
                </>
              )}
              {page === "documents" && (
                <Documents revision={revision} openDocument={setDocumentId} />
              )}
              {page === "settings" && (
                <Settings
                  summary={summary}
                  revision={revision}
                  notice={notice}
                />
              )}
            </>
          )}
          <footer className="ws-footer">
            <span>机会雷达 · 为独立开发者保留证据与判断</span>
            <span>假设保持可见，决策可以追溯</span>
          </footer>
        </main>
      </div>
      {importOpen && (
        <ImportDialog close={() => setImportOpen(false)} notice={notice} />
      )}
      {documentId && (
        <EvidenceDrawer
          id={documentId}
          close={() => setDocumentId(null)}
          select={setDocumentId}
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
function Documents({
  revision,
  openDocument,
}: {
  revision: number;
  openDocument: (id: string) => void;
}) {
  const [docs, setDocs] = useState<any[]>([]),
    [search, setSearch] = useState(""),
    [source, setSource] = useState("all"),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
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
              setError("");
            }
          })
          .catch((e) => active && setError(e.message)),
      180,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [revision, search, source, offset]);
  return (
    <section className="ws-panel ws-documents">
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="ws-list-toolbar">
        <label className="ws-search">
          <Search size={16} />
          <input
            aria-label="搜索原始文档"
            placeholder="搜索标题或正文关键词"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <select
          aria-label="筛选原文来源"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setOffset(0);
          }}
        >
          <option value="all">全部来源</option>
          <option value="winner">产品官网</option>
          <option value="reddit">Reddit 讨论</option>
          <option value="hn">Hacker News</option>
          <option value="manual">手动网页</option>
        </select>
        <span className="ws-muted">{total} 个原文条目</span>
      </div>
      <DocumentList docs={docs} select={openDocument} />
      <div className="pagination">
        <span>
          {total ? offset + 1 : 0}–{Math.min(offset + 50, total)} / {total}
        </span>
        <button
          className="icon-button"
          aria-label="上一页"
          disabled={!offset}
          onClick={() => setOffset(offset - 50)}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="下一页"
          disabled={offset + 50 >= total}
          onClick={() => setOffset(offset + 50)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </section>
  );
}
