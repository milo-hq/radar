import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readXPage } from "../extensions/reddit-reader/x-extractor.js";
const browser = await chromium.launch({ headless: true });
after(() => browser.close());
test("X rendered posts preserve identity and do not mix quoted posts or hidden text", async () => {
  const page = await browser.newPage();
  await page.route("**/*", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<button data-testid="SideNav_AccountSwitcher_Button">Account</button><article data-testid="tweet"><a href="/buyer/status/123"><time datetime="2026-09-18T00:00:00Z">Today</time></a><div data-testid="tweetText">Tool is missing export.</div><div data-testid="tweetText">Quoted author text</div></article><article data-testid="tweet" style="display:none"><div data-testid="tweetText">Private hidden</div></article>`,
    }),
  );
  await page.goto("https://x.com/search?q=export");
  const r = await page.evaluate(readXPage);
  assert.equal(r.state, "ready");
  assert.equal(r.snapshots.length, 1);
  assert.equal(r.snapshots[0].body, "Tool is missing export.");
  assert.equal(r.snapshots[0].author, "buyer");
  await page.setContent("<h1>Log in</h1>");
  assert.equal((await page.evaluate(readXPage)).state, "login_required");
  await page.setContent("<h1>Verify you are human</h1>");
  assert.equal((await page.evaluate(readXPage)).state, "challenge");
  await page.close();
});
