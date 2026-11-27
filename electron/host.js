import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinCommands } from "../shared/commands.js";
import { PiProcess, findNode } from "./pi-process.js";
import {
  agentDir,
  configuredModels,
  desktopDir,
  readJson,
  sessionDirFor,
  statePath,
  trustPath,
  writeJson,
} from "./models.js";

const cliPath = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url));
const changelogPath = fileURLToPath(new URL("../node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md", import.meta.url));
const nodePath = findNode();
const MAX_WORKSPACES = 8;

function redact(text) {
  return String(text ?? "")
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***")
    .replace(/("apiKey"\s*:\s*")[^"]*"/gi, '$1***"')
    .replace(/(authorization:\s*)\S+/gi, "$1***");
}

function publicModel(model) {
  if (!model) return null;
  return {
    provider: model.provider,
    id: model.id,
    name: model.name || model.id,
    contextWindow: model.contextWindow || 0,
    reasoning: Boolean(model.reasoning),
  };
}

function visibleModels(live) {
  const configured = configuredModels();
  if (!configured.length) return [];
  const allowed = new Set(configured.map((model) => `${model.provider}\0${model.id}`));
  const matched = (live || []).map(publicModel).filter((model) => model && allowed.has(`${model.provider}\0${model.id}`));
  return matched.length ? matched : configured;
}

function sanitize(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === "string") return value.length > 80000 ? `${value.slice(0, 80000)}\n…` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/apiKey|authorization|secret|password|token/i.test(key)) continue;
      out[key] = sanitize(item, depth + 1);
    }
    return out;
  }
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Host {
  constructor(send) {
    this.send = send;
    this.workspaces = new Map();
    this.saveTimer = null;
  }

  publicWorkspace(workspace) {
    return {
      id: workspace.id,
      cwd: workspace.cwd,
      title: path.basename(workspace.cwd) || workspace.cwd,
      status: workspace.status,
      error: workspace.error || "",
      provider: workspace.provider || "",
      modelId: workspace.modelId || "",
      modelName: workspace.modelName || "",
      thinking: workspace.thinking || "",
      sessionName: workspace.sessionName || "",
      availableModels: workspace.availableModels || [],
      thinkingLevels: workspace.thinkingLevels || [],
      commands: workspace.commands || [],
      extStatus: workspace.extStatus || "",
      widget: workspace.widget || [],
    };
  }

  snapshot() {
    return {
      commands: builtinCommands,
      workspaces: [...this.workspaces.values()].map((workspace) => ({
        ...this.publicWorkspace(workspace),
        messages: workspace.messages || [],
      })),
    };
  }

  patch(id, fields) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return;
    Object.assign(workspace, fields);
    this.send("pi:workspace", this.publicWorkspace(workspace));
    this.scheduleSave();
  }

  replaceMessages(id, messages) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return;
    workspace.messages = messages;
    this.send("pi:messages", { id, messages });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 200);
  }

  save() {
    writeJson(statePath, {
      workspaces: [...this.workspaces.values()].map((workspace) => ({
        id: workspace.id,
        cwd: workspace.cwd,
        provider: workspace.provider || "",
        modelId: workspace.modelId || "",
        thinking: workspace.thinking || "",
        modelsArg: workspace.modelsArg || "",
      })),
    });
  }

  async restore() {
    const state = readJson(statePath, { workspaces: [] });
    for (const saved of state.workspaces || []) {
      if (!saved.cwd || !existsSync(saved.cwd)) continue;
      await this.open(saved.cwd, saved);
    }
  }

  async open(cwd, saved = {}) {
    const resolved = path.resolve(cwd);
    if ([...this.workspaces.values()].filter((workspace) => workspace.cwd === resolved).length >= MAX_WORKSPACES) {
      throw new Error(`最多同时打开 ${MAX_WORKSPACES} 个工作区`);
    }
    if (this.workspaces.size >= MAX_WORKSPACES) throw new Error(`最多同时打开 ${MAX_WORKSPACES} 个工作区`);
    const workspace = {
      id: saved.id || randomUUID(),
      cwd: resolved,
      status: "starting",
      error: "",
      provider: saved.provider || "",
      modelId: saved.modelId || "",
      thinking: saved.thinking || "",
      modelsArg: saved.modelsArg || "",
      sessionName: "",
      availableModels: [],
      thinkingLevels: [],
      commands: [],
      messages: [],
      extStatus: "",
      widget: [],
      client: null,
      reloadAfterSettle: false,
    };
    this.workspaces.set(workspace.id, workspace);
    this.send("pi:workspace", this.publicWorkspace(workspace));
    this.scheduleSave();
    this.boot(workspace).catch((error) => {
      this.patch(workspace.id, { status: "error", error: redact(error.message) });
    });
    return this.publicWorkspace(workspace);
  }

  async boot(workspace, sessionFile) {
    const sameFolder = [...this.workspaces.values()].filter((item) => item.cwd === workspace.cwd && item.id !== workspace.id && item.client);
    const args = [];
    if (workspace.modelsArg) args.push("--models", workspace.modelsArg);
    if (sessionFile) args.push("--session", sessionFile);
    else if (sameFolder.length) args.push("--session-id", `desktop-${workspace.id.slice(0, 8)}`);
    else args.push("--continue");

    const client = await this.spawn(workspace, args);
    workspace.client = client;
    client.onEvent((event) => this.onEvent(workspace.id, event));
    const state = await this.ready(client);
    const [models, commands, messages] = await Promise.all([
      client.getAvailableModels().catch(() => []),
      client.getCommands().catch(() => []),
      client.getMessages().catch(() => []),
    ]);
    const current = publicModel(state.model);
    const availableModels = visibleModels(models);
    let provider = current?.provider || workspace.provider;
    let modelId = current?.id || workspace.modelId;
    let modelName = current?.name || workspace.modelName;
    const allowed = availableModels.some((model) => model.provider === provider && model.id === modelId);
    if (!allowed && availableModels[0]) {
      try {
        const selected = publicModel(await client.setModel(availableModels[0].provider, availableModels[0].id));
        provider = selected?.provider || availableModels[0].provider;
        modelId = selected?.id || availableModels[0].id;
        modelName = selected?.name || availableModels[0].name;
      } catch {
        provider = availableModels[0].provider;
        modelId = availableModels[0].id;
        modelName = availableModels[0].name;
      }
    }
    const thinkingLevels = await client.getAvailableThinkingLevels().catch(() => []);
    this.patch(workspace.id, {
      status: state.isStreaming ? "running" : "idle",
      error: "",
      provider,
      modelId,
      modelName,
      thinking: thinkingLevels.includes(state.thinkingLevel) ? state.thinkingLevel : thinkingLevels.at(-1) || workspace.thinking,
      thinkingLevels,
      sessionName: state.sessionName || "",
      availableModels,
      commands: (commands || []).map((command) => ({
        name: command.name,
        summary: command.description || "当前工作区加载的命令",
        source: command.source,
      })),
      messages: sanitize(messages || []),
    });
    this.replaceMessages(workspace.id, workspace.messages);
  }

  async spawn(workspace, args) {
    const base = { cwd: workspace.cwd, args, env: { PI_CODING_AGENT_DIR: agentDir } };
    const start = async (withModel) => {
      const client = new PiProcess(nodePath);
      const options = { ...base };
      if (withModel && workspace.provider && workspace.modelId) {
        options.provider = workspace.provider;
        options.model = workspace.modelId;
      }
      try {
        await client.start(options);
        if (client.exitError) throw client.exitError;
        return client;
      } catch (error) {
        await client.stop().catch(() => {});
        throw error;
      }
    };
    try {
      return await start(true);
    } catch (error) {
      if (!(workspace.provider && workspace.modelId)) throw error;
      return start(false);
    }
  }

  async ready(client) {
    let last = new Error("Pi 没有响应");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (client.exitError) throw client.exitError;
      try {
        return await client.getState();
      } catch (error) {
        last = error;
        await delay(250);
      }
    }
    throw last;
  }

  must(id) {
    const workspace = this.workspaces.get(id);
    if (!workspace?.client) throw new Error("这个工作区还没有连上 Pi");
    return workspace;
  }

  onEvent(id, event) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return;
    if (event.type === "extension_ui_request") {
      this.onExtensionUi(workspace, event);
      return;
    }
    if (event.type === "agent_start" || event.type === "turn_start") this.patch(id, { status: "running" });
    if (event.type === "compaction_start") this.patch(id, { status: "compacting" });
    if (event.type === "auto_retry_start") this.patch(id, { status: "retrying" });
    if (event.type === "agent_settled") {
      this.patch(id, { status: "idle" });
      if (workspace.reloadAfterSettle) {
        workspace.reloadAfterSettle = false;
        this.reload(id).catch((error) => this.patch(id, { status: "error", error: redact(error.message) }));
      }
    }
    this.send("pi:event", { id, event: sanitize(event) });
  }

  onExtensionUi(workspace, request) {
    if (request.method === "notify") {
      this.send("pi:notice", { id: workspace.id, text: request.message || "" });
      return;
    }
    if (request.method === "setStatus") {
      this.patch(workspace.id, { extStatus: request.statusText || "" });
      return;
    }
    if (request.method === "setWidget") {
      this.patch(workspace.id, { widget: request.widgetLines || [] });
      return;
    }
    if (request.method === "set_editor_text") {
      this.send("pi:editor", { id: workspace.id, text: request.text || "" });
      return;
    }
    if (["select", "confirm", "input", "editor"].includes(request.method)) {
      this.send("pi:dialog", { id: workspace.id, request });
    }
  }

  replyUi(workspaceId, requestId, body) {
    return this.must(workspaceId).client.replyUi(requestId, body);
  }

  cwdOf(id) {
    const workspace = this.workspaces.get(id);
    if (!workspace) throw new Error("没有这个工作区");
    return workspace.cwd;
  }

  async close(id) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return false;
    this.workspaces.delete(id);
    await workspace.client?.stop().catch(() => {});
    this.send("pi:closed", { id });
    this.scheduleSave();
    return true;
  }

  async shutdown() {
    clearTimeout(this.saveTimer);
    this.save();
    await Promise.all([...this.workspaces.values()].map((workspace) => workspace.client?.stop().catch(() => {})));
  }

  async setModel(id, provider, modelId) {
    const workspace = this.must(id);
    const model = publicModel(await workspace.client.setModel(provider, modelId));
    const levels = await workspace.client.getAvailableThinkingLevels().catch(() => []);
    this.patch(id, {
      provider: model.provider,
      modelId: model.id,
      modelName: model.name,
      thinkingLevels: levels,
      thinking: levels.includes(workspace.thinking) ? workspace.thinking : levels.at(-1) || "off",
    });
    return this.publicWorkspace(workspace);
  }

  async setThinking(id, level) {
    const workspace = this.must(id);
    await workspace.client.setThinkingLevel(level);
    this.patch(id, { thinking: level });
    return level;
  }

  async thinkingLevels(id) {
    return this.must(id).client.getAvailableThinkingLevels();
  }

  async prompt(id, text, behavior) {
    const workspace = this.must(id);
    this.patch(id, { status: "running", error: "" });
    try {
      const state = await workspace.client.getState();
      const streamingBehavior = behavior || (state.isStreaming ? "steer" : undefined);
      const disposition = await workspace.client.prompt(text, undefined, streamingBehavior);
      if (disposition === "handled") this.patch(id, { status: "idle" });
      return disposition;
    } catch (error) {
      this.patch(id, { status: "idle", error: redact(error.message) });
      throw error;
    }
  }

  async steer(id, text) {
    const workspace = this.must(id);
    return workspace.client.steer(text);
  }

  async follow(id, text) {
    const workspace = this.must(id);
    return workspace.client.followUp(text);
  }

  async abort(id) {
    const workspace = this.must(id);
    const queued = await workspace.client.clearQueue().catch(() => ({ steering: [], followUp: [] }));
    await workspace.client.abort();
    this.patch(id, { status: "idle" });
    return [...(queued.steering || []), ...(queued.followUp || [])].filter(Boolean).join("\n");
  }

  async sessions(id) {
    const workspace = this.must(id);
    const dir = sessionDirFor(workspace.cwd);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => {
        const file = path.join(dir, name);
        const stat = statSync(file);
        return { path: file, name, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 40);
  }

  async forkMessages(id) {
    return this.must(id).client.getForkMessages();
  }

  async reload(id) {
    const workspace = this.must(id);
    let sessionFile;
    try {
      sessionFile = (await workspace.client.getState()).sessionFile;
    } catch {
      sessionFile = undefined;
    }
    await workspace.client.stop().catch(() => {});
    workspace.client = null;
    this.patch(id, { status: "starting", error: "" });
    await this.boot(workspace, sessionFile);
    return this.publicWorkspace(workspace);
  }

  markReload(id) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return;
    if (workspace.status === "running" || workspace.status === "compacting" || workspace.status === "retrying") {
      workspace.reloadAfterSettle = true;
      this.send("pi:notice", { id, text: "模型配置已保存。这一轮结束后会重新连接。" });
      return;
    }
    this.reload(id).catch((error) => this.patch(id, { status: "error", error: redact(error.message) }));
  }

  async command(id, name, payload = {}) {
    const workspace = this.must(id);
    const client = workspace.client;
    switch (name) {
      case "model":
        return this.finish(id, await this.setModel(id, payload.provider, payload.modelId), "已切换模型");
      case "thinking":
        await this.setThinking(id, payload.level);
        return { title: "思考级别", body: payload.level };
      case "scoped-models":
        workspace.modelsArg = String(payload.text || "").trim();
        this.scheduleSave();
        this.markReload(id);
        return { title: "模型范围", body: workspace.modelsArg || "已取消限制，重新连接后生效" };
      case "new": {
        await client.newSession();
        this.patch(id, { sessionName: "" });
        this.replaceMessages(id, []);
        return { title: "新会话", body: "已开始一段新会话" };
      }
      case "resume": {
        await client.switchSession(payload.path);
        await this.refreshTranscript(id);
        return { title: "恢复会话", body: path.basename(payload.path) };
      }
      case "name":
        await client.setSessionName(payload.text || "");
        this.patch(id, { sessionName: payload.text || "" });
        return { title: "会话名称", body: payload.text || "已清除名称" };
      case "session":
        return { title: "当前会话", body: await this.sessionReport(workspace) };
      case "tree":
        return { title: "会话树", body: await this.treeReport(client) };
      case "fork": {
        const result = await client.fork(payload.entryId);
        await this.refreshTranscript(id);
        return { title: "分叉", body: result.cancelled ? "扩展取消了这次分叉" : result.text || "已从所选消息另开会话" };
      }
      case "clone": {
        const result = await client.clone();
        await this.refreshTranscript(id);
        return { title: "复制会话", body: result.cancelled ? "扩展取消了这次复制" : "已复制为一段新会话" };
      }
      case "compact": {
        await client.compact(payload.text || undefined);
        return { title: "压缩", body: "上下文已压缩" };
      }
      case "copy": {
        const text = await client.getLastAssistantText();
        return { title: "复制", body: text || "", copy: true };
      }
      case "export":
      case "share": {
        const exported = await client.exportHtml();
        return {
          title: name === "share" ? "分享文件已准备" : "已导出",
          body: exported.path,
          reveal: exported.path,
        };
      }
      case "bug":
        return { title: "问题记录", body: this.writeBug(workspace, payload.text || ""), revealFile: true };
      case "trust":
        this.trust(workspace.cwd);
        this.markReload(id);
        return { title: "项目信任", body: "已信任当前文件夹，正在重新连接以加载项目资源" };
      case "mcp":
        return { title: "MCP", body: await this.runCli(["mcp", "list"], workspace.cwd) };
      case "reload":
        await this.reload(id);
        return { title: "重新连接", body: "已重新加载模型、技能和命令" };
      case "llama":
        return {
          title: "llama.cpp",
          body: "桌面端使用同一份 models.json。本地路由仍用命令行里的 /llama 管理；把兼容接口的 baseUrl 配进设置后，每个工作区都能选到对应模型。",
        };
      case "changelog":
        return { title: "Pi 更新说明", body: this.changelog() };
      case "quit":
        await this.close(id);
        return { title: "已关闭", body: workspace.cwd };
      case "steer":
        await client.steer(payload.text || "");
        return { title: "插话", body: "已插入当前这一轮" };
      case "follow":
        await client.followUp(payload.text || "");
        return { title: "随后", body: "会在当前这一轮结束后发送" };
      case "abort":
        return { title: "已停止", body: await this.abort(id), restore: true };
      case "login": {
        const body = await this.login(payload.provider, payload.apiKey);
        this.markReload(id);
        return { title: "登录", body };
      }
      case "logout":
        return { title: "退出登录", body: await this.runCli(["auth", "logout", payload.provider], workspace.cwd) };
      default:
        await this.prompt(id, `/${name}`);
        return { title: `/${name}`, body: "已发送给当前工作区" };
    }
  }

  finish(id, workspace, title) {
    return { title, body: workspace.modelName ? `${workspace.provider}/${workspace.modelName}` : "已更新" };
  }

  async refreshTranscript(id) {
    const messages = sanitize(await this.must(id).client.getMessages());
    const state = await this.must(id).client.getState();
    this.patch(id, { sessionName: state.sessionName || "" });
    this.replaceMessages(id, messages);
  }

  async sessionReport(workspace) {
    const state = await workspace.client.getState();
    const stats = await workspace.client.getSessionStats().catch(() => null);
    const model = publicModel(state.model);
    return [
      `文件夹 ${workspace.cwd}`,
      `会话 ${state.sessionName || "未命名"}`,
      `文件 ${state.sessionFile || "尚未写入"}`,
      `模型 ${model ? `${model.provider}/${model.name}` : "未选择"}`,
      `思考 ${state.thinkingLevel}`,
      `消息 ${state.messageCount}`,
      stats ? `用量 ${JSON.stringify(sanitize(stats))}` : "",
    ].filter(Boolean).join("\n");
  }

  async treeReport(client) {
    const { tree } = await client.getTree();
    const lines = [];
    const walk = (nodes, depth) => {
      for (const node of nodes || []) {
        const entry = node.entry || {};
        const message = entry.message;
        const preview = node.label || messageText(message) || entry.type || "entry";
        lines.push(`${"  ".repeat(depth)}${preview}`.slice(0, 240));
        walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return lines.join("\n") || "这段会话还没有分叉";
  }

  trust(cwd) {
    const data = readJson(trustPath, {});
    data[path.resolve(cwd)] = true;
    writeJson(trustPath, data);
  }

  login(provider, apiKey) {
    const args = ["auth", "login", provider, "--no-browser"];
    if (apiKey) args.push("--api-key", apiKey);
    return this.runCli(args, agentDir);
  }

  runCli(args, cwd) {
    return new Promise((resolve) => {
      const child = spawn("node", [cliPath, ...args], { cwd, windowsHide: true });
      let out = "";
      child.stdout.on("data", (chunk) => { out += chunk.toString(); });
      child.stderr.on("data", (chunk) => { out += chunk.toString(); });
      child.on("exit", (code) => {
        resolve(redact(out.trim() || (code === 0 ? "完成" : `退出码 ${code}`)));
      });
      child.on("error", (error) => resolve(redact(error.message)));
    });
  }

  changelog() {
    try {
      return readFileSync(changelogPath, "utf8").slice(0, 6000);
    } catch {
      return "没有找到 CHANGELOG.md";
    }
  }

  writeBug(workspace, description) {
    const file = path.join(desktopDir, "bug-report.txt");
    const body = [
      "Pi desktop bug report",
      `cwd: ${workspace.cwd}`,
      `model: ${workspace.provider}/${workspace.modelId}`,
      `error: ${workspace.error || ""}`,
      "",
      description,
    ].join("\n");
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(file, body, "utf8");
    return file;
  }
}

function messageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content.filter((block) => block?.type === "text").map((block) => block.text || "").join(" ");
  }
  return "";
}
