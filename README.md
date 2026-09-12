# Venture Radar · 独立开发者机会工作台

为不知道做什么的独立开发者主动寻找产品机会：自动选择探索方向 → 多渠道采集 → 过滤与合并需求 → 输出有出处的产品建议和验证优先级。无需先输入主题或逐条审核材料。

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

## 默认使用流程：自动发现

首页点击「自动发现机会」，无需提供主题。系统选择4个方向，跨HN、GitHub、Stack Overflow、WordPress评价和App Store适配器采集，再由Python分组统计、模型提取和综合复核。重复点击复用同一轮任务。

Python多维证据看板会先显示来源分布、复制内容、相似文本分组、来源账号与六维指标；不需要等待推荐，也不要求你手动分组。最终0–5项产品建议说明付费者、缺口、最小方案、可行性、风险和验证方法。没有足够证据时返回无合格建议。

WordPress评价已实测返回真实材料；Apple应用搜索可用，但其公开评论RSS实测为空，不能计作已获得的用户评论。其余三个渠道偏技术社区。评论和词频不是付费证明，文本相似分组也不是已验证的需求。美国评价不能证明目标国家存在空白。

架构、指标公式、采集上限、Python本地开发与Docker测试见 [Python数据引擎](docs/python-data-engine.md)。创始人资料可选，更新由按钮触发，不隐式定时消耗API。

API：`POST /api/radar` 启动或复用任务；`GET /api/radar` 查看阶段、覆盖、analytics与报告。任务和批次存入数据库，Worker重启可续跑，失效租约不能发布结果。

## 可选：手动管理和验证机会

1. 在「创始人设置」填写技能、每周时间、预算、最长开发周期、销售与维护偏好。不填的项保持未知。
2. 在「参考产品」导入产品官网 / 收费页；点击「发现用户反馈」自动收集 Hacker News 讨论，也可手动关联其他用户评论。也可以创建多个同域名的不同产品。
3. 点击「研究机会」。后台先提取带原文行号的声明，再基于固定声明 ID 提出具体机会。研究复用 `.env` 的 `TRANSLATION_API_KEY` / `TRANSLATION_MODEL` / `TRANSLATION_BASE_URL`。
4. 在首页草稿打开机会，先比较「现有产品已经解决什么」「仍未解决的痛点」「为什么尚未解决」「适合独立开发的补充方案」，再检查目标付费者、任务、市场缺口、最小方案、收费与获客假设、工期和维护风险。没有需求证据的明确待补证。
5. 逐条确认原文是否支持这项机会的声明。至少接受一条市场/收入声明及一条需求/痛点声明后，该机会进入候选。新的机会复用旧声明也需要重新核对关联关系；撤回会实时降级。
6. 编辑验证方案：动作和样本、预算、期限、成功、终止条件。满足证据条件且计划完整才能「开始验证」。观察与放弃可随时记录原因；决策保存当时方案、证据和 founder 配置。

原文库保留全文、源地址、线程上下文和中文译文。接受原文只确认采集质量，与机会证据审核分开。原文重复快照不会自动增加机会可信度。

## 跨地区本地化机会

在「参考产品」点击「本地化研究」，可快捷选择美国→中东、美国→欧洲、美国→亚洲（不含中国），或自填A/B。研究输出来源成功依据、目标地区竞品/需求、首发国家、本地化策略和迁移风险；宽泛地区需进一步选择具体国家。未查到竞品不等于当地没有，A成功不代表B有需求。

机会档案可选择工作流/本地化类型，首页可按类型筛选。对本地化机会，每条声明须人工标注A或B归属；候选门槛要求已接受的A收入声明和B痛点声明，不能用A定价或A用户抱怨替代。改变类型或A/B会清空地区归属，要求重新核对。比较页使用B痛点与当地落地条件，资料变化使旧比较过期。

## 机会比较与来源覆盖

在「机会比较」点击「评估全部机会」，后台对所有未放弃机会（当前最多30条）做统一评估；不额外生成机会、不自动接受证据。需求25%、付费价值25%、开发20%、获客15%、个人匹配15%，每项1–5或未知。比较分是已知维度加权均值，覆盖不足60%或少于三个维度时不排序。它表示暂定验证优先级，不是商业成功概率；相同分数并列。评分前对照已有功能；疑似重合的方案暂不排名，无用户痛点声明时需求最多2分。差异检查仍是模型判断，应核对原文。在机会档案填写「优先级阻断原因」后，该项无论模型评分多高都不参与排名；问题解决后可清空并重新评估。

每项理由、最大未知和下一步验证动作可同时查看；无创始人资料时个人匹配强制未知。保存模型输入与输出快照，方案、证据、个人资料或机会集合变更后提示旧评估过期。来源面板按去重来源统计，另列原文版本数，明确未配置和未接入渠道。

