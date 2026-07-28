import { readFile } from "node:fs/promises";

const baseUrl = new URL(process.env.SMOKE_BASE_URL || "http://localhost:5173/");
const checks = [];

function record(name, passed, detail = "") {
  checks.push({ name, passed, detail });
  const marker = passed ? "ok" : "fail";
  console.log(`${marker} - ${name}${detail ? ` (${detail})` : ""}`);
  if (!passed) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
}

async function fetchOk(pathname, name, expectedType = "") {
  const response = await fetch(new URL(pathname, baseUrl));
  record(name, response.ok, `${response.status} ${response.statusText}`.trim());
  if (expectedType) {
    const contentType = response.headers.get("content-type") || "";
    record(`${name} content type`, contentType.includes(expectedType), contentType || "missing content-type");
  }
  return response;
}

const landing = await fetchOk("/", "landing page serves", "text/html");
const landingHtml = await landing.text();
record("landing page has React root", landingHtml.includes('id="root"'));
record("landing page links the web manifest", landingHtml.includes('rel="manifest"') && landingHtml.includes("/manifest.webmanifest"));

await fetchOk("/assets/hero-food.png", "hero PNG fallback loads", "image/");
await fetchOk("/assets/hero-food.webp", "hero WebP loads", "image/");
await fetchOk("/assets/hero-food.avif", "hero AVIF loads", "image/");
await fetchOk("/assets/taptap-logo.png", "logo PNG fallback loads", "image/");
await fetchOk("/assets/taptap-logo.webp", "logo WebP loads", "image/");
await fetchOk("/assets/taptap-logo.avif", "logo AVIF loads", "image/");
await fetchOk("/robots.txt", "robots file loads", "text/plain");
const manifestResponse = await fetchOk("/manifest.webmanifest", "PWA manifest loads", "application/manifest+json");
const manifest = await manifestResponse.json();
record("PWA manifest uses TapTap branding", manifest.name === "TapTap Foodtrip" && manifest.start_url === "/" && manifest.icons?.length >= 1);
const offlineResponse = await fetchOk("/offline.html", "offline fallback loads", "text/html");
record("offline fallback explains private data is not cached", (await offlineResponse.text()).includes("private records are never served from an offline cache"));
const serviceWorkerResponse = await fetchOk("/service-worker.js", "shared PWA and messaging worker loads", "javascript");
const serviceWorker = await serviceWorkerResponse.text();
record("service worker excludes private routes", serviceWorker.includes("/api/") && serviceWorker.includes("checkout") && serviceWorker.includes("notifications"));
record("service worker removes old static caches", serviceWorker.includes("caches.keys") && serviceWorker.includes("caches.delete"));

const authPanels = await readFile(new URL("../src/features/auth/AuthPanels.jsx", import.meta.url), "utf8");
record("customer login modal entry exists", authPanels.includes("login-modal-title"));
record("popular meal cards are wired", authPanels.includes("login-meal-card") && authPanels.includes("popularMeals"));
record("landing menu uses current menu data", authPanels.includes("subscribeMenu") && authPanels.includes("getPopularMeals"));
record("public menu browser is filterable", authPanels.includes('id="browse-menu"') && authPanels.includes("login-menu-categories") && authPanels.includes("activeMenuCategory"));
record("public ordering wording matches sign-in flow", authPanels.includes("Sign in to order") && !authPanels.includes("Your account is only needed when you confirm an order"));
record("store trust strip is present", authPanels.includes("login-trust-strip") && authPanels.includes("getOrderingDetails"));
record("hero service copy uses readable prose", authPanels.includes("availableServiceSentence") && authPanels.includes("Available for {availableServiceSentence()}"));
record("trust strip avoids duplicate clear-orders promise", authPanels.includes('label: "Delivery area"') && !authPanels.includes('label: websiteStoreConfig.customerPromise.label'));
record("landing conversion events use the analytics boundary", authPanels.includes("trackLandingOrderEntry") && authPanels.includes("trackLandingMenuView") && authPanels.includes("trackRegistrationComplete"));
record("public reviews are wired", authPanels.includes("subscribePublicReviews"));
record("empty reviews do not use fabricated testimonials", !authPanels.includes("fallbackCustomerReviews"));
record("hours and FAQ use configured data", authPanels.includes("formatStoreHoursLabel") && authPanels.includes('id="frequently-asked"'));
record("footer encoding is clean", authPanels.includes("&copy;") && !authPanels.includes(String.fromCharCode(194, 169)));
record("secondary role access is present", authPanels.includes("login-footer-team") && authPanels.includes('openLoginModal(item.id, "footer_team")'));

