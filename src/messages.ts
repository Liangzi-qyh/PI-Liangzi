export type ToolCard = {
  id: string;
  name: string;
  args: string;
  output: string;
  running: boolean;
  error: boolean;
};

export type ChatMessage = {
  key: string;
  role: "user" | "assistant";
  text: string;
  thinking: string;
  thinkingStartedAt?: number;
  thinkingMs?: number;
  tools: ToolCard[];
};

function textOf(message: { content?: unknown } | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "text")
    .map((block) => String((block as { text?: string }).text || ""))
    .join("");
}

function signatureText(signature: unknown): string {
  if (typeof signature !== "string" || !signature.trim()) return "";
  try {
    const parsed = JSON.parse(signature) as unknown;
    const details = Array.isArray(parsed) ? parsed : [parsed];
    return details
      .map((detail) => {
        if (!detail || typeof detail !== "object") return "";
        const item = detail as { text?: unknown; summary?: unknown };
        return String(item.text || item.summary || "");
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

function thinkingOf(message: { content?: unknown } | undefined): string {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === "thinking")
    .map((block) => {
      const item = block as { thinking?: string; thinkingSignature?: string };
      return item.thinking || signatureText(item.thinkingSignature);
    })
    .join("");
}

function argsOf(args: unknown): string {
  if (!args) return "";
  if (typeof args === "string") return args.slice(0, 4000);
  try {
    return JSON.stringify(args, null, 2).slice(0, 4000);
  } catch {
    return "";
  }
}

let sequence = 0;
function nextKey(): string {
  sequence += 1;
  return `m-${sequence}`;
}

export function historyToChat(messages: Array<{ role?: string; content?: unknown; toolCallId?: string; isError?: boolean }>): ChatMessage[] {
  const chat: ChatMessage[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") {
      chat.push({ key: `h-${index}`, role: "user", text: textOf(message), thinking: "", tools: [] });
      return;
    }
    if (message.role === "assistant") {
      const tools = Array.isArray(message.content)
        ? message.content
            .filter((block) => block && (block as { type?: string }).type === "toolCall")
            .map((block) => {
              const call = block as { id?: string; name?: string; arguments?: unknown };
              return {
                id: call.id || nextKey(),
                name: call.name || "tool",
                args: argsOf(call.arguments),
                output: "",
                running: false,
                error: false,
              };
            })
        : [];
      chat.push({ key: `h-${index}`, role: "assistant", text: textOf(message), thinking: thinkingOf(message), tools });
      return;
    }
    if (message.role === "toolResult") {
      const tool = [...chat].reverse().flatMap((item) => item.tools).find((item) => item.id === message.toolCallId);
      if (tool) {
        tool.output = textOf(message);
        tool.error = Boolean(message.isError);
      }
    }
  });
  return chat;
}

function finishThinking(assistant: ChatMessage) {
  if (assistant.thinkingStartedAt && !assistant.thinkingMs) {
    assistant.thinkingMs = Date.now() - assistant.thinkingStartedAt;
  }
}

export function actionLabel(tool: ToolCard): string {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(tool.args) as Record<string, unknown>;
  } catch {
    args = {};
  }
  const file = String(args.path || args.filePath || args.file || "");
  const command = String(args.command || "");
  const short = (value: string) => (value.length > 72 ? `${value.slice(0, 72)}…` : value);
  if (tool.name === "bash" || tool.name === "powershell") {
    const shown = short(command || tool.name);
    if (tool.running) return `正在运行 ${shown}`;
    if (tool.error) return `运行失败 ${shown}`;
    return `已运行 ${shown}`;
  }
  if (tool.name === "edit" || tool.name === "write") {
    const shown = file || "文件";
    if (tool.running) return `正在修改 ${shown}`;
    if (tool.error) return `修改失败 ${shown}`;
    return `修改了 ${shown}`;
  }
  if (tool.name === "read") return `${tool.running ? "正在读取" : "读取了"} ${file || "文件"}`;
  if (tool.running) return `正在执行 ${tool.name}`;
  if (tool.error) return `${tool.name} 失败`;
  return `完成 ${tool.name}`;
}

function ensureAssistant(messages: ChatMessage[]): ChatMessage {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant") return last;
  const created: ChatMessage = { key: nextKey(), role: "assistant", text: "", thinking: "", tools: [] };
  messages.push(created);
  return created;
}

export function applyEvent(messages: ChatMessage[], event: { type?: string; message?: { role?: string; content?: unknown; toolCallId?: string; isError?: boolean }; assistantMessageEvent?: { type?: string; delta?: string; content?: string }; toolCallId?: string; toolName?: string; args?: unknown; partialResult?: { content?: unknown }; result?: { content?: unknown }; isError?: boolean }): ChatMessage[] {
  const next = messages.map((message) => ({ ...message, tools: message.tools.map((tool) => ({ ...tool })) }));
  if (event.type === "message_end" && event.message?.role === "user") {
    const text = textOf(event.message);
    const last = next[next.length - 1];
    if (last?.role === "user" && last.text === text) return next;
    next.push({ key: nextKey(), role: "user", text, thinking: "", tools: [] });
    return next;
  }
  if (event.type === "message_start" && event.message?.role === "assistant") {
    next.push({ key: nextKey(), role: "assistant", text: textOf(event.message), thinking: thinkingOf(event.message), tools: [] });
    return next;
  }
  if (event.type === "message_end" && event.message?.role === "assistant") {
    const assistant = ensureAssistant(next);
    const text = textOf(event.message);
    const thinking = thinkingOf(event.message);
    if (text) assistant.text = text;
    if (thinking) assistant.thinking = thinking;
    if (text) finishThinking(assistant);
    return next;
  }
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (!update) return next;
    const assistant = ensureAssistant(next);
    if (update.type === "text_delta") {
      if (assistant.thinking) finishThinking(assistant);
      assistant.text += update.delta || "";
    }
    if (update.type === "text_end" && typeof update.content === "string" && update.content.length >= assistant.text.length) {
      if (assistant.thinking) finishThinking(assistant);
      assistant.text = update.content;
    }
    if (update.type === "thinking_start" || update.type === "thinking_delta") {
      if (!assistant.thinkingStartedAt) assistant.thinkingStartedAt = Date.now();
    }
    if (update.type === "thinking_delta") assistant.thinking += update.delta || "";
    if (update.type === "thinking_end" && update.content) {
      assistant.thinking = String(update.content);
      finishThinking(assistant);
    }
    return next;
  }
  if (event.type === "tool_execution_start") {
    const assistant = ensureAssistant(next);
    assistant.tools.push({
      id: event.toolCallId || nextKey(),
      name: event.toolName || "tool",
      args: argsOf(event.args),
      output: "",
      running: true,
      error: false,
    });
    return next;
  }
  if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
    const tool = next.flatMap((message) => message.tools).find((item) => item.id === event.toolCallId);
    if (!tool) return next;
    const result = event.partialResult || event.result;
    if (result) tool.output = textOf(result);
    if (event.type === "tool_execution_end") {
      tool.running = false;
      tool.error = Boolean(event.isError);
    }
    return next;
  }
  return next;
}
