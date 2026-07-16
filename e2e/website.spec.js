import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const roleLabels = {
  customer: "Customer",
  owner: "Owner",
  staff: "Staff",
  rider: "Rider"
};

const roleHeadings = {
  owner: /Operations control center/i,
  staff: /Operations dashboard/i,
  rider: /^Hi,/i
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

async function expectAccessible(page) {
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
  const failures = blocking.flatMap((violation) => violation.nodes.map((node) => `${violation.id}: ${node.target.join(" > ")}`));
  expect(failures).toEqual([]);
}

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectMinimumTouchTarget(control, minimum = 44) {
  const box = await control.boundingBox();
  expect(box, "Expected an interactive control to be visible").not.toBeNull();
  expect(box?.width || 0).toBeGreaterThanOrEqual(minimum);
  expect(box?.height || 0).toBeGreaterThanOrEqual(minimum);
}

async function expectTwoColumnMobileGrid(page, selector) {
  const items = page.locator(selector);
  await expect(items).toHaveCount(4);
  const [first, second] = await Promise.all([items.nth(0).boundingBox(), items.nth(1).boundingBox()]);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs((first?.y || 0) - (second?.y || 0))).toBeLessThanOrEqual(2);
  expect((second?.x || 0)).toBeGreaterThan(first?.x || 0);
}

async function activateWithKeyboard(page, control, key = "Enter") {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press(key);
}

test("landing page, registration entry, and accessibility are operational", async ({ page }) => {
  const runtime = watchRuntime(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /TapTap Foodtrip/i })).toBeVisible();
  await expect(page.locator("#popular-meals .login-meal-card")).toHaveCount(4);

  const skipLink = page.getByRole("link", { name: /Skip to menu/i });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#popular-meals")).toBeInViewport();

  await page.goto("/");
  await page.getByRole("link", { name: /View menu/i }).click();
  await expect(page.locator("#popular-meals")).toBeInViewport();

  const navOrderButton = page.getByRole("button", { name: /Order now/i }).first();
  await navOrderButton.click();
  const panel = page.locator("[data-login-modal-panel]");
  await panel.getByRole("button", { name: /Customer registration/i }).click();
  await expect(panel.getByRole("heading", { name: /Create customer account/i })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(navOrderButton).toBeFocused();
  await expectAccessible(page);
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("customer can add a meal, confirm a pin, and complete a COD pickup", async ({ page }) => {
  const runtime = watchRuntime(page);
  await loginAs(page, "customer");
  await expect(page.getByRole("heading", { name: /Choose your foodtrip/i })).toBeVisible();
  await expectAccessible(page);
  await page.locator('button[aria-label^="Add "]:not([disabled])').first().click();
  await page.getByRole("button", { name: /Choose delivery or pickup/i }).click();
  await expect(page.getByRole("heading", { name: /Secure checkout/i })).toBeVisible();

  await page.getByRole("button", { name: /Choose pin on map/i }).click();
  await expect(page.getByLabel("Latitude")).toBeVisible();
  await page.getByRole("button", { name: /^Pickup/i }).click();
  await page.getByLabel(/Mobile number/i).fill("09171234567");
  await expect(page.getByText("Ready to place order.")).toBeVisible();
  await expectAccessible(page);
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
  await expectAccessible(page);
  await activateWithKeyboard(page, page.getByRole("navigation", { name: /owner navigation/i }).getByRole("button", { name: "Reports" }));
  await expect(page.getByRole("heading", { name: /Reports & Reconciliation/i })).toBeVisible();
  await expectAccessible(page);
  expect(ownerRuntime.errors).toEqual([]);
  await page.getByRole("button", { name: /Log out/i }).click();

  const staffRuntime = watchRuntime(page);
  await loginAs(page, "staff");
  await expect(page.getByRole("heading", { name: /Operations dashboard/i })).toBeVisible();
  await expectAccessible(page);
  const navigation = page.getByRole("navigation", { name: /staff navigation/i });
  await activateWithKeyboard(page, navigation.getByRole("button", { name: /Walk-in POS/i }), "Space");
  await expect(page.getByRole("heading", { name: /Walk-in POS/i })).toBeVisible();
  await activateWithKeyboard(page, navigation.getByRole("button", { name: /Order Queue/i }));
  await expect(page.getByRole("heading", { name: /Order Queue/i })).toBeVisible();
  await expectAccessible(page);
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
  await expectAccessible(page);
  await page.getByRole("button", { name: /Capture delivery proof/i }).click();
  await expect(page.getByRole("heading", { name: /Proof of delivery/i })).toBeVisible();
  await expect(page.getByText(/Preparing camera|permission|camera/i).first()).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: /Cancel/i }).click();
  await activateWithKeyboard(page, page.getByRole("navigation", { name: /rider navigation/i }).getByRole("button", { name: /COD Ledger/i }));
  await expect(page.getByRole("heading", { name: /COD Ledger/i })).toBeVisible();
  await expectAccessible(page);
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("375px landing and customer workspace have no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const runtime = watchRuntime(page);
  await page.goto("/");
  await expect(page.locator(".login-hero-copy")).toContainText("Available for delivery, pickup, or walk-in.");
  await expectNoHorizontalOverflow(page);
  const heroActions = page.locator(".login-hero-actions");
  const orderButton = heroActions.getByRole("button", { name: /Order now/i });
  const menuLink = heroActions.getByRole("link", { name: /View menu/i });
  const [orderBox, menuBox] = await Promise.all([orderButton.boundingBox(), menuLink.boundingBox()]);
  expect(orderBox?.height || 0).toBeGreaterThanOrEqual(44);
  expect(menuBox?.height || 0).toBeGreaterThanOrEqual(44);
  expect(Math.abs((orderBox?.y || 0) - (menuBox?.y || 0))).toBeLessThanOrEqual(2);
  await expect(page.locator(".login-hero-promise small")).toBeVisible();
  await loginAs(page, "customer");
  await expectNoHorizontalOverflow(page);
  const supportButton = page.getByRole("button", { name: /Open customer support/i });
  await expectMinimumTouchTarget(supportButton);
  await expect(page.locator(".assistant-launcher")).toHaveCount(0);
  await supportButton.click();
  const supportPanel = page.getByRole("dialog", { name: /TapTap customer support/i });
  const mobileNavigation = page.getByRole("navigation", { name: /Customer mobile navigation/i });
  await expect(supportPanel).toBeVisible();
  const [supportBox, navigationBox] = await Promise.all([supportPanel.boundingBox(), mobileNavigation.boundingBox()]);
  expect((supportBox?.y || 0) + (supportBox?.height || 0)).toBeLessThanOrEqual((navigationBox?.y || 0) + 1);
  await supportPanel.getByRole("button", { name: /Close customer support/i }).click();
  await expect(supportPanel).toBeHidden();
  await page.evaluate(() => sessionStorage.setItem("taptap-checkout:v1:demo-customer", "temporary checkout data"));
  await page.getByRole("button", { name: /Log out/i }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("taptap-checkout:v1:demo-customer"))).toBeNull();
  expect(runtime.errors).toEqual([]);
});

