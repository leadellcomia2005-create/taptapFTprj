import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["client/src", "client/public", "client/dist"].map((entry) => path.join(repositoryRoot, entry));
const textExtensions = new Set([".css", ".html", ".js", ".json", ".jsx", ".mjs", ".ts", ".tsx", ".txt", ".webmanifest"]);
const ignoredDirectories = new Set(["node_modules"]);
const secretPatterns = [
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { label: "Groq secret key", pattern: /\bgsk_[A-Za-z0-9_-]{20,}\b/ },
  { label: "OpenAI secret key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { label: "private payment key", pattern: /\bsk_(?:test|live)_[A-Za-z0-9_-]{20,}\b/ },
  { label: "service-account private key", pattern: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/ }
];
const productionCredentialPatterns = [
  { label: "owner preview password", pattern: /Owner123!/ },
  { label: "staff preview password", pattern: /Staff123!/ },
  { label: "rider preview password", pattern: /Rider123!/ },
  { label: "customer preview password", pattern: /Customer123!/ }
];

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory) {
  if (!await exists(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) files.push(...await collectFiles(target));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(target);
  }
  return files;
}

const files = (await Promise.all(roots.map(collectFiles))).flat();
const findings = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const secret of secretPatterns) {
    if (secret.pattern.test(content)) {
      findings.push(`${path.relative(repositoryRoot, file).replaceAll("\\", "/")}: ${secret.label}`);
    }
  }
  const relativePath = path.relative(repositoryRoot, file).replaceAll("\\", "/");
  if (relativePath.startsWith("client/dist/") || relativePath.startsWith("client/public/")) {
    for (const credential of productionCredentialPatterns) {
      if (credential.pattern.test(content)) findings.push(`${relativePath}: ${credential.label}`);
    }
  }
}

if (findings.length) {
  console.error("Client secret check failed. Remove server credentials from browser-delivered files:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Client secret check passed across ${files.length} browser-delivered text files.`);
}
