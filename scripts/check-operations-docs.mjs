import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runbookPath = path.join(repositoryRoot, "docs", "OPERATIONS_RUNBOOK.md");
const clientTemplatePath = path.join(repositoryRoot, "docs", "config", "client.staging.env.example");
const serverTemplatePath = path.join(repositoryRoot, "docs", "config", "server.staging.env.example");

const [runbook, clientTemplate, serverTemplate] = await Promise.all([
  readFile(runbookPath, "utf8"),
  readFile(clientTemplatePath, "utf8"),
  readFile(serverTemplatePath, "utf8")
]);

const requiredRunbookSections = [
  "## Environment Isolation",
  "## Release Evidence",
  "## Backup Procedure",
  "## Restore Rehearsal",
  "## Deployment Checklist",
  "## Rollback",
  "### Realtime Database Rules",
  "### Data",
  "## Emergency Owner Access",
  "## Credential Rotation"
];
const missingSections = requiredRunbookSections.filter((section) => !runbook.includes(section));
if (missingSections.length) {
  throw new Error(`Operations runbook is missing: ${missingSections.join(", ")}`);
}

const requiredClientValues = [
  "VITE_ENABLE_DEMO_MODE=false",
  "VITE_DISABLE_FIREBASE=false",
  "VITE_ENABLE_FIREBASE_STORAGE=false"
];
const requiredServerValues = [
  "ENABLE_OPENAI=false",
  "ENABLE_TWILIO=false",
  "ENABLE_PAYMONGO=false"
];
const missingTemplateValues = [
  ...requiredClientValues.filter((value) => !clientTemplate.includes(value)),
  ...requiredServerValues.filter((value) => !serverTemplate.includes(value))
];
if (missingTemplateValues.length) {
  throw new Error(`Staging templates are missing safe defaults: ${missingTemplateValues.join(", ")}`);
}

console.log("Operations runbook and isolated staging templates passed the release check.");
