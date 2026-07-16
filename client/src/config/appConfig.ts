import {
  DEFAULT_VIEW_BY_ROLE,
  MENU_CATEGORY_OPTIONS,
  ROLE_NAVIGATION,
  SECURITY_METHOD_LABELS,
  SERVICE_DISPLAY_NAMES,
  STAFF_ROLE_CAPABILITIES,
  STAFF_ROLE_LABELS
} from "../types/constants";
import type { DayKey, MenuItem, StaffRole, UserRole, WebsiteOpenStatus, WebsiteStoreConfig } from "../types/domain";
import type { RoleView } from "../types/constants";

type StaffPosCategory = {
  id: "all" | "meal" | "alacarte" | "solo" | "special" | "drinks" | "addons";
  label: string;
  matches: (item: Pick<MenuItem, "category">) => boolean;
};

type NavigationUser = {
  role?: UserRole | string;
  staffRole?: StaffRole | string;
};

const dayKeys: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const normalizeMenuCategory = (value = ""): string => value.toLowerCase().replace(/[^a-z]/g, "");
const minutesFromTime = (value: string): number => {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
};
const formatBusinessTime = (value: string): string => {
  const [rawHour = "0", rawMinute = "0"] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${suffix}`;
};
export const formatStoreHoursLabel = (hours: WebsiteStoreConfig["hours"][number]): string => hours.closed
  ? "Closed"
  : `${formatBusinessTime(hours.opens)} - ${formatBusinessTime(hours.closes)}`;
const dayLabel = (offset: number, fallback: string): string => {
  if (offset === 0) return "today";
  if (offset === 1) return "tomorrow";
  return fallback;
};

export const websiteStoreConfig: WebsiteStoreConfig = {
  timezone: "Asia/Manila",
  hours: dayKeys.map((day) => ({
    day,
    label: day.charAt(0).toUpperCase() + day.slice(1),
    opens: "10:00",
    closes: "21:00"
  })),
  prepTimeMinutes: {
    min: 15,
    max: 25
  },
  serviceAvailability: {
    delivery: true,
    pickup: true,
    "walk-in": true
  },
  paymentMethods: ["cash", "cod"],
  serviceAreaLabel: "Nearby delivery zones",
  serviceAreaDetail: "Use a delivery pin and landmark for smoother drop-off.",
  customerPromise: {
    label: "Clear orders",
    detail: "Receipts, status updates, and friendly local service."
  }
};

export const paymentMethodLabels: Record<WebsiteStoreConfig["paymentMethods"][number], string> = {
  cash: "Cash",
  gcash: "GCash",
  cod: "COD"
};

export const serviceAvailabilityLabels: Record<keyof WebsiteStoreConfig["serviceAvailability"], string> = {
  delivery: "Delivery",
  pickup: "Pickup",
  "walk-in": "Walk-in"
};

export const getWebsiteOpenStatus = (date = new Date(), config = websiteStoreConfig): WebsiteOpenStatus => {
  const manilaNow = new Date(date.toLocaleString("en-US", { timeZone: config.timezone }));
  const dayIndex = manilaNow.getDay();
  const minutesNow = manilaNow.getHours() * 60 + manilaNow.getMinutes();
  const today = config.hours.find((hours) => hours.day === dayKeys[dayIndex]);
  const todayHoursLabel = today && !today.closed
    ? `${formatBusinessTime(today.opens)} - ${formatBusinessTime(today.closes)}`
    : "Closed today";

  if (today && !today.closed) {
    const opens = minutesFromTime(today.opens);
    const closes = minutesFromTime(today.closes);
    if (minutesNow >= opens && minutesNow < closes) {
      return {
        open: true,
        label: "Open now",
        detail: `Serving until ${formatBusinessTime(today.closes)} today.`,
        todayHoursLabel,
        nextOpeningLabel: "",
        timezone: config.timezone
      };
    }
  }

  let nextOpeningLabel = "Next opening time is unavailable.";
  for (let offset = 0; offset < dayKeys.length; offset += 1) {
    const candidate = config.hours.find((hours) => hours.day === dayKeys[(dayIndex + offset) % dayKeys.length]);
    if (!candidate || candidate.closed) continue;
    if (offset === 0 && minutesNow >= minutesFromTime(candidate.opens)) continue;
    nextOpeningLabel = `Opens ${dayLabel(offset, candidate.label)} at ${formatBusinessTime(candidate.opens)}.`;
    break;
  }

  return {
    open: false,
    label: "Closed now",
    detail: nextOpeningLabel,
    todayHoursLabel,
    nextOpeningLabel,
    timezone: config.timezone
  };
};

export const staffPosCategories: StaffPosCategory[] = [
  { id: "all", label: "All", matches: () => true },
  { id: "meal", label: "Meal", matches: (item) => ["favoritemeal", "meal"].includes(normalizeMenuCategory(item.category)) },
  { id: "alacarte", label: "Ala Carte", matches: (item) => normalizeMenuCategory(item.category) === "alacarte" },
  { id: "solo", label: "Solo", matches: (item) => normalizeMenuCategory(item.category) === "solo" },
  { id: "special", label: "Special", matches: (item) => normalizeMenuCategory(item.category) === "specialmeal" },
  { id: "drinks", label: "Drinks", matches: (item) => normalizeMenuCategory(item.category) === "drinks" },
  { id: "addons", label: "Add-ons", matches: (item) => ["walkinaddon", "addon", "addons"].includes(normalizeMenuCategory(item.category)) }
];

export const menuCategoryOptions = MENU_CATEGORY_OPTIONS;
export const roleNavigation = ROLE_NAVIGATION;
export const staffRoleLabels = STAFF_ROLE_LABELS;
export const staffRoleCapabilities = STAFF_ROLE_CAPABILITIES;

export const staffRoleForUser = (user: NavigationUser = {}): StaffRole => staffRoleCapabilities[user.staffRole as StaffRole] ? user.staffRole as StaffRole : "manager";
export const staffCanAccess = (user: NavigationUser | null | undefined, view: RoleView | string): boolean => {
  if (user?.role !== "staff") return true;
  const allowedViews = staffRoleCapabilities[staffRoleForUser(user)] as readonly string[];
  return allowedViews.includes(view);
};
export const navigationForUser = (user: NavigationUser = {}) => {
  const navigation = roleNavigation[user.role as UserRole] || [];
  return user.role === "staff" ? navigation.filter(([view]) => staffCanAccess(user, view)) : navigation;
};

export const defaultViewForRole = (role: UserRole | string): RoleView => DEFAULT_VIEW_BY_ROLE[role as UserRole] || DEFAULT_VIEW_BY_ROLE.customer;

export const serviceDisplayNames = SERVICE_DISPLAY_NAMES;

export const securityMethodLabels = SECURITY_METHOD_LABELS;
