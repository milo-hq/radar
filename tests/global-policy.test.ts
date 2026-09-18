import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globalPolicy,
  localizedToolQuery,
  groundMarket,
  optionalSources,
} from "../packages/core/src/discovery-policy.js";
test("global plans retain English and US baseline while rotating other languages and storefronts", () => {
  const plans = Array.from({ length: 8 }, (_, i) => globalPolicy(i));
  for (const p of plans) {
    assert.equal(p.audience, "global");
    assert.equal(p.outputLanguage, "zh-CN");
    assert.ok(p.searchLanguages.includes("en"));
    assert.equal(p.storefronts[0], "us");
  }
  assert.ok(new Set(plans.flatMap((p) => p.searchLanguages)).size >= 8);
  assert.ok(plans.some((p) => p.storefronts.includes("cn")));
  assert.match(localizedToolQuery("Notion", "ja"), /Notion/);
  assert.match(localizedToolQuery("Notion", "es"), /alternativa/);
});
test("language and storefront never create market evidence", () => {
  assert.deepEqual(
    groundMarket({ name: "Japan", line: null }, ["I use a Japanese app"]),
    { status: "unknown" },
  );
  assert.deepEqual(
    groundMarket({ name: "Japan", line: 0 }, ["I live in Brazil."]),
    { status: "unknown" },
  );
  assert.deepEqual(
    groundMarket({ name: "Brazil", line: 0 }, ["I run my business in Brazil."]),
    { status: "stated", name: "Brazil", quote: "I run my business in Brazil." },
  );
});
test("optional sources distinguish missing credentials from scheduled capability", () => {
  assert.equal(
    optionalSources({}).find((s) => s.id === "youtube")?.ready,
    false,
  );
  assert.equal(
    optionalSources({ YOUTUBE_API_KEY: "fixture" }).find(
      (s) => s.id === "youtube",
    )?.ready,
    true,
  );
  assert.equal(
    optionalSources({}).find((s) => s.id === "xiaohongshu")?.ready,
    false,
  );
});

test("market grounding rejects substrings within words but accepts whole source place names", () => {
  for (const [name, quote] of [
    ["US", "I use Notion daily."],
    ["Canada", "I use Canadian software."],
    ["UK", "The ukulele workflow is broken."],
  ]) {
    assert.deepEqual(groundMarket({ name, line: 0 }, [quote]), {
      status: "unknown",
    });
  }
  assert.deepEqual(
    groundMarket({ name: "US", line: 0 }, ["I work in the US."]),
    { status: "stated", name: "US", quote: "I work in the US." },
  );
  assert.deepEqual(
    groundMarket({ name: "中国", line: 0 }, ["我住在中国，需要离线工具。"]),
    { status: "stated", name: "中国", quote: "我住在中国，需要离线工具。" },
  );
});
