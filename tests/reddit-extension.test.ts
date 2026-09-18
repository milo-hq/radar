import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { buildApp } from "../apps/api/src/app.js";

test(
  "real MV3 extension claims, renders and uploads to the application without a Reddit network request",
  { timeout: 140000 },
  async () => {
    const db = new Pool({
      connectionString:
        process.env.TEST_DATABASE_URL ??
        "postgresql://radar@127.0.0.1:55432/radar_test",
    });
    const app = await buildApp(db);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as { port: number };
    const root = await mkdtemp(join(tmpdir(), "radar-extension-test-"));
    let context: any;
    let jobIds: string[] = [];
    let scanId: string | undefined;
    let xScanId: string | undefined;
    try {
      const extension = join(root, "extension");
      await cp(resolve("extensions/reddit-reader"), extension, {
        recursive: true,
      });
      const manifestPath = join(extension, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      // This isolated fixture grants X only in its temporary profile, never the user browser.
      manifest.host_permissions.push("https://x.com/*");
      await writeFile(manifestPath, JSON.stringify(manifest));
      const background = join(extension, "background.js");
      await writeFile(
        background,
        (await readFile(background, "utf8"))
          .replace("127.0.0.1:4317", "127.0.0.1:" + address.port)
          .replace("work ? 5000 : 15000", "work ? 150 : 300")
          // Let Playwright attach request routing before the extension tab navigates.
          .replace("url: startUrl.href,", 'url: "about:blank",')
          .replace(
            "await chrome.storage.local.set({\n        work: {",
            "await new Promise(r=>setTimeout(r,300)); await chrome.tabs.update(tab.id,{url:startUrl.href});\n      await chrome.storage.local.set({\n        work: {",
          ),
      );
      context = await chromium.launchPersistentContext(join(root, "profile"), {
        channel: "chromium",
        headless: true,
        args: [
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      });
      // Never let an unmatched third-party request escape the test fixture.
      await context.route("**/*", (route: any) => {
        const u = new URL(route.request().url());
        return ["127.0.0.1"].includes(u.hostname) ||
          u.protocol === "chrome-extension:"
          ? route.continue()
          : route.abort();
      });
      const searchRequests: URL[] = [];
      await context.route("https://www.reddit.com/**", (route: any) => {
        const u = new URL(route.request().url()),
          sub = u.pathname.split("/")[2];
        if (u.pathname === `/r/${sub}/search/`) {
          searchRequests.push(u);
          return route.fulfill({
            contentType: "text/html",
            body: `<button id="notifications-inbox-button">Inbox</button><a href="/r/${sub}/comments/fixture1/search/">Searching docs takes hours</a>`,
          });
        }
        return route.fulfill({
          contentType: "text/html",
          body: `<shreddit-post id="t3_fixture1" post-title="Searching docs takes hours" subreddit-name="${sub}" post-type="text" author="fixture" user-logged-in comment-count="1" permalink="/r/${sub}/comments/fixture1/search/"><div id="t3_fixture1-post-rtjson-content">We cannot find documents and waste two hours each week.</div></shreddit-post><shreddit-comment thingid="t1_reply1" depth="0" postid="t3_fixture1" author="reader"><div id="t1_reply1-post-rtjson-content">We also need better search.</div></shreddit-comment>`,
        });
      });
      await context.route(/https:\/\/x\.com\/.*/, (route: any) =>
        route.fulfill({
          contentType: "text/html",
          body:
            `<button data-testid="SideNav_AccountSwitcher_Button">Account</button>` +
            Array.from(
              { length: 20 },
              (_, i) =>
                `<article data-testid="tweet"><a href="/buyer/status/${10000 + i}"><time datetime="2026-09-18T00:00:00Z">Now</time></a><div data-testid="tweetText">Tool exports require manual work ${i}.</div></article>`,
            ).join(""),
        }),
      );
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(worker.url()).host;
      const token = (
        await app.inject({
          method: "POST",
          url: "/api/reddit-browser/pair",
          payload: {},
        })
      ).json().token;
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await popup.locator("#token").fill(token);
      await popup.locator("#start").click();
      for (let i = 0; i < 50; i++) {
        const state = (await app.inject("/api/reddit-browser")).json();
        if (state.connection.enabled) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const start = await app.inject({
        method: "POST",
        url: "/api/reddit-browser/start",
        payload: {},
      });
      assert.equal(start.statusCode, 200);
      jobIds = start.json().jobIds;
      scanId = start.json().scanId;
      await db.query(
        "UPDATE jobs SET status='failed' WHERE id=ANY($1::uuid[])",
        [jobIds.slice(1)],
      );
      let job: any;
      for (let i = 0; i < 65; i++) {
        job = (await db.query("SELECT * FROM jobs WHERE id=$1", [jobIds[0]]))
          .rows[0];
        if (job.status === "succeeded") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.equal(
        job.status,
        "succeeded",
        JSON.stringify({
          status: job.status,
          error: job.last_error,
          extension: await popup.locator("#status").innerText(),
        }),
      );
      assert.ok(
        searchRequests.length > 0,
        "extension must search rather than browse latest posts",
      );
      assert.equal(
        searchRequests[0].searchParams.get("q"),
        job.payload.searchQuery,
      );
      assert.equal(searchRequests[0].searchParams.get("restrict_sr"), "1");
      assert.equal(searchRequests[0].searchParams.get("t"), "year");
      assert.equal(job.payload.matchedCount, 2);
      assert.equal(job.payload.capturedThreads, 1);
      const rows = (
        await db.query(
          "SELECT d.* FROM discovery_documents dd JOIN raw_documents d ON d.id=dd.document_id WHERE dd.job_id=$1",
          [job.id],
        )
      ).rows;
      assert.ok(
        rows.some((d: any) => d.body === "We also need better search."),
      );
      assert.ok(rows.every((d: any) => d.metadata.contextComplete === false));
      const ownedId = await worker.evaluate(
        async ({ jobId }: { jobId: string }) => {
          const tab = await (globalThis as any).chrome.tabs.create({
            url: "https://www.reddit.com/r/SaaS/expired-fixture/",
          });
          await (globalThis as any).chrome.storage.local.set({
            work: {
              job: {
                id: jobId,
                lock_token: crypto.randomUUID(),
                payload: { subreddit: "SaaS" },
              },
              tabId: tab.id,
            },
          });
          return tab.id;
        },
        { jobId: job.id },
      );
      await popup.locator("#start").click();
      let tabExists = true;
      for (let i = 0; i < 40; i++) {
        tabExists = await worker.evaluate(async (id: number) => {
          try {
            await (globalThis as any).chrome.tabs.get(id);
            return true;
          } catch {
            return false;
          }
        }, ownedId);
        if (!tabExists) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assert.equal(
        tabExists,
        false,
        "an expired work lease must close its owned tab",
      );
      const xStart = await app.inject({
        method: "POST",
        url: "/api/reddit-browser/start",
        payload: { source: "x" },
      });
      assert.equal(xStart.statusCode, 200);
      xScanId = xStart.json().scanId;
      const xIds = xStart.json().jobIds;
      await db.query(
        "UPDATE jobs SET status='failed' WHERE id=ANY($1::uuid[])",
        [xIds.slice(1)],
      );
      await popup.locator("#start").click();
      let xJob: any;
      for (let i = 0; i < 45; i++) {
        xJob = (await db.query("SELECT * FROM jobs WHERE id=$1", [xIds[0]]))
          .rows[0];
        if (xJob.status === "succeeded" || xJob.last_error) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.equal(
        xJob.status,
        "succeeded",
        JSON.stringify({
          job: xJob,
          pages: await Promise.all(
            context.pages().map(async (p: any) => ({
              url: p.url(),
              text: await p
                .locator("body")
                .innerText()
                .catch(() => ""),
            })),
          ),
          tabs: await worker.evaluate(async () =>
            (globalThis as any).chrome.tabs.query({}),
          ),
        }),
      );
      assert.equal(xJob.payload.matchedCount, 20);
      const xDocs = (
        await db.query(
          "SELECT d.source_id,d.metadata FROM raw_documents d JOIN discovery_documents dd ON dd.document_id=d.id WHERE dd.job_id=$1",
          [xJob.id],
        )
      ).rows;
      assert.equal(xDocs.length, 20);
      assert.ok(
        xDocs.every(
          (d: any) =>
            d.source_id === "x" && d.metadata.contextComplete === false,
        ),
      );
    } finally {
      await context?.close();
      await app.inject({
        method: "POST",
        url: "/api/reddit-browser/disconnect",
        payload: {},
      });
      if (xScanId)
        await db.query("UPDATE radar_scans SET status='failed' WHERE id=$1", [
          xScanId,
        ]);
      if (scanId)
        await db.query("UPDATE radar_scans SET status='failed' WHERE id=$1", [
          scanId,
        ]);
      await app.close();
      await db.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
