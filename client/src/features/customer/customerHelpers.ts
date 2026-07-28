import type { AppUser, CartItem, ComplaintType, DeliveryLocation, MenuItem, Order, PaymentMethod } from "../../types/domain";
import { menuAvailability } from "../../utils/operations";

export const defaultStorePin: DeliveryLocation = {
  lat: Number(import.meta.env.VITE_STORE_LATITUDE || 14.4509229),
  lng: Number(import.meta.env.VITE_STORE_LONGITUDE || 120.9764514),
  accuracy: 0,
  source: "map-picker"
};

export const customerSecurityMethodLabels: Record<string, string> = {
  passkey: "Passkey",
  totp: "Security app",
  email: "Email code",
  sms: "SMS code"
};

export const complaintTypes = [
  ["wrong-item", "Wrong item"],
  ["missing-item", "Missing item"],
  ["late-order", "Late order"],
  ["bad-food", "Bad food"]
] as const satisfies readonly (readonly [ComplaintType, string])[];

export interface ReorderPlan {
  items: CartItem[];
  addedQuantity: number;
  adjustedLines: number;
  skippedLines: number;
}

export function buildReorderPlan(order: Pick<Order, "items">, menu: readonly MenuItem[]): ReorderPlan {
  const products = new Map(menu.map((product) => [product.id, product]));
  let adjustedLines = 0;
  let skippedLines = 0;
  const items = (order.items || []).map((previousItem) => {
    const product = products.get(previousItem.id);
    if (!product || product.walkInOnly || !menuAvailability(product).available) {
      skippedLines += 1;
      return null;
    }
    const requestedQuantity = Math.max(1, Math.floor(Number(previousItem.qty || 1)));
    const stock = Math.max(0, Math.floor(Number(product.stock ?? previousItem.stock ?? 0)));
    const qty = Math.min(requestedQuantity, stock);
    if (qty <= 0) {
      skippedLines += 1;
      return null;
    }
    if (qty < requestedQuantity) adjustedLines += 1;
    return { ...product, stock, qty } as CartItem;
  }).filter((item): item is CartItem => Boolean(item));

  return {
    items,
    addedQuantity: items.reduce((sum, item) => sum + item.qty, 0),
    adjustedLines,
    skippedLines
  };
}

export interface CheckoutDraft {
  deliveryType: "delivery" | "pickup";
  payment: Extract<PaymentMethod, "gcash" | "cod">;
  phone: string;
  address: string;
  landmark: string;
  notes: string;
  deliveryLocation: DeliveryLocation | null;
}

const checkoutDraftVersion = 1;
const checkoutDraftStorageKey = (userId: string) => `taptap-checkout:v${checkoutDraftVersion}:${userId}`;

export function normalizePhilippinePhone(value = ""): string {
  const digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("639") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("09") && digits.length === 11) return `+63${digits.slice(1)}`;
  if (digits.startsWith("9") && digits.length === 10) return `+63${digits}`;
  return value.trim();
}

export function isValidPhilippineMobile(value = ""): boolean {
  return /^\+639\d{9}$/.test(value);
}

export function locationToMarker(location?: Partial<DeliveryLocation> | null): [number, number] | null {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

export function phoneIsVerified(profile: Partial<AppUser> | null | undefined, phone: string): boolean {
  const normalized = normalizePhilippinePhone(phone);
  return Boolean(profile?.phoneVerified && normalizePhilippinePhone(profile.phone || "") === normalized);
}

export function formatProfileDate(value: unknown): string {
  const timestamp = Number(value || 0);
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-PH");
}

export function sanitizeCheckoutLocation(location?: Partial<DeliveryLocation> | null): DeliveryLocation | null {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    accuracy: Math.max(0, Number(location?.accuracy || 0)),
    source: String(location?.source || "map-picker").slice(0, 40)
  };
}

export function readCheckoutDraft(userId: string, paymongoEnabled: boolean): CheckoutDraft | null {
  if (!userId) return null;
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(checkoutDraftStorageKey(userId)) || "null");
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== checkoutDraftVersion) return null;
    const draft = parsed as Record<string, unknown>;
    return {
      deliveryType: draft.deliveryType === "pickup" ? "pickup" : "delivery",
      payment: draft.payment === "gcash" && paymongoEnabled ? "gcash" : "cod",
      phone: String(draft.phone || "").slice(0, 32),
      address: String(draft.address || "").slice(0, 300),
      landmark: String(draft.landmark || "").slice(0, 160),
      notes: String(draft.notes || "").slice(0, 400),
      deliveryLocation: sanitizeCheckoutLocation(draft.deliveryLocation as Partial<DeliveryLocation> | null)
    };
  } catch {
    return null;
  }
}

export function writeCheckoutDraft(userId: string, draft: CheckoutDraft): void {
  if (!userId) return;
  try {
    window.sessionStorage.setItem(checkoutDraftStorageKey(userId), JSON.stringify({
      version: checkoutDraftVersion,
      deliveryType: draft.deliveryType,
      payment: draft.payment,
      phone: String(draft.phone || "").slice(0, 32),
      address: String(draft.address || "").slice(0, 300),
      landmark: String(draft.landmark || "").slice(0, 160),
      notes: String(draft.notes || "").slice(0, 400),
      deliveryLocation: sanitizeCheckoutLocation(draft.deliveryLocation)
    }));
  } catch {
    // Checkout remains usable when session storage is blocked or full.
  }
}

export function removeCheckoutDraft(userId: string): void {
  if (!userId) return;
  try {
    window.sessionStorage.removeItem(checkoutDraftStorageKey(userId));
  } catch {
    // Storage cleanup is best effort and must not block an order.
  }
}
