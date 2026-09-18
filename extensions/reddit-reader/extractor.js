// Self-contained function: Chrome injects its source into an isolated page world.
export function readRedditPage({ subreddit }) {
  const visible = (e) =>
    !!e &&
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== "hidden";
  const text = (e) =>
    visible(e) ? e.innerText?.trim().slice(0, 40000) || "" : "";
  const pageText = document.body?.innerText || "";
  if (
    /prove your humanity|blocked by network security|verify you are human/i.test(
      pageText,
    ) &&
    !document.querySelector("shreddit-post")
  )
    return { state: "challenge" };
  const loggedIn = !!document.querySelector(
    'shreddit-post[user-logged-in], [id="user-drawer-avatar-logged-in"], #notifications-inbox-button',
  );
  if (!loggedIn)
    return {
      state: /log in|登录|login/i.test(pageText) ? "login_required" : "loading",
    };
  const posts = Array.from(document.querySelectorAll("shreddit-post")).filter(
    (p) =>
      !p.hasAttribute("is-ad") &&
      p.getAttribute("subreddit-name")?.toLowerCase() ===
        subreddit.toLowerCase(),
  );
  let links = posts
    .filter(
      (p) =>
        p.getAttribute("post-type") !== "image" &&
        p.getAttribute("post-type") !== "video",
    )
    .map((p) => {
      const href = p.getAttribute("permalink");
      if (!href) return null;
      const u = new URL(href, location.origin);
      return u.origin === "https://www.reddit.com" &&
        new RegExp("^/r/" + subreddit + "/comments/[a-z0-9]+/", "i").test(
          u.pathname,
        )
        ? u.href
        : null;
    })
    .filter(Boolean);
  const path = location.pathname.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
  if (!path) {
    // Reddit search renders link cards rather than shreddit-post elements.
    if (location.pathname.endsWith("/search/")) {
      // A title heuristic chooses what to read first; it is not demand evidence.
      const score = (a) => {
        const title = a.innerText || "";
        const pain =
          /alternative|too expensive|missing|wish|frustrat|manual|looking for|does anyone|feature request|替代|太贵|缺少/i.test(
            title,
          )
            ? 2
            : 0;
        const promotion =
          /(?:i|we) (?:built|launched|made)|mrr|sign up|boring industries|我做了|上线/i.test(
            title,
          )
            ? 3
            : 0;
        return pain - promotion;
      };
      const candidates = Array.from(document.querySelectorAll("a[href]"))
        .filter(visible)
        .sort((a, b) => score(b) - score(a))
        .map((a) => {
          try {
            const u = new URL(a.getAttribute("href"), location.origin);
            if (
              u.origin !== "https://www.reddit.com" ||
              !new RegExp(
                "^/r/" + subreddit + "/comments/[a-z0-9]+/",
                "i",
              ).test(u.pathname)
            )
              return null;
            return u.origin + u.pathname;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      links = [...new Set([...links, ...candidates])];
    }
    return { state: "ready", links };
  }
  const post = posts.find((p) => p.id === "t3_" + path[2]);
  if (!post) return { state: "loading", links };
  const body = text(document.getElementById(post.id + "-post-rtjson-content"));
  if (!body || ["[removed]", "[deleted]"].includes(body))
    return { state: "empty", links };
  const date = (v) =>
    v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;
  const comments = Array.from(
    document.querySelectorAll("shreddit-comment[thingid]"),
  )
    .filter(
      (c) =>
        !c.hasAttribute("collapsed") &&
        c.getAttribute("aria-hidden") !== "true",
    )
    .map((c) => {
      const id = c.getAttribute("thingid"),
        parent = c.parentElement?.closest("shreddit-comment");
      return {
        id,
        body: text(document.getElementById(id + "-post-rtjson-content")),
        author: c.getAttribute("author") || undefined,
        parentId:
          parent?.getAttribute("thingid") ||
          (c.getAttribute("depth") === "0" ? post.id : undefined),
        publishedAt: date(c.getAttribute("created")),
      };
    })
    .filter(
      (c) =>
        /^t1_[a-z0-9]+$/.test(c.id || "") &&
        c.body &&
        !["[deleted]", "[removed]"].includes(c.body),
    )
    .slice(0, 30);
  const count = post.getAttribute("comment-count");
  return {
    state: "ready",
    links,
    snapshot: {
      url: location.href.split("?")[0],
      subreddit,
      postId: post.id,
      title: post.getAttribute("post-title") || "",
      body,
      author: post.getAttribute("author") || undefined,
      publishedAt: date(post.getAttribute("created-timestamp")),
      reportedCommentCount:
        count !== null && /^\d+$/.test(count) ? Number(count) : undefined,
      comments,
    },
  };
}
export function advanceRedditPage({ mode }) {
  if (mode === "list")
    window.scrollBy(0, Math.max(window.innerHeight * 2, 1600));
  else {
    for (const comment of Array.from(
      document.querySelectorAll("shreddit-comment[collapsed]"),
    ).slice(0, 20)) {
      const summary = comment.querySelector("details:not([open]) > summary");
      if (summary) summary.click();
    }
    window.scrollBy(0, window.innerHeight);
  }
}
