const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("pi", {
  get: () => ipcRenderer.invoke("app:get"),
  setTitle: (title) => ipcRenderer.invoke("window:title", title),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  edit: (command) => ipcRenderer.invoke("window:edit", command),
  resizeStart: (dir) => ipcRenderer.send("window:resize-start", dir),
  resizeMove: () => ipcRenderer.send("window:resize-move"),
  resizeEnd: () => ipcRenderer.send("window:resize-end"),
  onWindowState: (callback) => listen("window:state", callback),
  pickFolder: () => ipcRenderer.invoke("workspace:pick"),
  closeWorkspace: (id) => ipcRenderer.invoke("workspace:close", id),
  listFiles: (id, dir) => ipcRenderer.invoke("workspace:files", { id, dir }),
  gitChanges: (id) => ipcRenderer.invoke("workspace:git", id),
  readFile: (id, file) => ipcRenderer.invoke("workspace:readFile", { id, file }),
  writeFile: (id, file, text) => ipcRenderer.invoke("workspace:writeFile", { id, file, text }),
  openExternal: (id, file) => ipcRenderer.invoke("workspace:openExternal", { id, file }),
  setModel: (id, provider, modelId) => ipcRenderer.invoke("workspace:setModel", { id, provider, modelId }),
  setThinking: (id, level) => ipcRenderer.invoke("workspace:setThinking", { id, level }),
  thinkingLevels: (id) => ipcRenderer.invoke("workspace:thinkingLevels", id),
  prompt: (id, text) => ipcRenderer.invoke("workspace:prompt", { id, text }),
  steer: (id, text) => ipcRenderer.invoke("workspace:steer", { id, text }),
  follow: (id, text) => ipcRenderer.invoke("workspace:follow", { id, text }),
  abort: (id) => ipcRenderer.invoke("workspace:abort", id),
  sessions: (id) => ipcRenderer.invoke("workspace:sessions", id),
  forkMessages: (id) => ipcRenderer.invoke("workspace:forkMessages", id),
  reload: (id) => ipcRenderer.invoke("workspace:reload", id),
  command: (id, name, payload) => ipcRenderer.invoke("workspace:command", { id, name, payload }),
  replyUi: (id, requestId, body) => ipcRenderer.invoke("ui:reply", { id, requestId, body }),
  providers: () => ipcRenderer.invoke("settings:providers"),
  saveProvider: (provider) => ipcRenderer.invoke("settings:saveProvider", provider),
  deleteProvider: (id) => ipcRenderer.invoke("settings:deleteProvider", id),
  importModels: () => ipcRenderer.invoke("settings:import"),
  testProvider: (id) => ipcRenderer.invoke("settings:test", id),
  onEvent: (callback) => listen("pi:event", callback),
  onWorkspace: (callback) => listen("pi:workspace", callback),
  onClosed: (callback) => listen("pi:closed", callback),
  onNotice: (callback) => listen("pi:notice", callback),
  onDialog: (callback) => listen("pi:dialog", callback),
  onEditor: (callback) => listen("pi:editor", callback),
  onMessages: (callback) => listen("pi:messages", callback),
});
