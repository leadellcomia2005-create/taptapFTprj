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

async function seedDemoNotifications(page, notifications) {
  await page.addInitScript((seededNotifications) => {
    localStorage.setItem("taptap-demo-data", JSON.stringify({ notifications: seededNotifications }));
  }, notifications);
}

async function expectAccessible(page, include) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  const usesEdge = await page.evaluate(() => /\bEdg\//.test(navigator.userAgent));
  if (usesEdge) builder.setLegacyMode();
  if (include) builder.include(include);
  const accessibility = await builder.analyze();
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

test("browser notification permission is never requested automatically and denied access stays safe", async ({ page }) => {
  await page.addInitScript(() => {
    window.__taptapNotificationPermission = "default";
    window.__taptapNotificationPermissionRequests = 0;
    class MockNotification {}
    Object.defineProperty(MockNotification, "permission", {
      configurable: true,
      get: () => window.__taptapNotificationPermission
    });
    MockNotification.requestPermission = async () => {
      window.__taptapNotificationPermissionRequests += 1;
      return window.__taptapNotificationPermission;
    };
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: MockNotification
    });
  });

  const runtime = watchRuntime(page);
  await loginAs(page, "owner");
  expect(await page.evaluate(() => window.__taptapNotificationPermissionRequests)).toBe(0);

  await page.getByRole("button", { name: "Open notifications" }).click();
  let dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.getByRole("button", { name: "More notification actions" }).click();
  const unavailableAction = dialog.getByTestId("push-notification-toggle");
  await expect(unavailableAction).toContainText("Browser alerts unavailable");
  await expect(unavailableAction).toBeDisabled();
  expect(await page.evaluate(() => window.__taptapNotificationPermissionRequests)).toBe(0);

  await dialog.getByRole("button", { name: "Close notifications" }).click();
  await page.evaluate(() => {
    window.__taptapNotificationPermission = "denied";
  });
  await page.getByRole("button", { name: "Open notifications" }).click();
  dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.getByRole("button", { name: "More notification actions" }).click();
  const blockedAction = dialog.getByTestId("push-notification-toggle");
  await expect(blockedAction).toContainText("Browser alerts blocked");
  await expect(blockedAction).toBeDisabled();
  expect(await page.evaluate(() => window.__taptapNotificationPermissionRequests)).toBe(0);
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("customer can add a meal, confirm a pin, and complete a COD pickup", async ({ page }) => {
  test.setTimeout(60_000);
  const runtime = watchRuntime(page);
  await loginAs(page, "customer");
  await expect(page.getByRole("heading", { name: /Choose your foodtrip/i })).toBeVisible();
  await expectAccessible(page, ".storefront-page");
  await page.locator('button[aria-label^="Add "]:not([disabled])').first().click();
  await page.getByRole("button", { name: /Continue to checkout/i }).click();
  await expect(page.getByRole("heading", { name: /Secure checkout/i })).toBeVisible();

  await page.getByRole("button", { name: /Choose pin on map/i }).click();
  await expect(page.getByLabel("Latitude")).toBeVisible();
  await page.getByRole("button", { name: /^Pickup/i }).click();
  await page.getByLabel(/Mobile number/i).fill("09171234567");
  await expect(page.getByText("Ready to place order.")).toBeVisible();
  await expectAccessible(page, ".checkout-modal");
  await page.getByRole("button", { name: /Place order/i }).click();
  await expect(page.getByRole("heading", { name: /Order history/i })).toBeVisible();
  await expect(page.getByText(/TAP-/).first()).toBeVisible();
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("customer reorder skips unavailable items and reduces quantities to current stock", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("taptap-demo-data", JSON.stringify({
      menu: {
        "porkchop-meal": { stock: 1 },
        "tapa-meal": { stock: 0, unavailable: true }
      },
      orders: {
        "TAP-E2E-REORDER": {
          customerId: "demo-customer",
          customerName: "Demo Customer",
          deliveryType: "pickup",
          address: "Counter pickup",
          items: [
            { id: "porkchop-meal", name: "Porkchop", category: "Favorite Meal", price: 99, qty: 3 },
            { id: "tapa-meal", name: "Tapa Meal", category: "Favorite Meal", price: 99, qty: 2 }
          ],
          subtotal: 495,
          total: 495,
          paymentMethod: "cod",
          paymentStatus: "paid",
          status: "completed",
          createdAt: 1700000000000
        }
      }
    }));
  });
  const runtime = watchRuntime(page);
  await loginAs(page, "customer");
  const navigation = page.getByRole("navigation", { name: /customer navigation/i });
  await activateWithKeyboard(page, navigation.getByRole("button", { name: "Order History" }));
  const orderRow = page.locator(".order-table-row").filter({ hasText: "TAP-E2E-REORDER" });
  await expect(orderRow).toHaveCount(1);
  await orderRow.getByRole("button", { name: "Order again" }).click();
  await expect(page.locator(".app-toast")).toContainText("1 item added to your cart");
  await expect(page.locator(".app-toast")).toContainText("1 unavailable item was skipped");
  await expect(page.locator(".app-toast")).toContainText("1 item quantity was reduced to current stock");
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

test("staff can focus, filter, and add a unique POS product from the keyboard", async ({ page }) => {
  const runtime = watchRuntime(page);
  await loginAs(page, "staff");
  const navigation = page.getByRole("navigation", { name: /staff navigation/i });
  await activateWithKeyboard(page, navigation.getByRole("button", { name: /Walk-in POS/i }));
  await expect(page.getByRole("heading", { name: /Walk-in POS/i })).toBeVisible();
  const search = page.getByPlaceholder("Search POS products");
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("Egg, Rice, Unli Soup");
  await search.press("Enter");
  await expect(page.locator(".staff-cart-list").getByText("Egg, Rice, Unli Soup", { exact: true })).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("owner can suspend an account with a recorded reason", async ({ page }) => {
  let suspended = false;
  let suspensionRequest = null;
  await page.route("**/api/admin/users**", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && request.url().endsWith("/api/admin/users/staff-1/suspension")) {
      suspensionRequest = request.postDataJSON();
      suspended = suspensionRequest.suspended;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ updated: true, suspended, reauthenticationRequired: true })
      });
      return;
    }
    if (request.method() === "GET" && request.url().endsWith("/api/admin/users")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          users: [
            { uid: "demo-owner", name: "Demo Owner", email: "owner@example.com", role: "owner", suspended: false, twoFactorEnabled: true },
            { uid: "staff-1", name: "Staff Account", email: "staff@example.com", role: "staff", staffRole: "manager", suspended, twoFactorEnabled: true }
          ]
        })
      });
      return;
    }
    await route.continue();
  });

  const runtime = watchRuntime(page);
  await loginAs(page, "owner");
  const navigation = page.getByRole("navigation", { name: /owner navigation/i });
  await activateWithKeyboard(page, navigation.getByRole("button", { name: "Users & Roles" }));
  await expect(page.getByRole("heading", { name: "Users & Roles" })).toBeVisible();
  await expectAccessible(page);

  const staffRow = page.getByRole("row").filter({ hasText: "Staff Account" });
  await expect(staffRow).toHaveCount(1);
  await expect(staffRow.getByText("Active", { exact: true })).toBeVisible();
  await staffRow.getByRole("button", { name: "Suspend", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Suspend Staff Account" });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, ".reason-modal");
  await dialog.getByLabel("Account action reason").fill("Access review");
  await dialog.getByRole("button", { name: "Suspend account" }).click();
  await expect(dialog).toBeHidden();
  await expect(staffRow.getByText("Suspended", { exact: true })).toBeVisible();
  expect(suspensionRequest).toEqual({ suspended: true, reason: "Access review" });
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("owner recovery requires a fresh preview and explicit typed confirmation", async ({ page }) => {
  let applied = false;
  let previewRequest = null;
  let applyRequest = null;
  const issue = {
    id: "recovery-issue-test-123456",
    type: "stock_projection_mismatch",
    recordId: "porkchop-meal",
    summary: "Porkchop has different operational and public stock values.",
    severity: "warning",
    actionable: true
  };
  await page.route("**/api/admin/recovery/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && request.url().includes("/api/admin/recovery/scan")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          generatedAt: 1700000000000,
          issues: applied ? [] : [issue],
          summary: applied ? {} : { stock_projection_mismatch: 1 },
          scanned: { orders: 1, inventoryItems: 1, notifications: 0, idempotencyUsers: 1 },
          truncated: false
        })
      });
      return;
    }
    if (request.method() === "POST" && request.url().endsWith("/api/admin/recovery/preview")) {
      previewRequest = request.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          issueId: issue.id,
          type: issue.type,
          recordId: issue.recordId,
          previewHash: "a".repeat(64),
          changes: ["Set public stock to the current operational inventory stock."],
          dryRun: true
        })
      });
      return;
    }
    if (request.method() === "POST" && request.url().endsWith("/api/admin/recovery/apply")) {
      applyRequest = request.postDataJSON();
      applied = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "stock_projection_synchronized", recordId: issue.recordId, idempotent: false })
      });
      return;
    }
    await route.continue();
  });

  const runtime = watchRuntime(page);
  await loginAs(page, "owner");
  const navigation = page.getByRole("navigation", { name: /owner navigation/i });
  await activateWithKeyboard(page, navigation.getByRole("button", { name: "System Settings" }));
  await page.getByRole("button", { name: "Run dry scan" }).click();
  await expect(page.getByText("Stock display mismatch", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review safe action" }).click();
  await page.getByLabel("Recovery reason").fill("Correct public stock projection");
  await page.getByRole("button", { name: "Preview safe action" }).click();
  const applyButton = page.getByRole("button", { name: "Apply audited recovery" });
  await expect(applyButton).toBeDisabled();
  await page.getByLabel("Type APPLY_RECOVERY to confirm").fill("APPLY_RECOVERY");
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByText("No recovery findings", { exact: true })).toBeVisible();
  expect(previewRequest).toEqual({ issueId: issue.id, reason: "Correct public stock projection" });
  expect(applyRequest).toMatchObject({
    issueId: issue.id,
    reason: "Correct public stock projection",
    previewHash: "a".repeat(64),
    confirmation: "APPLY_RECOVERY"
  });
  expect(applyRequest.requestId).toMatch(/^[A-Za-z0-9-]{12,128}$/);
  await expectAccessible(page, ".recovery-panel");
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
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
        },
        "TAP-E2E-RIDER-READY": {
          customerId: "customer-ready",
          customerName: "Ready Customer",
          riderId: "demo-rider",
          riderName: "Demo Rider",
          deliveryType: "delivery",
          deliveryLocation: { lat: 14.452, lng: 120.977, source: "map-picker" },
          address: "Second delivery address",
          items: [{ id: "meal-ready", name: "Ready meal", price: 89, qty: 1 }],
          subtotal: 89,
          deliveryFee: 49,
          total: 138,
          paymentMethod: "gcash",
          paymentStatus: "paid",
          status: "ready",
          createdAt: Date.now() - 60000
        }
      }
    }));
  });
  const runtime = watchRuntime(page);
  await loginAs(page, "rider");
  await expect(page.getByRole("heading", { name: /^Hi,/i })).toBeVisible();
  const deliveryCards = await page.locator(".rider-order-card").allTextContents();
  expect(deliveryCards[0]).toContain("TAP-E2E-RIDER");
  expect(deliveryCards[1]).toContain("TAP-E2E-RIDER-READY");
  await expectAccessible(page, ".rider-page");
  await page.getByRole("button", { name: /Capture delivery proof/i }).click();
  await expect(page.getByRole("heading", { name: /Proof of delivery/i })).toBeVisible();
  await expect(page.getByText(/Preparing camera|permission|camera/i).first()).toBeVisible();
  await expectAccessible(page, ".camera-modal");
  await page.getByRole("button", { name: /Cancel/i }).click();
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Issue" }).click();
  await page.getByLabel("Delivery issue").fill("Customer is not answering");
  await page.getByRole("button", { name: "Send issue" }).click();
  await expect(page.locator(".app-toast")).toContainText("You are offline");
  await page.keyboard.press("Escape");
  const retryButton = page.getByRole("button", { name: "Retry" });
  await expect(retryButton).toBeDisabled();
  await page.context().setOffline(false);
  await expect(retryButton).toBeEnabled();
  await retryButton.click();
  await expect(retryButton).toBeHidden();
  await activateWithKeyboard(page, page.getByRole("navigation", { name: /rider navigation/i }).getByRole("button", { name: /COD Ledger/i }));
  await expect(page.getByRole("heading", { name: /COD Ledger/i })).toBeVisible();
  await expectAccessible(page, ".rider-page");
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
  const mobileNavigation = page.getByRole("navigation", { name: /Customer mobile navigation/i });
  await mobileNavigation.getByRole("button", { name: /^Orders$/i }).click();
  await expect(page.getByRole("heading", { name: /Order history/i })).toBeVisible();
  const brand = page.locator(".customer-header .brand-lockup");
  const titleGroup = page.locator(".order-history-page .section-title > div");
  const description = page.locator(".order-history-page .section-title > p");
  const [brandBox, titleBox, descriptionBox] = await Promise.all([
    brand.boundingBox(),
    titleGroup.boundingBox(),
    description.boundingBox()
  ]);
  expect(Math.abs((brandBox?.x || 0) - (titleBox?.x || 0))).toBeLessThanOrEqual(2);
  expect(Math.abs((descriptionBox?.x || 0) - (titleBox?.x || 0))).toBeLessThanOrEqual(2);
  expect((descriptionBox?.y || 0) - ((titleBox?.y || 0) + (titleBox?.height || 0))).toBeLessThanOrEqual(14);
  await expect(brand.locator("strong")).toBeVisible();
  const supportButton = page.getByRole("button", { name: /Open customer support/i });
  await expectMinimumTouchTarget(supportButton);
  await expect(page.locator(".assistant-launcher")).toHaveCount(0);
  await supportButton.click();
  const supportPanel = page.getByRole("dialog", { name: /TapTap customer support/i });
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

