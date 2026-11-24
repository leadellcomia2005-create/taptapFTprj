import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { initializeFirebaseAdmin } from '../server/src/integrations/firebaseAdmin.js';

dotenv.config({ path: 'server/.env', quiet: true });
const firebase = await initializeFirebaseAdmin({
  databaseUrl: process.env.FIREBASE_DATABASE_URL,
  serviceAccountJsonBase64: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
  credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
}, { error: () => {} });
if (!firebase.enabled) throw new Error('Verification auth unavailable');

const account = (await firebase.auth().listUsers(100)).users.find(user => user.customClaims?.role === 'customer');
if (!account) throw new Error('No existing customer account for read-only verification');
const token = await firebase.auth().createCustomToken(account.uid, { role: 'customer', mfaSession: true, email_verified: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  let putCount = 0;
  let getCount = 0;
  let notificationCount = 0;
  let duplicate = false;
  let savedMessage;
  await page.route('**/messages/support/*.json*', async route => {
    if (route.request().method() === 'PUT') {
      putCount += 1;
      savedMessage ||= route.request().postDataJSON();
      await route.fulfill({ status: duplicate ? 401 : 200, contentType: 'application/json', body: duplicate ? JSON.stringify({ error: 'Permission denied' }) : JSON.stringify(savedMessage) });
      return;
    }
    getCount += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedMessage) });
  });
  await page.route('**/api/notifications', async route => {
    notificationCount += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"created":1}' });
  });
  await page.goto('http://127.0.0.1:4176/');
  await page.evaluate(async customToken => {
    const service = await import('/src/services/firebase.js');
    const authSdk = await import('/node_modules/.vite/deps/firebase_auth.js');
    await authSdk.signInWithCustomToken(service.auth, customToken);
  }, token);
  const send = () => page.evaluate(async uid => {
    const service = await import('/src/services/firebase.js');
    await service.sendSupportMessage('Support send verification', { uid, name: 'Customer', role: 'customer' }, {
      customerId: uid,
      customerName: 'Customer',
      conversationId: uid,
      messageId: 'support-send-verification'
    });
  }, account.uid);
  await send();
  duplicate = true;
  await send();
  assert.equal(putCount, 2);
  assert.equal(getCount, 1);
  assert.equal(savedMessage?.customerId, account.uid);
  assert.equal(savedMessage?.text, 'Support send verification');
  await page.waitForTimeout(500);
  assert.equal(notificationCount, 2);
  console.log({ browserSend: 'passed', duplicateConfirmation: 'passed', staffAlertsRequested: notificationCount, productionRecordsChanged: false });
} finally {
  await browser.close();
}
