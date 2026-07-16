import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultViewForRole, navigationForUser } from "../config/appConfig";
import { observeAuth } from "../services/firebase/auth";
import { subscribeNotifications } from "../services/firebase/notifications";
import { subscribeUserProfile } from "../services/firebase/users";
import { menuAvailability } from "../utils/operations";

const CART_STORAGE_VERSION = 1;
const CHECKOUT_DRAFT_STORAGE_VERSION = 1;
const cartStorageKey = (userId) => `taptap-cart:v${CART_STORAGE_VERSION}:${userId}`;
const checkoutDraftStorageKey = (userId) => `taptap-checkout:v${CHECKOUT_DRAFT_STORAGE_VERSION}:${userId}`;

function readStoredCart(userId) {
  if (!userId) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cartStorageKey(userId)) || "null");
    if (parsed?.version !== CART_STORAGE_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.slice(0, 50);
  } catch {
    return [];
  }
}

function removeStoredCart(userId) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(cartStorageKey(userId));
  } catch {
    // Cart recovery is optional when browser storage is unavailable.
  }
}

function removeStoredCheckoutDraft(userId) {
  if (!userId) return;
  try {
    window.sessionStorage.removeItem(checkoutDraftStorageKey(userId));
  } catch {
    // Logout still succeeds when browser storage is unavailable.
  }
}

function clearStoredCustomerRecovery(userId) {
  removeStoredCart(userId);
  removeStoredCheckoutDraft(userId);
}

function writeStoredCart(userId, cart) {
  if (!userId) return;
  if (!cart.length) {
    removeStoredCart(userId);
    return;
  }
  try {
    window.localStorage.setItem(cartStorageKey(userId), JSON.stringify({
      version: CART_STORAGE_VERSION,
      items: cart.map(({ id, qty }) => ({ id, qty }))
    }));
  } catch {
    // Ordering still works when storage is blocked or full.
  }
}

function reconcileCart(items, menu) {
  const products = new Map(menu.map((product) => [product.id, product]));
  return items.map((item) => {
    const product = products.get(item?.id);
    if (!product || product.walkInOnly || product.unavailable || !menuAvailability(product).available) return null;
    const stock = Math.max(0, Math.floor(Number(product.stock ?? 0)));
    const requestedQty = Math.max(0, Math.floor(Number(item?.qty ?? 0)));
    const qty = Math.min(requestedQty, stock);
    return qty > 0 ? { ...product, stock, qty } : null;
  }).filter(Boolean);
}

function cartSignature(cart) {
  return JSON.stringify(cart.map(({ id, name, price, qty, stock }) => ({ id, name, price, qty, stock })));
}

export function useAuthSession() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const activeUser = user?.mfaVerified ? user : null;

  useEffect(() => observeAuth(setUser), []);
  useEffect(() => {
    if (!activeUser) {
      setProfile(null);
      return undefined;
    }
    return subscribeUserProfile(activeUser, setProfile);
  }, [activeUser]);

  const currentUser = useMemo(() => activeUser ? ({
    ...activeUser,
    name: profile?.name || activeUser.name,
    staffRole: profile?.staffRole || activeUser.staffRole || (activeUser.role === "staff" ? "manager" : undefined)
  }) : null, [activeUser, profile]);

  return { user, setUser, profile, activeUser, currentUser };
}

export function useRoleNavigation(user) {
  const [view, setView] = useState("store");
  const role = user?.role;
  const allowedViews = useMemo(() => user ? navigationForUser(user).map(([roleView]) => roleView) : [], [user]);

  useEffect(() => {
    if (role) setView(defaultViewForRole(role));
  }, [role]);

  const navigate = useCallback((nextView) => {
    if (allowedViews.includes(nextView)) setView(nextView);
  }, [allowedViews]);

  return { view, navigate };
}

export function useNotificationCenter(user) {
  const [notifications, setNotifications] = useState([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setNotificationsOpen(false);
      return undefined;
    }
    return subscribeNotifications(user, setNotifications);
  }, [user]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications]
  );

  return { notifications, notificationsOpen, setNotificationsOpen, unreadCount };
}

export function useCartState({ menu, navigate, notify, userId }) {
  const [cart, setCart] = useState([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [hydratedUserId, setHydratedUserId] = useState(null);
  const previousUserIdRef = useRef(null);

  useEffect(() => {
    if (!userId) {
      clearStoredCustomerRecovery(previousUserIdRef.current);
      previousUserIdRef.current = null;
      setHydratedUserId(null);
      setCart((current) => current.length ? [] : current);
      setCheckoutOpen(false);
      return;
    }
    if (hydratedUserId === userId) return;

    if (previousUserIdRef.current && previousUserIdRef.current !== userId) {
      clearStoredCustomerRecovery(previousUserIdRef.current);
    }
    previousUserIdRef.current = userId;
    const restoredCart = reconcileCart(readStoredCart(userId), menu);
    setCart(restoredCart);
    setCheckoutOpen(false);
    setHydratedUserId(userId);
    if (restoredCart.length) notify(`Restored ${restoredCart.length} item${restoredCart.length === 1 ? "" : "s"} in your cart.`);
  }, [hydratedUserId, menu, notify, userId]);

  useEffect(() => {
    if (!userId || hydratedUserId !== userId) return;
    setCart((current) => {
      const reconciled = reconcileCart(current, menu);
      return cartSignature(current) === cartSignature(reconciled) ? current : reconciled;
    });
  }, [hydratedUserId, menu, userId]);

  useEffect(() => {
    if (!userId || hydratedUserId !== userId) return;
    writeStoredCart(userId, cart);
  }, [cart, hydratedUserId, userId]);

  const reorder = useCallback((order) => {
    const nextCart = (order.items || []).map((item) => {
      const product = menu.find((candidate) => candidate.id === item.id);
      if (!product || product.walkInOnly || !menuAvailability(product).available) return null;
      const stock = Number(product.stock ?? item.stock ?? 0);
      const qty = Math.min(Number(item.qty || 1), stock);
      return qty > 0 ? { ...product, stock, qty } : null;
    }).filter(Boolean);
    if (nextCart.length === 0) {
      notify("Those items are not available right now.");
      return;
    }
    setCart(nextCart);
    navigate("store");
    notify(`${order.id} added back to your cart.`);
  }, [menu, navigate, notify]);

  const completeCheckout = useCallback(() => {
    clearStoredCustomerRecovery(userId);
    setCart([]);
    setCheckoutOpen(false);
    navigate("orders");
  }, [navigate, userId]);

  return { cart, setCart, checkoutOpen, setCheckoutOpen, reorder, completeCheckout };
}
