#!/usr/bin/env node
/**
 * Stagehand thin MCP — credentials only from Deploy auth dir / process env.
 * Never hardcode Browserbase / model keys in this repo.
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
    browserbaseApiKey:
      process.env.BROWSERBASE_API_KEY || process.env.STAGEHAND_BROWSERBASE_API_KEY || "",
    browserbaseProjectId:
      process.env.BROWSERBASE_PROJECT_ID || process.env.STAGEHAND_BROWSERBASE_PROJECT_ID || "",
    modelApiKey: process.env.OPENAI_API_KEY || process.env.STAGEHAND_MODEL_API_KEY || "",
    modelName: process.env.STAGEHAND_MODEL_NAME || "openai/gpt-4o-mini",
  };

  const dir = authDir();
  if (dir) {
    const file = path.join(dir, "stagehand.json");
    if (fs.existsSync(file)) {
      const conf = JSON.parse(fs.readFileSync(file, "utf8"));
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

  if (!out.browserbaseApiKey || !out.browserbaseProjectId) {
    throw new Error(
      "Stagehand 缺少 Browserbase 凭据。请在 Deploy 凭证中配置 stagehand（browserbaseApiKey / browserbaseProjectId），由软件注入 CIZHENYU_AUTH_DIR。",
    );
  }
  if (!out.modelApiKey) {
    throw new Error(
      "Stagehand 缺少 modelApiKey。请在 Deploy 凭证中配置 stagehand.modelApiKey。",
    );
  }
  return out;
}

let stagehand = null;
let secrets = null;

async function ensureSession() {
  if (stagehand) return stagehand;
  secrets = loadSecrets();
  process.env.BROWSERBASE_API_KEY = secrets.browserbaseApiKey;
  process.env.BROWSERBASE_PROJECT_ID = secrets.browserbaseProjectId;
  process.env.OPENAI_API_KEY = secrets.modelApiKey;

  stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: secrets.browserbaseApiKey,
    projectId: secrets.browserbaseProjectId,
    modelName: secrets.modelName,
    modelClientOptions: { apiKey: secrets.modelApiKey },
  });
  await stagehand.init();
  return stagehand;
}

async function closeSession() {
  if (!stagehand) return { ok: true };
  try {
    await stagehand.close();
  } finally {
    stagehand = null;
  }
  return { ok: true };
}

const tools = [
  {
    name: "stagehand_navigate",
    description: "在 Browserbase 浏览器中打开 URL。",
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
    description: "关闭当前 Stagehand / Browserbase 会话。",
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
      return { ok: true, url: args.url };
    case "stagehand_act":
      return { ok: true, result: await sh.act(args.instruction) };
    case "stagehand_extract": {
      const instruction = args.schema_hint
        ? `${args.instruction}\nSchema hint: ${args.schema_hint}`
        : args.instruction;
      return { ok: true, result: await sh.extract(instruction) };
    }
    case "stagehand_observe":
      return { ok: true, result: await sh.observe(args.instruction || undefined) };
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

const server = new Server(
  { name: "cizhenyu-stagehand", version: "1.0.0" },
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
