import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const disposableDirectories = [
  "client/dist",
  "output",
  "playwright-report",
  "test-results",
  "tmp"
];
const logDirectories = [".", "client"];

function safeWorkspacePath(relativePath, { allowRoot = false } = {}) {
  const target = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, target);
  if ((!relative && !allowRoot) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing unsafe cleanup target: ${relativePath}`);
  }
  return target;
}

async function existingFileSize(target) {
  try {
    return (await stat(target)).size;
  } catch {
    return null;
  }
}

async function directorySize(target) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    total += entry.isDirectory() ? (await directorySize(child)) || 0 : (await existingFileSize(child)) || 0;
  }
  return total;
}

async function rootLogFiles(relativeDirectory) {
  const directory = safeWorkspacePath(relativeDirectory, { allowRoot: true });
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

const targets = [];
for (const relativePath of disposableDirectories) {
  const target = safeWorkspacePath(relativePath);
  const size = await directorySize(target);
  if (size !== null) targets.push({ target, relativePath, size, directory: true });
}
for (const relativeDirectory of logDirectories) {
  for (const target of await rootLogFiles(relativeDirectory)) {
    targets.push({
      target,
      relativePath: path.relative(workspaceRoot, target),
      size: (await existingFileSize(target)) || 0,
      directory: false
    });
  }
}

const totalBytes = targets.reduce((total, target) => total + target.size, 0);
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

if (!targets.length) {
  console.log("Workspace cleanup found no disposable artifacts.");
  process.exit(0);
}

for (const target of targets.sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
  console.log(`${apply ? "Removing" : "Would remove"} ${target.relativePath} (${megabytes(target.size)})`);
  if (apply) await rm(target.target, { recursive: target.directory, force: true });
}

console.log(`${apply ? "Removed" : "Found"} ${targets.length} disposable target(s), ${megabytes(totalBytes)} total.`);
if (!apply) console.log("Dry run only. Use `npm run clean:workspace:apply` to remove these generated artifacts.");
