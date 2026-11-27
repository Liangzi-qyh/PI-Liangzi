import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const skipped = new Set(["node_modules", ".git"]);

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveInside(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, relative || ".");
  if (!inside(base, target)) throw new Error("路径超出工作区");
  return { base, target };
}

export function listFiles(root, relative = "") {
  const { target } = resolveInside(root, relative);
  if (!statSync(target).isDirectory()) throw new Error("这不是文件夹");
  const prefix = String(relative || "").replace(/\\/g, "/").replace(/\/$/, "");
  return readdirSync(target, { withFileTypes: true })
    .filter((entry) => !skipped.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: prefix ? `${prefix}/${entry.name}` : entry.name,
      directory: entry.isDirectory(),
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, "zh"));
}

export function readWorkspaceFile(root, relative) {
  const { base, target } = resolveInside(root, relative);
  if (target === base) throw new Error("路径超出工作区");
  const info = statSync(target);
  if (info.isDirectory()) throw new Error("这是文件夹");
  if (info.size > 1_500_000) return { binary: true, size: info.size, truncated: false, text: "" };
  const buffer = readFileSync(target);
  if (buffer.subarray(0, 8000).includes(0)) return { binary: true, size: info.size, truncated: false, text: "" };
  const text = buffer.toString("utf8");
  const limit = 200000;
  return { binary: false, size: info.size, truncated: text.length > limit, text: text.slice(0, limit) };
}

export function writeWorkspaceFile(root, relative, text) {
  const { base, target } = resolveInside(root, relative);
  if (target === base) throw new Error("路径超出工作区");
  const info = statSync(target);
  if (info.isDirectory()) throw new Error("这是文件夹");
  if (info.size > 1_500_000) throw new Error("文件太大，请用系统程序修改");
  const existing = readFileSync(target);
  if (existing.subarray(0, 8000).includes(0)) throw new Error("二进制文件不能在这里修改");
  if (existing.toString("utf8").length > 200000) throw new Error("文件太长，请用系统程序修改，避免只保存前面一部分");
  writeFileSync(target, String(text ?? ""), "utf8");
  return true;
}

export function workspaceFilePath(root, relative) {
  const { base, target } = resolveInside(root, relative);
  if (target === base) throw new Error("路径超出工作区");
  return target;
}
