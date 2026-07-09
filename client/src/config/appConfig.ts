import {
  DEFAULT_VIEW_BY_ROLE,
  MENU_CATEGORY_OPTIONS,
  ROLE_NAVIGATION,
  SECURITY_METHOD_LABELS,
  SERVICE_DISPLAY_NAMES,
  STAFF_ROLE_CAPABILITIES,
  STAFF_ROLE_LABELS
} from "../types/constants";
import type { MenuItem, StaffRole, UserRole } from "../types/domain";
import type { RoleView, StaffView } from "../types/constants";

type StaffPosCategory = {
  id: "all" | "meal" | "alacarte" | "solo" | "special" | "drinks" | "addons";
  label: string;
  matches: (item: Pick<MenuItem, "category">) => boolean;
};

type NavigationUser = {
  role?: UserRole | string;
  staffRole?: StaffRole | string;
};

const normalizeMenuCategory = (value = ""): string => value.toLowerCase().replace(/[^a-z]/g, "");

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
