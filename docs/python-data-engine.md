# Python 数据引擎

这是已接入主流程的计算与采集模块，而不是独立演示脚本。React/Fastify保留交互、Postgres追加原文和任务状态；Python负责采集和数值分析。没有第二套任务队列。

## 实际链路

自动规划4个方向 → 每方向5个渠道检索任务 → 按来源/正文去重及排除已解决问题 → `RADAR_ANALYZE` 调用Python → 保存 `radar_scans.analytics` → 按文本分组安排30篇一批的模型提取 → 结合统计汇总、复核及发布。网络与计算在数据库事务外；持久化分析和生成后续任务与完成租约在同一事务。

Python不可用时重试任务并显示失败，不静默返回零分或假装完成。所有合格原文必须恰好出现在一次分组中，Node验证文档ID集合后才能保存。历史扫描允许analytics为空，不伪造历史指标。

## 技术分工

- FastAPI/Pydantic：内部接口与输入校验；无公网端口。
- HTTPX：固定公开接口、流式响应上限、超时和限流退避。
- Polars：按来源聚合，统计关键词特征。
- scikit-learn：字符TF-IDF及余弦相似度，阈值0.58的连通分组；这不是跨语言语义理解，间接连接也可能产生松散分组。
- PostgreSQL：仍是原文和任务唯一状态源；Python无数据库凭据、无业务写入。

## 首版六维指标

| 维度 | 计算依据 | 权重 |
|---|---|---:|
| 重复出现 | 去除复制内容影响后的来源账号数量，超过1个后递增，5个封顶 | 30% |
| 跨渠道 | 独立正文来源一致时覆盖的渠道，3个封顶 | 20% |
| 近期性 | 全部去重内容中已知近30天的比例；日期缺失、未来时间为未知 | 15% |
| 痛点措辞 | 有痛点词的独立正文比例 | 15% |
| 价格/收费措辞 | 有价格、购买、订阅词的独立正文比例 | 10% |
| 手动处理/替代方案 | 有手工、重复、表格等词的独立正文比例 | 10% |

这是证据检查优先分，不是商业价值/成功率评分。词语匹配使用中英文词表，不等于真实意图识别；例如“愿意付费”和“不愿付费”不能仅凭关键词分辨。未观察到匹配记0，不代表痛点不存在。缺失日期不按已知项重新放大得分。来源账号不等于独立真人；复制正文合并计数，来源冲突不增加渠道票数；只有所有副本日期有效时才使用最早日期，避免复制日期抬高新鲜度。超过40000字符的文档传递完整正文SHA256指纹，避免截断把不同正文误当重复。付费意愿、市场规模、获客可行性、开发工期与本地化空白仍须证据支持。

## 采集渠道

保留Node的HN/GitHub/StackOverflow；Python新增以下适配器：

- WordPress：官方插件搜索后采集公开评价RSS，每查询最多2插件×20条评价，最近730天。已实测booking、invoice、woocommerce各40条。保留产品、日期、作者、原文链接；未获取评分时不编造。
- App Store：Apple Search后尝试公开客户评论RSS，每查询最多2应用×20条。实测应用搜索可用，但多个真实应用评论接口返回200空数据，当前不保证评论可获取。界面按实际结果计数，不能称已覆盖Apple用户需求。

完整关键词空结果时仅允许一次首词扩展，并保存实际查询和原查询。每轮最多20个检索任务、680份返回材料（不等于680份新增或有效材料）。保留渠道错误与部分失败；无密钥的公开接口不是稳定性承诺。

原文来源：[Apple Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)、[WordPress插件API](https://api.wordpress.org/plugins/info/1.2/)、[公开评价RSS示例](https://wordpress.org/support/plugin/woocommerce/reviews/feed/)。

## 运行与检查

```sh
docker compose up -d --build api worker data-engine
docker compose exec -T data-engine python -m unittest discover -s tests -v
```

本地开发（Python3.12+）：

```sh
python3 -m venv .local/python-venv
.local/python-venv/bin/pip install -r services/data-engine/requirements.txt
PYTHONPATH=services/data-engine .local/python-venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

Node配置 `DATA_ENGINE_URL=http://127.0.0.1:8000`，Compose使用内部主机data-engine。测试 `npm run test:python`、`npm test`、`npm run test:db`。端点：`GET /health`、`POST /analyze`、`POST /collect`。

输入最多1000篇、正文40000字符，统计用规范化正文前6000字符，TF-IDF最多24000特征；HTTP请求体48MiB、单次Node调用60秒，计算限时20秒为协作式检查，不是强制进程中断。生产还未完成大规模负载验证，不将首版称为无限规模采集平台。
