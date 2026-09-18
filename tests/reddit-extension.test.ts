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
  { timeout: 90000 },
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
    try {
      const extension = join(root, "extension");
      await cp(resolve("extensions/reddit-reader"), extension, {
        recursive: true,
      });
      const background = join(extension, "background.js");
      await writeFile(
        background,
        (await readFile(background, "utf8")).replace(
          "127.0.0.1:4317",
          "127.0.0.1:" + address.port,
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
    } finally {
      await context?.close();
      await app.inject({
        method: "POST",
        url: "/api/reddit-browser/disconnect",
        payload: {},
      });
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