test("mobile cart rows and checkout actions remain visible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const runtime = watchRuntime(page);
  await loginAs(page, "customer");

  const addButtons = page.locator('button[aria-label^="Add "]:not([disabled])');
  expect(await addButtons.count()).toBeGreaterThanOrEqual(4);
  for (let index = 0; index < 4; index += 1) await addButtons.nth(index).click();
  for (let index = 0; index < 6; index += 1) await addButtons.first().click();

  await page.getByRole("button", { name: /Review order - 10 items/i }).click();
  const sheet = page.getByLabel("Mobile order summary");
  const currentOrder = sheet.getByLabel("Current order");
  const itemList = currentOrder.locator(".cart-summary-list");
  const totals = currentOrder.locator(".store-cart-totals");
  const checkoutButton = currentOrder.getByRole("button", { name: /Continue to checkout.*₱/i });
  await expect(sheet).toBeVisible();
  await expect(checkoutButton).toBeVisible();
  await expect(currentOrder.locator(".cart-summary-item").first().locator(".cart-quantity > span")).toHaveText("7");

  const removedName = await currentOrder.locator(".cart-summary-item").nth(1).locator("strong").textContent();
  await currentOrder.locator(".cart-summary-item").nth(1).getByRole("button", { name: /Remove .* from cart/i }).click();
  const undoBanner = currentOrder.locator(".cart-undo-banner");
  await expect(undoBanner).toContainText(removedName || "");
  await expect(currentOrder.getByRole("heading", { name: "9 items" })).toBeVisible();
  await undoBanner.getByRole("button", { name: /Undo/i }).click();
  await expect(currentOrder.getByRole("heading", { name: "10 items" })).toBeVisible();
  await expect(currentOrder.getByText(removedName || "", { exact: true })).toBeVisible();

  const itemMetrics = await currentOrder.locator(".cart-summary-item").evaluateAll((items) => items.map((item) => ({
    top: item.offsetTop,
    bottom: item.offsetTop + item.offsetHeight
  })));
  for (let index = 1; index < itemMetrics.length; index += 1) {
    expect(itemMetrics[index].top).toBeGreaterThanOrEqual(itemMetrics[index - 1].bottom - 1);
  }
  const [listBox, totalsBox, listScroll] = await Promise.all([
    itemList.boundingBox(),
    totals.boundingBox(),
    itemList.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }))
  ]);
  expect((listBox?.y || 0) + (listBox?.height || 0)).toBeLessThanOrEqual((totalsBox?.y || 0) + 1);
  expect(listScroll.scrollHeight).toBeGreaterThan(listScroll.clientHeight);

  await checkoutButton.click();
  const checkout = page.locator(".checkout-modal");
  const cancelButton = checkout.getByRole("button", { name: /^Cancel$/i });
  const placeOrderButton = checkout.getByRole("button", { name: /Place order.*₱/i });
  const phoneInput = checkout.getByLabel(/Mobile number/i);
  const addressInput = checkout.getByLabel(/Delivery address/i);
  await expect(cancelButton).toBeVisible();
  await expect(placeOrderButton).toBeVisible();
  await expect(checkout.getByRole("button", { name: /GCash/i })).toHaveCount(0);
  await expect(checkout.getByRole("button", { name: /Cash on delivery/i })).toHaveAttribute("aria-pressed", "true");

  await placeOrderButton.click();
  await expect(phoneInput).toBeFocused();
  await expect(checkout.getByText(/Use a valid Philippine mobile number/i)).toBeVisible();
  await phoneInput.fill("09171234567");
  await placeOrderButton.click();
  await expect(addressInput).toBeFocused();
  await expect(checkout.getByText(/Add a complete delivery address/i)).toBeVisible();
  await addressInput.fill("17 Gemini Street, Pamplona Dos, Las Pinas City");
  await placeOrderButton.click();
  await expect(checkout.getByRole("button", { name: /Choose pin on map/i })).toBeFocused();
  await expect(checkout.getByText(/Choose or capture the exact rider drop-off pin/i)).toBeVisible();

  await checkout.getByRole("button", { name: /^Pickup/i }).click();
  await expect(checkout.getByRole("button", { name: /Pay on pickup/i })).toHaveAttribute("aria-pressed", "true");
  await expect(phoneInput).toHaveValue("09171234567");
  await checkout.getByRole("button", { name: /^Delivery/i }).click();
  await expect(addressInput).toHaveValue("17 Gemini Street, Pamplona Dos, Las Pinas City");
  const [cancelBox, placeOrderBox] = await Promise.all([cancelButton.boundingBox(), placeOrderButton.boundingBox()]);
  expect(Math.abs((placeOrderBox?.y || 0) - (cancelBox?.y || 0))).toBeLessThanOrEqual(2);
  expect((placeOrderBox?.y || 0) + (placeOrderBox?.height || 0)).toBeLessThanOrEqual(812);
  await expectMinimumTouchTarget(cancelButton);
  await expectMinimumTouchTarget(placeOrderButton);
  const modalIsAboveNavigation = await page.evaluate(() => {
    const modal = document.querySelector(".modal.d-block");
    const navigation = document.querySelector(".customer-bottom-nav");
    return Number(getComputedStyle(modal).zIndex) > Number(getComputedStyle(navigation).zIndex);
  });
  expect(modalIsAboveNavigation).toBe(true);
  await expectNoHorizontalOverflow(page);
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

  await currentOrder.getByRole("button", { name: /Continue to checkout/i }).click();
  await page.getByRole("button", { name: /^Pickup/i }).click();
  await page.getByLabel(/Mobile number/i).fill("09171234567");
  await page.getByLabel(/Order notes/i).fill("Less sauce, please");
  await page.getByRole("button", { name: /Cancel/i }).click();

  await currentOrder.getByRole("button", { name: /Continue to checkout/i }).click();
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

