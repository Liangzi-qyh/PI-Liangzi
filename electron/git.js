import { spawn } from "node:child_process";

function unquote(text) {
  const value = text.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function kindOf(code) {
  if (code === "??") return "untracked";
  if (code.includes("U")) return "conflict";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("A")) return "added";
  return "modified";
}

export function parseGitStatus(text) {
  const changes = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.length < 4) continue;
    const code = line.slice(0, 2);
    let file = unquote(line.slice(3));
    const arrow = file.lastIndexOf(" -> ");
    if (arrow !== -1) file = unquote(file.slice(arrow + 4));
    file = file.replace(/\\/g, "/");
    if (!file) continue;
    changes.push({ path: file, code, kind: kindOf(code) });
    if (changes.length >= 300) break;
  }
  return changes;
}

export function gitChanges(cwd) {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--porcelain=v1", "-uall"], { cwd, windowsHide: true });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ repo: false, changes: [] });
    }, 8000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ repo: false, changes: [] });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) resolve({ repo: false, changes: [] });
      else resolve({ repo: true, changes: parseGitStatus(out) });
    });
  });
}
