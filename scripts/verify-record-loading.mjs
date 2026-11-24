import { chromium } from '@playwright/test';
import dotenv from '../server/node_modules/dotenv/lib/main.js';
import { initializeFirebaseAdmin } from '../server/src/integrations/firebaseAdmin.js';
import { readFileSync } from 'node:fs';

dotenv.config({ path: 'server/.env', quiet: true });
const firebase = await initializeFirebaseAdmin({ databaseUrl: process.env.FIREBASE_DATABASE_URL, serviceAccountJsonBase64: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS }, { error: () => {} });
if (!firebase.enabled) throw new Error('Verification connection unavailable');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const role of ['owner']) {
    const account = await firebase.auth().getUserByEmail(`${role}@taptap.ph`);
    const token = await firebase.auth().createCustomToken(account.uid, { role, mfaSession: true, email_verified: true });
    const context = await browser.newContext();
    const csp = JSON.parse(readFileSync('firebase.json', 'utf8')).hosting.headers.find(entry => entry.source === '**').headers.find(header => header.key === 'Content-Security-Policy').value;
    await context.addInitScript(() => {
      window.WebSocket = undefined;
      window.recordPolicyViolations = [];
      window.recordReadEvents = [];
      window.addEventListener('taptap-data-status', event => {
        window.recordReadEvents.push({ source: event.detail?.source, error: Boolean(event.detail?.error) });
      });
      document.addEventListener('securitypolicyviolation', event => {
        let origin = event.blockedURI;
        try { origin = new URL(origin).origin; } catch {}
        window.recordPolicyViolations.push({ directive: event.effectiveDirective, origin });
      });
    });
    await context.routeWebSocket('**', socket => socket.close());
    const page = await context.newPage();
    page.on('response', response => {
      if (response.status() >= 400 && response.url().includes('firebasedatabase.app')) console.log(JSON.stringify({ failedPath: new URL(response.url()).pathname, status: response.status() }));
    });
    await page.route('http://127.0.0.1:4176/', route => route.fulfill({ headers: { 'Content-Security-Policy': csp }, contentType: 'text/html', body: '<html><body>Read-only record verification</body></html>' }));
    await page.goto('http://127.0.0.1:4176/');
    const result = await page.evaluate(async ({ token, uid, role }) => {
      const service = await import('/src/services/firebase.js');
      if (!service.firebaseEnabled) throw new Error('Real database must be enabled for this check');
      const sdk = await import('/node_modules/.vite/deps/firebase_auth.js');
      await sdk.signInWithCustomToken(service.auth, token);
      const user = { uid, role };
      async function read(subscribe, ready = () => true) {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { stop?.(); reject(new Error('Record subscription timed out')); }, 20000);
          const stop = subscribe(value => { if (!ready(value)) return; clearTimeout(timeout); setTimeout(() => stop?.(), 0); resolve(Array.isArray(value) ? value.length : value); });
        });
      }
      const counts = {};
      counts.orders = await read(callback => service.subscribeOrders(user, callback), value => value.length > 0);
      if (role !== 'rider') {
        counts.reviews = await read(callback => service.subscribeReviews(user, callback));
        counts.inventory = await read(callback => service.subscribeInventory([], callback));
        counts.shiftLogs = await read(callback => service.subscribeShiftLogs(callback));
      }
      counts.notifications = await read(callback => service.subscribeNotifications(user, callback));
      counts.profileLoaded = Boolean(await read(callback => service.subscribeUserProfile(user, callback)));
      if (role === 'owner') counts.auditLogs = await read(callback => service.subscribeAuditLogs(callback));
      if (role === 'owner') counts.preferences = await read(callback => service.subscribeOwnerWorkspacePreferences(uid, callback));
      if (role === 'staff') counts.supportMessages = await read(callback => service.subscribeSupportMessages(callback));
      await new Promise(resolve => setTimeout(resolve, 16000));
      counts.recordReadErrors = window.recordReadEvents.filter(event => event.error);
      counts.policyViolations = window.recordPolicyViolations;
      return counts;
    }, { token, uid: account.uid, role });
    if (role === 'owner') {
      const accessToken = await page.evaluate(async () => (await import('/src/services/firebase.js')).auth.currentUser.getIdToken());
      for (const [key, path, field] of [['complaints','history/complaints?limit=200','records'],['approvals','approvals','requests'],['users','admin/users','users']]) {
        const response = await fetch(`https://taptap-foodtrip-api.onrender.com/api/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const body = await response.json();
        result[key] = { status: response.status, count: body[field]?.length };
      }
    }
    console.log(JSON.stringify({ role, realtimeBlocked: true, counts: result }));
    if ((role === 'rider' && result.orders < 36) || (role !== 'rider' && (result.orders !== 77 || result.inventory !== 50 || result.reviews === 0 || (role === 'staff' && result.supportMessages !== 67)))) throw new Error('Stored records did not reach their subscriptions');
    await context.close();
  }
} finally {
  await browser.close();
}
process.exit(0);
