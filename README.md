# Venture Radar · Foundation Alpha

单人创始人的市场证据工作台。当前是 V1 的第一批可运行实现：真实来源 → 不可变原文 → 产品候选 → 人工检查。**不是完整 V1，也没有模拟生产数据。**

## 启动

推荐 Docker（PostgreSQL 17 + pgvector、迁移、API、Worker）：

```bash
cp .env.example .env
docker compose up -d --build
```

打开 http://127.0.0.1:4317 。端口只绑定本机。数据库不暴露端口。首次启动自动迁移，后续复用 `radar_pg` volume。停止：`docker compose down`（不加 `-v`，保留数据）。

开发模式（Node 22+，本机 Homebrew PostgreSQL 17）：

```bash
npm ci
npm run db:local
npm run db:migrate
npm run dev
```

前端 http://127.0.0.1:5173 ，API 4317。不要同时占用 Compose 的 4317 端口。可先 `docker compose stop api worker`。本机 DB 与 Docker DB **独立**，不会自动同步。本机数据库路径 `.local/pg`，监听 127.0.0.1:55432；仅作为开发实例。停止：`/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D .local/pg stop`。

## 已实现

- React 工作台：Radar、Products、Signals、Settings；搜索/过滤/分页、原文 drawer、来源 URL、时间、作者、原始 payload、线程上下文。里程碑按来源文档身份去重计数，版本快照另外统计。
- Manual/Winner 有界公开网页抓取，DNS 固定与私网防护、响应大小与超时限制；队列自动重试，失败可见。
- Reddit OAuth 线程采集和原始 JSON 导入，保留父子关系与作者，`more` 节点标注上下文不完整；不接受标题-only 或删除正文。
- Postgres 不可变原文快照、复制内容分组、独立人工检查记录。
- 产品候选按 domain 合并；不会把定价自动认作收入，未验证字段显示 UNKNOWN。
- Postgres 租约队列、竞争领取、fencing token、幂等快照、指数退避与定期来源。
- Founder 配置持久化；LLM 接口、禁用 provider、版本化 prompt 基础契约与 model_runs 审计。
- Docker Compose 和可选 pgvector 迁移。

## 使用

1. 「导入来源」选择产品或市场网页，输入公开 URL。可选每日刷新。
2. 在 Radar 查看任务，成功后进入 Signals / Products。
3. 打开原文，检查正文和来源；「接受原文」只确认输入质量，不确认商业价值。
4. Reddit 可配置 `.env` 的 `REDDIT_ACCESS_TOKEN` / `REDDIT_USER_AGENT` 后重启 API/Worker；也可导入合法取得的完整 `[postListing, commentsListing]` JSON。token 由用户自行获取和更新，首版不做 OAuth 登录/续期。
5. Settings 设置 Founder 偏好，暂停/恢复定期采集。

公开 Reddit API 是否可用取决于账户权限，缺 token 明确报错，不绕过来源访问控制。JSON 导入不等于已连接实时 Reddit。网页提取使用静态 HTML；JS-only、access challenge、超大页面会失败。不存在自动浏览器绕过。

真实公开产品页面采样：`npm run smoke`（调用本机运行中的 API）。它只收集少量产品原文，不推断收入，也不满足 M1 数量门槛。

## 检查

```bash
npm test
npm run typecheck
npm run build
npm audit
```

数据库集成测试必须使用独立测试库，不写入生产市场数据：

```bash
/opt/homebrew/opt/postgresql@17/bin/createdb -h 127.0.0.1 -p 55432 -U radar radar_test
DATABASE_URL=postgresql://radar@127.0.0.1:55432/radar_test npm run db:migrate
npm run test:db
npx playwright install chromium
npx playwright test
```

默认测试 URL 是 `postgresql://radar@127.0.0.1:55432/radar_test`，可用 `TEST_DATABASE_URL` 覆盖。测试库保留测试快照，便于检查不可变性；不应指向真实市场库。

## 架构与边界

- [技术架构](docs/superpowers/specs/2026-09-11-venture-radar-design.md)
- [首批计划](docs/superpowers/plans/2026-09-11-foundation.md)
- [产品需求参考](docs/product-reference.md)
- [验证记录](docs/verification.md)

Problems / Opportunities / Graveyard 显示明确的未启用门禁。痛点抽取、语义聚类、SEO 评分、收入证据录入/审核、机会生成、Deep Research、Bull/Bear/Judge、Validation Plan 和 KILL 流程尚未完成。prompt 仅基础契约，不能作为已完成的角色实现。模型 adapter 不自动读取其他应用的凭据或调用付费模型。

下一阶段需补齐真实来源规模并由 founder 审核输入质量：M1 为 200 个真实产品、500 条市场原文（包含 Reddit）。随后才推进上层智能。数据库中的 revenue_signals / model_runs / vector 表不代表对应产品流程已交付。

本版仅本机内部使用，没有身份系统；不要直接改为公网暴露。
