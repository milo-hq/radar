// Injected into the extension-owned X search tab. Read only rendered public posts.
export function readXPage() {
  const visible = (e) =>
    !!e &&
    e.getClientRects().length > 0 &&
    getComputedStyle(e).visibility !== "hidden";
  const pageText = document.body?.innerText || "";
  if (
    /verify you are human|authenticate your account|验证你是真人/i.test(
      pageText,
    )
  )
    return { state: "challenge" };
  if (!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'))
    return {
      state: /log in|sign in|登录/i.test(pageText)
        ? "login_required"
        : "loading",
    };
  const cards = Array.from(
    document.querySelectorAll('article[data-testid="tweet"]'),
  ).filter(visible);
  const snapshots = cards.flatMap((card) => {
    if (
      card.querySelector('[data-testid="placementTracking"]') ||
      /^(Ad|Promoted|推广)$/.test(
        card
          .querySelector('[data-testid="socialContext"]')
          ?.innerText?.trim() || "",
      )
    )
      return [];
    const time = card.querySelector("time"),
      link = time?.closest("a");
    const text = Array.from(
      card.querySelectorAll('[data-testid="tweetText"]'),
    ).find((e) => !e.closest('[role="link"]'));
    if (!visible(text) || !link) return [];
    const u = new URL(link.getAttribute("href"), location.origin);
    const m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    if (u.origin !== "https://x.com" || !m || !text.innerText?.trim())
      return [];
    const dt = time.getAttribute("datetime");
    return [
      {
        url: u.origin + u.pathname,
        postId: m[2],
        author: m[1],
        body: text.innerText.trim().slice(0, 40000),
        publishedAt:
          dt && Number.isFinite(Date.parse(dt))
            ? new Date(dt).toISOString()
            : undefined,
      },
    ];
  });
  if (
    !cards.length &&
    !/No results|Try searching|没有结果|未找到结果/i.test(pageText)
  )
    return { state: "loading" };
  return { state: "ready", snapshots };
}
export function advanceXPage() {
  window.scrollBy(0, Math.max(window.innerHeight, 800));
}
