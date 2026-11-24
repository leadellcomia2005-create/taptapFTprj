import { test, expect } from '@playwright/test';

const roles = {
  owner: ['owner@taptap.ph', 'Owner123!'],
  staff: ['staff@taptap.ph', 'Staff123!'],
  customer: ['customer@demo.ph', 'Customer123!'],
  rider: ['rider@taptap.ph', 'Rider123!']
};

for (const [role, credentials] of Object.entries(roles)) {
  test(`visual review ${role} across desktop tablet phone and zoom widths`, async ({ page }) => {
    test.setTimeout(90000);
    await page.addInitScript(() => {
      const base = { customerId: 'demo-customer', customerName: 'Customer with a long display name for responsive review', riderId: 'demo-rider', riderName: 'Demo Rider', deliveryType: 'delivery', deliveryLocation: { lat: 14.451, lng: 120.976 }, address: '17 Example Street, Pamplona Dos, Las Piñas City; a long address to check wrapping', items: [{ id: 'porkchop-meal', name: 'Porkchop rice meal with extra rice', price: 99, qty: 3 }], subtotal: 297, deliveryFee: 49, total: 346, paymentMethod: 'cod', phone: '09171234567', createdAt: Date.now() };
      localStorage.setItem('taptap-demo-data', JSON.stringify({ orders: {
        'TAP-REVIEW-PAID': { ...base, status: 'delivered', paymentStatus: 'paid', deliveredAt: Date.now(), paymentConfirmedAt: Date.now() },
        'TAP-REVIEW-ACTIVE': { ...base, status: 'preparing', paymentStatus: 'cod-pending' }
      } }));
    });
    await page.goto('/');
    await page.getByRole('button', { name: /Order now/i }).first().click();
    const login = page.locator('[data-login-modal-panel]');
    await login.getByLabel('Email').fill(credentials[0]);
    await login.getByLabel('Password', { exact: true }).fill(credentials[1]);
    await login.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.records-loading-notice')).toHaveCount(0);
    // 1920 / 1, 1.25, 1.5 and 2: CSS layout widths corresponding to desktop zoom.
    for (const width of [1920, 1536, 1280, 960, 768, 390, 375]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 1080 });
      await page.waitForTimeout(250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${role} at ${width}`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `artifacts/ui-review/${role}-${width}.png`, fullPage: true });
    }
    if (role === 'owner') {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.getByRole('navigation', { name: 'owner navigation', exact: true }).getByRole('button', { name: 'Sales & Orders', exact: true }).click();
      for (const width of [1920,1536,1280,960,768,390,375]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300);
        const chart = page.locator('.chart-card').first();
        await expect(chart).toBeVisible();
        const box = await chart.boundingBox();
        for (const button of await chart.locator('.sales-chart-switch button').all()) {
          const control = await button.boundingBox();
          expect(control.x + control.width).toBeLessThanOrEqual(box.x + box.width + 1);
        }
        await chart.screenshot({ path: `artifacts/ui-review/sales-${width}.png` });
      }
    }
  });
}
