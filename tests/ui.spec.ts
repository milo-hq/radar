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
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page.getByRole("button", { name: "原文库", exact: true }).click();
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
  await page.getByRole("button", { name: "创始人设置", exact: true }).click();
  await expect(page.getByLabel("技术优势")).toBeVisible();
  await page.getByLabel("技术优势").fill("Browser QA TypeScript");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.reload();
  await page.getByRole("button", { name: "创始人设置", exact: true }).click();
  await expect(page.getByLabel("技术优势")).toHaveValue(
    "Browser QA TypeScript",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^机会工作台/ }).click();
  await expect(page.getByRole("button", { name: "查看参考产品", exact: true }))
    .toBeVisible()
    .catch(async () => {
      await expect(page.locator(".ws-opportunity-card").first()).toBeVisible();
    });
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
  await page.getByRole("button", { name: "原文库", exact: true }).click();
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
test("opportunity evidence review unlocks validation and preserves the decision", async ({
  page,
  request,
}) => {
  const title = "UI验证机会 " + Date.now();
  const product = await (
    await request.post("/api/products", {
      data: { name: title, url: "https://example.com/ui/" + Date.now() },
    })
  ).json();
  const r = await request.post("/api/reddit/import", {
    data: {
      thread: [
        {
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "opp" + Date.now(),
                  subreddit: "testing",
                  title,
                  selftext: "A paid plan exists. I need invoice export.",
                  author: "qa",
                },
              },
            ],
          },
        },
        { data: { children: [] } },
      ],
    },
  });
  const documentId = (await r.json()).documents[0];
  const opp = await (
    await request.post("/api/opportunities", {
      data: {
        productId: product.id,
        title,
        dossier: {
          customer: "Solo sellers",
          validation: {
            test: "Interview 3 sellers",
            budget: "$10",
            duration: "7 days",
            success: "2 paid trials",
            kill: "No buyer",
          },
        },
      },
    })
  ).json();
  for (const [kind, quote] of [
    ["market", "A paid plan exists."],
    ["pain", "I need invoice export."],
  ]) {
    const c = await (
      await request.post("/api/claims", {
        data: {
          productId: product.id,
          documentId,
          kind,
          statement: quote,
          quote,
        },
      })
    ).json();
    await request.post(`/api/opportunities/${opp.id}/claims`, {
      data: { claimId: c.id },
    });
  }
  await page.goto("/");
  await page.getByRole("button", { name: /^机会工作台/ }).click();
  await page.getByRole("heading", { name: title, exact: true }).click();
  await expect(page.getByText("继续补证，暂存为草稿")).toBeVisible();
  await page
    .locator(".ws-claim")
    .nth(0)
    .getByRole("button", { name: "接受声明" })
    .click();
  await expect(
    page.locator(".ws-claim").nth(0).getByRole("button", { name: "接受声明" }),
  ).toBeDisabled();
  await page
    .locator(".ws-claim")
    .nth(1)
    .getByRole("button", { name: "接受声明" })
    .click();
  await expect(page.getByText("已具备进入候选的最低证据")).toBeVisible();
  await page.locator(".ws-decision select").selectOption("VALIDATE");
  await page.getByLabel("决策理由").fill("先验证实际付款");
  await page.getByRole("button", { name: "记录决策" }).click();
  await expect(page.locator(".ws-timeline")).toContainText("先验证实际付款");
  await page
    .locator(".ws-claim")
    .nth(1)
    .getByRole("button", { name: "排除", exact: true })
    .click();
  await expect(page.getByText("继续补证，暂存为草稿")).toBeVisible();
  await expect(page.locator(".ws-timeline")).toContainText("先验证实际付款");
});

