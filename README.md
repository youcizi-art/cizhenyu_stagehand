# cizhenyu_stagehand

Stagehand MCP for 磁帧鱼 Deploy：**本地浏览器优先，Browserbase 云兜底**；**模型由配置驱动，不写死厂商**。

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
  "modelProvider": "deepseek",
  "modelName": "deepseek/deepseek-chat",
  "modelApiKey": "...",
  "modelBaseUrl": "",
  "browserbaseApiKey": "...",
  "browserbaseProjectId": "..."
}
```

| 字段 | 说明 |
|------|------|
| `modelName` | **必填**。一等公民可用裸名（`gpt-4o-mini`、`gemini-2.0-flash`）；AISDK / 兼容端点用 `provider/model` |
| `modelApiKey` | **必填**。对应厂商 Key |
| `modelBaseUrl` | 可选。Kimi / GLM / 千问等 OpenAI 兼容端点 |
| `modelProvider` | 可选。Deploy UI 厂商预设 ID |

国内示例：

- DeepSeek：`deepseek/deepseek-chat`（SDK 内置）
- Kimi：`openai/moonshot-v1-auto` + `https://api.moonshot.cn/v1`
- GLM：`openai/glm-4-flash` + `https://open.bigmodel.cn/api/paas/v4`
- 千问：`openai/qwen-plus` + DashScope compatible-mode URL

`browserbaseProjectId` 可省略或由 Deploy 选择：启动时用**当前 API Key** 列出项目并校验；
若已存 ID 不属于该 Key（换 Key / 旧残留），会丢弃并改选 `updatedAt` 最新的项目。**无写死他人 Project ID。**

浏览器由 Deploy 共享策略解析（Chrome → Edge → `browsers/pw`）。

## Install / run

```bash
npm install
node mcp_launcher.mjs
```

需要 Node ≥ 20。Deploy 工具箱重装后才会更新到本机安装副本。
