import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { Badge } from "./primitives";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useEffect, useState } from "react";
import { api, when } from "../api";
const channels = {
  hn: "Hacker News",
  github: "GitHub Issues",
  stackoverflow: "Stack Overflow",
};
export function WorkspaceDiscovery({
  revision,
  notice,
  openDocument,
}: {
  revision: number;
  notice: (s: string) => void;
  openDocument: (id: string) => void;
}) {
  const [query, setQuery] = useState("invoice"),
    [sources, setSources] = useState<string[]>(Object.keys(channels)),
    [jobs, setJobs] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [docs, setDocs] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api("/discovery")
      .then((r) => alive && setJobs(r.items))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [revision]);
  useEffect(() => {
    let alive = true;
    setDocs([]);
    if (selected)
      api(`/discovery/${selected}/documents`)
        .then((r) => alive && setDocs(r.items))
        .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [selected, revision]);
  const [jobSearch, setJobSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const statusLabels: Record<string, string> = {
    pending: "等待执行",
    running: "采集中",
    succeeded: "完成",
    failed: "失败",
  };
  const filteredJobs = jobs.filter((job) =>
    [
      job.payload?.query,
      channels[job.payload?.source as keyof typeof channels],
      statusLabels[job.status],
      job.last_error,
    ]
      .join(" ")
      .toLocaleLowerCase()
      .includes(jobSearch.trim().toLocaleLowerCase()),
  );
  const filteredDocs = docs.filter((doc) =>
    [doc.title, doc.excerpt, doc.author_name, doc.metadata?.repositoryName]
      .join(" ")
      .toLocaleLowerCase()
      .includes(documentSearch.trim().toLocaleLowerCase()),
  );
  async function addProduct(document: any) {
    setBusy(true);
    try {
      const product = await api("/products", {
        name: document.metadata.repositoryName,
        url: document.metadata.repositoryUrl,
      });
      await api(`/products/${product.id}/documents`, {
        documentId: document.id,
      });
      notice("参考项目已加入，材料已关联；可前往参考产品研究");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const jobColumns: ColumnDef<any>[] = [
    {
      accessorFn: (job) => job.payload?.query || "",
      id: "query",
      header: "搜索主题",
      cell: ({ row }) => (
        <Button
          variant="link"
          className="h-auto p-0 text-left"
          aria-pressed={selected === row.original.id}
          onClick={() => {
            setSelected(row.original.id);
            setDocumentSearch("");
          }}
        >
          {row.original.payload?.query || "未命名主题"}
          {selected === row.original.id ? " · 当前查看" : ""}
        </Button>
      ),
    },
    {
      accessorFn: (job) =>
        channels[job.payload?.source as keyof typeof channels] ||
        job.payload?.source,
      id: "source",
      header: "渠道",
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => (
        <Badge
          tone={
            row.original.status === "succeeded"
              ? "green"
              : row.original.status === "failed"
                ? "amber"
                : "neutral"
          }
        >
          {statusLabels[row.original.status] || row.original.status}
        </Badge>
      ),
    },
    {
      id: "result",
      header: "采集结果",
      cell: ({ row }) => (
        <div className="max-w-md whitespace-normal text-xs">
          {row.original.status === "succeeded"
            ? `匹配 ${row.original.payload?.matchedCount ?? "未知"} 条 · 新增 ${row.original.payload?.savedCount ?? "未知"} 条`
            : "—"}
          {row.original.last_error && (
            <p className="mt-1 text-destructive">{row.original.last_error}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "created_at",
      header: "创建时间",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {when(row.original.created_at)}
        </span>
      ),
    },
  ];
  const documentColumns: ColumnDef<any>[] = [
    {
      accessorKey: "title",
      header: "主题材料",
      cell: ({ row }) => (
        <div className="min-w-56 max-w-xl whitespace-normal">
          <Button
            variant="link"
            className="h-auto justify-start whitespace-normal p-0 text-left text-foreground"
            onClick={() => openDocument(row.original.id)}
          >
            {row.original.title || "原始讨论"}
          </Button>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {row.original.excerpt}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "author_name",
      header: "作者 / 发布时间",
      cell: ({ row }) => (
        <div className="text-xs">
          <span>{row.original.author_name || "作者未知"}</span>
          <p className="mt-1 text-muted-foreground">
            {when(row.original.published_at)}
          </p>
        </div>
      ),
    },
    {
      id: "context",
      header: "来源说明",
      cell: ({ row }) => {
        const metadata = row.original.metadata || {};
        return (
          <div className="min-w-44 max-w-sm whitespace-normal text-xs text-muted-foreground">
            {metadata.license && <span>{metadata.license} · </span>}
            {metadata.contextNote}
            {metadata.isAnswered ? " · 平台标记已有回答" : ""}
            {metadata.state === "closed"
              ? " · Issue已关闭，需核对解决方式"
              : metadata.state === "open"
                ? " · Issue仍开放"
                : ""}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a
              href={row.original.canonical_url}
              target="_blank"
              rel="noreferrer"
            >
              打开来源 ↗
            </a>
          </Button>
          {row.original.metadata?.repositoryUrl && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void addProduct(row.original)}
            >
              加入参考产品
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <section className="ws-panel">
        <h2>从需求主题出发，跨产品搜索</h2>
        <p className="ws-muted">
          检索最近两年的公开讨论，每渠道每次最多30条。GitHub匹配标题并优先显示讨论较多的问题。结果是待筛选材料；Issue、问题或评论不等于付费需求，也可能已有解决方案。
        </p>
        <form
          className="ws-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/discovery", { query, sources });
              notice("主题搜索已排队，结果按渠道分别显示");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            主题 / 搜索词
            <Input
              required
              minLength={2}
              maxLength={150}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如 invoice、email automation、data export"
            />
          </label>
          <div className="ws-inline">
            {Object.entries(channels).map(([key, name]) => (
              <label className="ws-channel" key={key}>
                <Checkbox
                  checked={sources.includes(key)}
                  onCheckedChange={(checked) =>
                    setSources(
                      checked === true
                        ? [...sources, key]
                        : sources.filter((s) => s !== key),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </div>
          <p className="ws-muted">公开英文渠道建议使用英文关键词。示例主题：</p>
          <div className="ws-inline">
            {["invoice", "email automation", "data export"].map((q) => (
              <Button
                variant="outline"
                type="button"
                size="sm"
                key={q}
                onClick={() => setQuery(q)}
              >
                {q}
              </Button>
            ))}
          </div>
          <Button size="sm" disabled={busy || !sources.length}>
            {busy ? "提交中…" : "搜索新主题"}
          </Button>
        </form>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="space-y-5">
        <section className="ws-panel">
          <h2>采集记录</h2>
          <p className="ws-muted">
            新来源数按平台原文ID去重。渠道限流时按要求延后；失败原因保留。
          </p>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Input
              className="max-w-sm"
              aria-label="筛选已加载采集记录"
              placeholder="筛选主题、渠道或状态…"
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              已加载 {jobs.length} 条采集记录
            </span>
          </div>
          {!jobs.length && (
            <p className="mb-3 text-sm text-muted-foreground">尚未搜索主题。</p>
          )}
          <DataTable
            data={filteredJobs}
            columns={jobColumns}
            label="已加载采集记录"
          />
        </section>
        <section className="ws-panel">
          <h2>主题材料 {selected ? `· 已加载 ${docs.length} 条` : ""}</h2>
          <p className="ws-muted">
            先核对原文；发现真实产品后可加入参考产品，再关联更多官网、定价和用户材料做研究。
          </p>
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              选择上方采集记录查看结果。
            </p>
          ) : (
            <>
              <Input
                className="mb-3 max-w-sm"
                aria-label="筛选已加载主题材料"
                placeholder="筛选材料、作者或项目…"
                value={documentSearch}
                onChange={(e) => setDocumentSearch(e.target.value)}
              />
              {!docs.length && (
                <p className="mb-3 text-sm text-muted-foreground">
                  该记录尚无材料。请查看采集状态和错误；空结果不会补造数据。
                </p>
              )}
              <DataTable
                key={selected}
                data={filteredDocs}
                columns={documentColumns}
                label="已加载主题材料"
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}