const appConfig = await readFile(new URL("../src/config/appConfig.ts", import.meta.url), "utf8");
record("landing customer payments only advertise enabled methods", appConfig.includes('paymentMethods: ["cash", "cod"]'));

const customerScreens = await readFile(new URL("../src/features/customer/CustomerScreens.jsx", import.meta.url), "utf8");
const customerHelpers = await readFile(new URL("../src/features/customer/customerHelpers.ts", import.meta.url), "utf8");
record("checkout entry point exists", customerScreens.includes("export function Checkout") && customerScreens.includes("Secure checkout"));
record("checkout validation summary exists", customerScreens.includes("checkout-validation-summary"));
record("checkout draft is versioned and tab scoped", customerHelpers.includes("checkoutDraftVersion") && customerHelpers.includes("window.sessionStorage"));
record("checkout draft preserves sanitized delivery pins", customerHelpers.includes("sanitizeCheckoutLocation") && customerHelpers.slice(customerHelpers.indexOf("function writeCheckoutDraft"), customerHelpers.indexOf("function removeCheckoutDraft")).includes("deliveryLocation"));
record("checkout blocks submission while offline", customerScreens.includes('!online || !navigator.onLine') && customerScreens.includes("Reconnect to the internet"));

const appState = await readFile(new URL("../src/hooks/useAppState.js", import.meta.url), "utf8");
record("cart recovery is versioned per customer", appState.includes("CART_STORAGE_VERSION") && appState.includes("cartStorageKey(userId)"));
record("cart storage excludes menu prices and customer data", appState.includes("cart.map(({ id, qty }) => ({ id, qty }))"));
record("restored carts reconcile against the current menu", appState.includes("reconcileCart") && appState.includes("menuAvailability(product).available"));
record("logout clears customer recovery data", appState.includes("clearStoredCustomerRecovery(previousUserIdRef.current)") && appState.includes("window.sessionStorage.removeItem"));

const analyticsService = await readFile(new URL("../src/services/analytics.ts", import.meta.url), "utf8");
record("analytics events are centralized and typed", analyticsService.includes("LandingOrderSource") && analyticsService.includes("CheckoutAbandonmentReason"));
record("analytics funnel includes entry, auth, and checkout", analyticsService.includes('trackEvent("select_content"') && analyticsService.includes('trackEvent("login"') && analyticsService.includes('trackEvent("begin_checkout"'));
record("analytics payload excludes customer private fields", !/customer(Id|Name|Email)|phone|address|location|latitude|longitude|notes|otp/i.test(analyticsService));

const appShell = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const notificationCenter = await readFile(new URL("../src/components/NotificationCenter.tsx", import.meta.url), "utf8");
const pushNotifications = await readFile(new URL("../src/services/pushNotifications.ts", import.meta.url), "utf8");
const pwaService = await readFile(new URL("../src/services/pwa.ts", import.meta.url), "utf8");
record("owner workspace is reachable", appShell.includes("<OwnerWorkspace"));
record("staff workspace is reachable", appShell.includes("<StaffWorkspace"));
record("rider workspace is reachable", appShell.includes("<RiderWorkspace"));
record("storefront total waits for fulfillment choice", appShell.includes("Calculated at checkout") && appShell.includes("Estimated total") && !appShell.includes("const deliveryFee = cart.length"));
record("storefront search and availability filters exist", appShell.includes("menu-search-field") && appShell.includes("menu-availability-filter"));
record("mobile cart sheet replaces direct floating checkout", appShell.includes("mobile-cart-sheet") && appShell.includes("Review order -"));
record("checkout conversion events use the analytics boundary", appShell.includes("trackCheckoutStart") && appShell.includes("trackCheckoutAbandonment"));
record("notifications require explicit read action", notificationCenter.includes("Mark all read") && notificationCenter.includes("markNotificationRead(notification.id, user.uid)") && !notificationCenter.includes("api.markAllNotificationsRead().catch"));
record("notifications clear only read records", notificationCenter.includes("Clear read notifications") && notificationCenter.includes("clearReadNotifications(user.uid)") && !notificationCenter.includes("window.confirm"));
record("notification destinations are role scoped", notificationCenter.includes("navigationForUser(user)") && notificationCenter.includes("allowedViews.has(requested)"));
record("notification permission is requested only by the explicit enable action", pushNotifications.includes("export async function enablePushNotifications") && pushNotifications.indexOf("Notification.requestPermission()") > pushNotifications.indexOf("export async function enablePushNotifications") && notificationCenter.includes("onClick={handlePushPreference}"));
record("one production service worker handles PWA and messaging", pwaService.includes('register("/service-worker.js"') && !pwaService.includes("firebase-messaging-sw"));

