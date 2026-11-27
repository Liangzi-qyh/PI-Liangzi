import { useEffect, useMemo, useRef, useState } from "react";
import type { BuiltinCommand, CommandResult, ModelChoice, ProviderConfig, UiRequest, Workspace } from "./global";
import { actionLabel, applyEvent, historyToChat, type ChatMessage } from "./messages";

const statusText: Record<string, string> = {
  starting: "连接中",
  idle: "空闲",
  running: "生成中",
  compacting: "压缩中",
  retrying: "重试中",
  error: "出错",
};

const sourceText: Record<string, string> = {
  extension: "扩展",
  prompt: "提示模板",
  skill: "技能",
};

const apis = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"];

const apiNames: Record<string, string> = {
  "openai-completions": "OpenAI 兼容",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic",
  "google-generative-ai": "Google",
};

const thinkingLabel: Record<string, string> = {
  off: "关闭",
  minimal: "极少",
  low: "简短",
  medium: "标准",
  high: "深入",
  xhigh: "更深入",
  max: "最长",
};

const featuredCommands = ["new", "resume", "model", "thinking", "compact", "copy", "export", "trust", "reload", "settings"];

const starters = ["说明这个项目", "找出可能的错误", "列出接下来可以做的事"];

const emptyModel = () => ({ id: "", name: "", contextWindow: 128000, maxTokens: 8192, reasoning: false, image: false });

function modelValue(model: ModelChoice): string {
  return JSON.stringify([model.provider, model.id]);
}

