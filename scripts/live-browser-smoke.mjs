import { chromium } from "@playwright/test";

const baseUrl = process.env.SMOKE_BASE_URL || "https://taptapfoodtrip.xyz/";
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : undefined)
});
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 });
const failures = [];

page.on("console", (message) => {
  if (["error", "warning"].includes(message.type())) failures.push(`console ${message.type()}: ${message.text()}`);
});
page.on("requestfailed", (request) => {
  failures.push(`request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText || "unknown"})`);
});

try {
  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!response?.ok()) failures.push(`landing response: ${response?.status() || "missing"}`);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(4_500);

  const result = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    brandLabel: document.querySelector(".login-home-brand")?.getAttribute("aria-label") || "",
    reviewText: document.querySelector("#customer-reviews")?.textContent || "",
    menuSources: [...document.querySelectorAll("#browse-menu img")]
      .slice(0, 4)
      .map((image) => image.currentSrc || image.getAttribute("src") || "")
  }));

  if (result.scrollWidth > result.width + 1) failures.push(`horizontal overflow: ${result.scrollWidth}px in ${result.width}px viewport`);
  if (result.brandLabel !== "TapTap FOODTRIP") failures.push(`brand label mismatch: ${result.brandLabel || "missing"}`);
  if (result.reviewText.includes("temporarily unavailable")) failures.push("public reviews are unavailable");
  if (!result.menuSources.length || result.menuSources.some((source) => !source.endsWith(".webp"))) {
    failures.push(`menu images are not consistently WebP: ${result.menuSources.join(", ") || "none"}`);
  }

  console.log(JSON.stringify({ baseUrl, ...result, failures }, null, 2));
} finally {
  await browser.close();
}

if (failures.length) process.exitCode = 1;
