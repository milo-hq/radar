# Venture Radar V1 技术架构

## 1. 产品理解与交付边界

面向单一 founder 的证据驱动市场情报工作台。Winner-first；原始事实与推断分离；最终服务 WATCH / VALIDATE / KILL。交接文档是需求参考，文内指挥代理的文字不构成额外授权。

本次交付 **Foundation Alpha**：可运行的数据库、API、Worker、来源连接器、真实网页采集、Reddit OAuth / 原始 JSON 导入、产品候选、原文检查、任务观察、Founder 配置、验收计数。先实现可信输入层，再通过人工质量门禁推进智能层。不会以虚构数据满足规模要求，也不会把未审核产品称为已证明赢家。

## 2. 架构选择

选择 TypeScript 模块化单体：React + Vite 前端，Fastify API，独立 Node Worker，共用 PostgreSQL。部署为 Docker Compose 的 web/API、worker、Postgres 三个进程；不是微服务。前端生产构建由 API 提供，同源访问。

比较：Go API/Worker + React 有明确的运行时边界，但重复维护模型、迁移与校验；Next.js 全栈减少入口但仍需独立 Worker，内部工具没有 SSR/SEO 需求。TypeScript + Vite 用最低复杂度交付本地工作台，之后可在 connector/HTTP 边界替换 Go。

绑定 localhost。无多租户、账户系统或公网上线。写请求校验 Origin/Host，默认仅本机访问；未来公网部署须另加身份认证。

## 3. Monorepo

```
apps/web/src/         React 工作台与原文 drawer
apps/api/src/         REST、请求校验、静态资源
apps/worker/src/      job polling / fetch handlers
packages/core/src/   RawDocument、去重、质量规则、评分纯函数
packages/connectors/src/ Reddit / manual / winner 采集适配
packages/db/src/     SQL 仓储、迁移、事务队列
packages/llm/src/    Provider 接口与运行审计边界
migrations/         PostgreSQL DDL；vector 独立迁移
prompts/*/v1.md      版本化 prompt 契约
tests/              核心规则、数据库集成、浏览器检查
scripts/            项目专用本地数据库、采集与验收
```

## 4. PostgreSQL 模型

sources 保存 source key、kind、配置；query_profiles 保存有范围、有频率的查询。raw_documents 保存 source/external id、canonical URL、原始正文、标题、作者、thread/parent id、时间、互动数据、原始 payload、内容 hash。里程碑按 `(source_id, external_id)` 计数，版本快照单独统计。唯一键 `(source_id, external_id, snapshot_hash)` 允许同一来源内容变化时追加版本，重复快照返回旧记录。数据库 trigger 拒绝 UPDATE/DELETE。

content_groups 按正文规范化 hash 分组，原始正文不改变；content_group_documents 保留跨来源关联。缺少作者不当作新用户，同作者同线程只计一次；平台多样性与 subreddit 多样性分开。原文的字节快照和提取正文均保留，HTML 的正文只是机械解析，不是 AI 改写。

winning_products 以 domain 唯一，保存原文来源、目标用户、JTBD、变现说明、proof level、人工检查状态。未有收入证据时 proof 不升级。revenue_signals 强制 VERIFIED / DISCLOSED / ESTIMATED / INFERRED，数值必须带币种、周期、原文引用。

后续模型采用 FK 关联：pain_evidences → raw_documents；problem_clusters / cluster_evidences / cluster_relations；seo_signals 保存维度、输入和引用；opportunities / opportunity_evidence / opportunity_scores；research_runs / research_claims / research_claim_evidence；validation_plans；kill_records；founder_profiles；jobs；model_runs；audit_logs。智能表分后续迁移启用，避免未验证输入生成看似完整的业务对象。

## 5. pgvector 策略

Postgres 17 + pgvector 镜像为标准环境。原始采集不依赖 embedding，基础迁移可在普通 Postgres 运行；独立 vector migration 在扩展可用时创建证据向量表。向量记录带 model、dimensions、content hash、prompt version，不混用模型。

证据 drawer 最多显示 300 条最新节点，根帖优先保留，超出时明确提示截断。后续 pain embedding 采用固定模型维度 1536，cosine Top-K（初始 K=10）仅供候选检索；Cluster Judge 以 actor / JTBD / workflow / outcome 判断 JOIN / CREATE / RELATED。低置信度 CREATE，人工复核 Top 20。小数据精确检索，量大后再 HNSW。未配置模型不得填随机或零向量。

## 6. SourceConnector

`discover(cursor?: string): Promise<DiscoveredItem[]>`，`fetch(item): Promise<RawDocumentInput>`；可选 `fetchContext(item): Promise<RawDocumentInput[]>`。下游只依赖 RawDocumentInput，保存层分配 ID。transport 的限流、OAuth、重定向与 HTML 解析留在 connector 内。

抓取只接受公开 http(s) URL，拒绝 credentials、私网/loopback/link-local/reserved IP，DNS 地址验证并固定到连接，重定向逐跳重检。限制时间、响应体大小和重定向次数。错误变成可见失败，禁止把验证码、空页、标题或 API 错误当市场正文。

