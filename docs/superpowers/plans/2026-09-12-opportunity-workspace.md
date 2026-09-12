# Opportunity Workspace Implementation Plan

**Goal:** 让独立开发者从真实产品材料形成可审阅、可补证、可验证的机会。
**Architecture:** 保留 Fastify / React / Postgres / Worker，增加机会领域模块和独立关系表，替换首页。
**Spec:** docs/superpowers/specs/2026-09-12-opportunity-workspace-design.md

- [x] 1. tests/opportunities.test.ts 先验证 /workspace/opportunities 可用、无证据只能草稿、非法摘录拒绝、接受/拒绝改变准入、VALIDATE 校验计划与不可覆盖历史；新增 migration 004 和 packages/opportunities/src/service.ts，apps/api/src/opportunities.ts。
- [x] 2. packages/opportunities/src/research.ts：模型输入行带编号，schema 严格验证引用；事务保存所有声明和机会；apps/worker/src/worker.ts 增加 ANALYZE_PRODUCT，失去租约不提交；用假 transport 验证错引用/重试不重复。
- [x] 3. apps/web/src/App.tsx 和 opportunity-workspace.css 重写中文机会工作台，拆出详情/编辑等组件。对接下面接口，保留原文 drawer 与导入弹窗。由 UI 子代理实现，父代理做接口集成和最终审阅。
- [x] 4. Docker 备份、迁移、构建；真实研究运行与浏览器检查；更新 README / verification，提交代码。

## API contract
所有路径在 /api 下，错误 {error:string}，集合 {items:[]}
GET /workspace -> {opportunities,products,claims,ready,drafts,killed,researchConfigured}
GET /opportunities -> {items:[{id,product_id,title,status,dossier,created_at,readiness:{ready:boolean,missing:string[]},claims:Claim[]}]}
POST /opportunities {productId,title,dossier} -> opportunity; PATCH /opportunities/:id {title,dossier} -> {ok:true}
GET /opportunities/:id -> opportunity + decisions[] + founder_snapshot
POST /opportunities/:id/claims {claimId} -> {ok:true}
POST /opportunities/:id/decisions {decision:'WATCH'|'VALIDATE'|'KILL',reason} -> {ok:true}
GET /claims?productId= -> {items:Claim[]}; POST /claims {productId,documentId,kind,statement,quote} -> Claim
PATCH /claims/:id {reviewStatus:'accepted'|'rejected'|'pending',opportunityId?:string} -> {ok:true}
Claim: {id,product_id,raw_document_id,kind:'market'|'pain'|'revenue'|'distribution',statement,quote,review_status,url}
Dossier: {customer,buyer,job,gap,offer,monetization,acquisition,buildEstimate,maintenance,risks,unknowns,validation:{test,budget,duration,success,kill}} all strings (validation object). Blank strings mean unknown.
GET /products existing response with documents[]. POST /products {name,url} -> product. POST /products/:id/documents {documentId} -> {ok:true}.
POST /products/:id/research {} -> {jobId}; GET /jobs existing response polling.
GET /documents existing, /documents/:id existing. GET/PUT /founder existing with additional optional hoursPerWeek,maxBuildWeeks,budget,maintenanceTolerance string fields.

Ruling: 用户已明确授权重设计重写，执行上一轮已呈现的目标模型；不再重复请求设计许可。工作在现有 feature 分支以便当前 Docker 使用，保留未提交的翻译修复。

Ruling: 真实模型会混淆原文行号与声明下标，研究改为独立 evidence / proposal 两次调用，第二阶段只接收固定 C0/C1 声明 ID。机会证据审核独立于声明全局状态，复用旧声明仍待审。