test("stored cart and checkout draft recover without trusting stale product data", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("taptap-cart:v1:demo-customer", JSON.stringify({
      version: 1,
      items: [
        { id: "porkchop-meal", qty: 2, price: 1 },
        { id: "missing-meal", qty: 99 }
      ]
    }));
  });

  const runtime = watchRuntime(page);
  await loginAs(page, "customer");
  const currentOrder = page.getByLabel("Current order");
  await expect(currentOrder.getByRole("heading", { name: "2 items" })).toBeVisible();
  await expect(currentOrder.getByText("Porkchop", { exact: true })).toBeVisible();
  await expect(currentOrder.getByText(/99 each/)).toBeVisible();
  await expect(currentOrder.getByText("missing-meal")).toHaveCount(0);

  await currentOrder.getByRole("button", { name: /Choose delivery or pickup/i }).click();
  await page.getByRole("button", { name: /^Pickup/i }).click();
  await page.getByLabel(/Mobile number/i).fill("09171234567");
  await page.getByLabel(/Order notes/i).fill("Less sauce, please");
  await page.getByRole("button", { name: /Cancel/i }).click();

  await currentOrder.getByRole("button", { name: /Choose delivery or pickup/i }).click();
  await expect(page.getByText("Checkout details restored")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pickup/i })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel(/Mobile number/i)).toHaveValue("09171234567");
  await expect(page.getByLabel(/Order notes/i)).toHaveValue("Less sauce, please");
  await page.getByRole("button", { name: /Place order/i }).click();
  await expect(page.getByRole("heading", { name: /Order history/i })).toBeVisible();

  await expect.poll(() => page.evaluate(() => ({
    cart: localStorage.getItem("taptap-cart:v1:demo-customer"),
    checkout: sessionStorage.getItem("taptap-checkout:v1:demo-customer")
  }))).toEqual({ cart: null, checkout: null });
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("role dashboards avoid page overflow at phone and tablet widths", async ({ page }) => {
  const runtime = watchRuntime(page);
  for (const role of ["owner", "staff", "rider"]) {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, role);
    await expect(page.getByRole("heading", { name: roleHeadings[role] })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectMinimumTouchTarget(page.getByRole("button", { name: /Log out/i }));
    await expect(page.locator(".workspace-overview-header")).toBeVisible();

    if (role === "owner") {
      await expectMinimumTouchTarget(page.getByRole("button", { name: /Open navigation menu/i }));
      await expectTwoColumnMobileGrid(page, ".owner-kpi-grid .owner-metric-card");
      const [attention, metrics] = await Promise.all([
        page.locator(".owner-attention-board").boundingBox(),
        page.locator(".owner-kpi-grid").boundingBox()
      ]);
      expect(attention?.y || 0).toBeLessThan(metrics?.y || 0);
    }
    if (role === "staff") {
      await expectMinimumTouchTarget(page.getByRole("button", { name: /Open navigation menu/i }));
      await expectTwoColumnMobileGrid(page, ".staff-kpi-grid .staff-metric-button");
      const [priority, metrics] = await Promise.all([
        page.locator(".staff-priority-grid").boundingBox(),
        page.locator(".staff-kpi-grid").boundingBox()
      ]);
      expect(priority?.y || 0).toBeLessThan(metrics?.y || 0);
    }
    if (role === "rider") {
      const riderNavigation = page.getByRole("navigation", { name: /rider navigation/i });
      await expectMinimumTouchTarget(riderNavigation.getByRole("button", { name: /Assigned Orders/i }));
      await expectMinimumTouchTarget(riderNavigation.getByRole("button", { name: /COD Ledger/i }));
      const [activePanel, orderFeed] = await Promise.all([
        page.locator(".rider-active-panel").boundingBox(),
        page.locator(".rider-order-feed").boundingBox()
      ]);
      expect(activePanel?.y || 0).toBeLessThan(orderFeed?.y || 0);
    }

    await page.setViewportSize({ width: 768, height: 1024 });
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: /Log out/i }).click();
    await expect(page.getByRole("heading", { level: 1, name: /TapTap Foodtrip/i })).toBeVisible();
  }
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});
