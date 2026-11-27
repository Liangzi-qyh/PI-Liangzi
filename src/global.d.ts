export type ModelChoice = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
};

export type DynamicCommand = {
  name: string;
  summary: string;
  source?: string;
};

export type BuiltinCommand = {
  name: string;
  group: string;
  input: string;
  summary: string;
  textLabel?: string;
  confirm?: string;
};

export type Workspace = {
  id: string;
  cwd: string;
  title: string;
  status: string;
  error: string;
  provider: string;
  modelId: string;
  modelName: string;
  thinking: string;
  sessionName: string;
  availableModels: ModelChoice[];
  thinkingLevels: string[];
  commands: DynamicCommand[];
  extStatus: string;
  widget: string[];
  messages?: unknown[];
};

export type ProviderModel = {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
};

export type ProviderConfig = {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  hasApiKey: boolean;
  models: ProviderModel[];
};

export type CommandResult = {
  title: string;
  body: string;
  restore?: boolean;
  copy?: boolean;
};

export type UiRequest = {
  id: string;
  method: "select" | "confirm" | "input" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
};

declare global {
  interface Window {
    pi: {
      get: () => Promise<{ commands: BuiltinCommand[]; workspaces: Workspace[] }>;
      setTitle: (title: string) => Promise<void>;
      minimize: () => Promise<void>;
      maximize: () => Promise<boolean>;
      windowClose: () => Promise<void>;
      edit: (command: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll") => Promise<void>;
      resizeStart: (dir: string) => void;
      resizeMove: () => void;
      resizeEnd: () => void;
      onWindowState: (callback: (payload: { maximized: boolean }) => void) => () => void;
      pickFolder: () => Promise<Workspace | null>;
      closeWorkspace: (id: string) => Promise<boolean>;
      listFiles: (id: string, dir: string) => Promise<Array<{ name: string; path: string; directory: boolean }>>;
      gitChanges: (id: string) => Promise<{ repo: boolean; changes: Array<{ path: string; code: string; kind: string }> }>;
      readFile: (id: string, file: string) => Promise<{ binary: boolean; size: number; truncated: boolean; text: string }>;
      writeFile: (id: string, file: string, text: string) => Promise<boolean>;
      openExternal: (id: string, file: string) => Promise<string>;
      setModel: (id: string, provider: string, modelId: string) => Promise<unknown>;
      setThinking: (id: string, level: string) => Promise<unknown>;
      thinkingLevels: (id: string) => Promise<string[]>;
      prompt: (id: string, text: string) => Promise<unknown>;
      steer: (id: string, text: string) => Promise<unknown>;
      follow: (id: string, text: string) => Promise<unknown>;
      abort: (id: string) => Promise<string>;
      sessions: (id: string) => Promise<Array<{ path: string; name: string }>>;
      forkMessages: (id: string) => Promise<Array<{ entryId: string; text: string }>>;
      command: (id: string, name: string, payload?: Record<string, unknown>) => Promise<CommandResult>;
      replyUi: (id: string, requestId: string, body: Record<string, unknown>) => Promise<boolean>;
      providers: () => Promise<ProviderConfig[]>;
      saveProvider: (provider: unknown) => Promise<ProviderConfig[]>;
      deleteProvider: (id: string) => Promise<ProviderConfig[]>;
      importModels: () => Promise<{ replaced: string[] } | null>;
      testProvider: (id: string) => Promise<{ ok: boolean; message: string }>;
      onEvent: (callback: (payload: { id: string; event: never }) => void) => () => void;
      onWorkspace: (callback: (workspace: Workspace) => void) => () => void;
      onClosed: (callback: (payload: { id: string }) => void) => () => void;
      onNotice: (callback: (payload: { id: string; text: string }) => void) => () => void;
      onDialog: (callback: (payload: { id: string; request: UiRequest }) => void) => () => void;
      onEditor: (callback: (payload: { id: string; text: string }) => void) => () => void;
      onMessages: (callback: (payload: { id: string; messages: never[] }) => void) => () => void;
    };
  }
}