test("radar starts without a topic and renders ranked evidence on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let started = false;
  const recommendation = {
    id: "r1",
    title: "客户资料交接检查助手",
    buyer: "小型代理公司",
    problem: "资料反复遗漏",
    solution: "检查交接清单",
    whyPriority: "本轮先验证节省人工时间的价值",
    feasibility: "一个人可先实现文件清单检查",
    monetization: "按工作区收费，尚待验证",
    risks: "现有项目管理工具可能覆盖",
    nextStep: "访谈5名项目负责人，至少3人愿意试用再开发",
    confidence: "探索假设，证据有限",
    independentVoices: 1,
    platforms: ["hn"],
    evidence: [
      {
        documentId: "test-doc",
        title: "handoff discussion",
        url: "https://news.ycombinator.com/item?id=123",
        quote: "We manually check every handoff.",
        source: "hn",
        author: "example",
      },
    ],
  };
  await page.route("**/api/radar", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postData()).toBeNull();
      started = true;
      await route.fulfill({ json: { scanId: "scan1" } });
    } else
      await route.fulfill({
        json: {
          configured: true,
          latest: started
            ? {
                id: "scan1",
                status: "complete",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                plan: { queries: [] },
                coverage: {
                  collected: 25,
                  eligible: 12,
                  excluded: 10,
                  duplicates: 3,
                  analyzed: 12,
                  failedJobs: 0,
                  sourceCounts: { hn: 22 },
                },
                report: {
                  summary: "优先验证客户交接流程",
                  recommendations: [recommendation],
                  rejectedSummary: "已解决的代码错误不推荐",
                },
                jobs: [],
              }
            : null,
        },
      });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "自动发现机会", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".ws-radar input")).toHaveCount(0);
  await page.getByRole("button", { name: "自动发现机会", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "客户资料交接检查助手" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("Python evidence dashboard works before model report and remains usable on mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const clusters = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`,
    label: `发票处理反馈组 ${i + 1}`,
    documentIds: [`d${i}`],
    independentAccounts: 1,
    sourceCount: 1,
    sourceNames: ["wordpress"],
    recentCount: 1,
    painMentions: 1,
    commercialMentions: 1,
    frictionMentions: 0,
    evidenceScore: 40,
    dimensions: {
      recurrence: 0,
      crossSource: 0,
      recency: i === 0 ? null : 100,
      pain: 100,
      commercial: 100,
      friction: 0,
    },
    unknowns: ["verified_willingness_to_pay"],
  }));
  await page.route("**/api/radar", (r) =>
    r.fulfill({
      json: {
        configured: true,
        latest: {
          id: "python-scan",
          status: "analyzing",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          plan: { queries: [] },
          coverage: {
            collected: 10,
            eligible: 10,
            analyzed: 0,
            excluded: 0,
            duplicates: 0,
            failedJobs: 0,
            sourceCounts: { wordpress: 10 },
          },
          analytics: {
            version: "1",
            documentCount: 10,
            uniqueContentCount: 10,
            clusterCount: 10,
            sourceCounts: { wordpress: 10 },
            clusters,
            limitations: ["Keyword heuristics are not verified intent."],
          },
          report: null,
          jobs: [
            {
              type: "DISCOVER_TOPIC",
              status: "succeeded",
              last_error: null,
              payload: { warnings: ["另一应用评论为空"] },
            },
          ],
        },
      },
    }),
  );
  await page.goto("/");
  const dashboard = page.getByRole("region", { name: "多维证据看板" });
  await expect(dashboard).toBeVisible();
  await expect(
    page.getByText("发票处理反馈组 8", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("发票处理反馈组 9", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "展开其余 2 个分组" }).click();
  await expect(
    page.getByText("发票处理反馈组 10", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("crawler coverage shows actual site outcomes on mobile", async ({
  page,
}) => {
  await page.route("**/api/crawler", (route) =>
    route.fulfill({
      json: {
        configured: true,
        sites: [
          {
            id: "demo",
            name: "Demo Community",
            seed: "https://example.com/",
            kind: "community",
            enabled: true,
          },
        ],
      },
    }),
  );
  await page.route("**/api/radar", (route) =>
    route.fulfill({
      json: {
        configured: true,
        latest: {
          id: "crawl",
          status: "collecting",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          plan: null,
          coverage: null,
          report: null,
          error: null,
          jobs: [
            {
              type: "DISCOVER_TOPIC",
              status: "succeeded",
              last_error: null,
              payload: {
                siteId: "demo",
                savedCount: 8,
                crawlStats: {
                  visited: 12,
                  rendered: 1,
                  cached: 0,
                  blocked: 0,
                  remaining: 24,
                },
              },
            },
          ],
        },
        previous: null,
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByText("网页爬虫 · 1 个站点 · 查看实际采集进度").click();
  await expect(page.getByText(/访问 12 页 · 入库 8 篇/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("historical radar selection survives polling and empty rounds never borrow another report", async ({
  page,
}) => {
  const old = {
    id: "old",
    status: "complete",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
    plan: null,
    coverage: null,
    analytics: null,
    jobs: [],
    error: null,
    report: {
      summary: "这是八月保存的机会报告",
      recommendations: [],
      rejectedSummary: "",
    },
  };
  const latest = {
    ...old,
    id: "new",
    created_at: "2026-09-01T10:00:00Z",
    report: { ...old.report, summary: "这是最新报告" },
  };
  const failed = {
    ...old,
    id: "failed",
    status: "failed",
    created_at: "2026-08-02T10:00:00Z",
    report: null,
    error: "测试失败轮次",
  };
  await page.route("**/api/radar", (route) =>
    route.fulfill({ json: { configured: true, latest, previous: latest } }),
  );
  await page.route("**/api/radar/history?*", (route) =>
    route.fulfill({
      json: {
        items: [latest, failed, old].map((s) => ({
          ...s,
          opportunity_count: s.report ? 0 : null,
        })),
        hasMore: false,
      },
    }),
  );
  await page.route("**/api/radar/history/old", (route) =>
    route.fulfill({ json: { scan: old } }),
  );
  await page.route("**/api/radar/history/failed", (route) =>
    route.fulfill({ json: { scan: failed } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .locator(".ws-radar-history-item")
    .filter({ hasText: "2026/08/01" })
    .click();
  await expect(page.getByText(old.report.summary)).toBeVisible();
  await page.waitForTimeout(5500);
  await expect(page.getByText(old.report.summary)).toBeVisible();
  await expect(page.getByText(latest.report.summary)).toHaveCount(0);
  await page
    .locator(".ws-radar-history-item")
    .filter({ hasText: "2026/08/02" })
    .click();
  await expect(page.getByText("测试失败轮次")).toBeVisible();
  await expect(page.getByText(old.report.summary)).toHaveCount(0);
  await expect(page.getByText(latest.report.summary)).toHaveCount(0);
  await page.getByRole("button", { name: "查看最新一轮" }).click();
  await expect(page.getByText(latest.report.summary)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
