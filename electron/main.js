import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Host } from "./host.js";
import { listFiles, readWorkspaceFile, workspaceFilePath, writeWorkspaceFile } from "./files.js";
import { gitChanges } from "./git.js";
import { deleteProvider, importModels, maskProviders, saveProvider, testProvider } from "./models.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let win = null;
let host = null;

let resizeDrag = null;

function sendWindowState() {
  if (win && !win.isDestroyed()) win.webContents.send("window:state", { maximized: win.isMaximized() });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    thickFrame: false,
    hasShadow: false,
    roundedCorners: true,
    autoHideMenuBar: true,
    title: "PI-Liangzi",
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("maximize", sendWindowState);
  win.on("unmaximize", sendWindowState);
  if (app.isPackaged) win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  else win.loadURL("http://127.0.0.1:5173");
}

function broadcast(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function registerIpc() {
  ipcMain.handle("app:get", () => host.snapshot());
  ipcMain.handle("window:title", (_event, title) => {
    if (win && !win.isDestroyed()) win.setTitle(title || "PI-Liangzi");
  });
  ipcMain.handle("window:minimize", () => win?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle("window:close", () => win?.close());
  ipcMain.handle("window:edit", (_event, command) => {
    const contents = win?.webContents;
    if (!contents) return;
    const actions = { undo: "undo", redo: "redo", cut: "cut", copy: "copy", paste: "paste", selectAll: "selectAll" };
    const method = actions[command];
    if (method) contents[method]();
  });
  ipcMain.on("window:resize-start", (event, dir) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target || target.isMaximized()) return;
    resizeDrag = { dir, bounds: target.getBounds(), origin: screen.getCursorScreenPoint(), win: target };
  });
  ipcMain.on("window:resize-move", () => {
    if (!resizeDrag || resizeDrag.win.isDestroyed() || resizeDrag.win.isMaximized()) return;
    const cur = screen.getCursorScreenPoint();
    const dx = cur.x - resizeDrag.origin.x;
    const dy = cur.y - resizeDrag.origin.y;
    const start = resizeDrag.bounds;
    const next = { x: start.x, y: start.y, width: start.width, height: start.height };
    if (resizeDrag.dir.includes("e")) next.width = Math.max(960, start.width + dx);
    if (resizeDrag.dir.includes("s")) next.height = Math.max(640, start.height + dy);
    if (resizeDrag.dir.includes("w")) {
      next.width = Math.max(960, start.width - dx);
      next.x = start.x + start.width - next.width;
    }
    if (resizeDrag.dir.includes("n")) {
      next.height = Math.max(640, start.height - dy);
      next.y = start.y + start.height - next.height;
    }
    resizeDrag.win.setBounds(next);
  });
  ipcMain.on("window:resize-end", () => {
    resizeDrag = null;
  });
  ipcMain.handle("workspace:pick", async () => {
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    return host.open(result.filePaths[0]);
  });
  ipcMain.handle("workspace:close", (_event, id) => host.close(id));
  ipcMain.handle("workspace:files", (_event, { id, dir }) => listFiles(host.cwdOf(id), dir || ""));
  ipcMain.handle("workspace:git", (_event, id) => gitChanges(host.cwdOf(id)));
  ipcMain.handle("workspace:readFile", (_event, { id, file }) => readWorkspaceFile(host.cwdOf(id), file));
  ipcMain.handle("workspace:writeFile", (_event, { id, file, text }) => writeWorkspaceFile(host.cwdOf(id), file, text));
  ipcMain.handle("workspace:openExternal", (_event, { id, file }) => shell.openPath(workspaceFilePath(host.cwdOf(id), file)));
  ipcMain.handle("workspace:setModel", (_event, { id, provider, modelId }) => host.setModel(id, provider, modelId));
  ipcMain.handle("workspace:setThinking", (_event, { id, level }) => host.setThinking(id, level));
  ipcMain.handle("workspace:thinkingLevels", (_event, id) => host.thinkingLevels(id));
  ipcMain.handle("workspace:prompt", (_event, { id, text }) => host.prompt(id, text));
  ipcMain.handle("workspace:steer", (_event, { id, text }) => host.steer(id, text));
  ipcMain.handle("workspace:follow", (_event, { id, text }) => host.follow(id, text));
  ipcMain.handle("workspace:abort", (_event, id) => host.abort(id));
  ipcMain.handle("workspace:sessions", (_event, id) => host.sessions(id));
  ipcMain.handle("workspace:forkMessages", (_event, id) => host.forkMessages(id));
  ipcMain.handle("workspace:reload", (_event, id) => host.reload(id));
  ipcMain.handle("workspace:command", async (_event, { id, name, payload }) => {
    if (name === "import") {
      const picked = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        filters: [{ name: "Session", extensions: ["jsonl"] }],
      });
      if (picked.canceled || !picked.filePaths[0]) return { title: "导入", body: "已取消" };
      return host.command(id, "resume", { path: picked.filePaths[0] });
    }
    const result = await host.command(id, name, payload || {});
    if (result.copy) clipboard.writeText(result.body || "");
    if (result.reveal) shell.showItemInFolder(result.reveal);
    if (result.revealFile) shell.showItemInFolder(result.body);
    return result;
  });
  ipcMain.handle("ui:reply", (_event, { id, requestId, body }) => host.replyUi(id, requestId, body));
  ipcMain.handle("settings:providers", () => maskProviders());
  ipcMain.handle("settings:saveProvider", (_event, provider) => {
    const providers = saveProvider(provider);
    for (const workspace of host.snapshot().workspaces) host.markReload(workspace.id);
    return providers;
  });
  ipcMain.handle("settings:deleteProvider", (_event, id) => {
    const providers = deleteProvider(id);
    for (const workspace of host.snapshot().workspaces) host.markReload(workspace.id);
    return providers;
  });
  ipcMain.handle("settings:test", (_event, id) => testProvider(id));
  ipcMain.handle("settings:import", async () => {
    const picked = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "models.json", extensions: ["json"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const result = importModels(picked.filePaths[0]);
    for (const workspace of host.snapshot().workspaces) host.markReload(workspace.id);
    return result;
  });
}

app.whenReady().then(async () => {
  host = new Host(broadcast);
  registerIpc();
  createWindow();
  await host.restore();
});

let quitting = false;

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.resolve(host?.shutdown()).finally(() => app.quit());
});
