import { useEffect, useState } from "react";
import { api, when } from "../api";
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
const states: Record<string, string> = {
  pending: "等待浏览器",
  running: "正在采集",
  succeeded: "完成",
  failed: "失败",
};
const reasons: Record<string, string> = {
  login_required: "需要登录 Reddit",
  challenge: "需要在浏览器完成验证",
  page_changed: "页面结构未识别",
  browser_closed: "采集标签页被关闭",
  user_paused: "已手动暂停",
};
export function RedditBrowserSettings({
  revision,
  notice,
}: {
  revision: number;
  notice: (message: string) => void;
}) {
  const [data, setData] = useState<any>(null),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api("/reddit-browser")
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/reddit-browser/" + action, {});
      if (action === "pair") setToken(result.token);
      if (action === "disconnect") setToken("");
      setData(await api("/reddit-browser"));
      notice(
        action === "start"
          ? "Reddit 采集已排队，完成后自动分析"
          : action === "pair"
            ? "连接码已生成，请在扩展中粘贴"
            : "连接已断开",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = data?.connection;
  const online = c?.enabled && c?.online && !c?.pause_reason;
  return (
    <section className="panel connection-panel min-w-0">
      <h2>Reddit 浏览器采集</h2>
      <p className="muted">
        {c?.pause_reason
          ? reasons[c.pause_reason] || c.pause_reason
          : online
            ? "在线 · 自动发现会包含 Reddit"
            : c?.paired
              ? "已配对 · 等待扩展连接"
              : "尚未连接"}
        {c?.last_seen_at ? ` · 最近连接 ${when(c.last_seen_at)}` : ""}
      </p>
      <p className="text-sm leading-6">
        默认浏览{" "}
        {data?.communities?.map((s: string) => `r/${s}`).join("、") ||
          "4 个相关社区"}
        ，无需填写主题。每社区最多 6 帖，每帖最多 30
        条可见评论；部分内容会标注上下文不完整。
      </p>
      <details className="my-3 text-sm">
        <summary className="cursor-pointer">首次安装与连接</summary>
        <ol className="list-decimal pl-5 space-y-2 mt-3">
          <li>
            在 Chrome
            扩展管理页启用开发者模式，选择“加载已解压的扩展程序”，打开项目内{" "}
            <code>extensions/reddit-reader</code> 文件夹。
          </li>
          <li>
            在同一 Chrome 中登录
            Reddit。下方生成连接码，粘贴到扩展弹窗，再点“连接 / 继续”。
          </li>
          <li>
            保持 Chrome
            开启。扩展使用自己的标签页读取公开帖子，只把内容发送到本机
            Radar，不读取 Cookie 或私信。遇到验证后，在该标签页处理并点击继续。
          </li>
        </ol>
      </details>
      <div className="flex flex-wrap gap-2 my-3">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => act("pair")}
        >
          {c?.paired ? "重新生成连接码" : "生成连接码"}
        </Button>
        <Button
          size="sm"
          disabled={busy || !online}
          onClick={() => act("start")}
        >
          采集 Reddit 并分析
        </Button>
        {c?.paired && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => act("disconnect")}
          >
            断开连接
          </Button>
        )}
      </div>
      {token && (
        <div className="flex gap-2 mb-3">
          <Input
            aria-label="浏览器连接码"
            type="password"
            readOnly
            value={token}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(token)
                .then(() => notice("已复制连接码"))
                .catch(() => setError("复制失败，请选择连接码手动复制"))
            }
          >
            复制
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!!data?.jobs?.length && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>社区 / 时间</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>已入库</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.jobs.map((j: any) => (
              <TableRow key={j.id}>
                <TableCell>
                  <div>r/{j.payload.subreddit}</div>
                  <small>{when(j.created_at)}</small>
                </TableCell>
                <TableCell>
                  <div>{states[j.status] || j.status}</div>
                  {j.last_error && (
                    <small className="block max-w-48 whitespace-normal break-words">
                      {j.last_error}
                    </small>
                  )}
                </TableCell>
                <TableCell>{j.payload.matchedCount ?? 0} 条</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
