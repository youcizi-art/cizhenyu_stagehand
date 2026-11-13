# cizhenyu_stagehand

Stagehand MCP for 词真语 Deploy：**本地浏览器优先，Browserbase 云兜底**。

## 运行模式（`mode`）

| 值 | 行为 |
|----|------|
| `auto`（默认） | 本机有 Chrome/Edge/共享 Chromium → `LOCAL`；否则若配置了 Browserbase → 云 |
| `local` | 强制本机浏览器（Deploy 注入 `CIZHENYU_BROWSER_*`） |
| `browserbase` | 强制云浏览器 |

## Secrets（勿提交）

Deploy 写入 `CIZHENYU_AUTH_DIR/stagehand.json`：

```json
{
  "mode": "auto",
  "modelApiKey": "...",
  "modelName": "openai/gpt-4o-mini",
  "browserbaseApiKey": "...",
  "browserbaseProjectId": "..."
}
```

本地模式只需 `modelApiKey`。云模式另需 Browserbase 两项。

浏览器由 Deploy **共享策略**解析（系统 Chrome → Edge → 工作目录 `browsers/pw`），经环境变量注入，各工具不重复下载。

## Install / run

```bash
npm install
node mcp_launcher.mjs
```