「自定义搜索」（高级手动入口）支持 GitHub 公开 Issues、Stack Overflow 问题、HN 评论的跨产品关键词检索（过去两年，每渠道每次最多30条）。无需新增密钥，各渠道独立记录成功/空结果/失败，遵守API返回的退避。GitHub结果可人工加入参考产品并关联材料；问答/评论先核对是否已解决，不自动变成机会证据。

接口：[GitHub REST Search](https://docs.github.com/en/rest/search/search)、[Stack Exchange Advanced Search](https://api.stackexchange.com/docs/advanced-search)、[HN Algolia](https://hn.algolia.com/api)。Stack Overflow保留作者、原文和内容许可；只抓问题正文，未抓回答。GitHub只抓Issue正文，未抓评论。三个技术社区存在用户群偏差，未接入Reddit主题搜索、G2或Capterra。

## 实现与边界

- React 中文机会工作台，Fastify API，Postgres 原文/声明/机会/决策关系模型，独立 Worker。
- 追加迁移保留旧产品、原文、译文；产品具有独立 ID 和地址标识，域名不再唯一。
- 研究分别从最近 100 个产品来源和 100 个外部来源中去重，最多保留 2 个产品来源与 6 个外部来源，每篇前 12000 字符；模型输入包含发表时间、上下文完整性和截断标记。未覆盖全部采集材料。
- 反馈发现使用 [Hacker News Search API](https://hn.algolia.com/api)，按域名及明确产品名检索最近两年评论，单次最多 40 条，不需要 API 密钥。保留原文、作者与讨论链接，但不自动抓取完整父帖；需人工核对相关性。该参考产品反馈入口限于 HN；首页自动发现另包含 GitHub 和 Stack Overflow。
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

尚未实现全网搜索、持续定时扫描、实际访谈/付费实验执行与结果跟踪。现有模型通过项目配置调用，不读取其他应用凭据。

本版仅本机内部使用，没有身份系统；不要直接改为公网暴露。

### 网页爬虫

自动发现现在会在原有 HN、GitHub Issues、Stack Overflow、App Store、WordPress 搜索之外，自动调度 8 个网页站点：n8n 社区、Obsidian 论坛、Discourse Meta、Frappe 论坛、OpenAlternative、Launching Next、n8n 官网、Plausible 官网。不需要填写主题。

Python 使用 Playwright 1.62.0（Chromium 动态渲染）和 Trafilatura 2.2.0（正文提取），优先请求 HTML，正文不足时才尝试浏览器。每站每轮最多访问 12 页、40 秒，使用 robots.txt、至少 1 秒页面间隔和失败退避；不绕过登录、验证码或访问限制。限定站点和路径，社区列表只发现链接，不充当讨论证据。官网、目录材料保留类型，不能成为需求发现的直接证据，关键词统计不将其视为痛点或付费意图。

Docker 的 `crawler_state` 卷保存 SQLite 链接队列、条件请求缓存和任务重放结果。后续扫描继续尚未访问的页面，缓存默认 6 小时后重新验证。网页全文保持原文，并记录 URL、站点、提取方式与内容指纹；作者和时间无法确认时保持未知。网页面板显示每站访问、入库、渲染、缓存、受限与待访问数量。

内部接口：`GET /crawl/sites`、`POST /crawl`（`siteId`、`replayKey`）；前端目录接口 `GET /api/crawler`。扩展站点配置位于 `services/data-engine/crawl_sites.py`，新增前需验证 robots、列表和详情正文。当前是 8 个经过验证的站点增量采集，并非全网覆盖；目录内容或定价表也可能提取不完整。

### shadcn 管理工作台

前端采用官方 shadcn/ui 组件（Radix 基础组件）、Tailwind CSS v4 和 TanStack Table v8。`components.json` 定义组件目录，`apps/web/src/components/ui` 保存可维护源码；共享 `DataTable` 支持排序、分页、页大小调整，并保持后台刷新时所在页。主题在 `shadcn.css` / `admin.css`，旧业务布局暂保留在 legacy CSS layer 以保护复杂档案与证据流程。

- 自动发现历史：服务端分页、编号/报告摘要/机会标题搜索、状态筛选、时间排序、总数与10/20/50页大小；按轮次查看分析。
- 机会、发现结果、自定义搜索、参考产品、采集活动和原文：标准表格与详情操作。除历史外，表格分页作用于现有接口加载的数据；不会把局部数据伪称全库搜索。原文库外层仍使用现有服务端检索。
- 导入与证据检查使用 shadcn Dialog；中文翻译、来源审查、机会声明、验证决策、产品研究与创始人设置保留。
- 设置、机会详情、自定义搜索按需加载。移动端表格局部横向滚动。

组件参考：[shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)、[Data Table](https://ui.shadcn.com/docs/components/radix/data-table)。执行 `npm run build && npx playwright test` 验证核心业务、历史筛选、分页刷新与移动端。
