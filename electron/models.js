import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const agentDir = path.join(homedir(), ".pi", "agent");
export const desktopDir = path.join(homedir(), ".pi", "desktop");
export const modelsPath = path.join(agentDir, "models.json");
export const statePath = path.join(desktopDir, "state.json");
export const trustPath = path.join(agentDir, "trust.json");

export function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadModelsFile() {
  const data = readJson(modelsPath, { providers: {} });
  if (!data || typeof data !== "object" || Array.isArray(data)) return { providers: {} };
  if (!data.providers || typeof data.providers !== "object") data.providers = {};
  return data;
}

export function configuredModels(data = loadModelsFile()) {
  const models = [];
  for (const [provider, value] of Object.entries(data.providers || {})) {
    for (const model of value.models || []) {
      if (!model?.id) continue;
      models.push({
        provider,
        id: String(model.id),
        name: model.name || String(model.id),
        contextWindow: model.contextWindow || 0,
        reasoning: Boolean(model.reasoning),
      });
    }
  }
  return models;
}

export function maskProviders(data = loadModelsFile()) {
  return Object.entries(data.providers).map(([id, value]) => ({
    id,
    name: value.name || id,
    api: value.api || "",
    baseUrl: value.baseUrl || "",
    hasApiKey: Boolean(value.apiKey),
    models: (value.models || []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextWindow: model.contextWindow || 0,
      maxTokens: model.maxTokens || 0,
      reasoning: Boolean(model.reasoning),
      input: Array.isArray(model.input) && model.input.length ? model.input : ["text"],
    })),
  }));
}

export function saveProvider(input) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("厂家 ID 不能为空");
  const models = (input.models || [])
    .map((model) => ({
      id: String(model.id || "").trim(),
      name: String(model.name || model.id || "").trim(),
      contextWindow: Number(model.contextWindow) || undefined,
      maxTokens: Number(model.maxTokens) || undefined,
      reasoning: Boolean(model.reasoning),
      input: model.input?.includes("image") ? ["text", "image"] : ["text"],
    }))
    .filter((model) => model.id);
  if (!models.length) throw new Error("至少填写一个模型 ID");

  const data = loadModelsFile();
  const current = data.providers[id] || {};
  const previousModels = new Map((current.models || []).map((model) => [model.id, model]));
  const next = {
    ...current,
    api: String(input.api || current.api || "openai-completions"),
    baseUrl: String(input.baseUrl || "").trim() || current.baseUrl,
    models: models.map((model) => {
      const { contextWindow, maxTokens, ...rest } = model;
      return {
        ...(previousModels.get(model.id) || {}),
        ...rest,
        ...(contextWindow ? { contextWindow } : {}),
        ...(maxTokens ? { maxTokens } : {}),
      };
    }),
  };
  if (input.name) next.name = String(input.name).trim();
  if (input.apiKey) next.apiKey = String(input.apiKey);
  if (input.clearApiKey) delete next.apiKey;
  if (!next.baseUrl && !current.baseUrl) delete next.baseUrl;
  data.providers[id] = next;
  if (!data.$schema) data.$schema = "https://pi.dev/schemas/models.schema.json";
  writeJson(modelsPath, data);
  return maskProviders(data);
}

export async function testProvider(id) {
  const provider = loadModelsFile().providers?.[id];
  if (!provider) return { ok: false, message: "没有这个厂家" };
  const base = String(provider.baseUrl || "").replace(/\/$/, "");
  if (!base) return { ok: false, message: "还没有接口地址" };
  const key = provider.apiKey ? String(provider.apiKey) : "";
  if (!key || key.startsWith("$") || key.startsWith("!")) return { ok: false, message: "还没有可直接使用的密钥" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, message: `连接失败（${response.status}）` };
    return { ok: true, message: "连接成功" };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, message: "连接超时" };
    return { ok: false, message: "无法连接到这个地址" };
  } finally {
    clearTimeout(timer);
  }
}

export function deleteProvider(id) {
  const data = loadModelsFile();
  if (!data.providers[id]) throw new Error(`没有这个厂家：${id}`);
  delete data.providers[id];
  writeJson(modelsPath, data);
  return maskProviders(data);
}

export function importModels(file) {
  const incoming = JSON.parse(readFileSync(file, "utf8"));
  if (!incoming || typeof incoming.providers !== "object" || Array.isArray(incoming.providers)) {
    throw new Error("这份文件不是 models.json：需要 providers 对象");
  }
  const data = loadModelsFile();
  const replaced = [];
  for (const [id, value] of Object.entries(incoming.providers)) {
    if (data.providers[id]) replaced.push(id);
    data.providers[id] = value;
  }
  if (!data.$schema) data.$schema = "https://pi.dev/schemas/models.schema.json";
  writeJson(modelsPath, data);
  return { providers: maskProviders(data), replaced };
}

export function sessionDirFor(cwd) {
  let resolved = path.resolve(cwd);
  try {
    resolved = realpathSync(resolved);
  } catch {
    // Keep the absolute path when the folder cannot be canonicalized.
  }
  const safe = `--${resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(agentDir, "sessions", safe);
}
