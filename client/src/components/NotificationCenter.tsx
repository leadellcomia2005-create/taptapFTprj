import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Banknote,
  Bell,
  BellOff,
  BellRing,
  Bike,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  MessageCircle,
  MessageSquareWarning,
  MoreHorizontal,
  PackageSearch,
  PhilippinePeso,
  ShoppingBag,
  Star,
  Trash2,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { navigationForUser } from "../config/appConfig";
import {
  clearReadNotifications,
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead
} from "../services/firebase/notifications";
import {
  currentPushNotificationState,
  disablePushNotifications,
  enablePushNotifications,
  syncGrantedPushToken
} from "../services/pushNotifications";
import type { PushNotificationSnapshot } from "../services/pushNotifications";
import type { RoleView } from "../types/constants";
import type { AppUser, Notification } from "../types/domain";
import { currency, relativeTime } from "../utils/display";
import "./NotificationCenter.css";

type NotificationFilter = "all" | "unread" | "orders" | "payments" | "issues";
type DateGroup = "today" | "yesterday" | "earlier";
type Confirmation =
  | { kind: "clear-read" }
  | { kind: "dismiss"; notification: Notification };
type PresentationEntry =
  | { kind: "notification"; notification: Notification }
  | { kind: "group"; key: string; notifications: Notification[] };

type NotificationCenterProps = {
  notifications: Notification[];
  loading?: boolean;
  user: AppUser;
  onClose: () => void;
  onNavigate: (view: RoleView) => void;
  onOpenOrder?: (orderId: string) => void;
};

const filters: Array<{ id: NotificationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "orders", label: "Orders" },
  { id: "payments", label: "Payments" },
  { id: "issues", label: "Issues" }
];

const dateGroupLabels: Record<DateGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier"
};

const notificationIcons: Record<string, LucideIcon> = {
  order: ShoppingBag,
  sale: PhilippinePeso,
  payment: PhilippinePeso,
  complaint: MessageSquareWarning,
  delivery: Bike,
  inventory: PackageSearch,
  shift: ClipboardCheck,
  chat: MessageCircle,
  review: Star,
  admin: Bell,
  system: Bell
};

function normalizedNotificationType(notification: Notification): string {
  const content = `${notification.title} ${notification.message}`.toLowerCase();
  if (notification.entityType) return notification.entityType;
  if (notification.type) return notification.type;
  return /\bcod\b|payment|remitted/.test(content) ? "payment" : "system";
}

function iconForNotification(notification: Notification): LucideIcon {
  const content = `${notification.title} ${notification.message}`.toLowerCase();
  if (/\bcod\b/.test(content)) return Banknote;
  return notificationIcons[normalizedNotificationType(notification)] || notificationIcons[notification.type] || Bell;
}

function generatedReference(recordId: string): string {
  if (/^TAP-[A-Z0-9-]{3,}$/i.test(recordId)) return recordId.toUpperCase();
  const suffix = recordId.replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();
  return suffix ? `TAP-${suffix}` : "";
}

