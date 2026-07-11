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

await fetchOk("/assets/hero-food.png", "hero PNG fallback loads", "image/");
await fetchOk("/assets/hero-food.webp", "hero WebP loads", "image/");
await fetchOk("/assets/hero-food.avif", "hero AVIF loads", "image/");
await fetchOk("/assets/taptap-logo.png", "logo PNG fallback loads", "image/");
await fetchOk("/assets/taptap-logo.webp", "logo WebP loads", "image/");
await fetchOk("/assets/taptap-logo.avif", "logo AVIF loads", "image/");

const authPanels = await readFile(new URL("../src/features/auth/AuthPanels.jsx", import.meta.url), "utf8");
record("customer login modal entry exists", authPanels.includes("login-modal-title"));
record("popular meal cards are wired", authPanels.includes("login-meal-card") && authPanels.includes("popularMeals"));
record("landing menu uses current menu data", authPanels.includes("subscribeMenu") && authPanels.includes("getPopularMeals"));
record("store trust strip is present", authPanels.includes("login-trust-strip") && authPanels.includes("getOrderingDetails"));
record("public reviews are wired", authPanels.includes("subscribePublicReviews"));
record("empty reviews do not use fabricated testimonials", !authPanels.includes("fallbackCustomerReviews"));
record("secondary role access is present", authPanels.includes("login-footer-team") && authPanels.includes("openLoginModal(item.id)"));

const customerScreens = await readFile(new URL("../src/features/customer/CustomerScreens.jsx", import.meta.url), "utf8");
record("checkout entry point exists", customerScreens.includes("export function Checkout") && customerScreens.includes("Secure checkout"));
record("checkout validation summary exists", customerScreens.includes("checkout-validation-summary"));

const appShell = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
record("owner workspace is reachable", appShell.includes("<OwnerWorkspace"));
record("staff workspace is reachable", appShell.includes("<StaffWorkspace"));
record("rider workspace is reachable", appShell.includes("<RiderWorkspace"));
record("storefront total waits for fulfillment choice", appShell.includes("Calculated at checkout") && appShell.includes("Estimated total") && !appShell.includes("const deliveryFee = cart.length"));
record("storefront search and availability filters exist", appShell.includes("menu-search-field") && appShell.includes("menu-availability-filter"));
record("mobile cart sheet replaces direct floating checkout", appShell.includes("mobile-cart-sheet") && appShell.includes("Review order -"));
record("notifications require explicit read action", appShell.includes("Mark all read") && !appShell.includes("api.markAllNotificationsRead().catch"));

record("2FA continuation text is role aware", authPanels.includes("Continue to ordering") && authPanels.includes("Open owner dashboard") && authPanels.includes("Open staff workspace") && authPanels.includes("Open rider dashboard"));
record("POS-specific customer continuation text is removed", !authPanels.includes("Verify and open POS"));

const ownerWorkspace = await readFile(new URL("../src/features/workspaces/OwnerWorkspace.jsx", import.meta.url), "utf8");
record("owner dashboard is exception first", ownerWorkspace.includes("Today&apos;s exceptions") && ownerWorkspace.includes("Needs a decision") && ownerWorkspace.includes("owner-attention-grid"));
record("owner profit is not hardcoded", !ownerWorkspace.includes("totalSales * 0.58") && ownerWorkspace.includes("Average paid order"));
record("owner planning controls disclose local persistence", ownerWorkspace.includes("Saved only on this browser for planning") && ownerWorkspace.includes("Customer pricing was not changed"));

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
