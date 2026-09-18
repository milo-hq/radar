import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { readRedditPage } from "../extensions/reddit-reader/extractor.js";
const browser = await chromium.launch({ headless: true });
after(() => browser.close());
test("rendered reader excludes ads, preserves IDs and ignores collapsed/deleted comments", async () => {
  const page = await browser.newPage();
  await page.route("**/*", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: `<shreddit-post id="t3_abc" post-title="Search pain" subreddit-name="SaaS" author="founder" user-logged-in comment-count="5" permalink="/r/SaaS/comments/abc/search/"><div id="t3_abc-post-rtjson-content">Cannot find answers.</div></shreddit-post><shreddit-post id="t3_ad" is-ad permalink="/r/SaaS/comments/ad/promo/"></shreddit-post><shreddit-comment thingid="t1_def" depth="0" postid="t3_abc" author="reader"><div id="t1_def-post-rtjson-content">Me too.</div></shreddit-comment><shreddit-comment thingid="t1_hide" collapsed depth="0"><div id="t1_hide-post-rtjson-content">Hidden.</div></shreddit-comment><shreddit-comment thingid="t1_gone" depth="0"><div id="t1_gone-post-rtjson-content">[deleted]</div></shreddit-comment>`,
    }),
  );
  await page.goto("https://www.reddit.com/r/SaaS/comments/abc/search/");
  const result = await page.evaluate(readRedditPage, { subreddit: "SaaS" });
  assert.equal(result.snapshot.body, "Cannot find answers.");
  assert.equal(result.snapshot.comments.length, 1);
  assert.equal(result.snapshot.comments[0].parentId, "t3_abc");
  assert.equal(result.snapshot.reportedCommentCount, 5);
  assert.equal(result.links.length, 1);
  await page.setContent("<h1>Prove your humanity</h1>");
  assert.equal(
    (await page.evaluate(readRedditPage, { subreddit: "SaaS" })).state,
    "challenge",
  );
  await page.setContent("<h1>Log In</h1>");
  assert.equal(
    (await page.evaluate(readRedditPage, { subreddit: "SaaS" })).state,
    "login_required",
  );
  await page.close();
});
