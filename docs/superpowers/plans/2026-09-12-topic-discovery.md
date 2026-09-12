# 主题发现与新增渠道

扩展已授权的数据采集：GitHub公开Issues、Stack Overflow问题、HN主题评论，脱离已有产品池。每主题每渠道独立任务/状态，单渠道最多30条，过去两年；保留作者、时间、URL、正文和上下文边界。API固定主机、超时与响应限额，失败可见，退避持久化。无密钥，无自动登录或绕过权限。

实现：migration009（来源/主题采集关联与冷却）；topic connector（规范化三API响应）；API GET/POST discovery与worker原子保存；React主题发现页面与新来源筛选；GitHub来源可人工加入参考产品并关联材料。默认三个主题是探索示例，不声称与用户匹配。不自动生成/接受商业证据。

验收：纯连接器过滤、去重、URL与上下文测试；API去重任务、关联保存；真实三主题三渠道采集计数、UI桌面手机，部署提交。所有接口规范参考官方GitHub REST Search、Stack Exchange advanced-search、HN Algolia API。
