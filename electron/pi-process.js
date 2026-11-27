import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const bridgePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "bridge.mjs");

export function findNode() {
  if (process.env.PI_NODE) return process.env.PI_NODE;
  try {
    const output = execFileSync("where.exe", ["node"], { encoding: "utf8", windowsHide: true });
    const found = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/electron/i.test(line));
    if (found) return found;
  } catch {
    // Fall through to PATH lookup when the process is started from a developer shell.
  }
  return "node";
}

export class PiProcess {
  constructor(nodePath = findNode()) {
    this.nodePath = nodePath;
    this.child = null;
    this.buffer = "";
    this.pending = new Map();
    this.listeners = [];
    this.exitError = null;
    this.stderr = "";
    this.nextId = 1;
  }

  onEvent(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  start(options) {
    this.exitError = null;
    this.child = spawn(this.nodePath, [bridgePath], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code, signal) => {
      if (!this.exitError) this.fail(new Error(`Pi 进程已退出 (${code ?? signal}) ${this.stderr}`.trim()));
    });
    return this.call("start", options);
  }

  async stop() {
    if (!this.child) return;
    await this.call("stop").catch(() => {});
    this.child.kill();
    this.child = null;
  }

  fail(error) {
    this.exitError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  onData(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (line.trim()) this.dispatchLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  dispatchLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.event) {
      for (const listener of [...this.listeners]) listener(message.event);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) pending.resolve(message.data);
    else pending.reject(new Error(message.error || "Pi 调用失败"));
  }

  call(method, params) {
    if (!this.child?.stdin?.writable) return Promise.reject(this.exitError || new Error("Pi 进程还没有启动"));
    if (this.exitError && method !== "stop") return Promise.reject(this.exitError);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`等待 ${method} 超时`));
      }, 120000);
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  getState() { return this.call("getState"); }
  getAvailableModels() { return this.call("getAvailableModels"); }
  getCommands() { return this.call("getCommands"); }
  getMessages() { return this.call("getMessages"); }
  setModel(provider, modelId) { return this.call("setModel", { provider, modelId }); }
  getAvailableThinkingLevels() { return this.call("getAvailableThinkingLevels"); }
  setThinkingLevel(level) { return this.call("setThinkingLevel", { level }); }
  prompt(text, _images, behavior) { return this.call("prompt", { text, behavior }); }
  steer(text) { return this.call("steer", { text }); }
  followUp(text) { return this.call("followUp", { text }); }
  clearQueue() { return this.call("clearQueue"); }
  abort() { return this.call("abort"); }
  newSession() { return this.call("newSession"); }
  switchSession(sessionPath) { return this.call("switchSession", { sessionPath }); }
  setSessionName(name) { return this.call("setSessionName", { name }); }
  getSessionStats() { return this.call("getSessionStats"); }
  getTree() { return this.call("getTree"); }
  fork(entryId) { return this.call("fork", { entryId }); }
  clone() { return this.call("clone"); }
  compact(instructions) { return this.call("compact", { instructions }); }
  getLastAssistantText() { return this.call("getLastAssistantText"); }
  exportHtml() { return this.call("exportHtml"); }
  getForkMessages() { return this.call("getForkMessages"); }
  replyUi(requestId, body) { return this.call("replyUi", { requestId, body }); }
}
