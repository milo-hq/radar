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
