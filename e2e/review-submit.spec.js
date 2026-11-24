import { test, expect } from '@playwright/test';

test('customer submits a rating without optional comment and cannot submit twice', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    localStorage.setItem('taptap-demo-data', JSON.stringify({ orders: {
      'TAP-REVIEW-TEST': { customerId: 'demo-customer', customerName: 'Demo Customer', deliveryType: 'delivery', status: 'delivered', paymentMethod: 'cod', paymentStatus: 'paid', total: 99, items: [{ id: 'meal', name: 'Test meal', qty: 1, price: 99 }], createdAt: Date.now() }
    } }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Order now/i }).first().click();
  const login = page.locator('[data-login-modal-panel]');
  await login.getByLabel('Email').fill('customer@demo.ph');
  await login.getByLabel('Password', { exact: true }).fill('Customer123!');
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: /Open account menu/i })).toBeVisible();
  const menu = page.getByRole('button', { name: /Open navigation menu/i });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: /^customer navigation$/i }).getByRole('button', { name: 'Reviews & Feedback' }).click();
  await page.getByRole('button', { name: 'Submit review', exact: true }).click();
  await expect(page.getByText('Your review was saved. Thank you for your feedback.')).toBeVisible();
  await expect(page.locator('.previous-review')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Submit review', exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('taptap-demo-data')).reviews['TAP-REVIEW-TEST']);
  expect(stored.rating).toBe(5);
  expect(stored.comment).toBe('');
});
