# Stagehand 配置

1. **运行模式**：选「自动」（默认）优先本机浏览器，不行再走云；或强制「仅本地 / 仅云端」。
2. **模型厂商**：选择后会预填模型名与兼容端点，可再手动改。
3. **模型 API Key**：填写对应厂商的 Key（工具进程内调用，与 Agent 配额无关）。
4. **Browserbase**（推荐）：在 [Browserbase Settings](https://www.browserbase.com/settings) 复制 API Key 与 Project ID。「仅云端」模式必填。
5. 安装并启用 Stagehand（Node ≥ 20）；改工具源码后请在工具箱「更新/重装」。

更多模型说明见 [Stagehand Models](https://docs.stagehand.dev/v3/configuration/models)。
