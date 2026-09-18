import { test } from "node:test";
import assert from "node:assert/strict";
import { toolTargets, productQuery } from "../packages/db/src/tool-search.js";
import {
  publicationBlocker,
  demandEvidenceBlocker,
} from "../packages/radar/src/quality.js";
test("rotating plans cover named tools and use source-specific syntax", () => {
  const a = toolTargets(0),
    b = toolTargets(1),
    c = toolTargets(2);
  assert.equal(a.length, 4);
  assert.equal(new Set([...a, ...b, ...c].map((t) => t.product)).size, 12);
  for (const t of a) {
    assert.ok(productQuery(t, "x").includes(t.product));
    assert.ok(productQuery(t, "reddit").includes(t.product));
    assert.ok(!productQuery(t, "reddit").includes("filter:"));
  }
  assert.deepEqual(toolTargets(3), a);
});
test("reject enterprise-wide BI platforms but keep a narrow export plugin", () => {
  const base = {
    buyer: "中大型企业管理者",
    title: "自然语言解释型企业业务智能分析平台",
    solution: "集成多业务数据源的智能分析平台",
    problem: "数据分散",
    whyPriority: "待验证",
  };
  assert.ok(publicationBlocker(base));
  assert.equal(
    publicationBlocker({
      ...base,
      buyer: "小团队运营",
      title: "Notion 报表导出插件",
      solution: "将一个数据库导出为CSV",
    }),
    null,
  );
});

test("founder origin stories and unverified market gaps cannot justify opportunities", () => {
  assert.ok(
    demandEvidenceBlocker(
      "Cal.com's founder needed an open-source alternative to Calendly.",
    ),
  );
  assert.equal(
    demandEvidenceBlocker(
      "I use Calendly and need an export of custom fields each week.",
    ),
    null,
  );
  assert.ok(
    publicationBlocker({
      buyer: "小团队",
      title: "同步插件",
      solution: "同步一个字段",
      problem: "手工同步",
      whyPriority: "市场缺口明显",
    }),
  );
});
