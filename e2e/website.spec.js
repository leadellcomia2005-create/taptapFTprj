import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const roleLabels = {
  customer: "Customer",
  owner: "Owner",
  staff: "Staff",
  rider: "Rider"
};

function watchRuntime(page) {
  const errors = [];
  const deferredRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/openai|twilio|paymongo|payments\/checkout|notifications\/sms/i.test(request.url())) {
      deferredRequests.push(request.url());
    }
  });
  return { errors, deferredRequests };
}

async function loginAs(page, role) {
  await page.goto("/");
  await page.getByRole("button", { name: /Order now/i }).first().click();
  const panel = page.locator("[data-login-modal-panel]");
  await expect(panel).toBeVisible();
  if (role !== "customer") {
    await panel.getByRole("button", { name: /Team access/i }).click();
    await panel.getByRole("button", { name: new RegExp(`^${roleLabels[role]}`, "i") }).click();
  }
  const submitName = role === "customer" ? /Sign in and order/i : new RegExp(`Sign in as ${role}`, "i");
  await panel.getByRole("button", { name: submitName }).click();
  await expect(page.getByRole("button", { name: /Log out/i })).toBeVisible();
}

test("landing page, registration entry, and accessibility are operational", async ({ page }) => {
  const runtime = watchRuntime(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /TapTap Foodtrip/i })).toBeVisible();
  await expect(page.locator("#popular-meals .login-meal-card")).toHaveCount(4);
  await page.getByRole("link", { name: /View menu/i }).click();
  await expect(page.locator("#popular-meals")).toBeInViewport();

  await page.getByRole("button", { name: /Order now/i }).first().click();
  const panel = page.locator("[data-login-modal-panel]");
  await panel.getByRole("button", { name: /Customer registration/i }).click();
  await expect(panel.getByRole("heading", { name: /Create customer account/i })).toBeVisible();

  await page.keyboard.press("Escape");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
  expect(blocking).toEqual([]);
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("customer can add a meal, confirm a pin, and complete a COD pickup", async ({ page }) => {
  const runtime = watchRuntime(page);
  await loginAs(page, "customer");
  await expect(page.getByRole("heading", { name: /Choose your foodtrip/i })).toBeVisible();
  await page.locator('button[aria-label^="Add "]:not([disabled])').first().click();
  await page.getByRole("button", { name: /Choose delivery or pickup/i }).click();
  await expect(page.getByRole("heading", { name: /Secure checkout/i })).toBeVisible();

  await page.getByRole("button", { name: /Choose pin on map/i }).click();
  await expect(page.getByLabel("Latitude")).toBeVisible();
  await page.getByRole("button", { name: /^Pickup/i }).click();
  await page.getByLabel(/Mobile number/i).fill("09171234567");
  await expect(page.getByText("Ready to place order.")).toBeVisible();
  await page.getByRole("button", { name: /Place order/i }).click();
  await expect(page.getByRole("heading", { name: /Order history/i })).toBeVisible();
  await expect(page.getByText(/TAP-/).first()).toBeVisible();
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("owner reports and staff POS/order queue are reachable", async ({ page }) => {
  const ownerRuntime = watchRuntime(page);
  await loginAs(page, "owner");
  await expect(page.getByRole("heading", { name: /Operations control center/i })).toBeVisible();
  await page.getByRole("navigation", { name: /owner navigation/i }).getByRole("button", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: /Reports & Reconciliation/i })).toBeVisible();
  expect(ownerRuntime.errors).toEqual([]);
  await page.getByRole("button", { name: /Log out/i }).click();

  const staffRuntime = watchRuntime(page);
  await loginAs(page, "staff");
  await expect(page.getByRole("heading", { name: /Operations dashboard/i })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: /staff navigation/i });
  await navigation.getByRole("button", { name: /Walk-in POS/i }).click();
  await expect(page.getByRole("heading", { name: /Walk-in POS/i })).toBeVisible();
  await navigation.getByRole("button", { name: /Order Queue/i }).click();
  await expect(page.getByRole("heading", { name: /Order Queue/i })).toBeVisible();
  expect(staffRuntime.errors).toEqual([]);
  expect(staffRuntime.deferredRequests).toEqual([]);
});

test("rider can open assigned delivery proof fallback and COD ledger", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("taptap-demo-data", JSON.stringify({
      orders: {
        "TAP-E2E-RIDER": {
          customerId: "customer-e2e",
          customerName: "E2E Customer",
          riderId: "demo-rider",
          riderName: "Demo Rider",
          deliveryType: "delivery",
          deliveryLocation: { lat: 14.451, lng: 120.976, source: "map-picker" },
          address: "Test delivery address",
          items: [{ id: "meal", name: "Test meal", price: 99, qty: 1 }],
          subtotal: 99,
          deliveryFee: 49,
          total: 148,
          paymentMethod: "cod",
          paymentStatus: "cod-pending",
          status: "arrived",
          handoffOtp: "123456",
          createdAt: Date.now()
        }
      }
    }));
  });
  const runtime = watchRuntime(page);
  await loginAs(page, "rider");
  await expect(page.getByRole("heading", { name: /^Hi,/i })).toBeVisible();
  await page.getByRole("button", { name: /Capture delivery proof/i }).click();
  await expect(page.getByRole("heading", { name: /Proof of delivery/i })).toBeVisible();
  await expect(page.getByText(/Preparing camera|permission|camera/i).first()).toBeVisible();
  await page.getByRole("button", { name: /Cancel/i }).click();
  await page.getByRole("navigation", { name: /rider navigation/i }).getByRole("button", { name: /COD Ledger/i }).click();
  await expect(page.getByRole("heading", { name: /COD Ledger/i })).toBeVisible();
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("375px landing and customer workspace have no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const runtime = watchRuntime(page);
  await page.goto("/");
  const landingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(landingOverflow).toBeLessThanOrEqual(1);
  const orderButton = page.getByRole("button", { name: /Order now/i }).first();
  expect((await orderButton.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  await loginAs(page, "customer");
  const workspaceOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(workspaceOverflow).toBeLessThanOrEqual(1);
  expect(runtime.errors).toEqual([]);
});
