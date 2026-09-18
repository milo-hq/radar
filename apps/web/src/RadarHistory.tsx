import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";

type Entry = {
  id: string;
  status: string;
  kind: string;
  created_at: string;
  opportunity_count: number | null;
  coverage: { collected?: number } | null;
};
type HistoryPage = { items: Entry[]; hasMore: boolean; total: number };
export const scanKindLabels: Record<string, string> = {
  full: "全渠道发现",
  x: "X 专项",
  reddit: "Reddit 专项",
  reanalysis: "历史重分析",
};
const labels: Record<string, string> = {
  planning: "规划中",
  collecting: "采集中",
  analyzing: "分析中",
  reporting: "生成报告",
  complete: "已完成",
  failed: "失败",
};
export function RadarHistory({
  revision,
  selectedId,
  latestId,
  onSelect,
}: {
  revision: number;
  selectedId: string | null;
  latestId?: string;
  onSelect: (id: string | null) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(10);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [order, setOrder] = useState("desc");
  const [data, setData] = useState<HistoryPage | null>(null);
  const loadedQuery = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
      q: search,
      status,
      order,
    });
    const queryKey = params.toString();
    const hasCurrentPage = loadedQuery.current === queryKey;
    setLoading(!hasCurrentPage);
    if (!hasCurrentPage) {
      loadedQuery.current = null;
      setData(null);
    }
    setError("");
    api<HistoryPage>(`/radar/history?${params}`)
      .then((value) => {
        if (!alive) return;
        if (offset > 0 && offset >= value.total) {
          setOffset(Math.max(0, Math.ceil(value.total / limit) - 1) * limit);
          return;
        }
        loadedQuery.current = queryKey;
        setData(value);
      })
      .catch(() => {
        if (alive) setError("历史记录暂时无法读取，请重试。");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [revision, offset, limit, search, status, order, retry]);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  return (
    <section className="space-y-4" aria-label="发现历史">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">发现历史</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            全渠道、单来源专项和历史重分析分别标注，结果数量不可直接比较。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onSelect(null)}>
          查看最新全渠道
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full sm:w-72"
          type="search"
          aria-label="搜索发现历史"
          placeholder="搜索编号、报告标题或摘要"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36" aria-label="按状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(labels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={order}
          onValueChange={(value) => {
            setOrder(value);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-36" aria-label="时间排序">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">最新在前</SelectItem>
            <SelectItem value="asc">最早在前</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error && data && (
        <div className="flex items-center gap-2 text-sm" role="alert">
          <span className="text-destructive">
            刷新失败，当前显示上次读取的记录。
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            重试
          </Button>
        </div>
      )}
      <div
        className="admin-table-panel overflow-hidden rounded-md border"
        aria-busy={loading}
      >
        <Table aria-label="发现历史列表">
          <TableHeader>
            <TableRow>
              <TableHead>发现时间</TableHead>
              <TableHead>范围</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">机会数</TableHead>
              <TableHead className="text-right">采集篇数</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 text-center text-muted-foreground"
                  role="status"
                >
                  正在读取历史…
                </TableCell>
              </TableRow>
            ) : error && !data ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center">
                  <span role="alert" className="text-destructive">
                    {error}
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setRetry((n) => n + 1)}
                  >
                    重试
                  </Button>
                </TableCell>
              </TableRow>
            ) : !data?.items.length ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-28 text-center text-muted-foreground"
                >
                  {search || status !== "all"
                    ? "没有符合条件的发现记录。"
                    : "尚无发现记录，开始第一轮后会自动保留。"}
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((item) => {
                const selected = (selectedId ?? latestId) === item.id;
                return (
                  <TableRow
                    key={item.id}
                    data-state={selected ? "selected" : undefined}
                  >
                    <TableCell className="font-medium">
                      <time dateTime={item.created_at}>
                        {new Date(item.created_at).toLocaleString("zh-CN", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </TableCell>
                    <TableCell>
                      {scanKindLabels[item.kind] ?? "未知范围"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.status === "failed"
                            ? "destructive"
                            : item.status === "complete"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {labels[item.status] ?? item.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.opportunity_count ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.coverage?.collected ??
                        (item.status === "collecting" ? "统计中" : "—")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={selected}
                        onClick={() => onSelect(item.id)}
                      >
                        {selected ? "正在查看" : "查看结果"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground" aria-live="polite">
          {loading
            ? "正在更新…"
            : error && !data
              ? "暂时无法统计记录"
              : `共 ${data?.total ?? 0} 条记录`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={String(limit)}
            onValueChange={(value) => {
              setLimit(Number(value));
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-28" aria-label="每页条数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} 条 / 页
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="min-w-24 text-center tabular-nums">
            第 {page} / {pages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || (!data && !!error) || offset === 0}
            onClick={() => setOffset((n) => Math.max(0, n - limit))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || (!data && !!error) || !data?.hasMore}
            onClick={() => setOffset((n) => n + limit)}
          >
            下一页
          </Button>
        </div>
      </div>
    </section>
  );
}
