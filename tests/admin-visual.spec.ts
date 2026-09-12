import { test, expect } from "@playwright/test";
test("admin pages keep table pagination during polling and fit desktop/mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("table", { name: "发现历史列表" })).toBeVisible();
  await page.screenshot({ path: ".local/admin-desktop.png", fullPage: true });
  await page.getByRole("button", { name: /^机会工作台/ }).click();
  await expect(page.getByRole("table", { name: "机会列表" })).toBeVisible();
  const panel = page
    .locator(".admin-table-panel")
    .filter({ has: page.getByRole("table", { name: "机会列表" }) });
  if (
    await panel.getByRole("button", { name: "下一页", exact: true }).isEnabled()
  ) {
    await panel.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(panel).toContainText("第 2 /");
    await page.waitForTimeout(5500);
    await expect(panel).toContainText("第 2 /");
  }
  for (const title of [
    "自定义搜索",
    "机会比较",
    "参考产品",
    "原文库",
    "创始人设置",
  ]) {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: title, exact: true })
      .click();
    await expect(page.locator("main")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "自动发现", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/admin-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("history table sends page, search and filter operations to the server", async ({
  page,
}) => {
  let last = new URLSearchParams();
  await page.route("**/api/radar/history?*", (route) => {
    last = new URL(route.request().url()).searchParams;
    const offset = Number(last.get("offset") || 0),
      limit = Number(last.get("limit") || 10);
    return route.fulfill({
      json: {
        items: Array.from({ length: limit }, (_, i) => ({
          id: `row-${offset + i}`,
          status: "complete",
          created_at: "2026-09-01T10:00:00Z",
          opportunity_count: 2,
          coverage: { collected: 30 },
        })),
        total: 64,
        hasMore: offset + limit < 64,
      },
    });
  });
  await page.goto("/");
  const history = page.getByRole("region", { name: "发现历史" });
  await expect(
    history.getByRole("table", { name: "发现历史列表" }),
  ).toBeVisible();
  await history.getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => last.get("offset")).toBe("10");
  await page.getByLabel("按状态筛选").click();
  await page.getByRole("option", { name: "失败", exact: true }).click();
  await expect.poll(() => last.get("status")).toBe("failed");
  await expect.poll(() => last.get("offset")).toBe("0");
  await page.getByLabel("搜索发现历史").fill("invoice");
  await expect.poll(() => last.get("q")).toBe("invoice");
  await page.getByLabel("时间排序").click();
  await page.getByRole("option", { name: "最早在前", exact: true }).click();
  await expect.poll(() => last.get("order")).toBe("asc");
});
