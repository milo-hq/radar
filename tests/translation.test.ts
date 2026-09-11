import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  splitText,
  validatePart,
  translateDocument,
} from "../packages/translation/src/translate.js";
import { saveDocuments } from "../packages/db/src/repository.js";
import type { LLMProvider } from "../packages/llm/src/provider.js";
const db = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    "postgresql://radar@127.0.0.1:55432/radar_test",
});
after(() => db.end());
test("translation chunks preserve every source character including emoji", () => {
  const source = "First line.\n😀 Price $9/month.\n".repeat(600);
  const chunks = splitText(source, 4000);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((p) => Array.from(p).length <= 4000));
});
test("Chinese points must cite text that actually occurs in their source chunk", () => {
  assert.throws(
    () =>
      validatePart(
        {
          titleZh: "产品",
          bodyZh: "每月9美元",
          keyPoints: [
            { textZh: "很多付费用户", sourceQuote: "1000 paid users" },
          ],
        },
        "Price: $9/month",
      ),
    /引用/,
  );
});
test("translation is cached, traceable and separate from immutable raw text", async () => {
  const [doc] = await saveDocuments(db, [
    {
      sourceKey: "manual",
      externalId: crypto.randomUUID(),
      canonicalUrl: "https://example.com/translation",
      type: "article",
      body: "Price: $9/month",
      title: "Pricing",
      metadata: { test: true },
    },
  ]);
  let calls = 0;
  const provider: LLMProvider = {
    async generateStructured<T>() {
      calls++;
      return {
        value: {
          titleZh: "定价",
          bodyZh: "价格：每月9美元",
          keyPoints: [
            {
              textZh: "方案价格为每月9美元，未证明实际收入。",
              sourceQuote: "Price: $9/month",
            },
          ],
        } as T,
        inputTokens: 40,
        outputTokens: 30,
        estimatedCost: null,
      };
    },
    async generateText() {
      throw new Error("unused");
    },
  };
  const config = { provider, model: "fixture-model" };
  const first = await translateDocument(db, doc.id, config);
  const second = await translateDocument(db, doc.id, config);
  assert.equal(first.bodyZh, "价格：每月9美元");
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(
    (await db.query("SELECT body FROM raw_documents WHERE id=$1", [doc.id]))
      .rows[0].body,
    "Price: $9/month",
  );
});
test("partial translation resumes from cached chunks after a provider failure", async () => {
  const body = "A".repeat(4000) + "Last segment";
  const [doc] = await saveDocuments(db, [
    {
      sourceKey: "manual",
      externalId: crypto.randomUUID(),
      canonicalUrl: "https://example.com/resume",
      type: "article",
      body,
      metadata: { test: true },
    },
  ]);
  let calls = 0;
  const provider: LLMProvider = {
    async generateStructured<T>() {
      calls++;
      if (calls === 2) throw new Error("temporary outage");
      return {
        value: {
          titleZh: "测试",
          bodyZh: calls === 1 ? "第一段" : "最后一段",
          keyPoints: [],
        } as T,
        inputTokens: 10,
        outputTokens: 10,
        estimatedCost: null,
      };
    },
    async generateText() {
      throw new Error("unused");
    },
  };
  await assert.rejects(
    translateDocument(db, doc.id, { provider, model: "resume-fixture" }),
    /temporary/,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM document_translations WHERE raw_document_id=$1",
        [doc.id],
      )
    ).rows[0].n,
    0,
  );
  const result = await translateDocument(db, doc.id, {
    provider,
    model: "resume-fixture",
  });
  assert.equal(result.bodyZh, "第一段\n\n最后一段");
  assert.equal(calls, 3);
});
test("provider sends a structured request and rejects incomplete model output", async () => {
  const { CompatibleProvider } = await import(
    "../packages/llm/src/compatible.js"
  );
  const { z } = await import("zod");
  let request: any;
  const transport = (async (_url: any, init: any) => {
    request = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"text":"partial"}' },
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const provider = new CompatibleProvider(
    {
      apiKey: "fixture-key",
      model: "fixture-model",
      baseUrl: "https://example.com/v1",
    },
    transport,
  );
  await assert.rejects(
    provider.generateStructured(
      {
        promptName: "translate-chinese",
        promptVersion: "v1",
        system: "Translate faithfully",
        input: { body: "Hello" },
        model: "fixture-model",
      },
      z.object({ text: z.string() }),
    ),
    /未完整/,
  );
  assert.equal(request.response_format.type, "json_object");
  assert.equal(JSON.parse(request.messages[1].content).body, "Hello");
});
test("Chinese API exposes cached results and supports Chinese list search without credentials", async () => {
  const { buildApp } = await import("../apps/api/src/app.js");
  const app = await buildApp(db);
  try {
    const [doc] = await saveDocuments(db, [
      {
        sourceKey: "manual",
        externalId: crypto.randomUUID(),
        canonicalUrl: "https://example.com/chinese",
        type: "article",
        title: "English title",
        body: "A unique workflow",
        metadata: { test: true },
      },
    ]);
    await db.query(
      "INSERT INTO document_translations(raw_document_id,prompt_version,model,result) VALUES($1,$2,$3,$4)",
      [
        doc.id,
        "v1",
        "test-model",
        JSON.stringify({
          titleZh: "独特工作流中文案例",
          bodyZh: "这里是中文正文",
          keyPoints: [],
        }),
      ],
    );
    const result = await app.inject("/api/documents/" + doc.id + "/chinese");
    assert.equal(
      result.json().translation.result.titleZh,
      "独特工作流中文案例",
    );
    const list = await app.inject(
      "/api/documents?search=" + encodeURIComponent("独特工作流中文案例"),
    );
    assert.ok(list.json().items.some((d: any) => d.id === doc.id));
  } finally {
    await app.close();
  }
});
test("translation enqueue is idempotent and does not reveal configured credentials", async () => {
  const { buildApp } = await import("../apps/api/src/app.js");
  const app = await buildApp(db);
  const previous = {
    key: process.env.TRANSLATION_API_KEY,
    model: process.env.TRANSLATION_MODEL,
    base: process.env.TRANSLATION_BASE_URL,
  };
  process.env.TRANSLATION_API_KEY = "translation-test-secret";
  process.env.TRANSLATION_MODEL = "fixture";
  process.env.TRANSLATION_BASE_URL = "https://example.com/v1";
  try {
    const [doc] = await saveDocuments(db, [
      {
        sourceKey: "manual",
        externalId: crypto.randomUUID(),
        canonicalUrl: "https://example.com/queued",
        type: "article",
        body: "A source to translate.",
        metadata: { test: true },
      },
    ]);
    const a = await app.inject({
      method: "POST",
      url: `/api/documents/${doc.id}/chinese`,
      payload: {},
    });
    const b = await app.inject({
      method: "POST",
      url: `/api/documents/${doc.id}/chinese`,
      payload: {},
    });
    assert.equal(a.statusCode, 202);
    assert.equal(a.json().jobId, b.json().jobId);
    assert.equal(
      (
        await db.query("SELECT max_attempts FROM jobs WHERE id=$1", [
          a.json().jobId,
        ])
      ).rows[0].max_attempts,
      2,
    );
    const config = await app.inject("/api/translation-config");
    assert.equal(config.json().configured, true);
    assert.equal(config.body.includes("translation-test-secret"), false);
  } finally {
    for (const [name, val] of [
      ["TRANSLATION_API_KEY", previous.key],
      ["TRANSLATION_MODEL", previous.model],
      ["TRANSLATION_BASE_URL", previous.base],
    ])
      if (val === undefined) delete process.env[name!];
      else process.env[name!] = val;
    await app.close();
  }
});
test("cached translations remain readable after provider configuration becomes invalid", async () => {
  const { buildApp } = await import("../apps/api/src/app.js");
  const app = await buildApp(db);
  const old = {
    key: process.env.TRANSLATION_API_KEY,
    model: process.env.TRANSLATION_MODEL,
    base: process.env.TRANSLATION_BASE_URL,
  };
  try {
    const [doc] = await saveDocuments(db, [
      {
        sourceKey: "manual",
        externalId: crypto.randomUUID(),
        canonicalUrl: "https://example.com/cached",
        type: "article",
        body: "Already translated source.",
        metadata: { test: true },
      },
    ]);
    await db.query(
      "INSERT INTO document_translations(raw_document_id,prompt_version,model,result) VALUES($1,$2,$3,$4)",
      [
        doc.id,
        "v1",
        "fixture",
        JSON.stringify({
          titleZh: "已有译文",
          bodyZh: "已有内容",
          keyPoints: [],
        }),
      ],
    );
    process.env.TRANSLATION_API_KEY = "fixture";
    process.env.TRANSLATION_MODEL = "fixture";
    process.env.TRANSLATION_BASE_URL = "file:///invalid";
    const result = await app.inject(`/api/documents/${doc.id}/chinese`);
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().translation.result.bodyZh, "已有内容");
    assert.equal(result.json().configured, false);
  } finally {
    for (const [name, val] of [
      ["TRANSLATION_API_KEY", old.key],
      ["TRANSLATION_MODEL", old.model],
      ["TRANSLATION_BASE_URL", old.base],
    ])
      if (val === undefined) delete process.env[name!];
      else process.env[name!] = val;
    await app.close();
  }
});
test("compatible adapter and refined translation schema work through the complete persistence path", async () => {
  const { CompatibleProvider } = await import(
    "../packages/llm/src/compatible.js"
  );
  const [doc] = await saveDocuments(db, [
    {
      sourceKey: "manual",
      externalId: crypto.randomUUID(),
      canonicalUrl: "https://example.com/adapter",
      type: "article",
      body: "One paid plan.",
      metadata: { test: true },
    },
  ]);
  const transport = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                titleZh: "付费方案",
                bodyZh: "一个付费方案。",
                keyPoints: [
                  {
                    textZh: "原文提到一个付费方案。",
                    sourceQuote: "One paid plan.",
                  },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 21, completion_tokens: 35 },
      }),
      { status: 200 },
    )) as typeof fetch;
  const provider = new CompatibleProvider(
    {
      apiKey: "test-only",
      baseUrl: "https://example.com/v1",
      model: "wire-fixture",
    },
    transport,
  );
  const result = await translateDocument(db, doc.id, {
    provider,
    model: "wire-fixture",
  });
  assert.equal(result.bodyZh, "一个付费方案。");
  assert.equal(result.keyPoints[0].sourceQuote, "One paid plan.");
});
