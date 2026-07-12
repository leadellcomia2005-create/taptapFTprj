import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultViewForRole, navigationForUser } from "../config/appConfig";
import { observeAuth } from "../services/firebase/auth";
import { subscribeNotifications } from "../services/firebase/notifications";
import { subscribeUserProfile } from "../services/firebase/users";
import { menuAvailability } from "../utils/operations";

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

export function useCartState({ menu, navigate, notify }) {
  const [cart, setCart] = useState([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

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
    setCart([]);
    setCheckoutOpen(false);
    navigate("orders");
  }, [navigate]);

  return { cart, setCart, checkoutOpen, setCheckoutOpen, reorder, completeCheckout };
}
