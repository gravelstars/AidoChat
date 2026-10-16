# 模型适配器（TASK-004）

`llm.Provider` / `Request` / `Usage` 的契约保持原样。`openai.New(baseURL, key)` 与 `anthropic.New(baseURL, key)` 返回文本流适配器；只传输已经由 contextbuilder 组装的请求，不生成群聊提示词。默认地址分别是 `https://api.openai.com/v1` 和 `https://api.anthropic.com`。

服务层可使用 `providers.New(nil)` 取得 `turn.Providers`。它按 `domain.Provider.Kind` 选择协议：

- `KeyRef` 非空时必须为 `provider:{id}`；通过系统钥匙串读取。条目不存在与钥匙串不可用分别返回明确错误，不降级。
- `KeyRef` 为空表示显式未配置 Key。OpenAI 兼容协议直接无鉴权调用，可用于本地 Ollama（`http://localhost:11434/v1`），不访问钥匙串；Anthropic 则报告缺少 Key。
- Key 仅由 `secret.Set/Get/Delete(providerID)` 在系统钥匙串处理：service=`ai-group-chat`，account=`provider:{id}`。保存服务配置时只把引用写入 `domain.Provider.KeyRef`，不能把 Key 放进 SQLite。
- HTTP 失败、流内错误、JSON 错误及钥匙串错误都不回显服务响应正文或底层错误，防止服务/代理在错误中回显凭证。不会记录请求头或 Key。

## 传输与协议

使用 net/http，共享连接池；建连、TLS 握手和等待响应头的超时分别为 15 秒。响应正文 60 秒未收到字节会取消请求；心跳和未成行的字节都会重置计时。没有总响应时长限制，调用方可以传入自己的 deadline。ctx 取消后不继续分发 Scanner 已缓冲的事件。

SSE 按事件组装，支持 CRLF、注释心跳、多行 data 和任意传输分片；单行/单事件上限 1MiB。未收到协议结束标记的 EOF 视为中断，不能把半截回答当成功。拒绝重定向，避免向其他地址转发凭证。服务地址只接受没有 userinfo、query、fragment 的 HTTP/HTTPS URL。

- OpenAI：`system` 为第一条消息；`stream_options.include_usage=true`；`[DONE]` 结束。仅转发文本 content，不转发工具参数或 reasoning_content。Usage 从服务返回的统计中读取，没有返回时保持零。
- Anthropic：system 为顶层字段；max_tokens 缺省 4096；版本头 `2023-06-01`。message_stop 结束，ping 和未知事件可忽略。文本块初值与 text_delta 均转发；Usage 使用累计统计，输入量包含缓存读取/创建量。
- 兼容协议不等于每家厂商均已真机验收；模型名、服务地址及参数必须由相应服务支持。不会在失败后自动重新发送请求，避免重复调用。

协议依据：[OpenAI Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)、[Anthropic Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming)。

## 验证

`go test -race ./internal/llm/... ./internal/secret` 使用 httptest 和假钥匙串，不写真实凭证。真实服务测试默认跳过；明确设置以下非敏感配置后单独运行（Key 必须事先保存在上述系统钥匙串条目，不能写进环境变量或代码）：

```sh
AI_GROUP_CHAT_LIVE_PROVIDER_ID=deepseek \
AI_GROUP_CHAT_LIVE_KIND=openai \
AI_GROUP_CHAT_LIVE_BASE_URL=https://api.deepseek.com \
AI_GROUP_CHAT_LIVE_MODEL=deepseek-flash \
go test ./internal/llm/providers -run '^TestLiveProvider$' -v -count=1
```

DeepSeek 的地址与当前模型名以[官方文档](https://api-docs.deepseek.com/)为准，测试模型可由用户改成其他可用名称。无 Key 的本地服务额外设置 `AI_GROUP_CHAT_LIVE_KEYLESS=1`。测试只发送“请只回复 OK”，输出上限 512 token（为可能的默认推理预留空间），只记录响应字节数和用量，不记录 Key 或响应全文。真实系统钥匙串的授权提示与三平台行为仍需分别真机验证。
