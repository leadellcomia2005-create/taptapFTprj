import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const assetsDirectory = path.resolve("dist/assets");
const budgets = {
  largestJavaScript: 500 * 1024,
  totalJavaScript: 2100 * 1024,
  largestStylesheet: 300 * 1024,
  initialJavaScript: 700 * 1024,
  initialStylesheet: 300 * 1024
};

const entries = await readdir(assetsDirectory);
const assets = await Promise.all(
  entries.map(async (name) => ({ name, size: (await stat(path.join(assetsDirectory, name))).size }))
);
const javascript = assets.filter(({ name }) => name.endsWith(".js"));
const stylesheets = assets.filter(({ name }) => name.endsWith(".css"));
const largest = (items) => items.reduce((current, item) => (item.size > current.size ? item : current), { name: "none", size: 0 });
const largestJavaScript = largest(javascript);
const largestStylesheet = largest(stylesheets);
const totalJavaScript = javascript.reduce((total, asset) => total + asset.size, 0);
const indexHtml = await readFile(path.resolve("dist/index.html"), "utf8");
const initialAssetNames = [...indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)]
  .map((match) => match[1]);
const initialAssets = assets.filter(({ name }) => initialAssetNames.includes(name));
const initialJavaScript = initialAssets
  .filter(({ name }) => name.endsWith(".js"))
  .reduce((total, asset) => total + asset.size, 0);
const initialStylesheet = initialAssets
  .filter(({ name }) => name.endsWith(".css"))
  .reduce((total, asset) => total + asset.size, 0);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

console.log(`Largest JavaScript: ${largestJavaScript.name} (${kb(largestJavaScript.size)})`);
console.log(`Total JavaScript: ${kb(totalJavaScript)}`);
console.log(`Largest stylesheet: ${largestStylesheet.name} (${kb(largestStylesheet.size)})`);
console.log(`Initial JavaScript: ${kb(initialJavaScript)}`);
console.log(`Initial stylesheet: ${kb(initialStylesheet)}`);

const failures = [];
if (largestJavaScript.size > budgets.largestJavaScript) failures.push(`largest JavaScript exceeds ${kb(budgets.largestJavaScript)}`);
if (totalJavaScript > budgets.totalJavaScript) failures.push(`total JavaScript exceeds ${kb(budgets.totalJavaScript)}`);
if (largestStylesheet.size > budgets.largestStylesheet) failures.push(`largest stylesheet exceeds ${kb(budgets.largestStylesheet)}`);
if (initialJavaScript > budgets.initialJavaScript) failures.push(`initial JavaScript exceeds ${kb(budgets.initialJavaScript)}`);
if (initialStylesheet > budgets.initialStylesheet) failures.push(`initial stylesheet exceeds ${kb(budgets.initialStylesheet)}`);
const deferredChunkPattern = /(?:OwnerWorkspace|StaffWorkspace|RiderWorkspace|DeliveryMap|SalesChart|jspdf|html2canvas)/i;
const eagerlyLoadedDeferredChunks = initialAssetNames.filter((name) => deferredChunkPattern.test(name));
if (eagerlyLoadedDeferredChunks.length) {
  failures.push(`role or heavy feature chunks load eagerly: ${eagerlyLoadedDeferredChunks.join(", ")}`);
}

if (failures.length) {
  throw new Error(`Bundle budget failed: ${failures.join("; ")}`);
}

console.log("Bundle budget passed.");
