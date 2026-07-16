import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const clientRoot = fileURLToPath(new URL("..", import.meta.url));
const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const smokeScript = fileURLToPath(new URL("./website-smoke.mjs", import.meta.url));
const previewUrl = "http://127.0.0.1:4174/";

const preview = spawn(process.execPath, [viteCli, "preview", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], {
  cwd: clientRoot,
  env: process.env,
  stdio: "inherit"
});

const stopPreview = () => {
  if (preview.exitCode === null && !preview.killed) preview.kill("SIGTERM");
};

process.once("SIGINT", () => {
  stopPreview();
  process.exitCode = 130;
});
process.once("SIGTERM", () => {
  stopPreview();
  process.exitCode = 143;
});

async function waitForPreview() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (preview.exitCode !== null) throw new Error(`Vite preview exited with code ${preview.exitCode}.`);
    try {
      const response = await fetch(previewUrl);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite preview did not become ready at ${previewUrl}.`);
}

function runSmoke() {
  return new Promise((resolve, reject) => {
    const smoke = spawn(process.execPath, [smokeScript], {
      cwd: clientRoot,
      env: { ...process.env, SMOKE_BASE_URL: previewUrl },
      stdio: "inherit"
    });
    smoke.once("error", reject);
    smoke.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Website smoke exited with ${signal || `code ${code}`}.`));
    });
  });
}

try {
  await waitForPreview();
  await runSmoke();
} finally {
  stopPreview();
}
