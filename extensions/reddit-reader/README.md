# Reddit 浏览器采集

此扩展让本机 Radar 的任务在正常 Chrome 登录会话中运行。无 OAuth、Cookie 导出或验证码自动处理。它读取公开社区 DOM；不会读取私信、发帖、投票或绕过访问拦截。

## 安装

1. 先运行 Radar（默认 http://127.0.0.1:4317）。
2. 打开 Chrome 的扩展管理页，开启开发者模式，点击“加载已解压的扩展程序”，选择本目录。
3. 同一个 Chrome 登录 Reddit。
4. Radar → 创始人设置 → Reddit 浏览器采集 → 生成连接码。
5. 打开扩展弹窗，粘贴连接码，点击“连接 / 继续”。连接码只存本机扩展；服务端只存哈希。重新生成会使旧码失效。
6. 点击 Radar 的“采集 Reddit 并分析”，或正常启动自动发现。结果进入材料库和自动发现历史。

任务在扩展创建的标签页执行。请保持 Chrome 开启。停止按钮停止继续调度；当前正在执行的短步骤可能完成。遇到登录/验证码时暂停，用户在采集标签页处理后点击继续；不会自动处理验证码。网络中断自动重试；服务 worker 休眠后由 alarm 恢复，租约失效后重新领取。单轮任务等待上限 30 分钟，超时保留已入库部分数据并进入分析。

默认 4 个社区，每社区最多 6 个文字帖、3 次列表滚动、每帖 30 条已渲染评论。展开当前折叠评论一次，不保证加载全部回复。广告、空文、已删除文本排除。ID 去重和事务确保同一任务的同一帖子重复上传幂等。每份材料永远标注 contextComplete=false，不把抓取上限当成完整讨论。

## 权限和边界

- scripting：读取 Reddit 页面和操作滚动/折叠评论。
- storage：保存本机连接码、开关、任务进度。
- alarms：从服务 worker 休眠恢复。
- host_permissions：https://www.reddit.com/* 和 http://127.0.0.1/*（Chrome 匹配规则不限制端口；代码固定请求 4317 的浏览器专用路由）。
- 不申请 cookies/history/tabs 权限，不加载远程代码。后台仅使用自己创建的标签页。

## 验证

`npm run test:browser-reader` 检查真实 Chromium 中的 DOM 提取；`npm run test:db` 覆盖配对认证、租约隔离、去重、暂停恢复与雷达接入。现有用户会话读取验证记录在 `.local/reddit-probe/REPORT.md`。这些测试不等同于用户安装后的长期运行验证。

实现参考：[Chrome scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)、[Service worker events](https://developer.chrome.com/docs/extensions/get-started/tutorial/service-worker-events)。

## 工具痛点搜索（2026-09-18）

新任务搜索近一年的工具替代、价格抱怨、缺失功能及手工工作流，不再只浏览最新帖子。搜索结果按标题线索优先读取用户求助，自荐宣传降权；这只是采集优先级，不代表需求已验证。每社区仍最多读取 6 帖、每帖最多 30 条已渲染评论，未加载内容不计入。

更新代码后，在 Chrome 扩展管理页重新加载本扩展；若状态为暂停，在扩展弹窗点“连接 / 继续”。后端升级不会自动更新已运行的扩展脚本。
