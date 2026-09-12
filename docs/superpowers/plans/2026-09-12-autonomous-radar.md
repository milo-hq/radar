# 自动机会发现主流程

用户纠正：不知道做什么才使用雷达，不应要求输入主题或先审核几百条原文。实现默认首页自动发现报告，用户点击一次更新即可，保留高级手动搜索。

1. Radar扫描独立持久化：planning→collecting→analyzing→reporting→complete/failed。模型选择4个不同搜索方向，复用现有3渠道（每项30条），故每轮最多360份来源。子任务独立、幂等、失败可见、沿用渠道冷却。
2. 每个最新原文来源去重并合并相同正文；已关闭GitHub/已回答SO保留在覆盖统计但排除未满足需求提取。其余按30篇分批（每篇最多4000字符，明确截断），每批最多8条带精确原文行号的需求摘录。全轮全部合格材料均进入批处理，不悄悄只取8篇。
3. 综合全部提取结果，合并同类问题、排除单个代码缺陷/已覆盖方案，产生0–5个完整产品建议，排序理由、目标用户、MVP、可行性、付费假设、风险、无需开发的验证动作。原文ID固定引用，程序复制引文及计算独立作者/平台数。没有足够材料可返回空报告并解释，不伪造“成功产品”。
4. GET /api/radar → {latest:{id,status,created_at,updated_at,plan,coverage,report,error,jobs:[{type,status,...}]},configured}; POST /api/radar → {scanId}，无输入主题；复用活动扫描。report={summary,recommendations:[{id,title,buyer,problem,solution,whyPriority,feasibility,monetization,risks,nextStep,evidence:[{documentId,title,url,quote,source,author}],confidence,independentVoices,platforms}],rejectedSummary}。status枚举同上。plan={queries:[{query,reason}]}；coverage={collected,eligible,excluded,duplicates,analyzed,failedJobs,sourceCounts}。
5. 默认进入自动发现（page=radar），新组件WorkspaceRadar；原discovery页保留作为高级自定义搜索。无需先筛选材料、输入主题或手动接受声明才能看建议。自动建议是研究输出，不改写既有审核记录，也不将假设标为已验证。
6. 测试幂等、任务推进/失败、全来源批处理、精确引文、模型ID校验与租约；真实运行一轮与浏览器检查。使用已有API密钥，不新设外部账户/定时自动化。

用户偏好：美国→中东、欧洲、亚洲（不含中国）；只能作为探索偏好，不假设当地空白。缺个人资料仍未知；不以此阻塞系统的初步推荐。

真实运行后补充：生成初稿后增加独立 radar-audit 结构化复核，逐项对照原文，拒绝无依据需求/竞品/付费断言，排除机构采购安全大系统、泛平台和人脉社区。两次模型请求之间续租，最终只发布复核结果；空结果也必须如实展示。