record("2FA continuation text is role aware", authPanels.includes("Continue to ordering") && authPanels.includes("Open owner dashboard") && authPanels.includes("Open staff workspace") && authPanels.includes("Open rider dashboard"));
record("POS-specific customer continuation text is removed", !authPanels.includes("Verify and open POS"));

const ownerWorkspace = await readFile(new URL("../src/features/workspaces/OwnerWorkspace.jsx", import.meta.url), "utf8");
record("owner dashboard is exception first", ownerWorkspace.includes("Today&apos;s exceptions") && ownerWorkspace.includes("Needs a decision") && ownerWorkspace.includes("owner-attention-grid"));
record("owner profit is not hardcoded", !ownerWorkspace.includes("totalSales * 0.58") && ownerWorkspace.includes("Average paid order"));
record("owner planning controls disclose local persistence", ownerWorkspace.includes("Saved only on this browser for planning") && ownerWorkspace.includes("Customer pricing was not changed"));
record("owner account suspension is visible and reasoned", ownerWorkspace.includes("setUserSuspension") && ownerWorkspace.includes("Account action reason") && ownerWorkspace.includes("active sessions were revoked"));

const staffWorkspace = await readFile(new URL("../src/features/workspaces/StaffWorkspace.jsx", import.meta.url), "utf8");
record("staff dashboard adapts to staff scope", staffWorkspace.includes("staffDashboardProfiles") && staffWorkspace.includes("staffRole === \"kitchen\"") && staffWorkspace.includes("staffRole === \"inventory\""));
record("staff shift errors are recoverable", staffWorkspace.includes("shiftError") && staffWorkspace.includes("loadActiveShift") && staffWorkspace.includes("Retry"));
record("staff quick actions navigate", staffWorkspace.includes("onNavigate?.(view)") && staffWorkspace.includes("Open kitchen queue"));
record("POS discount and payment controls are explicit", staffWorkspace.includes("Discount reason") && staffWorkspace.includes("posPaymentMethod") && staffWorkspace.includes("completingPayment"));

const riderWorkspace = await readFile(new URL("../src/features/workspaces/RiderWorkspace.jsx", import.meta.url), "utf8");
record("rider GPS has acquiring and error states", riderWorkspace.includes("acquiring") && riderWorkspace.includes("Retry GPS") && riderWorkspace.includes("GPS error"));
record("rider actions prevent duplicate submissions", riderWorkspace.includes("busyAction") && riderWorkspace.includes("runAction"));
record("rider jobs show route and payment facts", riderWorkspace.includes("rider-job-facts") && riderWorkspace.includes("pinQuality(order)") && riderWorkspace.includes("routeForOrder(order)"));
record("rider has one status-dependent primary action", riderWorkspace.includes("const nextAction") && riderWorkspace.includes("rider-next-action"));
record("COD rider handoff is separate from remittance", riderWorkspace.includes("codHandoffRequested") && riderWorkspace.includes("Awaiting owner confirmation"));

console.log(`website smoke passed ${checks.length} checks against ${baseUrl.href}`);
