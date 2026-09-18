# Reddit Browser Implementation Plan

Goal: Connect logged-in Chrome public Reddit reads to discovery and radar analysis.
Architecture: Local paired MV3 extension, token-fenced HTTP job lease, existing immutable raw documents and scan pipeline.
Spec: ../specs/2026-09-18-reddit-browser-design.md

- [x] Test and implement strict browser snapshot normalization: reject cross-community/mismatched URLs, deduplicate comments, keep partial context.
- [x] Test and implement migration + bridge API: pairing, auth, exclusive lease, heartbeat, incremental snapshots, pause/resume, completion, timeouts. Normal worker must never claim browser work.
- [x] Extend autonomous planner with paired browser jobs and explicit unavailable coverage.
- [x] Implement MV3 popup/background/page extractor. Use own tab; persist session task/progress; bounded polling, heartbeat, recoverable stop; no credential extraction or private page access.
- [x] Add settings connection controls and job feedback.
- [x] Run typecheck, unit/database tests, browser extraction fixture; build and deploy API/worker/migration. Verify visible UI. Package extension and give exact install/pair steps; do not claim live extension test before installation.

## 验证结果与交接

- 类型检查和前端构建通过；19 项原有单测、50 项数据库测试、9 项 UI 测试、1 项 DOM 提取测试、1 项隔离 Chromium MV3 端到端测试通过。
- 独立审查修复缺失父评论 ID 和过期任务遗留标签页，均有复现和回归测试。
- 本机 Docker API/worker 已部署，015 迁移已执行，设置页面可见。Docker Hub 元数据请求超时，本次以本机已有 Node 22 应用镜像为基础构建；没有修改标准 Dockerfile。
- 扩展源目录为 extensions/reddit-reader，打包副本在 .local/reddit-reader.zip。尚未安装到用户日常 Chrome；真实 Reddit 的完整后台链路和长期稳定性仍待安装后验证。
