# cizhenyu_stagehand

Thin Stagehand MCP (Browserbase) for 词真语 Deploy.

## Secrets

Never commit keys. Deploy injects `CIZHENYU_AUTH_DIR/stagehand.json`:

```json
{
  "browserbaseApiKey": "...",
  "browserbaseProjectId": "...",
  "modelApiKey": "..."
}
```

Or process env: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `OPENAI_API_KEY`.

## Install / run

```bash
npm install
node mcp_launcher.mjs
```