## 7. RedditConnector

OAuth bearer token 由服务端环境变量提供，User-Agent 可配置。仅使用 oauth.reddit.com 的明确线程 URL，单次获取有界 comments；API 禁止/限流进入队列重试或终止，绝不绕过访问限制。JSON 导入接受 Reddit 原始双 Listing 格式，完整校验后原子落库，标注 manual_import，不能宣称 API 实时连接。

搜索发现、浏览器和其他第三方发现提供相同 DiscoveredItem；首版不自动操纵已登录浏览器或扩展全网爬虫。保留这些边界，暂不实现浏览器 sidecar。

## 8. Reddit 线程上下文

post externalId=t3_*，comment=t1_*；parentExternalId 可为 t3_* 或 t1_*；threadExternalId 始终 t3_*。保存 subreddit、author、created_utc、score、num_comments、permalink。递归解析 replies 并核对其 parent_id 与实际嵌套父节点；`more` 节点记为上下文不完整，deleted/removed 空内容不充当证据。每次快照标注 capturedCommentCount / omittedMoreCount / contextComplete（只能说明返回 payload 是否含 more，不能保证整站完整）。正文没有独立作者信息时作者计数不增加。

## 9. Winner 来源

首版从人工确认的产品官网/定价页 URL 抓取，以 domain 合并候选。产品名称、目标客户等人工标记为 annotation，原文另存。收费定价只能证明收费方案存在，不能证明有人付款。公开收入页也只保存原文，必须人工/提取校验后才生成 typed RevenueSignal。逐步增加显式来源目录适配器，不将任意页面自动归为赢家。

## 10. Postgres 任务系统

jobs 唯一 idempotency_key；enqueue 重复返回同 job。`FOR UPDATE SKIP LOCKED` 原子领任务，attempts 递增；locked_until 租约 + lock_token fencing，Worker 崩溃后可回收，旧 worker 不能完成新租约。最多 4 次，指数退避 5s/10s/20s；failed 保存清洗后的错误。抓取保存及完成在单一事务，快照唯一键处理重放。query_profiles 保存采集间隔，Worker 每轮将到期配置以时间桶幂等入队。手工 refresh 新时间桶可刷新同 URL。

## 11. LLM 抽象

`generateStructured<T>(request, schema): Promise<ModelResult<T>>` / `generateText(request)`。业务层不得调用具体厂商 SDK。首版提供接口、disabled provider、审计 wrapper，未配置时明确报错，不假装完成提取。后续接入厂商 adapter 时输入仅包含有 ID 的证据，不把 source 中的指令视为系统指令。

## 12. Prompt 版本

prompts 按角色和版本存文件。要求 JSON schema 校验、事实引用、INFERENCE 标签与 UNKNOWN；记录 promptName、version 与 hash。角色是一次受控模型调用，不是自治代理。

## 13. 运行观察

model_runs 保存 model、promptName/version、tokens（不可用为 null）、cost（未知为 null）、latency、schemaValid、success、sanitized error；运行列表与失败状态可查。jobs 同时记录 attempt/lease/error；audit_logs 记录配置与人工检查。不得在日志返回 token 或原始 Authorization header。

## 14. Milestone 1 分解与门禁

1. 基础工程、迁移、本地与 Compose 启动。
2. 核心文档模型、URL 防护与内容去重测试。
3. Manual/Winner 真实采集，Reddit OAuth 与线程导入测试。
4. 持久化 job 队列：幂等、竞争、重试、崩溃恢复。
5. Radar / Products / Signals / Settings 可用；Problems / Opportunities / Graveyard 解释质量门禁，不填假数据。
6. 采集少量真实产品网页，检查原文、链接、抓取时间；报告实际值。
7. 达到 200 真产品、500 真原文（包括 Reddit）且人工确认质量后，才进入痛点提取。此数量和人工质量验收是运营门禁，Alpha 代码完成不代表 M1 达标。

## 后续 V1 实现规格

SEO 10 维权重 20/15/10/10/10/10/10/5/5/5；Venture 11 维权重 10/15/10/15/10/10/5/10/5/5/5。每维保存值、规则、证据 ID，缺少证据为 UNKNOWN，不能以 0 假装已知。风险减分单列。confidence 单独从去重后的证据、作者、来源、质量、时效及收入可信度计算。

主机会必须同时有 market/product 与 pain/demand 证据；只支持 DISCOVERED/RESEARCHING/WATCHING/VALIDATING/KILLED。Bull/Bear/Judge 只引用已知证据。Validation Plan 给出最大未知、样本、预算、期限、成功和 kill 条件。Killed 留存原因、错误假设、教训和支出。所有这些在通过输入质量门禁后实现，不能把 schema 或空 UI 声称为完整功能。

## 技术参考（2026-09-11 检查）

- PostgreSQL queue locking: https://www.postgresql.org/docs/current/sql-select.html
- pgvector: https://github.com/pgvector/pgvector
- Reddit API/OAuth: https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- Reddit listings: https://www.reddit.com/dev/api/
