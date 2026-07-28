import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvironmentFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }));
}

const environmentPath = resolve(process.cwd(), "server", ".env");
const environment = { ...parseEnvironmentFile(environmentPath), ...process.env };
const mode = environment.PAYMONGO_MODE || "test";
const expectedPrefix = mode === "live" ? "sk_live_" : "sk_test_";
const results = [
  ["Explicitly enabled", environment.ENABLE_PAYMONGO === "true"],
  ["Mode is test or live", ["test", "live"].includes(mode)],
  [`Secret key matches ${mode} mode`, String(environment.PAYMONGO_SECRET_KEY || "").startsWith(expectedPrefix)],
  ["Webhook secret is present", String(environment.PAYMONGO_WEBHOOK_SECRET || "").startsWith("whsk_")],
  ["Website origin is configured", Boolean(environment.CLIENT_ORIGIN)]
];

let originValid = false;
try {
  const origin = new URL(String(environment.CLIENT_ORIGIN || ""));
  originValid = ["http:", "https:"].includes(origin.protocol) && origin.origin === origin.href.replace(/\/$/, "");
} catch {}
results.push(["Website origin is a complete HTTP(S) origin", originValid]);

console.log(`PayMongo readiness (${mode} mode)`);
for (const [label, passed] of results) console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
console.log("Secrets were checked by prefix only and were not printed.");

if (results.some(([, passed]) => !passed)) process.exitCode = 1;
