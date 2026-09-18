import { readRedditPage, advanceRedditPage } from "./extractor.js";
const API = "http://127.0.0.1:4317/api/reddit-browser/";
let busy = false,
  timer;
async function call(path, body = {}) {
  const { token } = await chrome.storage.local.get("token");
  const r = await fetch(API + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await r.json();
  if (!r.ok)
    throw Object.assign(Error(result.error || "连接失败"), {
      status: r.status,
    });
  return result;
}
async function status(message) {
  await chrome.storage.local.set({ message });
}
const lease = (s) => ({ jobId: s.job.id, lease: s.job.lock_token });
async function pause(s, reason) {
  await call("pause", { ...lease(s), reason });
  await chrome.storage.local.set({
    enabled: false,
    work: null,
    message: `已暂停：${reason}。请在采集标签页完成登录或验证，然后点击继续。`,
  });
}
async function discardOwnedWork() {
  const { work } = await chrome.storage.local.get("work");
  if (work?.tabId) {
    try {
      await chrome.tabs.remove(work.tabId);
    } catch {
      /* Already closed. */
    }
  }
  await chrome.storage.local.set({ work: null });
}
async function inject(id, func, args) {
  const result = await chrome.scripting.executeScript({
    target: { tabId: id },
    func,
    args: [args],
  });
  return result[0]?.result;
}
async function step() {
  if (busy) return;
  busy = true;
  try {
    const { enabled, work } = await chrome.storage.local.get([
      "enabled",
      "work",
    ]);
    if (!enabled) return;
    if (!work) {
      await call("heartbeat", {});
      const { job } = await call("claim");
      if (!job) {
        await status("已连接，等待采集任务。");
        return;
      }
      if (
        !["SaaS", "smallbusiness", "Entrepreneur", "SideProject"].includes(
          job.payload.subreddit,
        )
      )
        throw Error("未知社区");
      const startUrl = new URL(
        `https://www.reddit.com/r/${job.payload.subreddit}/new/`,
      );
      if (job.payload.searchQuery) {
        startUrl.pathname = `/r/${job.payload.subreddit}/search/`;
        startUrl.search = new URLSearchParams({
          q: job.payload.searchQuery,
          restrict_sr: "1",
          sort: "relevance",
          t: "year",
        }).toString();
      }
      const tab = await chrome.tabs.create({
        url: startUrl.href,
        active: false,
      });
      await chrome.storage.local.set({
        work: {
          job,
          tabId: tab.id,
          phase: "list",
          links: [],
          round: 0,
          index: 0,
          retries: 0,
          warnings: [],
        },
      });
      await status(`正在采集 r/${job.payload.subreddit}`);
      return;
    }
    const s = work;
    await call("heartbeat", lease(s));
    let tab;
    try {
      tab = await chrome.tabs.get(s.tabId);
    } catch {
      await pause(s, "browser_closed");
      return;
    }
    if (tab.status !== "complete") return;
    if (
      !tab.url?.startsWith(
        "https://www.reddit.com/r/" + s.job.payload.subreddit + "/",
      )
    ) {
      await pause(s, "login_required");
      return;
    }
    const read = await inject(s.tabId, readRedditPage, {
      subreddit: s.job.payload.subreddit,
    });
    if (["challenge", "login_required"].includes(read?.state)) {
      await pause(s, read.state);
      return;
    }
    if (!read || read.state === "loading") {
      s.retries++;
      if (s.retries >= 4) {
        await pause(s, "page_changed");
        return;
      }
      await chrome.storage.local.set({ work: s });
      return;
    }
    s.retries = 0;
    if (s.phase === "list") {
      s.links = [...new Set([...s.links, ...read.links])].slice(0, 6);
      if (s.links.length < 6 && s.round < 3) {
        s.round++;
        await inject(s.tabId, advanceRedditPage, { mode: "list" });
      } else {
        s.phase = "thread";
        if (s.links.length)
          await chrome.tabs.update(s.tabId, { url: s.links[0] });
      }
    } else if (s.index < s.links.length) {
      if (!s.expanded && read.state === "ready") {
        await inject(s.tabId, advanceRedditPage, { mode: "thread" });
        s.expanded = true;
        await chrome.storage.local.set({ work: s });
        return;
      }
      if (read.snapshot)
        await call("snapshot", { ...lease(s), snapshot: read.snapshot });
      else s.warnings.push("部分帖子没有可读取正文，已跳过");
      s.index++;
      s.expanded = false;
      if (s.index < s.links.length)
        await chrome.tabs.update(s.tabId, { url: s.links[s.index] });
    }
    if (s.phase === "thread" && s.index >= s.links.length) {
      await call("complete", {
        ...lease(s),
        warnings: s.links.length
          ? s.warnings
          : ["列表没有发现可读取的文字帖子"],
      });
      await chrome.tabs.remove(s.tabId);
      await chrome.storage.local.set({ work: null });
      await status(
        `r/${s.job.payload.subreddit} 已完成 ${s.index} 个帖子读取尝试。`,
      );
    } else await chrome.storage.local.set({ work: s });
  } catch (e) {
    if (e.status === 401) {
      await discardOwnedWork();
      await chrome.storage.local.set({ enabled: false });
      await status("连接码失效，请重新配对。");
    } else if (e.status === 409) {
      await discardOwnedWork();
      await status("任务租约已过期，将重新领取。");
    } else await status("连接暂时中断，将自动重试。" + e.message);
  } finally {
    busy = false;
    clearTimeout(timer);
    const { enabled, work } = await chrome.storage.local.get([
      "enabled",
      "work",
    ]);
    if (enabled) timer = setTimeout(step, work ? 5000 : 15000);
  }
}
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "radar-poll") void step();
});
chrome.runtime.onStartup.addListener(() => {
  // Tab IDs are not durable across a browser restart; never reuse an old ID.
  void chrome.storage.local
    .remove("work")
    .then(() => chrome.alarms.create("radar-poll", { periodInMinutes: 0.5 }));
});
chrome.runtime.onInstalled.addListener(
  () => void chrome.alarms.create("radar-poll", { periodInMinutes: 0.5 }),
);
chrome.runtime.onMessage.addListener((m, _sender, send) => {
  if (m.type !== "start" && m.type !== "stop") return;
  (async () => {
    if (m.type === "start") {
      if (!/^[a-f0-9]{64}$/.test(m.token))
        throw Error("请填写设置页生成的连接码");
      await chrome.storage.local.set({ token: m.token });
      await call("heartbeat", { ready: true });
      await chrome.storage.local.set({ enabled: true });
      await chrome.alarms.create("radar-poll", { periodInMinutes: 0.5 });
      void step();
    } else {
      await chrome.storage.local.set({ enabled: false });
      const { work } = await chrome.storage.local.get("work");
      if (work) await pause(work, "user_paused");
      else await call("heartbeat", { enabled: false });
      await status("已停止自动采集。");
    }
    send({ ok: true });
  })().catch((e) => send({ error: e.message }));
  return true;
});
