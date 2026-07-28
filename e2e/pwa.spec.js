import { expect, test } from "@playwright/test";

test("production website registers one worker and uses the offline navigation fallback", async ({ page }) => {
  const errors = [];
  let offlinePhase = false;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (offlinePhase && /ERR_INTERNET_DISCONNECTED/.test(message.text())) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    name: "TapTap Foodtrip",
    start_url: "/",
    scope: "/"
  });

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  const workerState = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheNames = await caches.keys();
    const cachedRequests = [];
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      cachedRequests.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
    }
    return {
      registrations: registrations.map((registration) => registration.scope),
      cacheNames,
      cachedRequests
    };
  });
  expect(workerState.registrations).toHaveLength(1);
  expect(workerState.cacheNames.filter((name) => name.startsWith("taptap-static-"))).toHaveLength(1);
  expect(workerState.cachedRequests).toContain("/offline.html");
  expect(workerState.cachedRequests.some((path) => path.startsWith("/api/"))).toBe(false);

  offlinePhase = true;
  await page.context().setOffline(true);
  await page.goto("/offline-check", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
  await expect(page.getByText(/private records are never served from an offline cache/i)).toBeVisible();

  await page.context().setOffline(false);
  offlinePhase = false;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /TapTap Foodtrip/i })).toBeVisible();
  expect(errors).toEqual([]);
});
