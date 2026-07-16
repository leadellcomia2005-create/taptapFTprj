import type { CartItem, UserRole } from "../types/domain";
import { trackEvent } from "./firebase/orders";

export type AnalyticsAuthMethod = "demo" | "firebase";
export type LandingOrderSource =
  | "landing"
  | "nav_order"
  | "hero_order"
  | "popular_meal"
  | "menu_item"
  | "final_order"
  | "footer_team"
  | "footer_sign_in"
  | "mobile_sticky_order";
export type LandingMenuSource = "skip_link" | "nav_favorites" | "nav_menu" | "hero_menu" | "popular_full_menu";
export type CheckoutAbandonmentReason = "customer_closed";

type AnalyticsCartItem = Pick<CartItem, "id" | "name" | "price" | "qty">;

const checkoutPayload = (cart: readonly AnalyticsCartItem[]) => ({
  currency: "PHP",
  value: cart.reduce((total, item) => total + Number(item.price || 0) * Number(item.qty || 0), 0),
  items: cart.map((item) => ({
    item_id: item.id,
    item_name: item.name,
    price: Number(item.price || 0),
    quantity: Number(item.qty || 0)
  }))
});

export function trackLandingOrderEntry(source: LandingOrderSource, role: UserRole): void {
  trackEvent("select_content", { content_type: "landing_order_entry", item_id: source, role });
}

export function trackLandingMenuView(source: LandingMenuSource): void {
  trackEvent("view_item_list", { item_list_id: "landing_menu", item_list_name: "Landing menu", source });
}

export function trackRegistrationStart(method: AnalyticsAuthMethod): void {
  trackEvent("sign_up_start", { method, source: "login_modal" });
}

export function trackRegistrationComplete(method: AnalyticsAuthMethod): void {
  trackEvent("sign_up", { method });
}

export function trackLogin(method: AnalyticsAuthMethod, role: UserRole): void {
  trackEvent("login", { method, role });
}

export function trackCheckoutStart(cart: readonly AnalyticsCartItem[]): void {
  trackEvent("begin_checkout", checkoutPayload(cart));
}

export function trackCheckoutAbandonment(cart: readonly AnalyticsCartItem[], reason: CheckoutAbandonmentReason): void {
  trackEvent("checkout_abandoned", { ...checkoutPayload(cart), reason });
}
