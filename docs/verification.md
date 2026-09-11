# Foundation Alpha 验证记录

日期：2026-09-11。工作目录：`/Users/huangqin/Documents/radar`。

## 可运行交付

Docker Compose 已实际启动：API、Worker、PostgreSQL 17 + pgvector。基础迁移与 vector 迁移通过。访问地址：http://127.0.0.1:4317 。原计划 4310 被 QQ 占用，因此项目改用 4317，未停止或修改 QQ。

本机 PostgreSQL 17（55432）用于独立数据库测试。市场数据在 Docker 的 `radar` 数据库；测试 fixture 在本机 `radar_test`，两者隔离。

## 已执行验证

| 检查 | 结果 |
| --- | --- |
| `npm test` | 8 个核心规则测试通过 |
| `npm run test:db` | 14 个 Postgres/API 集成测试通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，JS 约 255 KB / gzip 81 KB |
| `npx playwright test` | 1 个完整浏览器流程通过 |
| `npm audit` | 0 vulnerabilities |
| `docker compose up -d --build` | API/Worker 正常运行，DB healthy |
| pgvector migration | 已应用，运行时返回 vectorAvailable=true |
| 真实公开网页采集 | 3 个产品，5 个独立来源文档，10 个不可变版本快照 |

浏览器验证包含：关键词筛选、证据 drawer、审核保存及再次读取、无效 Reddit JSON 错误、Founder 配置刷新后持久化、手机导航、390px 无水平溢出、无 JS pageerror。测试自行创建 fixture，只写测试数据库。1440px 桌面截图和 390px 手机截图已目视检查。

关键后台约束覆盖：原文 UPDATE/DELETE 拒绝、重复导入幂等、变更追加快照、批量错误全部回滚、竞争领任务只有一个成功、旧租约无法完成、失败退避和最大次数、LLM 禁用失败审计且成本为 null、Reddit 父子/线程一致性、大线程根帖保留及显式截断、产品重定向别名合并、里程碑不重复计算新快照。

独立代码审查发现的三个问题已修复，并补回归测试：跨线程 parent_id、产品域名重定向去重、300 条 context 截断丢根帖。网页块级段落分隔也已修正；已有旧版本保持不可变，新抓取使用新解析器。

## 实际市场数据

成功采集：

- Plausible Analytics：https://plausible.io/
- Buffer：https://buffer.com/pricing 与 https://buffer.com/open
- Buttondown：https://buttondown.com/ 与 https://buttondown.com/pricing

5 个来源均保留标题、正文、URL、采集时间和原始 HTML。首次采集后改进段落提取，再次采集生成新快照，因此有 10 个版本；里程碑仍计 5 个来源文档。

尝试 `https://plausible.io/open` 返回 404，4 次有限重试后 failed。失败记录保留，没有作为产品证据入库；后续 smoke 脚本移除此失效地址。

当前：Reddit 原文 0；收入信号 0；人工接受 0；机会 0。生产库未导入测试 fixture、模型生成正文或虚构收入。抓到定价页不代表付费用户或收入已获验证。

## 尚未达成的门禁

- Milestone 1 的 200 真产品 / 500 真市场文档（含 Reddit）尚未达到。
- 未提供 Reddit OAuth token；OAuth 网络路径未做真实账户验证。线程 JSON 解析与导入已测试，但不等于实时 Reddit 已连通。
- 真实输入尚需 founder 人工审核；质量门禁保持关闭。
- 痛点抽取、embedding/semantic judge、Problem Clusters、SEO 分析、机会评分、Deep Research、Bull/Bear/Judge、Validation Plan 与 KILL 业务流程尚未实现。
- LLM 是接口、禁用 adapter 与审计基础，prompt 是版本化基础约束，不是可投入生产的角色工作流。
- 静态 HTML 抽取不会执行页面 JavaScript，复杂动态定价内容需要检查；不自动解决访问挑战。网站快照每次可变，内容去重不等同于语义或来源独立性判定。

因此本次结论是 **Foundation Alpha 可运行**，不是完整 V1 验收通过。
