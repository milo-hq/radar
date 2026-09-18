import { useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { when } from "../api";
import { Badge, Empty } from "./primitives";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const sources: Record<string, string> = {
  hn: "Hacker News",
  github: "GitHub Issues",
  stackoverflow: "Stack Overflow",
  appstore: "App Store 用户评论",
  x: "X (Twitter)",
  wordpress: "WordPress 插件评价",
  web: "公开网站",
  winner: "WINNER",
};
function host(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || "来源未知";
  }
}
export function DocumentList({
  docs,
  select,
}: {
  docs: any[];
  select: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = search.trim().toLocaleLowerCase();
  const filtered = docs.filter(
    (doc) =>
      !query ||
      [doc.title, doc.title_zh, doc.excerpt, doc.excerpt_zh, doc.canonical_url]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const current = Math.min(page, pages - 1);
  if (!docs.length)
    return (
      <Empty
        title="还没有匹配的市场原文"
        description="导入真实来源，或调整关键词与来源筛选。原文会在采集成功后出现在这里。"
      />
    );
  return (
    <section className="space-y-3" aria-label="市场原文列表">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            aria-label="筛选已加载原文"
            placeholder="筛选已加载原文…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          已加载 {docs.length} 条 · 匹配 {filtered.length} 条
        </span>
      </div>
      <div className="overflow-hidden rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>原文</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>检查状态</TableHead>
              <TableHead>采集时间</TableHead>
              <TableHead>
                <span className="sr-only">查看</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(current * 15, (current + 1) * 15).map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="min-w-64 max-w-xl whitespace-normal">
                  <Button
                    variant="link"
                    style={{ padding: 0, border: 0, width: "auto" }}
                    className="document-row h-auto max-w-full justify-start whitespace-normal p-0 text-left font-medium text-foreground"
                    onClick={() => select(doc.id)}
                  >
                    {doc.title_zh ||
                      doc.title ||
                      doc.excerpt?.slice(0, 100) ||
                      "无标题原文"}
                  </Button>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {doc.excerpt_zh || doc.excerpt}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge>
                    {doc.source_id === "reddit"
                      ? "r/" + (doc.subreddit || "reddit")
                      : sources[doc.source_id] || "MANUAL"}
                  </Badge>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {host(doc.canonical_url)}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge
                      tone={
                        doc.review_status === "accepted"
                          ? "green"
                          : doc.review_status === "rejected"
                            ? "amber"
                            : "neutral"
                      }
                    >
                      {doc.review_status === "accepted"
                        ? "已接受"
                        : doc.review_status === "rejected"
                          ? "已排除"
                          : "待检查"}
                    </Badge>
                    {doc.title_zh && <Badge tone="green">AI 中文</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {when(doc.collected_at)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      "查看原文：" + (doc.title_zh || doc.title || "无标题")
                    }
                    onClick={() => select(doc.id)}
                  >
                    <ArrowUpRight size={16} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-28 text-center text-muted-foreground"
                >
                  已加载原文中没有匹配记录。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          第 {current + 1} / {pages} 页 · 每页 15 条已加载原文
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </section>
  );
}
