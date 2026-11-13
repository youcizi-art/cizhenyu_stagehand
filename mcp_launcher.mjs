#!/usr/bin/env node
/**
 * Stagehand MCP — local browser by default, Browserbase fallback.
 * Model is fully config-driven (modelName + apiKey + optional baseURL).
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
    modelApiKey:
      process.env.STAGEHAND_MODEL_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      "",
    modelName: (process.env.STAGEHAND_MODEL_NAME || "").trim(),
    modelProvider: (process.env.STAGEHAND_MODEL_PROVIDER || "").trim(),
    modelBaseUrl: (process.env.STAGEHAND_MODEL_BASE_URL || "").trim(),
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
        out.modelApiKey ||
        conf.modelApiKey ||
        conf.OPENAI_API_KEY ||
        conf.openaiApiKey ||
        "";
      out.modelName = (conf.modelName || out.modelName || "").toString().trim();
      out.modelProvider = (conf.modelProvider || out.modelProvider || "").toString().trim();
      out.modelBaseUrl = (
        conf.modelBaseUrl ||
        conf.baseURL ||
        out.modelBaseUrl ||
        ""
      )
        .toString()
        .trim();
    }
  }

  // 历史误写：openai/gpt-4o-mini → 2.5 一等公民裸名
  if (out.modelName === "openai/gpt-4o-mini") out.modelName = "gpt-4o-mini";
  if (out.modelName === "openai/gpt-4o") out.modelName = "gpt-4o";

  if (!out.modelApiKey) {
    throw new Error(
      "Stagehand 缺少模型 API Key。请在 Deploy 凭证中按所选厂商填写（OpenAI / DeepSeek / Kimi 等）。",
    );
  }
  if (!out.modelName) {
    throw new Error(
      "Stagehand 缺少模型名称（modelName）。请在 Deploy 凭证中选择厂商或填写模型名，勿依赖写死默认。",
    );
  }
  return out;
}

function buildModelClientOptions(secrets) {
  const opts = { apiKey: secrets.modelApiKey };
  if (secrets.modelBaseUrl) {
    opts.baseURL = secrets.modelBaseUrl;
  }
  return opts;
}

/** 列出当前 API Key 下的项目（客户账号作用域，无写死 ID） */
async function listBrowserbaseProjects(apiKey) {
  const res = await fetch("https://api.browserbase.com/v1/projects", {
    headers: { "X-BB-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `无法解析 Browserbase 项目（HTTP ${res.status}）。请到 https://www.browserbase.com/settings 检查 API Key。${body}`,
    );
  }
  const list = await res.json();
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map((p) => ({
      id: (p?.id || "").toString().trim(),
      name: (p?.name || "").toString().trim(),
      updatedAt: (p?.updatedAt || "").toString().trim(),
    }))
    .filter((p) => p.id);
}

/**
 * 解析项目：preferred 仍属于该 Key 则保留；否则取 updatedAt 最新。
 * 换 Key 后旧 Project ID 会被自动丢弃，不会沿用他人/旧账号项目。
 */
function pickBrowserbaseProject(projects, preferred) {
  if (!projects.length) {
    throw new Error("该 API Key 下没有可用项目，请在 Browserbase 控制台创建项目后再试。");
  }
  const want = (preferred || "").toString().trim();
  if (want) {
    const hit = projects.find((p) => p.id === want);
    if (hit) return hit;
  }
  const sorted = [...projects].sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
  return sorted[0];
}

async function ensureBrowserbaseProjectId(secrets) {
  if (!secrets.browserbaseApiKey) return secrets;
  const projects = await listBrowserbaseProjects(secrets.browserbaseApiKey);
  const picked = pickBrowserbaseProject(projects, secrets.browserbaseProjectId);
  secrets.browserbaseProjectId = picked.id;
  secrets.browserbaseProjectName = picked.name || "";

  const dir = authDir();
  if (dir) {
    const file = path.join(dir, "stagehand.json");
    try {
      const conf = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
      conf.browserbaseProjectId = secrets.browserbaseProjectId;
      if (secrets.browserbaseProjectName) {
        conf.browserbaseProjectName = secrets.browserbaseProjectName;
      }
      conf.browserbaseApiKey = conf.browserbaseApiKey || secrets.browserbaseApiKey;
      conf.mode = conf.mode || secrets.mode;
      conf.modelApiKey = conf.modelApiKey || secrets.modelApiKey;
      conf.modelName = conf.modelName || secrets.modelName;
      if (secrets.modelBaseUrl) conf.modelBaseUrl = secrets.modelBaseUrl;
      if (secrets.modelProvider) conf.modelProvider = secrets.modelProvider;
      fs.writeFileSync(file, JSON.stringify(conf, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }
  return secrets;
}

function canUseLocal(secrets) {
  if (secrets.browserExecutable && fs.existsSync(secrets.browserExecutable)) return true;
  if (secrets.browserSource === "system_chrome" || secrets.browserSource === "system_edge") {
    return true;
  }
  if (secrets.browserSource === "shared_chromium") return true;
  return Boolean(secrets.browserChannel && secrets.browserChannel !== "chromium");
}

async function resolveEnv(secrets) {
  const mode = secrets.mode || "auto";
  if (mode === "browserbase") {
    if (!secrets.browserbaseApiKey) {
      throw new Error(
        "Stagehand 云模式需要 Browserbase API Key。获取：https://www.browserbase.com/settings",
      );
    }
    await ensureBrowserbaseProjectId(secrets);
    return "BROWSERBASE";
  }
  if (mode === "local") {
    if (!canUseLocal(secrets) && !secrets.browserExecutable) {
      throw new Error(
        "Stagehand 本地模式未找到浏览器。请安装 Chrome/Edge，或先安装 Crawl4AI；也可改用云模式。",
      );
    }
    return "LOCAL";
  }
  if (canUseLocal(secrets)) return "LOCAL";
  if (secrets.browserbaseApiKey) {
    await ensureBrowserbaseProjectId(secrets);
    return "BROWSERBASE";
  }
  throw new Error(
    "Stagehand auto：本机无可用浏览器且未配置 Browserbase。请安装浏览器或填写云端 Key：https://www.browserbase.com/settings",
  );
}

let stagehand = null;
let secrets = null;
let activeEnv = null;

async function ensureSession() {
  if (stagehand) return stagehand;
  secrets = loadSecrets();
  activeEnv = await resolveEnv(secrets);

  // 按厂商写入常见环境变量，便于 SDK 回退读取
  process.env.STAGEHAND_MODEL_API_KEY = secrets.modelApiKey;
  process.env.OPENAI_API_KEY = secrets.modelApiKey;
  if (secrets.modelName.startsWith("anthropic/") || secrets.modelName.startsWith("claude-")) {
    process.env.ANTHROPIC_API_KEY = secrets.modelApiKey;
  }
  if (secrets.modelName.startsWith("google/") || secrets.modelName.startsWith("gemini-")) {
    process.env.GOOGLE_API_KEY = secrets.modelApiKey;
  }
  if (secrets.modelName.startsWith("deepseek/")) {
    process.env.DEEPSEEK_API_KEY = secrets.modelApiKey;
  }

  const modelOpts = {
    modelName: secrets.modelName,
    modelClientOptions: buildModelClientOptions(secrets),
  };

  if (activeEnv === "BROWSERBASE") {
    process.env.BROWSERBASE_API_KEY = secrets.browserbaseApiKey;
    process.env.BROWSERBASE_PROJECT_ID = secrets.browserbaseProjectId;
    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: secrets.browserbaseApiKey,
      projectId: secrets.browserbaseProjectId,
      ...modelOpts,
    });
  } else {
    const localOpts = { headless: true };
    if (secrets.browserExecutable) {
      localOpts.executablePath = secrets.browserExecutable;
    }
    stagehand = new Stagehand({
      env: "LOCAL",
      ...modelOpts,
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
      return {
        ok: true,
        url: args.url,
        env: activeEnv,
        model: secrets?.modelName,
      };
    case "stagehand_act":
      return {
        ok: true,
        env: activeEnv,
        model: secrets?.modelName,
        result: await sh.act(args.instruction),
      };
    case "stagehand_extract": {
      const instruction = args.schema_hint
        ? `${args.instruction}\nSchema hint: ${args.schema_hint}`
        : args.instruction;
      return {
        ok: true,
        env: activeEnv,
        model: secrets?.modelName,
        result: await sh.extract(instruction),
      };
    }
    case "stagehand_observe":
      return {
        ok: true,
        env: activeEnv,
        model: secrets?.modelName,
        result: await sh.observe(args.instruction || undefined),
      };
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

const server = new Server(
  { name: "cizhenyu-stagehand", version: "1.3.1" },
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
