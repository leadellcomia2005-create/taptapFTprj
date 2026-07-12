import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const assetsDirectory = path.resolve("dist/assets");
const budgets = {
  largestJavaScript: 500 * 1024,
  totalJavaScript: 2100 * 1024,
  largestStylesheet: 420 * 1024
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
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

console.log(`Largest JavaScript: ${largestJavaScript.name} (${kb(largestJavaScript.size)})`);
console.log(`Total JavaScript: ${kb(totalJavaScript)}`);
console.log(`Largest stylesheet: ${largestStylesheet.name} (${kb(largestStylesheet.size)})`);

const failures = [];
if (largestJavaScript.size > budgets.largestJavaScript) failures.push(`largest JavaScript exceeds ${kb(budgets.largestJavaScript)}`);
if (totalJavaScript > budgets.totalJavaScript) failures.push(`total JavaScript exceeds ${kb(budgets.totalJavaScript)}`);
if (largestStylesheet.size > budgets.largestStylesheet) failures.push(`largest stylesheet exceeds ${kb(budgets.largestStylesheet)}`);

if (failures.length) {
  throw new Error(`Bundle budget failed: ${failures.join("; ")}`);
}

console.log("Bundle budget passed.");