test("checkout details follow draft, current input, and profile priority", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("taptap-cart:v1:demo-customer", JSON.stringify({
      version: 1,
      items: [{ id: "porkchop-meal", qty: 1 }]
    }));
    localStorage.setItem("taptap-demo-data", JSON.stringify({
      users: {
        "demo-customer": {
          phone: "09175550123",
          address: "Profile address, Pamplona Dos",
          landmark: "Profile landmark",
          deliveryLocation: { lat: 14.451, lng: 120.977, accuracy: 20, source: "profile" }
        }
      }
    }));
    sessionStorage.setItem("taptap-checkout:v1:demo-customer", JSON.stringify({
      version: 1,
      deliveryType: "delivery",
      payment: "gcash",
      phone: "09176660123",
      address: "Draft address, Las Pinas City",
      landmark: "Draft landmark",
      notes: "Draft note",
      deliveryLocation: { lat: 14.452, lng: 120.978, accuracy: 15, source: "draft" }
    }));
  });

  const runtime = watchRuntime(page);
  await loginAs(page, "customer");
  await page.getByLabel("Current order").getByRole("button", { name: /Continue to checkout/i }).click();
  const checkout = page.locator(".checkout-modal");
  await expect(checkout.getByText("Checkout details restored")).toBeVisible();
  await expect(checkout.getByLabel(/Mobile number/i)).toHaveValue("09176660123");
  await expect(checkout.getByLabel(/Delivery address/i)).toHaveValue("Draft address, Las Pinas City");
  await expect(checkout.getByLabel(/Landmark/i)).toHaveValue("Draft landmark");
  await expect(checkout.getByLabel(/Order notes/i)).toHaveValue("Draft note");
  await expect(checkout.getByLabel("Latitude")).toHaveValue("14.452");
  await expect(checkout.getByRole("button", { name: /GCash/i })).toHaveCount(0);
  await expect(checkout.getByRole("button", { name: /Cash on delivery/i })).toHaveAttribute("aria-pressed", "true");

  await checkout.locator(".checkout-draft-notice").getByRole("button", { name: /Clear/i }).click();
  await expect(checkout.getByLabel(/Mobile number/i)).toHaveValue("09175550123");
  await expect(checkout.getByLabel(/Delivery address/i)).toHaveValue("Profile address, Pamplona Dos");
  await expect(checkout.getByLabel(/Landmark/i)).toHaveValue("Profile landmark");
  await expect(checkout.getByLabel("Latitude")).toHaveValue("14.451");

  await checkout.getByLabel(/Mobile number/i).fill("09178880123");
  await checkout.getByLabel(/Delivery address/i).fill("Current checkout address");
  await checkout.getByRole("button", { name: /^Pickup/i }).click();
  await expect(checkout.getByRole("button", { name: /Pay on pickup/i })).toHaveAttribute("aria-pressed", "true");
  await checkout.getByRole("button", { name: /^Delivery/i }).click();
  await expect(checkout.getByLabel(/Mobile number/i)).toHaveValue("09178880123");
  await expect(checkout.getByLabel(/Delivery address/i)).toHaveValue("Current checkout address");
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("cart and checkout remain usable across required responsive viewports", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("taptap-cart:v1:demo-customer", JSON.stringify({
      version: 1,
      items: [
        { id: "porkchop-meal", qty: 7 },
        { id: "tapa-meal", qty: 1 },
        { id: "chibu-meal", qty: 1 },
        { id: "lechon-kawali-meal", qty: 1 }
      ]
    }));
  });
  const runtime = watchRuntime(page);
  const viewports = [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 812, height: 375 }
  ];

  await page.setViewportSize(viewports[0]);
  await loginAs(page, "customer");
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    const reviewButton = page.getByRole("button", { name: /Review order - 10 items/i });
    await expect(reviewButton).toBeVisible();
    await reviewButton.click();

    const sheet = page.getByLabel("Mobile order summary");
    const currentOrder = sheet.getByLabel("Current order");
    const itemList = currentOrder.locator(".cart-summary-list");
    const totals = currentOrder.locator(".store-cart-totals");
    const continueButton = currentOrder.getByRole("button", { name: /Continue to checkout.*₱/i });
    await expect(sheet).toBeVisible();
    await expect(continueButton).toBeVisible();
    const [listBox, totalsBox, listOverflow] = await Promise.all([
      itemList.boundingBox(),
      totals.boundingBox(),
      itemList.evaluate((element) => getComputedStyle(element).overflowY)
    ]);
    expect((listBox?.y || 0) + (listBox?.height || 0)).toBeLessThanOrEqual((totalsBox?.y || 0) + 1);
    expect(listOverflow).toBe("auto");
    await continueButton.click();

    const checkout = page.locator(".checkout-modal");
    const footer = checkout.locator(".checkout-footer");
    const cancelButton = footer.getByRole("button", { name: /^Cancel$/i });
    const placeOrderButton = footer.getByRole("button", { name: /Place order.*₱/i });
    await expect(cancelButton).toBeVisible();
    await expect(placeOrderButton).toBeVisible();
    const [footerBox, cancelBox, placeBox] = await Promise.all([
      footer.boundingBox(),
      cancelButton.boundingBox(),
      placeOrderButton.boundingBox()
    ]);
    expect(footerBox?.x || 0).toBeGreaterThanOrEqual(0);
    expect((footerBox?.x || 0) + (footerBox?.width || 0)).toBeLessThanOrEqual(viewport.width + 1);
    expect((footerBox?.y || 0) + (footerBox?.height || 0)).toBeLessThanOrEqual(viewport.height + 1);
    expect(cancelBox?.y || 0).toBeGreaterThanOrEqual(footerBox?.y || 0);
    expect(placeBox?.y || 0).toBeGreaterThanOrEqual(footerBox?.y || 0);
    await expectMinimumTouchTarget(cancelButton);
    await expectMinimumTouchTarget(placeOrderButton);
    await expectNoHorizontalOverflow(page);
    await cancelButton.click();
  }
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

