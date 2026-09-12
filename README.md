# Venture Radar · 独立开发者机会工作台

为独立开发者寻找可验证的小产品切口：真实参考产品和需求材料 → 带出处的声明 → 机会草稿 → 人工核对 → 验证或放弃。模型提出假设，人工决定证据是否支持该机会。

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

## 使用流程

1. 在「创始人设置」填写技能、每周时间、预算、最长开发周期、销售与维护偏好。不填的项保持未知。
2. 在「参考产品」导入产品官网 / 收费页；点击「发现用户反馈」自动收集 Hacker News 讨论，也可手动关联其他用户评论。也可以创建多个同域名的不同产品。
3. 点击「研究机会」。后台先提取带原文行号的声明，再基于固定声明 ID 提出具体机会。研究复用 `.env` 的 `TRANSLATION_API_KEY` / `TRANSLATION_MODEL` / `TRANSLATION_BASE_URL`。
4. 在首页草稿打开机会，先比较「现有产品已经解决什么」「仍未解决的痛点」「为什么尚未解决」「适合独立开发的补充方案」，再检查目标付费者、任务、市场缺口、最小方案、收费与获客假设、工期和维护风险。没有需求证据的明确待补证。
5. 逐条确认原文是否支持这项机会的声明。至少接受一条市场/收入声明及一条需求/痛点声明后，该机会进入候选。新的机会复用旧声明也需要重新核对关联关系；撤回会实时降级。
6. 编辑验证方案：动作和样本、预算、期限、成功、终止条件。满足证据条件且计划完整才能「开始验证」。观察与放弃可随时记录原因；决策保存当时方案、证据和 founder 配置。

原文库保留全文、源地址、线程上下文和中文译文。接受原文只确认采集质量，与机会证据审核分开。原文重复快照不会自动增加机会可信度。

## 机会比较与来源覆盖

在「机会比较」点击「评估全部机会」，后台对所有未放弃机会（当前最多30条）做统一评估；不额外生成机会、不自动接受证据。需求25%、付费价值25%、开发20%、获客15%、个人匹配15%，每项1–5或未知。比较分是已知维度加权均值，覆盖不足60%或少于三个维度时不排序。它表示暂定验证优先级，不是商业成功概率；相同分数并列。评分前对照已有功能；疑似重合的方案暂不排名，无用户痛点声明时需求最多2分。差异检查仍是模型判断，应核对原文。在机会档案填写「优先级阻断原因」后，该项无论模型评分多高都不参与排名；问题解决后可清空并重新评估。

每项理由、最大未知和下一步验证动作可同时查看；无创始人资料时个人匹配强制未知。保存模型输入与输出快照，方案、证据、个人资料或机会集合变更后提示旧评估过期。来源面板按去重来源统计，另列原文版本数，明确未配置和未接入渠道。

「主题发现」支持 GitHub 公开 Issues、Stack Overflow 问题、HN 评论的跨产品关键词检索（过去两年，每渠道每次最多30条）。无需新增密钥，各渠道独立记录成功/空结果/失败，遵守API返回的退避。GitHub结果可人工加入参考产品并关联材料；问答/评论先核对是否已解决，不自动变成机会证据。

接口：[GitHub REST Search](https://docs.github.com/en/rest/search/search)、[Stack Exchange Advanced Search](https://api.stackexchange.com/docs/advanced-search)、[HN Algolia](https://hn.algolia.com/api)。Stack Overflow保留作者、原文和内容许可；只抓问题正文，未抓回答。GitHub只抓Issue正文，未抓评论。三个技术社区存在用户群偏差，未接入Reddit主题搜索、G2或Capterra。

## 实现与边界

- React 中文机会工作台，Fastify API，Postgres 原文/声明/机会/决策关系模型，独立 Worker。
- 追加迁移保留旧产品、原文、译文；产品具有独立 ID 和地址标识，域名不再唯一。
- 研究分别从最近 100 个产品来源和 100 个外部来源中去重，最多保留 2 个产品来源与 6 个外部来源，每篇前 12000 字符；模型输入包含发表时间、上下文完整性和截断标记。未覆盖全部采集材料。
- 反馈发现使用 [Hacker News Search API](https://hn.algolia.com/api)，按域名及明确产品名检索最近两年评论，单次最多 40 条，不需要 API 密钥。保留原文、作者与讨论链接，但不自动抓取完整父帖；需人工核对相关性。当前自动发现限于 HN，不能代表全部用户。
- 研究最多重试 2 次，租约防并发重复提交，结果和任务成功原子保存。研究为 evidence/proposal 两步模型调用，按实际使用计费。
- 静态公开网页采集、每日刷新、Reddit OAuth 线程与合法 JSON 导入继续可用。Reddit 依然需要批准与令牌，目前不自动续期。
- 定价不证明收入；候选不证明商业成功。所有 AI 声明待人工核对，不提供假精确分数。
- 验证计划和决策已实现；验证的实际执行、实验结果结构化跟踪、全网来源发现、自动 SEO/流量调查仍需后续扩展。

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

## 中文译文与关键信息

证据详情默认打开「中文译文与要点」。填写 `.env` 中 `TRANSLATION_API_KEY`、`TRANSLATION_MODEL`、`TRANSLATION_BASE_URL` 后重启 API/Worker，即可按需生成。原文不变，译文缓存，中文要点附原文摘录。详见 [中文阅读助手配置](docs/chinese-reading.md)。

## 架构与边界

- [技术架构](docs/superpowers/specs/2026-09-11-venture-radar-design.md)
- [首批计划](docs/superpowers/plans/2026-09-11-foundation.md)
- [产品需求参考](docs/product-reference.md)
- [验证记录](docs/verification.md)

Problems / Opportunities / Graveyard 显示明确的未启用门禁。痛点抽取、语义聚类、SEO 评分、收入证据录入/审核、机会生成、Deep Research、Bull/Bear/Judge、Validation Plan 和 KILL 流程尚未完成。除中文阅读 prompt 外，研究角色 prompt 仅基础契约，不能作为已完成的角色实现。模型 adapter 不自动读取其他应用的凭据，翻译只在用户请求后调用所配置的模型。

下一阶段需补齐真实来源规模并由 founder 审核输入质量：M1 为 200 个真实产品、500 条市场原文（包含 Reddit）。随后才推进上层智能。数据库中的 revenue_signals / model_runs / vector 表不代表对应产品流程已交付。

本版仅本机内部使用，没有身份系统；不要直接改为公网暴露。
