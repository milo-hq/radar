import { ArrowUpRight, FileText, Radio } from "lucide-react";
import { when } from "../api";
import { Badge, Empty } from "./primitives";
export function DocumentList({
  docs,
  select,
}: {
  docs: any[];
  select: (id: string) => void;
}) {
  return docs.length ? (
    <div className="document-list">
      {docs.map((d) => (
        <button
          className="document-row"
          key={d.id}
          onClick={() => select(d.id)}
        >
          <span className={"source-icon " + d.source_id}>
            {d.source_id === "reddit" ? (
              <Radio size={19} />
            ) : (
              <FileText size={19} />
            )}
          </span>
          <span className="document-content">
            <span className="row gap wrap">
              <Badge tone={d.source_id === "reddit" ? "orange" : "neutral"}>
                {d.source_id === "reddit"
                  ? "r/" + (d.subreddit || "reddit")
                  : d.source_id === "winner"
                    ? "WINNER"
                    : (
                        {
                          hn: "Hacker News",
                          github: "GitHub Issues",
                          stackoverflow: "Stack Overflow",
                        } as Record<string, string>
                      )[d.source_id] || "MANUAL"}
              </Badge>
              <small>{d.type.toUpperCase()}</small>
              {d.title_zh && <Badge tone="green">AI 中文</Badge>}
              {d.review_status === "accepted" && (
                <Badge tone="green">已接受</Badge>
              )}
              {d.review_status === "rejected" && (
                <Badge tone="amber">已排除</Badge>
              )}
            </span>
            <strong>{d.title_zh || d.title || d.excerpt?.slice(0, 100)}</strong>
            <span className="excerpt">{d.excerpt_zh || d.excerpt}</span>
            <small>
              {new URL(d.canonical_url).hostname} <b>·</b> 采集于{" "}
              {when(d.collected_at)}
            </small>
          </span>
          <ArrowUpRight size={17} />
        </button>
      ))}
    </div>
  ) : (
    <Empty
      title="还没有匹配的市场原文"
      description="导入真实来源，或调整关键词与来源筛选。原文会在采集成功后出现在这里。"
    />
  );
}