function displayReference(notification: Notification): string {
  const supplied = String(notification.displayReference || "").replace(/^Order\s+/i, "").trim();
  const reference = supplied || (notification.orderId ? generatedReference(notification.orderId) : "");
  if (!reference) return "";
  return notification.orderId ? `Order ${reference}` : reference;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceRecordId(text: string, recordId: string, replacement: string): string {
  if (!recordId || !replacement) return text;
  const escapedId = escapeRegExp(recordId);
  return text
    .replace(new RegExp(`Order\\s+${escapedId}`, "gi"), replacement)
    .replace(new RegExp(escapedId, "g"), replacement);
}

function friendlyNotificationMessage(notification: Notification): string {
  const reference = displayReference(notification);
  if (typeof notification.amount === "number" && Number.isFinite(notification.amount)) {
    return [reference, currency(notification.amount)].filter(Boolean).join(" \u00b7 ");
  }

  let message = notification.message.trim();
  if (notification.orderId) message = replaceRecordId(message, notification.orderId, reference);
  if (notification.entityId && notification.entityId !== notification.orderId && notification.displayReference) {
    message = replaceRecordId(message, notification.entityId, notification.displayReference);
  }
  message = message.replace(/\b(\d+(?:\.\d+)?)\s*PHP\b/gi, (_match, amount: string) => currency(Number(amount)));
  message = message.replace(/-[A-Za-z0-9_-]{12,}/g, (recordId) => `Order ${generatedReference(recordId)}`);
  return message;
}

function dateGroupFor(timestamp: number): DateGroup {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  if (timestamp >= startOfToday) return "today";
  if (timestamp >= startOfYesterday) return "yesterday";
  return "earlier";
}

function matchesFilter(notification: Notification, filter: NotificationFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !notification.readAt;
  const type = normalizedNotificationType(notification);
  if (filter === "orders") return ["order", "delivery"].includes(type);
  if (filter === "payments") return ["payment", "sale"].includes(type) || /\bcod\b|payment|remitted/.test(`${notification.title} ${notification.message}`.toLowerCase());
  return ["complaint", "inventory"].includes(type) || /issue|alert|failed|cancel/.test(`${notification.title} ${notification.message}`.toLowerCase());
}

function notificationDestination(user: AppUser, notification: Notification): RoleView | null {
  const allowedViews = new Set(navigationForUser(user).map(([view]) => view as RoleView));
  const allowed = (...views: Array<RoleView | null>): RoleView | null => views.find((view): view is RoleView => Boolean(view && allowedViews.has(view))) || null;
  const requested = notification.actionView as RoleView | undefined;
  if (requested && allowedViews.has(requested)) return requested;

  const type = normalizedNotificationType(notification);
  const content = `${notification.title} ${notification.message}`.toLowerCase();
  if (user.role === "customer") {
    if (type === "review") return allowed("feedback");
    if (/receipt/.test(content)) return allowed("receipts");
    if (["order", "delivery", "payment", "complaint"].includes(type)) return allowed("orders");
  }
  if (user.role === "owner") {
    if (type === "inventory") return allowed("owner-inventory");
    if (["complaint", "review"].includes(type)) return allowed("owner-reviews");
    if (type === "shift") return allowed("owner-reports");
    if (["order", "delivery", "payment", "sale"].includes(type)) return allowed("owner-sales");
  }
  if (user.role === "staff") {
    if (type === "inventory") return allowed("staff-inventory");
    if (["complaint", "review"].includes(type)) return allowed("staff-reviews");
    if (type === "shift") return allowed("staff-shifts");
    if (type === "chat") return allowed("staff-chat");
    if (["order", "delivery", "payment", "sale"].includes(type)) {
      return /kitchen|prepar/.test(content) ? allowed("staff-kitchen", "staff-orders") : allowed("staff-orders");
    }
  }
  if (user.role === "rider") {
    if (["payment", "sale"].includes(type) || /\bcod\b/.test(content)) return allowed("rider-cod");
    if (["order", "delivery"].includes(type)) return allowed("rider-orders");
  }
  return null;
}

function destinationLabel(notification: Notification): string {
  const type = normalizedNotificationType(notification);
  if (type === "inventory") return "View stock";
  if (type === "complaint") return "View complaint";
  if (type === "delivery") return "View delivery";
  if (["payment", "sale"].includes(type)) return "View payment";
  if (type === "shift") return "View shift";
  if (type === "chat") return "Open conversation";
  if (type === "review") return "View review";
  return "View order";
}

function groupRepeatedNotifications(notifications: Notification[], dateGroup: DateGroup): PresentationEntry[] {
  const keyed = new Map<string, Notification[]>();
  for (const notification of notifications) {
    const key = `${notification.type}|${notification.title.trim().toLowerCase()}`;
    keyed.set(key, [...(keyed.get(key) || []), notification]);
  }
  const emitted = new Set<string>();
  const result: PresentationEntry[] = [];
  for (const notification of notifications) {
    const key = `${notification.type}|${notification.title.trim().toLowerCase()}`;
    const repeated = keyed.get(key) || [];
    if (repeated.length < 3) {
      result.push({ kind: "notification", notification });
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push({ kind: "group", key: `${dateGroup}-${key}`, notifications: repeated });
  }
  return result;
}

function NotificationIcon({ notification }: { notification: Notification }) {
  const Icon = iconForNotification(notification);
  const type = normalizedNotificationType(notification);
  return <span className={`notification-icon notification-icon-${type}`} aria-hidden="true"><Icon size={19} strokeWidth={2.2} /></span>;
}

type NotificationRowProps = {
  notification: Notification;
  destination: RoleView | null;
  busy: boolean;
  onOpen: (notification: Notification, destination: RoleView) => void;
  onMarkRead: (notification: Notification) => void;
  onDismiss: (notification: Notification) => void;
};

function NotificationRow({ notification, destination, busy, onOpen, onMarkRead, onDismiss }: NotificationRowProps) {
  const unread = !notification.readAt;
  const content = (
    <>
      <span className="notification-copy-heading">
        <strong>{notification.title}</strong>
        <time dateTime={new Date(notification.createdAt).toISOString()} title={new Date(notification.createdAt).toLocaleString("en-PH")}>{relativeTime(notification.createdAt)}</time>
      </span>
      <span className="notification-message">{friendlyNotificationMessage(notification)}</span>
      {destination && <span className="notification-action-label">{destinationLabel(notification)}<ArrowRight size={14} aria-hidden="true" /></span>}
    </>
  );

  return (
    <article className={`notification-row ${unread ? "unread" : "read"}`} data-notification-id={notification.id}>
      <NotificationIcon notification={notification} />
      {destination ? (
        <button className="notification-row-main notification-row-action" disabled={busy} type="button" onClick={() => onOpen(notification, destination)}>
          {content}
        </button>
      ) : (
        <div className="notification-row-main">
          {content}
          {unread && <button className="notification-inline-action" disabled={busy} type="button" onClick={() => onMarkRead(notification)}>Mark as read</button>}
        </div>
      )}
      {unread && <span className="notification-unread-marker"><span className="visually-hidden">Unread notification</span></span>}
      <button className="notification-dismiss" disabled={busy} type="button" title={`Remove ${notification.title}`} aria-label={`Remove ${notification.title}`} onClick={() => onDismiss(notification)}>
        <X size={17} aria-hidden="true" />
      </button>
    </article>
  );
}

export default function NotificationCenter({ notifications, loading = false, user, onClose, onNavigate, onOpenOrder }: NotificationCenterProps) {
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [bulkAction, setBulkAction] = useState<"mark" | "clear" | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushSnapshot, setPushSnapshot] = useState<PushNotificationSnapshot>(() => currentPushNotificationState());
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<Confirmation | null>(null);
  const confirmationDialogRef = useRef<HTMLDivElement>(null);
  const confirmationCancelRef = useRef<HTMLButtonElement>(null);
  const moreOpenRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const storageKey = `taptap-notification-scroll-${user.uid}`;
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const readCount = notifications.length - unreadCount;

  useEffect(() => {
    confirmationRef.current = confirmation;
    if (confirmation) window.setTimeout(() => confirmationCancelRef.current?.focus(), 0);
  }, [confirmation]);

  useEffect(() => {
    moreOpenRef.current = moreOpen;
  }, [moreOpen]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    body.style.overflow = "hidden";
    if (scrollbarWidth) body.style.paddingRight = `${scrollbarWidth}px`;
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmationRef.current) setConfirmation(null);
        else if (moreOpenRef.current) setMoreOpen(false);
        else onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const scope = confirmationRef.current ? confirmationDialogRef.current : panelRef.current;
      const focusable = Array.from(scope?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") || [])
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        scope?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1) || first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const savedScroll = Number(sessionStorage.getItem(storageKey) || 0);
    window.requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = savedScroll;
    });

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      previousFocusRef.current?.focus();
    };
  }, [storageKey]);

  useEffect(() => {
    let active = true;
    const snapshot = currentPushNotificationState();
    setPushSnapshot(snapshot);
    if (snapshot.permission === "granted" && snapshot.state !== "unconfigured") {
      void syncGrantedPushToken().then((next) => {
        if (active) setPushSnapshot(next);
      });
    }
    return () => {
      active = false;
    };
  }, [user.uid]);

  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => matchesFilter(notification, activeFilter)),
    [activeFilter, notifications]
  );
  const dateGroups = useMemo(() => {
    const grouped: Record<DateGroup, Notification[]> = { today: [], yesterday: [], earlier: [] };
    for (const notification of visibleNotifications) grouped[dateGroupFor(notification.createdAt)].push(notification);
    return grouped;
  }, [visibleNotifications]);

  const runForNotification = async (notification: Notification, action: () => Promise<unknown>) => {
    if (pendingIdsRef.current.has(notification.id)) return false;
    pendingIdsRef.current.add(notification.id);
    setPendingIds((current) => new Set(current).add(notification.id));
    setFeedback(null);
    try {
      await action();
      return true;
    } catch {
      setFeedback({ type: "error", text: "The notification could not be updated. Check your connection and try again." });
      return false;
    } finally {
      pendingIdsRef.current.delete(notification.id);
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
    }
  };

  const handleOpen = async (notification: Notification, destination: RoleView) => {
    const completed = await runForNotification(notification, async () => {
      if (!notification.readAt) await markNotificationRead(notification.id, user.uid);
    });
    if (!completed) return;
    onNavigate(destination);
    if (destination === "orders" && notification.orderId) onOpenOrder?.(notification.orderId);
    onClose();
  };

  const handleMarkRead = async (notification: Notification) => {
    const completed = await runForNotification(notification, () => markNotificationRead(notification.id, user.uid));
    if (completed) setFeedback({ type: "success", text: "Notification marked as read." });
  };

  const handleMarkAllRead = async () => {
    if (!unreadCount || bulkAction) return;
    setBulkAction("mark");
    setFeedback(null);
    try {
      await markAllNotificationsRead(user.uid);
      setFeedback({ type: "success", text: `${unreadCount} notification${unreadCount === 1 ? "" : "s"} marked as read.` });
    } catch {
      setFeedback({ type: "error", text: "Notifications could not be marked as read. Check your connection and try again." });
    } finally {
      setBulkAction(null);
    }
  };

  const handleConfirm = async () => {
    if (!confirmation || bulkAction) return;
    if (confirmation.kind === "clear-read") {
      setBulkAction("clear");
      setFeedback(null);
      try {
        const count = readCount;
        await clearReadNotifications(user.uid);
        setConfirmation(null);
        setFeedback({ type: "success", text: `${count} read notification${count === 1 ? "" : "s"} cleared.` });
      } catch {
        setFeedback({ type: "error", text: "Read notifications could not be cleared. Check your connection and try again." });
      } finally {
        setBulkAction(null);
      }
      return;
    }

    const { notification } = confirmation;
    const completed = await runForNotification(notification, () => dismissNotification(notification.id, user.uid));
    if (completed) {
      setConfirmation(null);
      setFeedback({ type: "success", text: "Notification removed." });
    }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePushPreference = async () => {
    if (pushBusy || ["unsupported", "unconfigured", "denied"].includes(pushSnapshot.state)) return;
    setPushBusy(true);
    setFeedback(null);
    setMoreOpen(false);
    const next = pushSnapshot.state === "enabled"
      ? await disablePushNotifications()
      : await enablePushNotifications();
    setPushSnapshot(next);
    if (next.state === "enabled") {
      setFeedback({ type: "success", text: "Browser order alerts are on." });
    } else if (next.state === "denied") {
      setFeedback({ type: "error", text: "Browser alerts are blocked in this browser's site settings." });
    } else if (next.state === "error") {
      setFeedback({ type: "error", text: "Browser alerts could not be updated. Try again later." });
    } else {
      setFeedback({ type: "success", text: "Browser order alerts are off." });
    }
    setPushBusy(false);
  };

  const pushActionDisabled = pushBusy || ["unsupported", "unconfigured", "denied"].includes(pushSnapshot.state);
  const pushActionLabel = pushBusy
    ? "Updating browser alerts..."
    : pushSnapshot.state === "enabled"
      ? "Turn off browser alerts"
      : pushSnapshot.state === "denied"
        ? "Browser alerts blocked"
        : ["unsupported", "unconfigured"].includes(pushSnapshot.state)
          ? "Browser alerts unavailable"
          : "Turn on browser alerts";

  const renderRow = (notification: Notification) => (
    <NotificationRow
      busy={pendingIds.has(notification.id)}
      destination={notificationDestination(user, notification)}
      key={notification.id}
      notification={notification}
      onDismiss={(entry) => setConfirmation({ kind: "dismiss", notification: entry })}
      onMarkRead={handleMarkRead}
      onOpen={handleOpen}
    />
  );

  const emptyLabel = activeFilter === "all"
    ? "No notifications yet. New order and account updates will appear here."
    : `No ${filters.find(({ id }) => id === activeFilter)?.label.toLowerCase()} notifications.`;

  return (
    <div className="notification-layer">
      <div className="notification-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside
        aria-busy={bulkAction ? "true" : undefined}
        aria-labelledby="notification-center-title"
        aria-modal="true"
        className="notification-center"
        id="notification-center"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="notification-panel-header">
          <div className="notification-title-row">
            <div>
              <p className="eyebrow text-danger">Your updates</p>
              <h2 id="notification-center-title">Notifications</h2>
            </div>
            <button className="notification-icon-button" type="button" title="Close notifications" aria-label="Close notifications" onClick={onClose}>
              <X size={21} aria-hidden="true" />
            </button>
          </div>
          <div className="notification-summary-row">
            <p><strong>{unreadCount}</strong> unread</p>
            <button className="notification-mark-all" disabled={!unreadCount || Boolean(bulkAction)} type="button" onClick={handleMarkAllRead}>
              <CheckCheck size={16} aria-hidden="true" />
              <span>{bulkAction === "mark" ? "Marking..." : "Mark all read"}</span>
            </button>
            <div className="notification-more-wrap">
              <button className="notification-icon-button" aria-expanded={moreOpen} aria-haspopup="menu" type="button" title="More notification actions" aria-label="More notification actions" onClick={() => setMoreOpen((current) => !current)}>
                <MoreHorizontal size={21} aria-hidden="true" />
              </button>
              {moreOpen && (
                <div className="notification-more-menu" role="menu">
                  <button
                    data-testid="push-notification-toggle"
                    disabled={pushActionDisabled}
                    role="menuitem"
                    type="button"
                    onClick={handlePushPreference}
                  >
                    {pushSnapshot.state === "enabled" ? <BellOff size={16} aria-hidden="true" /> : <BellRing size={16} aria-hidden="true" />}
                    <span>{pushActionLabel}</span>
                  </button>
                  <button disabled={!readCount || Boolean(bulkAction)} role="menuitem" type="button" onClick={() => { setMoreOpen(false); setConfirmation({ kind: "clear-read" }); }}>
                    <Trash2 size={16} aria-hidden="true" />
                    <span>Clear read notifications</span>
                  </button>
                </div>
              )}
            </div>
          </div>
          <nav className="notification-filters" aria-label="Filter notifications">
            {filters.map((filter) => (
              <button aria-pressed={activeFilter === filter.id} className={activeFilter === filter.id ? "active" : ""} key={filter.id} type="button" onClick={() => setActiveFilter(filter.id)}>
                {filter.label}
              </button>
            ))}
          </nav>
          <div className={`notification-feedback ${feedback?.type || ""}`} aria-live="polite" role="status">
            {feedback?.text || ""}
          </div>
        </header>

        <div
          className="notification-list"
          data-testid="notification-scroll-region"
          ref={listRef}
          onScroll={(event) => sessionStorage.setItem(storageKey, String(event.currentTarget.scrollTop))}
        >
          {loading && <div className="notification-state" role="status"><Bell size={22} aria-hidden="true" /><strong>Loading notifications...</strong></div>}
          {!loading && visibleNotifications.length === 0 && <div className="notification-state"><Bell size={22} aria-hidden="true" /><strong>{emptyLabel}</strong></div>}
          {!loading && (["today", "yesterday", "earlier"] as DateGroup[]).map((dateGroup) => {
            const entries = dateGroups[dateGroup];
            if (!entries.length) return null;
            return (
              <section className="notification-date-group" aria-labelledby={`notification-date-${dateGroup}`} key={dateGroup}>
                <h3 id={`notification-date-${dateGroup}`}>{dateGroupLabels[dateGroup]}</h3>
                {groupRepeatedNotifications(entries, dateGroup).map((entry) => {
                  if (entry.kind === "notification") return renderRow(entry.notification);
                  const expanded = expandedGroups.has(entry.key);
                  const unreadInGroup = entry.notifications.filter((notification) => !notification.readAt).length;
                  const first = entry.notifications[0];
                  return (
                    <div className="notification-repeat-group" key={entry.key}>
                      <button className="notification-group-summary" aria-expanded={expanded} type="button" onClick={() => toggleGroup(entry.key)}>
                        <NotificationIcon notification={first} />
                        <span><strong>{first.title}</strong><small>{entry.notifications.length} updates{unreadInGroup ? ` \u00b7 ${unreadInGroup} unread` : ""}</small></span>
                        {expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                      </button>
                      {expanded && <div className="notification-repeat-items">{entry.notifications.map(renderRow)}</div>}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>

        {confirmation && (
          <div className="notification-confirmation-layer">
            <div
              aria-describedby="notification-confirmation-description"
              aria-labelledby="notification-confirmation-title"
              aria-modal="true"
              className="notification-confirmation"
              ref={confirmationDialogRef}
              role="alertdialog"
              tabIndex={-1}
            >
              <span className="notification-confirmation-icon" aria-hidden="true"><Trash2 size={20} /></span>
              <h3 id="notification-confirmation-title">{confirmation.kind === "clear-read" ? "Clear read notifications?" : "Remove this notification?"}</h3>
              <p id="notification-confirmation-description">
                {confirmation.kind === "clear-read"
                  ? `${readCount} read notification${readCount === 1 ? "" : "s"} will be removed. Unread notifications will stay.`
                  : confirmation.notification.readAt
                    ? "This notification will be permanently removed."
                    : "This notification is unread. Confirm that you want to remove it permanently."}
              </p>
              <div>
                <button className="notification-confirm-cancel" disabled={Boolean(bulkAction)} ref={confirmationCancelRef} type="button" onClick={() => setConfirmation(null)}>Cancel</button>
                <button className="notification-confirm-delete" disabled={Boolean(bulkAction) || (confirmation.kind === "dismiss" && pendingIds.has(confirmation.notification.id))} type="button" onClick={handleConfirm}>
                  {bulkAction === "clear" ? "Clearing..." : "Remove"}
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
