# 中文阅读助手

在证据详情中打开「中文译文与要点」。配置模型后，点击「生成中文译文与要点」：

- 完整正文分段翻译为简体中文，保留品牌、金额、周期和上下文。
- 中文关键信息与译文分开显示，每条要点附可以展开的原文摘录。
- 要点是对来源陈述的摘要，不代表系统验证了收入、用户需求或商业成功。
- 原始正文和原始 Payload 保留不变，随时可切回。
- 已完成的译文缓存到数据库；列表优先显示中文标题和摘要，并支持中文搜索。
- 不自动批量调用模型，只在用户请求后入队。长文以约 4000 字符分段，最多 50 段；每个任务最多 2 次尝试，成功段落可复用，避免全部重译。

## 本地配置

编辑项目根目录的 `.env`（已加入 Git 忽略规则）：

```dotenv
TRANSLATION_API_KEY=服务商密钥
TRANSLATION_MODEL=账户可用的模型名称
TRANSLATION_BASE_URL=https://api.openai.com/v1
```

最后一项是默认 OpenAI 地址，可改为其他服务商的 HTTPS API 基地址。接口需要兼容 `POST /chat/completions` 和 `response_format: {type: "json_object"}`。服务端仍会用 Zod 校验输出和原文引用。不会把 API Key 发往浏览器，也不需要把密钥发在聊天里。也可复用已设置的 `OPENAI_API_KEY`。

保存后执行：

```bash
docker compose up -d api worker
```

在 Settings 的「中文阅读助手」检查状态，重新打开证据页面。如果修改模型/接口配置，已有译文依然可以读取；本版没有强制重新生成已有成功译文的按钮。

## 实现

- `document_translations` 保存译文、要点、模型和时间，通过原文 ID / prompt version 关联。
- `translation_chunks` 保存已完成片段；`raw_documents` 不改写。
- `TRANSLATE_DOCUMENT` 复用 Postgres job queue；Worker 在每段调用前后续租，过期租约停止提交。
- 版本化 prompt：`prompts/translate-chinese/v1.md`。
- 每次模型调用写入 `model_runs`；无法取得实际费用时记录 null，不伪造成本。
- 拒绝模型未完整返回、无效结构、找不到原文出处的要点。语义翻译准确性仍需人工核对。

## 验证边界

开发时未配置真实模型密钥，因此未向外部模型发送真实市场数据。通过的是结构化接口适配、分段/引用校验、缓存/续传、API 和浏览器流程测试；测试译文只存在独立测试数据库中。不能把测试通过等同于真实翻译质量已经验收。

接口参考：https://developers.openai.com/api/docs/guides/structured-outputs