test("a failed role chunk shows a safe reload action instead of a blank workspace", async ({ page }) => {
  await page.route(/\/src\/features\/workspaces\/OwnerWorkspace\.jsx(?:\?|$)/, (route) => route.abort("failed"));
  await loginAs(page, "owner");

  await expect(page.getByRole("heading", { name: "Workspace could not be loaded" })).toBeVisible();
  await expect(page.getByText("No order or form was submitted.")).toBeVisible();
  await expectMinimumTouchTarget(page.getByRole("button", { name: "Reload workspace" }));
  await expectNoHorizontalOverflow(page);
});

test("notification center stays readable and uses one scroll region at every required width", async ({ page }) => {
  const now = Date.now();
  await seedDemoNotifications(page, {
    "sale-1": { targetUserId: "demo-owner", title: "New sale recorded", message: "-OwSaleInternal4821 added 475 PHP to the live sales ledger.", type: "sale", orderId: "-OwSaleInternal4821", entityType: "payment", entityId: "-OwSaleInternal4821", displayReference: "TAP-4821", amount: 475, actionView: "owner-sales", createdAt: now - 1_000, expiresAt: now + 60_000, readAt: null },
    "sale-2": { targetUserId: "demo-owner", title: "New sale recorded", message: "-OwSaleInternal4822 added 376 PHP to the live sales ledger.", type: "sale", orderId: "-OwSaleInternal4822", entityType: "payment", entityId: "-OwSaleInternal4822", displayReference: "TAP-4822", amount: 376, actionView: "owner-sales", createdAt: now - 2_000, expiresAt: now + 60_000, readAt: null },
    "sale-3": { targetUserId: "demo-owner", title: "New sale recorded", message: "-OwSaleInternal4823 added 1244 PHP to the live sales ledger.", type: "sale", orderId: "-OwSaleInternal4823", entityType: "payment", entityId: "-OwSaleInternal4823", displayReference: "TAP-4823", amount: 1244, actionView: "owner-sales", createdAt: now - 3_000, expiresAt: now + 60_000, readAt: null },
    "legacy-order": { targetUserId: "demo-owner", title: "Order status updated", message: "-OwLegacyOrder4821 is now preparing.", type: "order", orderId: "-OwLegacyOrder4821", createdAt: now - 25 * 60 * 60 * 1_000, expiresAt: now + 60_000, readAt: null },
    complaint: { targetUserId: "demo-owner", title: "New order complaint", message: "A customer reported -OwComplaint4824.", type: "complaint", orderId: "-OwComplaint4824", createdAt: now - 3 * 24 * 60 * 60 * 1_000, expiresAt: now + 60_000, readAt: null },
    read: { targetUserId: "demo-owner", title: "System notice", message: "Account security is up to date.", type: "system", createdAt: now - 4 * 24 * 60 * 60 * 1_000, expiresAt: now + 60_000, readAt: now - 500 }
  });
  const runtime = watchRuntime(page);
  const viewports = [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 }
  ];

  await page.setViewportSize(viewports[0]);
  await loginAs(page, "owner");
  const trigger = page.getByRole("button", { name: "Open notifications" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByText("5 unread", { exact: true })).toBeVisible();
  await expectAccessible(page, ".notification-center");

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const metrics = await dialog.evaluate((panel) => {
      const header = panel.querySelector(".notification-panel-header");
      const list = panel.querySelector("[data-testid='notification-scroll-region']");
      const summary = panel.querySelector(".notification-summary-row");
      const markAll = panel.querySelector(".notification-mark-all");
      const visibleButtons = [...panel.querySelectorAll("button")].filter((button) => button.getBoundingClientRect().height > 0);
      return {
        bodyOverflow: document.body.style.overflow,
        documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
        headerBottom: header?.getBoundingClientRect().bottom || 0,
        listTop: list?.getBoundingClientRect().top || 0,
        listOverflow: list ? getComputedStyle(list).overflowY : "",
        listHorizontalOverflow: list ? list.scrollWidth - list.clientWidth : 0,
        markAllWhiteSpace: markAll ? getComputedStyle(markAll).whiteSpace : "",
        panelOverflow: getComputedStyle(panel).overflow,
        panelWidth: panel.getBoundingClientRect().width,
        summaryHeight: summary?.getBoundingClientRect().height || 0,
        minimumButtonHeight: Math.min(...visibleButtons.map((button) => button.getBoundingClientRect().height))
      };
    });
    expect(metrics.bodyOverflow).toBe("hidden");
    expect(metrics.documentOverflow).toBeLessThanOrEqual(1);
    expect(metrics.headerBottom).toBeLessThanOrEqual(metrics.listTop + 1);
    expect(metrics.listOverflow).toBe("auto");
    expect(metrics.listHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(metrics.markAllWhiteSpace).toBe("nowrap");
    expect(metrics.panelOverflow).toBe("hidden");
    const expectedPanelWidth = viewport.width <= 520 ? viewport.width : Math.min(420, viewport.width);
    expect(metrics.panelWidth).toBeLessThanOrEqual(expectedPanelWidth + 1);
    expect(metrics.summaryHeight).toBeLessThanOrEqual(46);
    expect(metrics.minimumButtonHeight).toBeGreaterThanOrEqual(44);
  }

  const repeatedSales = dialog.getByRole("button", { name: /New sale recorded.*3 updates/i });
  await repeatedSales.click();
  await expect(dialog.getByText("Order TAP-4821 \u00b7 \u20b1475", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("Order TAP-ER4821 is now preparing.");
  await expect(dialog).not.toContainText("-OwSaleInternal4821");
  await expect(dialog).not.toContainText("-OwLegacyOrder4821");
  await expect(dialog.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Yesterday" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Earlier" })).toBeVisible();
  await dialog.getByRole("button", { name: "Payments", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Payments", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("notification actions mark one, deep-link safely, and clear only read records", async ({ page }) => {
  const now = Date.now();
  await seedDemoNotifications(page, {
    "order-ready": { targetUserId: "demo-owner", title: "Order ready", message: "Order -OwReadyOrder9911 is ready.", type: "order", orderId: "-OwReadyOrder9911", entityType: "order", entityId: "-OwReadyOrder9911", displayReference: "TAP-9911", actionView: "owner-sales", createdAt: now, expiresAt: now + 60_000, readAt: null },
    "system-unread": { targetUserId: "demo-owner", title: "System maintenance", message: "The website is operating normally.", type: "system", createdAt: now - 1_000, expiresAt: now + 60_000, readAt: null },
    "system-read": { targetUserId: "demo-owner", title: "Security review complete", message: "No action is needed.", type: "system", createdAt: now - 2_000, expiresAt: now + 60_000, readAt: now - 1_000 }
  });
  const runtime = watchRuntime(page);
  await loginAs(page, "owner");
  const trigger = page.getByRole("button", { name: "Open notifications" });
  await trigger.click();
  let dialog = page.getByRole("dialog", { name: "Notifications" });
  const orderAction = dialog.getByRole("button", { name: /Order ready.*View order/i });
  await orderAction.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.role-navigation button[aria-current="page"]')).toContainText("Sales & Orders");
  let notificationState = await page.evaluate(() => JSON.parse(localStorage.getItem("taptap-demo-data") || "{}").notifications);
  expect(typeof notificationState["order-ready"].readAt).toBe("number");
  expect(notificationState["system-unread"].readAt).toBeNull();

  await trigger.click();
  dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.getByRole("button", { name: "More notification actions" }).click();
  await dialog.getByRole("menuitem", { name: "Clear read notifications" }).click();
  let confirmation = page.getByRole("alertdialog", { name: "Clear read notifications?" });
  await expect(confirmation).toContainText("Unread notifications will stay.");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toBeHidden();

  await dialog.getByRole("button", { name: "More notification actions" }).click();
  await dialog.getByRole("menuitem", { name: "Clear read notifications" }).click();
  confirmation = page.getByRole("alertdialog", { name: "Clear read notifications?" });
  await confirmation.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(confirmation).toBeHidden();
  notificationState = await page.evaluate(() => JSON.parse(localStorage.getItem("taptap-demo-data") || "{}").notifications);
  expect(notificationState["order-ready"]).toBeUndefined();
  expect(notificationState["system-read"]).toBeUndefined();
  expect(notificationState["system-unread"]).toBeTruthy();
  await expect(dialog.getByText("1 unread", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Mark all read", exact: true }).click();
  await expect(dialog.getByText("0 unread", { exact: true })).toBeVisible();
  notificationState = await page.evaluate(() => JSON.parse(localStorage.getItem("taptap-demo-data") || "{}").notifications);
  expect(typeof notificationState["system-unread"].readAt).toBe("number");
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});

test("notification destinations reject cross-role views and recover from action errors", async ({ page }) => {
  const now = Date.now();
  await seedDemoNotifications(page, {
    restricted: { targetUserId: "demo-staff", title: "System access notice", message: "Review this account update.", type: "admin", actionView: "owner-users", createdAt: now, expiresAt: now + 60_000, readAt: null }
  });
  const runtime = watchRuntime(page);
  await loginAs(page, "staff");
  const trigger = page.getByRole("button", { name: "Open notifications" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog.getByText("System access notice", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/View (order|payment|stock|complaint)/i)).toHaveCount(0);

  await dialog.getByRole("button", { name: "Remove System access notice" }).click();
  let confirmation = page.getByRole("alertdialog", { name: "Remove this notification?" });
  await expect(confirmation).toContainText("This notification is unread.");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.evaluate(() => {
    window.__notificationOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === "taptap-demo-data") throw new Error("Simulated storage failure");
      return window.__notificationOriginalSetItem.call(this, key, value);
    };
  });
  await dialog.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(dialog.getByText("The notification could not be updated. Check your connection and try again.", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__notificationOriginalSetItem;
    delete window.__notificationOriginalSetItem;
  });
  await dialog.getByRole("button", { name: "Mark as read", exact: true }).click();
  await expect(dialog.getByText("Notification marked as read.", { exact: true })).toBeVisible();
  await expect(page.locator('.role-navigation button[aria-current="page"]')).toContainText("Dashboard");
  expect(runtime.errors).toEqual([]);
  expect(runtime.deferredRequests).toEqual([]);
});
