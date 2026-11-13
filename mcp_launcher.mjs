#!/usr/bin/env node
/**
 * Stagehand MCP — local browser (shared Chrome/Edge/Chromium) by default,
 * Browserbase as fallback. Credentials via Deploy auth dir / process env.
 */
import fs from "node:fs";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Stagehand } from "@browserbasehq/stagehand";

function authDir() {
  const a = (process.env.CIZHENYU_AUTH_DIR || process.env.SEOGEO_AUTH_DIR || "").trim();
  return a || null;
}

function loadSecrets() {
  const out = {
    mode: (process.env.STAGEHAND_MODE || "auto").trim().toLowerCase(),
    browserbaseApiKey:
      process.env.BROWSERBASE_API_KEY || process.env.STAGEHAND_BROWSERBASE_API_KEY || "",
    browserbaseProjectId:
      process.env.BROWSERBASE_PROJECT_ID || process.env.STAGEHAND_BROWSERBASE_PROJECT_ID || "",
    modelApiKey: process.env.OPENAI_API_KEY || process.env.STAGEHAND_MODEL_API_KEY || "",
    modelName: process.env.STAGEHAND_MODEL_NAME || "openai/gpt-4o-mini",
    browserExecutable:
      process.env.CIZHENYU_BROWSER_EXECUTABLE || process.env.STAGEHAND_BROWSER_EXECUTABLE || "",
    browserChannel:
      process.env.CIZHENYU_BROWSER_CHANNEL || process.env.STAGEHAND_BROWSER_CHANNEL || "",
    browserSource: process.env.CIZHENYU_BROWSER_SOURCE || "",
  };

  const dir = authDir();
  if (dir) {
    const file = path.join(dir, "stagehand.json");
    if (fs.existsSync(file)) {
      const conf = JSON.parse(fs.readFileSync(file, "utf8"));
      out.mode = (conf.mode || out.mode || "auto").toString().trim().toLowerCase();
      out.browserbaseApiKey =
        out.browserbaseApiKey || conf.browserbaseApiKey || conf.BROWSERBASE_API_KEY || "";
      out.browserbaseProjectId =
        out.browserbaseProjectId ||
        conf.browserbaseProjectId ||
        conf.BROWSERBASE_PROJECT_ID ||
        "";
      out.modelApiKey =
        out.modelApiKey || conf.modelApiKey || conf.OPENAI_API_KEY || conf.openaiApiKey || "";
      out.modelName = conf.modelName || out.modelName;
    }
  }

  if (!out.modelApiKey) {
    throw new Error(
      "Stagehand 缺少 modelApiKey。请在 Deploy 凭证中配置 stagehand.modelApiKey（本地/云模式均需要）。",
    );
  }
  return out;
}

function canUseLocal(secrets) {
  if (secrets.browserExecutable && fs.existsSync(secrets.browserExecutable)) return true;
  if (secrets.browserSource === "system_chrome" || secrets.browserSource === "system_edge") {
    return true;
  }
  if (secrets.browserSource === "shared_chromium") return true;
  // channel-only: Stagehand LOCAL may still launch default Chromium if present
  return Boolean(secrets.browserChannel && secrets.browserChannel !== "chromium");
}

function resolveEnv(secrets) {
  const mode = secrets.mode || "auto";
  if (mode === "browserbase") {
    if (!secrets.browserbaseApiKey || !secrets.browserbaseProjectId) {
      throw new Error(
        "Stagehand 云模式需要 Browserbase API Key 与 Project ID（Deploy 凭证 stagehand）。",
      );
    }
    return "BROWSERBASE";
  }
  if (mode === "local") {
    if (!canUseLocal(secrets) && !secrets.browserExecutable) {
      throw new Error(
        "Stagehand 本地模式未找到浏览器。请安装 Chrome/Edge，或先安装 Crawl4AI 以下载共享 Chromium；也可将 mode 改为 browserbase。",
      );
    }
    return "LOCAL";
  }
  // auto
  if (canUseLocal(secrets)) return "LOCAL";
  if (secrets.browserbaseApiKey && secrets.browserbaseProjectId) return "BROWSERBASE";
  throw new Error(
    "Stagehand auto：本机无可用浏览器且未配置 Browserbase。请安装 Chrome/Edge，或填写云凭证。",
  );
}

let stagehand = null;
let secrets = null;
let activeEnv = null;

async function ensureSession() {
  if (stagehand) return stagehand;
  secrets = loadSecrets();
  activeEnv = resolveEnv(secrets);
  process.env.OPENAI_API_KEY = secrets.modelApiKey;

  if (activeEnv === "BROWSERBASE") {
    process.env.BROWSERBASE_API_KEY = secrets.browserbaseApiKey;
    process.env.BROWSERBASE_PROJECT_ID = secrets.browserbaseProjectId;
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: secrets.browserbaseApiKey,
      projectId: secrets.browserbaseProjectId,
      modelName: secrets.modelName,
      modelClientOptions: { apiKey: secrets.modelApiKey },
    });
  } else {
    const localOpts = { headless: true };
    if (secrets.browserExecutable) {
      localOpts.executablePath = secrets.browserExecutable;
    }
    stagehand = new Stagehand({
      env: "LOCAL",
      modelName: secrets.modelName,
      modelClientOptions: { apiKey: secrets.modelApiKey },
      localBrowserLaunchOptions: localOpts,
    });
  }
  await stagehand.init();
  return stagehand;
}

async function closeSession() {
  if (!stagehand) return { ok: true, env: activeEnv };
  try {
    await stagehand.close();
  } finally {
    stagehand = null;
  }
  return { ok: true, env: activeEnv };
}

const tools = [
  {
    name: "stagehand_navigate",
    description: "在浏览器中打开 URL（本地 Chrome/Edge/共享 Chromium，或 Browserbase 云）。",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "stagehand_act",
    description: "用自然语言指示对当前页面执行操作（点击、填写等）。",
    inputSchema: {
      type: "object",
      properties: { instruction: { type: "string" } },
      required: ["instruction"],
    },
  },
  {
    name: "stagehand_extract",
    description: "从当前页面按指令抽取结构化信息（返回文本/JSON）。",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string" },
        schema_hint: { type: "string", description: "可选：期望字段说明" },
      },
      required: ["instruction"],
    },
  },
  {
    name: "stagehand_observe",
    description: "观察页面可交互元素，返回建议动作列表。",
    inputSchema: {
      type: "object",
      properties: { instruction: { type: "string" } },
      required: [],
    },
  },
  {
    name: "stagehand_close",
    description: "关闭当前 Stagehand 浏览器会话。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

async function callTool(name, args = {}) {
  if (name === "stagehand_close") return closeSession();
  const sh = await ensureSession();
  const page = sh.page;
  switch (name) {
    case "stagehand_navigate":
      await page.goto(args.url, { waitUntil: "domcontentloaded" });
      return { ok: true, url: args.url, env: activeEnv };
    case "stagehand_act":
      return { ok: true, env: activeEnv, result: await sh.act(args.instruction) };
    case "stagehand_extract": {
      const instruction = args.schema_hint
        ? `${args.instruction}\nSchema hint: ${args.schema_hint}`
        : args.instruction;
      return { ok: true, env: activeEnv, result: await sh.extract(instruction) };
    }
    case "stagehand_observe":
      return {
        ok: true,
        env: activeEnv,
        result: await sh.observe(args.instruction || undefined),
      };
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

const server = new Server(
  { name: "cizhenyu-stagehand", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const result = await callTool(req.params.name, req.params.arguments || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
