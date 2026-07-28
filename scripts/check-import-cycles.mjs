import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["client/src", "server/src", "functions"].map((directory) => path.join(repositoryRoot, directory));
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set(["node_modules", "dist", "build", "coverage"]);
const parserPath = path.join(repositoryRoot, "client", "node_modules", "@babel", "parser", "lib", "index.js");

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...await collectFiles(entryPath));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(entryPath);
  }
  return files;
}

async function resolveImport(fromFile, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;
  const unresolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = path.extname(unresolved)
    ? [unresolved]
    : [
        ...[...sourceExtensions].map((extension) => `${unresolved}${extension}`),
        ...[...sourceExtensions].map((extension) => path.join(unresolved, `index${extension}`))
      ];
  return candidates.find((candidate) => knownFiles.has(candidate)) || null;
}

if (!await exists(parserPath)) {
  throw new Error("The JavaScript/TypeScript parser is not installed. Run npm ci --prefix client before checking import cycles.");
}

const importedParser = await import(pathToFileURL(parserPath).href);
const parse = importedParser.parse || importedParser.default?.parse;
if (typeof parse !== "function") throw new Error("The JavaScript/TypeScript parser could not be loaded.");
const files = (await Promise.all(sourceRoots.map(collectFiles))).flat().map(path.normalize);
const knownFiles = new Set(files);
const graph = new Map();

function importSpecifiers(source, file) {
  const ast = parse(source, {
    sourceType: "unambiguous",
    sourceFilename: file,
    plugins: ["jsx", "typescript", "dynamicImport", "importAttributes"]
  });
  const specifiers = [];
  const pending = [ast.program];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source?.value) {
      specifiers.push(node.source.value);
    } else if (node.type === "ImportExpression" && node.source?.value) {
      specifiers.push(node.source.value);
    } else if (node.type === "CallExpression") {
      const dynamicImport = node.callee?.type === "Import";
      const commonJsRequire = node.callee?.type === "Identifier" && node.callee.name === "require";
      if ((dynamicImport || commonJsRequire) && node.arguments?.[0]?.value) specifiers.push(node.arguments[0].value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "comments", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === "object") pending.push(value);
    }
  }
  return [...new Set(specifiers)];
}

for (const file of files) {
  const source = await readFile(file, "utf8");
  const imports = importSpecifiers(source, file);
  const dependencies = [];
  for (const specifier of imports) {
    const resolved = await resolveImport(file, specifier, knownFiles);
    if (resolved) dependencies.push(path.normalize(resolved));
  }
  graph.set(file, [...new Set(dependencies)]);
}

const state = new Map();
const stack = [];
const cycles = new Map();
const relative = (file) => path.relative(repositoryRoot, file).replaceAll("\\", "/");

function cycleKey(filesInCycle) {
  const members = filesInCycle.slice(0, -1).map(relative);
  const rotations = members.map((_, index) => [...members.slice(index), ...members.slice(0, index)]);
  return rotations.map((items) => items.join(" -> ")).sort()[0];
}

function visit(file) {
  state.set(file, 1);
  stack.push(file);
  for (const dependency of graph.get(file) || []) {
    if (!state.has(dependency)) visit(dependency);
    else if (state.get(dependency) === 1) {
      const cycleStart = stack.indexOf(dependency);
      const cycle = [...stack.slice(cycleStart), dependency];
      cycles.set(cycleKey(cycle), cycle);
    }
  }
  stack.pop();
  state.set(file, 2);
}

for (const file of files) {
  if (!state.has(file)) visit(file);
}

if (cycles.size) {
  console.error(`Import cycle check failed with ${cycles.size} cycle(s):`);
  for (const cycle of cycles.values()) console.error(`- ${cycle.map(relative).join(" -> ")}`);
  process.exitCode = 1;
} else {
  console.log(`Import cycle check passed across ${files.length} source files.`);
}
