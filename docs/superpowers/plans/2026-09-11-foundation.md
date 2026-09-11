# Venture Radar Foundation Implementation Plan

**Goal:** 交付可操作、可测试、无模拟生产数据的输入与检查闭环。

**Architecture:** TypeScript monorepo，单一 Postgres，API 和 worker 分进程。

**Tech Stack:** React / Vite / Fastify / pg / Zod / Node test runner。

**Spec:** `docs/superpowers/specs/2026-09-11-venture-radar-design.md`

按用户已授权的开始实现请求，在当前空目录顺序执行。各任务完成后自检，不并行扩展业务模块。

## Global Constraints

- 不可变事实层；内容去重不改写正文。
- 缺凭据/数据明确失败，不生成假赢家或机会。
- 本机访问；SQL 参数化；URL 抓取防 SSRF；有限重试。
- 真实数据规模和人工质量独立报告。

## Task 1 — 原文与连接器

Files: `packages/core/src/documents.ts`, `packages/connectors/src/{http,manual,reddit}.ts`, `tests/core.test.ts`。

- [x] 先用 Node test runner 验证正文保留、复制分组、删除用户、嵌套回复、more 不完整、私网 URL 拒绝。
- [x] 实现 `normalizeDocument`, `parseRedditThread`, `ManualURLConnector`, `RedditConnector`。
- [x] `npm test`；预期以上行为全部通过。

## Task 2 — Postgres 存储和队列

Files: `migrations/001_foundation.sql`, `packages/db/src/{index,repository,jobs}.ts`, `tests/db.test.ts`。

- [x] 写集成测试：原文 UPDATE/DELETE 失败，重复 snapshot 不增行，正文变化追加，同一 idempotency key 只领一次，旧租约不可完成，最大重试后 failed。
- [x] 实现 `saveDocuments`, `enqueue`, `claimJob`, `finishJob`, `failJob`，用事务和 FK 保证输入一致。
- [x] 启动项目专用 Postgres；`npm run test:db`，失败必须修复。

## Task 3 — API / Worker / 初版工作台

Files: `apps/api/src/app.ts`, `apps/worker/src/worker.ts`, `apps/web/src/{App,styles}.tsx`（CSS 独立），`tests/api.test.ts`。

- [x] API 测试验证空数据真实计数、无效输入 400、跨源写拒绝、导入原子性、配置持久化。
- [x] 实现 routes：summary、documents/detail、products、ingest、reddit/import、jobs、sources、founder；worker 调用相同 connector 保存层。
- [x] 实现可搜索原文、来源筛选、产品检查、证据 drawer、导入对话框、任务状态、设置与质量门禁。
- [x] `npm run typecheck && npm run build && npm run test:db`。

## Task 4 — 实证与交付

Files: `scripts/smoke.ts`, `README.md`, `docs/verification.md`, Compose/Dockerfile。

- [x] 少量公开产品官网通过真实 connector 入库，保留采集结果与失败；不得补造数量。
- [x] 浏览器检查导入、搜索、drawer、产品、设置、窄屏。
- [x] 写出实际数据量、通过检查、Reddit/模型可用性、M1 未达项。
- [x] 交付本地地址、启动命令、架构文档和下一门禁。
