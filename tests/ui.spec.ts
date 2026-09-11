import { test, expect } from "@playwright/test";
test("source inspection, search, review persistence and mobile navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = "ui" + Date.now().toString(36);
  const title = `Review test source ${id}`;
  const seeded = await page.request.post("/api/reddit/import", {
    data: {
      thread: [
        {
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id,
                  subreddit: "testing",
                  title,
                  selftext: "Review test source with original content.",
                  author: "qa-fixture",
                },
              },
            ],
          },
        },
        { data: { children: [] } },
      ],
    },
  });
  expect(seeded.ok()).toBe(true);
  await page.goto("/");
  await expect(page.getByText("数据库已连接")).toBeVisible();
  await page
    .getByRole("button", { name: "Signals 原始信号", exact: true })
    .click();
  await page.getByRole("textbox", { name: "搜索原始文档" }).fill(title);
  const row = page.locator(".document-row").first();
  await expect(row).toContainText("Review test source");
  await row.click();
  await expect(
    page.getByRole("dialog", { name: "原文证据检查" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "原始正文", exact: true }).click();
  await expect(page.locator(".source-body")).toContainText("original content");
  await page
    .getByLabel("检查备注")
    .fill("Browser QA: source remains immutable");
  await page.getByRole("button", { name: "接受原文" }).click();
  await expect(page.getByRole("status")).toContainText("原文已接受");
  await page.getByRole("button", { name: "关闭证据" }).click();
  await row.click();
  await expect(page.getByLabel("检查备注")).toHaveValue(
    "Browser QA: source remains immutable",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "导入来源", exact: true }).click();
  await page.getByLabel("来源类型").selectOption("json");
  await page.getByLabel("完整线程 JSON").fill('{"invalid":true}');
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "导入来源", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Settings 设置", exact: true })
    .click();
  await expect(page.getByLabel("技术优势")).toBeVisible();
  await page.getByLabel("技术优势").fill("Browser QA TypeScript");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.reload();
  await page
    .getByRole("button", { name: "Settings 设置", exact: true })
    .click();
  await expect(page.getByLabel("技术优势")).toHaveValue(
    "Browser QA TypeScript",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Opportunities 商业机会", exact: true })
    .click();
  await expect(page.getByText("好的机会，需要先有证据")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: ".local/radar-mobile.png", fullPage: true });
});
test("cached Chinese reading shows traceable points and original text remains accessible", async ({
  page,
  request,
}) => {
  const id = "zh" + Date.now().toString(36);
  const created = await request.post("/api/reddit/import", {
    data: {
      thread: [
        {
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id,
                  subreddit: "testing",
                  title: "Translation browser fixture",
                  selftext: "The plan costs $9 per month.",
                },
              },
            ],
          },
        },
        { data: { children: [] } },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const docId = (await created.json()).documents[0];
  const { Pool } = await import("pg");
  const db = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      "postgresql://radar@127.0.0.1:55432/radar_test",
  });
  try {
    await db.query(
      "INSERT INTO document_translations(raw_document_id,prompt_version,model,result) VALUES($1,$2,$3,$4)",
      [
        docId,
        "v1",
        "browser-test-fixture",
        JSON.stringify({
          titleZh: "中文翻译浏览器测试",
          bodyZh: "该方案每月收费9美元。",
          keyPoints: [
            {
              textZh: "原文标注每月9美元的方案价格。",
              sourceQuote: "The plan costs $9 per month.",
            },
          ],
        }),
      ],
    );
  } finally {
    await db.end();
  }
  await page.goto("/");
  await page
    .getByRole("button", { name: "Signals 原始信号", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "搜索原始文档" })
    .fill("中文翻译浏览器测试");
  await page.locator(".document-row").first().click();
  await expect(page.getByText("中文内容已缓存")).toBeVisible();
  await expect(page.locator(".translated-body")).toHaveText(
    "该方案每月收费9美元。",
  );
  await page.getByText("对照原文摘录").click();
  await expect(page.locator("blockquote")).toHaveText(
    "The plan costs $9 per month.",
  );
  await page.screenshot({ path: ".local/chinese-reading.png" });
  await page.getByRole("button", { name: "原始正文", exact: true }).click();
  await expect(page.locator(".source-body")).toHaveText(
    "The plan costs $9 per month.",
  );
});
