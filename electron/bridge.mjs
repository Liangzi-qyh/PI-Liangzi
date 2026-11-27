import { writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
let client = null;
let buffer = "";

function send(message) {
  const line = `${JSON.stringify(message)}\n`;
  try {
    writeSync(1, line);
  } catch {
    process.stdout.write(line);
  }
}

async function dispatch(method, params) {
  switch (method) {
    case "start": {
      client = new RpcClient({
        cliPath,
        cwd: params.cwd,
        args: params.args,
        env: params.env,
        provider: params.provider || undefined,
        model: params.model || undefined,
      });
      client.onEvent((event) => send({ event }));
      await client.start();
      if (client.exitError) throw client.exitError;
      return true;
    }
    case "stop":
      await client?.stop();
      client = null;
      return true;
    case "getState":
      return client.getState();
    case "getAvailableModels":
      return client.getAvailableModels();
    case "getCommands":
      return client.getCommands();
    case "getMessages":
      return client.getMessages();
    case "setModel":
      return client.setModel(params.provider, params.modelId);
    case "getAvailableThinkingLevels":
      return client.getAvailableThinkingLevels();
    case "setThinkingLevel":
      await client.setThinkingLevel(params.level);
      return true;
    case "prompt":
      return client.prompt(params.text, undefined, params.behavior);
    case "steer":
      return client.steer(params.text);
    case "followUp":
      return client.followUp(params.text);
    case "clearQueue":
      return client.clearQueue();
    case "abort":
      await client.abort();
      return true;
    case "newSession":
      return client.newSession();
    case "switchSession":
      return client.switchSession(params.sessionPath);
    case "setSessionName":
      await client.setSessionName(params.name);
      return true;
    case "getSessionStats":
      return client.getSessionStats();
    case "getTree":
      return client.getTree();
    case "fork":
      return client.fork(params.entryId);
    case "clone":
      return client.clone();
    case "compact":
      return client.compact(params.instructions);
    case "getLastAssistantText":
      return client.getLastAssistantText();
    case "exportHtml":
      return client.exportHtml();
    case "getForkMessages":
      return client.getForkMessages();
    case "replyUi":
      client.process.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: params.requestId, ...params.body })}\n`);
      return true;
    default:
      throw new Error(`未知调用：${method}`);
  }
}

async function handle(message) {
  try {
    send({ id: message.id, ok: true, data: await dispatch(message.method, message.params || {}) });
  } catch (error) {
    send({ id: message.id, ok: false, error: String(error?.message || error) });
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
    index = buffer.indexOf("\n");
  }
});