export function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [commands, setCommands] = useState<BuiltinCommand[]>([]);
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [activeId, setActiveId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [palette, setPalette] = useState(false);
  const [moreCommands, setMoreCommands] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [tests, setTests] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [hotkeys, setHotkeys] = useState(false);
  const [menu, setMenu] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [pending, setPending] = useState<BuiltinCommand | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [pendingSecret, setPendingSecret] = useState("");
  const [choices, setChoices] = useState<Array<{ id: string; label: string; payload: Record<string, unknown> }>>([]);
  const [dialog, setDialog] = useState<{ workspaceId: string; request: UiRequest } | null>(null);
  const [dialogText, setDialogText] = useState("");
  const [form, setForm] = useState({ id: "", name: "", api: apis[0], baseUrl: "", apiKey: "", clearApiKey: false, models: [emptyModel()] });
  const transcriptRef = useRef<HTMLDivElement>(null);
  const active = workspaces.find((workspace) => workspace.id === activeId) || null;
  const draft = drafts[activeId] || "";
  const busy = active ? ["running", "compacting", "retrying"].includes(active.status) : false;

  useEffect(() => {
    const applyWorkspace = (workspace: Workspace) => {
      setWorkspaces((current) => {
        const index = current.findIndex((item) => item.id === workspace.id);
        if (index === -1) return [...current, workspace];
        const next = current.slice();
        next[index] = { ...next[index], ...workspace };
        return next;
      });
      if (workspace.messages) setChats((current) => ({ ...current, [workspace.id]: historyToChat(workspace.messages as never[]) }));
    };
    window.pi.get().then((snapshot) => {
      setCommands(snapshot.commands);
      setWorkspaces(snapshot.workspaces);
      setActiveId((current) => current || snapshot.workspaces[0]?.id || "");
      const seeded: Record<string, ChatMessage[]> = {};
      for (const workspace of snapshot.workspaces) seeded[workspace.id] = historyToChat((workspace.messages || []) as never[]);
      setChats(seeded);
    }).catch((error) => setNotice(String(error)));
    const stops = [
      window.pi.onWorkspace(applyWorkspace),
      window.pi.onMessages(({ id, messages }) => setChats((current) => ({ ...current, [id]: historyToChat(messages) }))),
      window.pi.onEvent(({ id, event }) => setChats((current) => ({ ...current, [id]: applyEvent(current[id] || [], event) }))),
      window.pi.onClosed(({ id }) => {
        setWorkspaces((current) => {
          const next = current.filter((workspace) => workspace.id !== id);
          setActiveId((currentId) => (currentId === id ? next[0]?.id || "" : currentId));
          return next;
        });
      }),
      window.pi.onNotice(({ text }) => setNotice(text)),
      window.pi.onEditor(({ id, text }) => setDrafts((current) => ({ ...current, [id]: text }))),
      window.pi.onDialog(({ id, request }) => {
        setDialog({ workspaceId: id, request });
        setDialogText(request.prefill || "");
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, []);

  useEffect(() => {
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chats, activeId]);

  useEffect(() => window.pi.onWindowState(({ maximized: next }) => setMaximized(next)), []);

  useEffect(() => {
    document.body.classList.toggle("maximized", maximized);
    return () => document.body.classList.remove("maximized");
  }, [maximized]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".menubar")) setMenu("");
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
        setQuery("");
        setMenu("");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setMenu("");
        openFolder();
      } else if (event.key === "Escape") {
        setPalette(false);
        setPending(null);
        setHotkeys(false);
        setMenu("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(() => {
    const dynamic = (active?.commands || []).map((command) => ({
      name: command.name,
      group: sourceText[command.source || ""] || "工作区",
      input: "dynamic",
      summary: command.summary,
    }));
    const dynamicNames = new Set(dynamic.map((command) => command.name));
    const all = [...commands.filter((command) => !dynamicNames.has(command.name)), ...dynamic];
    const needle = query.trim().toLowerCase().replace(/^\//, "");
    const matched = needle ? all.filter((command) => `${command.name} ${command.summary} ${command.group}`.toLowerCase().includes(needle)) : all;
    if (needle || moreCommands) return matched;
    const picked = featuredCommands.map((name) => matched.find((command) => command.name === name)).filter((command) => command !== undefined);
    const extra = dynamic.filter((command) => !featuredCommands.includes(command.name));
    return [...picked, ...extra];
  }, [commands, active, query, moreCommands]);

  async function openFolder() {
    try {
      const workspace = await window.pi.pickFolder();
      if (!workspace) return;
      setActiveId(workspace.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function setDraft(text: string) {
    if (!activeId) return;
    setDrafts((current) => ({ ...current, [activeId]: text }));
  }

  async function send(kind: "prompt" | "steer" | "follow", text = draft) {
    if (!active || !text.trim()) return;
    setDraft("");
    setChats((current) => ({
      ...current,
      [active.id]: [...(current[active.id] || []), { key: `local-${Date.now()}`, role: "user", text, thinking: "", tools: [] }],
    }));
    try {
      if (kind === "steer") await window.pi.steer(active.id, text);
      else if (kind === "follow") await window.pi.follow(active.id, text);
      else await window.pi.prompt(active.id, text);
    } catch (error) {
      setDraft(text);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function stop() {
    if (!active) return;
    try {
      const restored = await window.pi.abort(active.id);
      if (restored) setDraft(restored);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function changeModel(value: string) {
    if (!active || !value) return;
    const [provider, modelId] = JSON.parse(value) as [string, string];
    try {
      await window.pi.setModel(active.id, provider, modelId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function changeThinking(level: string) {
    if (!active) return;
    try {
      await window.pi.setThinking(active.id, level);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function openSettings() {
    setSettings(true);
    setProviders(await window.pi.providers());
  }

  async function chooseCommand(command: BuiltinCommand) {
    setPalette(false);
    setQuery("");
    if (!active && command.input !== "local-settings" && command.input !== "local-hotkeys") {
      setNotice("先打开一个工作区");
      return;
    }
    if (command.input === "local-settings") return openSettings();
    if (command.input === "local-hotkeys") return setHotkeys(true);
    if (command.input === "none" || command.input === "dynamic") {
      await runCommand(command.name, {});
      return;
    }
    setPending(command);
    setPendingText("");
    setPendingSecret("");
    setChoices([]);
    if (!active) return;
    try {
      if (command.input === "thinking") {
        const levels = await window.pi.thinkingLevels(active.id);
        setChoices(levels.map((level) => ({ id: level, label: thinkingLabel[level] || level, payload: { level } })));
      } else if (command.input === "session") {
        const sessions = await window.pi.sessions(active.id);
        setChoices(sessions.map((session) => ({ id: session.path, label: session.name, payload: { path: session.path } })));
      } else if (command.input === "fork") {
        const messages = await window.pi.forkMessages(active.id);
        setChoices(messages.map((message) => ({ id: message.entryId, label: message.text || message.entryId, payload: { entryId: message.entryId } })));
      } else if (command.input === "model") {
        setChoices(active.availableModels.map((model) => ({
          id: modelValue(model),
          label: `${model.provider} / ${model.name}`,
          payload: { provider: model.provider, modelId: model.id },
        })));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function runCommand(name: string, payload: Record<string, unknown>) {
    if (!active) return;
    try {
      const response = await window.pi.command(active.id, name, payload);
      setPending(null);
      if (response.restore) {
        setDraft(response.body || "");
        setNotice(response.title);
        return;
      }
      if (response.body) setResult(response);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveForm() {
    try {
      const next = await window.pi.saveProvider({
        ...form,
        models: form.models.filter((model) => model.id.trim()).map((model) => ({
          id: model.id.trim(),
          name: model.name.trim() || model.id.trim(),
          contextWindow: Number(model.contextWindow) || undefined,
          maxTokens: Number(model.maxTokens) || undefined,
          reasoning: model.reasoning,
          input: model.image ? ["text", "image"] : ["text"],
        })),
      });
      setProviders(next);
      setNotice("已保存。空闲的工作区会重新连接并刷新模型列表。");
      setEditing(false);
      setForm({ id: "", name: "", api: apis[0], baseUrl: "", apiKey: "", clearApiKey: false, models: [emptyModel()] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function replyDialog(body: Record<string, unknown>) {
    if (!dialog) return;
    await window.pi.replyUi(dialog.workspaceId, dialog.request.id, body);
    setDialog(null);
  }

  const messages = active ? chats[active.id] || [] : [];

  function chooseMenu(action?: () => void) {
    setMenu("");
    action?.();
  }

  function startResize(dir: string, event: React.MouseEvent) {
    if (maximized) return;
    event.preventDefault();
    window.pi.resizeStart(dir);
    const move = () => window.pi.resizeMove();
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.pi.resizeEnd();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const menus: Array<{ id: string; label: string; items: Array<{ label: string; shortcut?: string; disabled?: boolean; separator?: boolean; action?: () => void }> }> = [
    {
      id: "file",
      label: "文件",
      items: [
        { label: "打开文件夹", shortcut: "Ctrl+O", action: () => { void openFolder(); } },
        { label: "关闭工作区", disabled: !active, action: () => { if (active) void window.pi.closeWorkspace(active.id); } },
        { separator: true, label: "" },
        { label: "退出", action: () => { void window.pi.windowClose(); } },
      ],
    },
    {
      id: "edit",
      label: "编辑",
      items: [
        { label: "撤销", shortcut: "Ctrl+Z", action: () => { void window.pi.edit("undo"); } },
        { label: "重做", shortcut: "Ctrl+Y", action: () => { void window.pi.edit("redo"); } },
        { separator: true, label: "" },
        { label: "剪切", shortcut: "Ctrl+X", action: () => { void window.pi.edit("cut"); } },
        { label: "复制", shortcut: "Ctrl+C", action: () => { void window.pi.edit("copy"); } },
        { label: "粘贴", shortcut: "Ctrl+V", action: () => { void window.pi.edit("paste"); } },
        { label: "全选", shortcut: "Ctrl+A", action: () => { void window.pi.edit("selectAll"); } },
        { separator: true, label: "" },
        { label: "命令面板", shortcut: "Ctrl+K", action: () => { setPalette(true); setQuery(""); setMoreCommands(false); } },
      ],
    },
    {
      id: "view",
      label: "视图",
      items: [
        ...(active?.availableModels.length ? active.availableModels.map((model) => ({
          label: `${model.provider === active.provider && model.id === active.modelId ? "✓ " : ""}${model.name}`,
          action: () => { void changeModel(modelValue(model)); },
        })) : [{ label: "配置模型", action: () => { void openSettings(); } }]),
        { separator: true, label: "" },
        ...((active?.thinkingLevels || []).map((level) => ({
          label: `${active?.thinking === level ? "✓ " : ""}${thinkingLabel[level] || level}`,
          action: () => { void changeThinking(level); },
        }))),
        { separator: true, label: "" },
        { label: "重新连接", disabled: !active, action: () => { void runCommand("reload", {}); } },
        { label: "模型配置", action: () => { void openSettings(); } },
      ],
    },
    {
      id: "window",
      label: "窗口",
      items: [
        ...workspaces.map((workspace) => ({
          label: `${workspace.id === activeId ? "✓ " : ""}${workspace.sessionName || workspace.title}`,
          action: () => setActiveId(workspace.id),
        })),
        ...(workspaces.length ? [{ separator: true, label: "" }] : []),
        { label: "最小化", action: () => { void window.pi.minimize(); } },
        { label: maximized ? "还原" : "最大化", action: () => { void window.pi.maximize(); } },
        { label: "关闭", action: () => { void window.pi.windowClose(); } },
      ],
    },
    {
      id: "help",
      label: "帮助",
      items: [
        { label: "快捷键", action: () => setHotkeys(true) },
        { label: "关于 PI-Liangzi", action: () => setResult({ title: "关于 PI-Liangzi", body: "PI-Liangzi 是 Pi 的桌面工作区。每个文件夹单独对话，模型来自同一份配置。" }) },
      ],
    },
  ];

  return (
    <div className="app">
      <div className="menubar" onDoubleClick={(event) => { if ((event.target as HTMLElement).closest("button")) return; void window.pi.maximize(); }}>
        <strong>PI-Liangzi</strong>
        {menus.map((entry) => (
          <div key={entry.id} className="menu-slot" onMouseEnter={() => { if (menu) setMenu(entry.id); }}>
            <button className={menu === entry.id ? "open" : ""} onClick={() => setMenu(menu === entry.id ? "" : entry.id)}>{entry.label}</button>
            {menu === entry.id ? (
              <div className="dropdown">
                {entry.items.map((item, index) => item.separator ? <div key={`s-${index}`} className="sep" /> : (
                  <button key={item.label + index} disabled={item.disabled} onClick={() => chooseMenu(item.action)}>
                    <span>{item.label}</span>
                    {item.shortcut ? <small>{item.shortcut}</small> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div className="window-controls">
          <button aria-label="最小化" onClick={() => window.pi.minimize()}>–</button>
          <button aria-label={maximized ? "还原" : "最大化"} onClick={() => window.pi.maximize()}>{maximized ? "❐" : "□"}</button>
          <button className="close" aria-label="关闭" onClick={() => window.pi.windowClose()}>×</button>
        </div>
      </div>
      <aside className="rail">
        <div className="brand">
          <span>工作区</span>
          <button className="add" aria-label="打开文件夹" onClick={openFolder}>+</button>
        </div>
        <div className="workspace-list">
          {workspaces.map((workspace) => {
            const live = ["running", "compacting", "retrying"].includes(workspace.status);
            return (
              <div key={workspace.id} className={workspace.id === activeId ? "workspace active" : "workspace"} onClick={() => setActiveId(workspace.id)}>
                {live || workspace.status === "error" ? <span className={`dot ${workspace.status}`} /> : null}
                <span>
                  <b>{workspace.sessionName || workspace.title}</b>
                  <small>{[workspace.sessionName ? workspace.title : "", workspace.modelName || statusText[workspace.status]].filter(Boolean).join(" · ")}</small>
                </span>
                <button className="icon-close" aria-label="关闭工作区" onClick={(event) => { event.stopPropagation(); window.pi.closeWorkspace(workspace.id); }}>×</button>
              </div>
            );
          })}
        </div>
      </aside>
      <main>
        <header>
          <div className="path" title={active?.cwd || ""}>{active?.title || "未打开文件夹"}</div>
          {active ? (
            <>
              {active.availableModels.length === 0 ? (
                <button onClick={openSettings}>配置模型</button>
              ) : (
                <select
                  aria-label="模型"
                  value={active.availableModels.some((model) => model.provider === active.provider && model.id === active.modelId) ? modelValue({ provider: active.provider, id: active.modelId, name: active.modelName }) : ""}
                  onChange={(event) => changeModel(event.target.value)}
                >
                  {active.availableModels.map((model) => (
                    <option key={modelValue(model)} value={modelValue(model)}>{model.name}</option>
                  ))}
                </select>
              )}
              {(active.thinkingLevels || []).length ? (
                <select aria-label="思考程度" value={active.thinking || active.thinkingLevels[0]} onChange={(event) => changeThinking(event.target.value)}>
                  {active.thinkingLevels.map((level) => <option key={level} value={level}>{thinkingLabel[level] || level}</option>)}
                </select>
              ) : null}
              <button onClick={() => { setPalette(true); setQuery(""); setMoreCommands(false); }}>命令</button>
            </>
          ) : null}
        </header>
        {active ? (
          <>
            {active.error ? <div className="banner">{active.error}</div> : null}
            {active.extStatus ? <div className="status-line">{active.extStatus}</div> : null}
            <div className="transcript" ref={transcriptRef}>
              {messages.length === 0 ? (
                <div className="empty">
                  <p>从一件具体的事开始。</p>
                  <div className="starters">
                    {starters.map((text) => <button className="starter" key={text} onClick={() => send("prompt", text)}>{text}</button>)}
                  </div>
                </div>
              ) : null}
              {messages.map((message, index) => {
                const streaming = busy && index === messages.length - 1 && message.role === "assistant";
                const seconds = message.thinkingMs && message.thinkingMs >= 1000 ? Math.round(message.thinkingMs / 1000) : 0;
                return (
                  <article key={message.key} className={message.role}>
                    {message.thinking && !message.text ? (
                      <details className="thinking" open>
                        <summary>思考</summary>
                        <pre>{message.thinking}{streaming ? <i className="caret" /> : null}</pre>
                      </details>
                    ) : null}
                    {message.thinking && message.text ? (
                      <details className="thinking">
                        <summary>{seconds ? `思考了 ${seconds} 秒` : "查看思考"}</summary>
                        <pre>{message.thinking}</pre>
                      </details>
                    ) : null}
                    {message.role === "user" && message.text ? (
                      <div className="bubble">{message.text}</div>
                    ) : null}
                    {message.role === "assistant" && (message.text || (streaming && !message.thinking)) ? (
                      <div className="prose">
                        {message.text}
                        {streaming ? <i className="caret" /> : null}
                      </div>
                    ) : null}
                    {message.tools.map((tool) => (
                      <details key={`${tool.id}-${tool.running ? "run" : "done"}`} className={tool.error ? "tool error" : "tool"} open={tool.running || undefined}>
                        <summary>{actionLabel(tool)}</summary>
                        {tool.output ? <pre>{tool.output}</pre> : null}
                      </details>
                    ))}
                  </article>
                );
              })}
              {busy && messages.at(-1)?.role !== "assistant" ? (
                <article className="assistant"><div className="prose"><i className="caret" /></div></article>
              ) : null}
            </div>
            {active.widget.length ? <pre className="widget">{active.widget.join("\n")}</pre> : null}
            <div className="composer-wrap">
              <div className="composer">
                <div className="composer-meta">
                  <span>{statusText[active.status] || active.status}</span>
                  {busy ? <button className="link" onClick={() => send("steer")}>现在改口</button> : null}
                  {busy ? <button className="link" onClick={() => send("follow")}>做完再说</button> : null}
                </div>
                <div className="field">
                  <textarea
                    value={draft}
                    placeholder={busy ? "生成中。Enter 是现在改口。" : "输入任务。行首按 / 或 Ctrl+K 打开命令。"}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "/" && !draft) {
                        event.preventDefault();
                        setPalette(true);
                        setQuery("");
                      } else if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        send(busy ? "steer" : "prompt");
                      }
                    }}
                  />
                  <button className={busy ? "send stop" : "send"} aria-label={busy ? "停止" : "发送"} onClick={() => (busy ? stop() : send("prompt"))}>{busy ? "■" : "↑"}</button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <section className="welcome">
            <h1>打开一个文件夹</h1>
            <p>每个文件夹是一个工作区，可以同时开着。模型来自同一份配置，每个工作区各自选择。</p>
            <button className="primary" onClick={openFolder}>打开文件夹</button>
          </section>
        )}
      </main>
      {maximized ? null : (
        <>
          <div className="resize n" onMouseDown={(event) => startResize("n", event)} />
          <div className="resize s" onMouseDown={(event) => startResize("s", event)} />
          <div className="resize e" onMouseDown={(event) => startResize("e", event)} />
          <div className="resize w" onMouseDown={(event) => startResize("w", event)} />
          <div className="resize ne" onMouseDown={(event) => startResize("ne", event)} />
          <div className="resize nw" onMouseDown={(event) => startResize("nw", event)} />
          <div className="resize se" onMouseDown={(event) => startResize("se", event)} />
          <div className="resize sw" onMouseDown={(event) => startResize("sw", event)} />
        </>
      )}
      {palette ? (
        <div className="overlay" onMouseDown={() => setPalette(false)}>
          <div className="sheet" onMouseDown={(event) => event.stopPropagation()}>
            <input autoFocus value={query} placeholder="搜索命令或注释" onChange={(event) => setQuery(event.target.value)} />
            <div className="menu">
              {paletteItems.map((command) => (
                <button key={`${command.group}-${command.name}`} onClick={() => chooseCommand(command as BuiltinCommand)}>
                  <b>/{command.name}</b>
                  <span>{command.summary}</span>
                  <small>{command.group}</small>
                </button>
              ))}
            </div>
            {!query.trim() ? (
              <button className="more" onClick={() => setMoreCommands((current) => !current)}>{moreCommands ? "只看常用" : "更多命令"}</button>
            ) : null}
          </div>
        </div>
      ) : null}
      {pending ? (
        <div className="overlay" onMouseDown={() => setPending(null)}>
          <div className="sheet narrow" onMouseDown={(event) => event.stopPropagation()}>
            <h2>/{pending.name}</h2>
            <p>{pending.summary}</p>
            {pending.input === "confirm" ? <p>{pending.confirm}</p> : null}
            {choices.length ? (
              <div className="menu">
                {choices.map((choice) => (
                  <button key={choice.id} onClick={() => runCommand(pending.name, choice.payload)}>{choice.label}</button>
                ))}
              </div>
            ) : null}
            {["model", "thinking", "session", "fork"].includes(pending.input) && choices.length === 0 ? <p>没有可选项</p> : null}
            {["text", "login", "provider"].includes(pending.input) ? (
              <input autoFocus value={pendingText} placeholder={pending.textLabel || "输入"} onChange={(event) => setPendingText(event.target.value)} />
            ) : null}
            {pending.input === "login" ? (
              <input type="password" value={pendingSecret} placeholder="API key，可留空" onChange={(event) => setPendingSecret(event.target.value)} />
            ) : null}
            <div className="actions">
              <button onClick={() => setPending(null)}>取消</button>
              {pending.input === "confirm" ? <button className="primary" onClick={() => runCommand(pending.name, { confirmed: true })}>确认</button> : null}
              {["text", "login", "provider"].includes(pending.input) ? (
                <button className="primary" onClick={() => runCommand(pending.name, { text: pendingText, provider: pendingText, apiKey: pendingSecret })}>执行</button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {settings ? (
        <div className="overlay" onMouseDown={() => setSettings(false)}>
          <div className="sheet wide" onMouseDown={(event) => event.stopPropagation()}>
            <h2>模型配置</h2>
            <p>写进 Pi 的 models.json。保存后，每个已打开的工作区都能选到这些模型。</p>
            <div className="provider-list">
              {providers.map((provider) => (
                <div className="provider-card" key={provider.id}>
                  <b>{provider.name}</b>
                  <span>{apiNames[provider.api] || provider.api || "内置"} · {provider.baseUrl || "默认地址"} · {provider.hasApiKey ? "已有密钥" : "无密钥"}</span>
                  <small>{provider.models.map((model) => model.name).join("、") || "使用厂家自带模型"}</small>
                  {tests[provider.id] ? <em className={tests[provider.id] === "连接成功" ? "ok" : ""}>{tests[provider.id]}</em> : null}
                  <button onClick={async () => {
                    setTests((current) => ({ ...current, [provider.id]: "正在连接…" }));
                    try {
                      const result = await window.pi.testProvider(provider.id);
                      setTests((current) => ({ ...current, [provider.id]: result.message }));
                    } catch (error) {
                      setTests((current) => ({ ...current, [provider.id]: error instanceof Error ? error.message : String(error) }));
                    }
                  }}>测试连接</button>
                  <button onClick={() => {
                    setEditing(true);
                    setForm({
                    id: provider.id,
                    name: provider.name,
                    api: provider.api || apis[0],
                    baseUrl: provider.baseUrl,
                    apiKey: "",
                    clearApiKey: false,
                    models: provider.models.length ? provider.models.map((model) => ({
                      id: model.id,
                      name: model.name,
                      contextWindow: model.contextWindow || 128000,
                      maxTokens: model.maxTokens || 8192,
                      reasoning: model.reasoning,
                      image: model.input.includes("image"),
                    })) : [emptyModel()],
                  })}}>编辑</button>
                  <button onClick={async () => setProviders(await window.pi.deleteProvider(provider.id))}>删除</button>
                </div>
              ))}
            </div>
            {editing ? (
            <>
            <label>厂家 ID<input value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} /></label>
            <label>显示名<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>协议
              <select value={form.api} onChange={(event) => setForm({ ...form, api: event.target.value })}>
                {apis.map((api) => <option key={api}>{api}</option>)}
              </select>
            </label>
            <label>接口地址<input value={form.baseUrl} placeholder="https://example.com/v1" onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
            <label>API key<input type="password" value={form.apiKey} placeholder={form.id ? "留空则不修改" : ""} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></label>
            {form.models.map((model, index) => (
              <div className="model-row" key={index}>
                <input placeholder="模型 ID" value={model.id} onChange={(event) => {
                  const models = form.models.slice();
                  models[index] = { ...model, id: event.target.value };
                  setForm({ ...form, models });
                }} />
                <input placeholder="显示名" value={model.name} onChange={(event) => {
                  const models = form.models.slice();
                  models[index] = { ...model, name: event.target.value };
                  setForm({ ...form, models });
                }} />
                <label><input type="checkbox" checked={model.reasoning} onChange={(event) => {
                  const models = form.models.slice();
                  models[index] = { ...model, reasoning: event.target.checked };
                  setForm({ ...form, models });
                }} />思考</label>
                <label><input type="checkbox" checked={model.image} onChange={(event) => {
                  const models = form.models.slice();
                  models[index] = { ...model, image: event.target.checked };
                  setForm({ ...form, models });
                }} />图像</label>
              </div>
            ))}
            </>
            ) : null}
            <div className="actions">
              {editing ? <button onClick={() => setForm({ ...form, models: [...form.models, emptyModel()] })}>加一个模型</button> : (
                <button onClick={() => {
                  setForm({ id: "", name: "", api: apis[0], baseUrl: "", apiKey: "", clearApiKey: false, models: [emptyModel()] });
                  setEditing(true);
                }}>添加厂家</button>
              )}
              <button onClick={async () => {
                const imported = await window.pi.importModels();
                if (!imported) return;
                setProviders(await window.pi.providers());
                setNotice(imported.replaced.length ? `已导入，覆盖了 ${imported.replaced.join("、")}` : "已导入");
              }}>导入 models.json</button>
              {editing ? <button className="primary" onClick={saveForm}>保存</button> : null}
              {editing ? <button onClick={() => setEditing(false)}>取消</button> : null}
              <button onClick={() => setSettings(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
      {dialog ? (
        <div className="overlay">
          <div className="sheet narrow">
            <h2>{dialog.request.title || "需要你确认"}</h2>
            {dialog.request.message ? <p>{dialog.request.message}</p> : null}
            {dialog.request.method === "select" ? (
              <div className="menu">
                {(dialog.request.options || []).map((option) => (
                  <button key={option} onClick={() => replyDialog({ value: option })}>{option}</button>
                ))}
              </div>
            ) : null}
            {dialog.request.method === "confirm" ? (
              <div className="actions">
                <button onClick={() => replyDialog({ confirmed: false })}>取消</button>
                <button className="primary" onClick={() => replyDialog({ confirmed: true })}>确认</button>
              </div>
            ) : null}
            {dialog.request.method === "input" || dialog.request.method === "editor" ? (
              <>
                {dialog.request.method === "editor"
                  ? <textarea value={dialogText} onChange={(event) => setDialogText(event.target.value)} />
                  : <input autoFocus value={dialogText} placeholder={dialog.request.placeholder || ""} onChange={(event) => setDialogText(event.target.value)} />}
                <div className="actions">
                  <button onClick={() => replyDialog({ cancelled: true })}>取消</button>
                  <button className="primary" onClick={() => replyDialog({ value: dialogText })}>确定</button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {result ? (
        <div className="overlay" onMouseDown={() => setResult(null)}>
          <div className="sheet narrow" onMouseDown={(event) => event.stopPropagation()}>
            <h2>{result.title}</h2>
            <pre>{result.body}</pre>
            <button onClick={() => setResult(null)}>关闭</button>
          </div>
        </div>
      ) : null}
      {hotkeys ? (
        <div className="overlay" onMouseDown={() => setHotkeys(false)}>
          <div className="sheet narrow" onMouseDown={(event) => event.stopPropagation()}>
            <h2>快捷键</h2>
            <p>Ctrl+K 打开命令面板</p>
            <p>Enter 发送。生成中则作为插话</p>
            <p>Shift+Enter 换行</p>
            <p>输入框为空时按 / 打开命令</p>
            <button onClick={() => setHotkeys(false)}>关闭</button>
          </div>
        </div>
      ) : null}
      {notice ? <button className="toast" onClick={() => setNotice("")}>{notice}</button> : null}
    </div>
  );
}
