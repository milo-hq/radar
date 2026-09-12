# 跨地区本地化机会

新增明确机会类型localization：A地成功的参考模式，在B地围绕真实当地差异提供独立实现。保留workflow类型默认兼容。A/B可自由填写，不预设用户地区。

- dossier: opportunityType,sourceMarket,targetMarket,sourceSuccess,localAlternatives,localDemand,localizationStrategy,transferRisks。研究请求显式选择A/B并在服务端固定输出类型与地区；不能将无搜索结果等同空白市场。
- opportunity_claims.market_role：general/source/target，人工逐机会标记；localization readiness要求不同且非空A/B、已接受A收入声明（定价不可替代）、已接受B痛点声明。原workflow门槛不变；更改A/B时清空市场角色，防旧地区审核沿用。
- 参考产品页发起本地化研究；档案可编辑类型与地区，证据选择归属。首页类型筛选、标签。比较考虑当地需求/竞争、支付、语言、渠道、经营限制和迁移成本；不把A地区成功视为B验证。
- 测试默认兼容、A痛点不能解锁B、地区变更清角色、研究请求校验。迁移010、构建、浏览器、部署。

用户明确优先方向：美国→中东、美国→欧洲、美国→亚洲（不含中国）。实现为可编辑快捷预设，增加entryMarket首发国家字段；区域不是单一市场。
