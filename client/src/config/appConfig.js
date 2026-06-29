const normalizeMenuCategory = (value = "") => value.toLowerCase().replace(/[^a-z]/g, "");

export const staffPosCategories = [
  { id: "all", label: "All", matches: () => true },
  { id: "meal", label: "Meal", matches: (item) => ["favoritemeal", "meal"].includes(normalizeMenuCategory(item.category)) },
  { id: "alacarte", label: "Ala Carte", matches: (item) => normalizeMenuCategory(item.category) === "alacarte" },
  { id: "solo", label: "Solo", matches: (item) => normalizeMenuCategory(item.category) === "solo" },
  { id: "special", label: "Special", matches: (item) => normalizeMenuCategory(item.category) === "specialmeal" },
  { id: "drinks", label: "Drinks", matches: (item) => normalizeMenuCategory(item.category) === "drinks" },
  { id: "addons", label: "Add-ons", matches: (item) => ["walkinaddon", "addon", "addons"].includes(normalizeMenuCategory(item.category)) }
];

export const menuCategoryOptions = ["Favorite Meal", "Alacarte", "Solo", "Special Meal", "Drinks", "Walk-in Add-on"];

export const roleNavigation = {
  customer: [
    ["store", "Storefront"],
    ["orders", "Order History"],
    ["receipts", "Digital Receipts"],
    ["feedback", "Reviews & Feedback"],
    ["profile", "Personal Info"]
  ],
  owner: [
    ["owner-overview", "Dashboard"],
    ["owner-sales", "Sales & Orders"],
    ["owner-inventory", "Inventory"],
    ["owner-reports", "Reports"],
    ["owner-reviews", "Reviews"],
    ["owner-users", "Users & Roles"],
    ["owner-audit", "Audit Logs"],
    ["owner-settings", "System Settings"]
  ],
  staff: [
    ["staff-overview", "Dashboard"],
    ["staff-pos", "Walk-in POS"],
    ["staff-kitchen", "Kitchen"],
    ["staff-orders", "Order Queue"],
    ["staff-inventory", "Inventory"],
    ["staff-shifts", "Shift Logs"],
    ["staff-chat", "Chat Support"],
    ["staff-reviews", "Reviews"],
    ["staff-settings", "Settings"]
  ],
  rider: [
    ["rider-orders", "Assigned Orders"],
    ["rider-cod", "COD Ledger"]
  ]
};

export const staffRoleLabels = {
  manager: "Manager",
  cashier: "Cashier",
  kitchen: "Kitchen",
  inventory: "Inventory"
};

export const staffRoleCapabilities = {
  manager: ["staff-overview", "staff-pos", "staff-kitchen", "staff-orders", "staff-inventory", "staff-shifts", "staff-chat", "staff-reviews", "staff-settings"],
  cashier: ["staff-overview", "staff-pos", "staff-orders", "staff-shifts", "staff-chat", "staff-settings"],
  kitchen: ["staff-overview", "staff-kitchen", "staff-orders", "staff-settings"],
  inventory: ["staff-overview", "staff-inventory", "staff-orders", "staff-settings"]
};

export const staffRoleForUser = (user = {}) => staffRoleCapabilities[user.staffRole] ? user.staffRole : "manager";
export const staffCanAccess = (user, view) => user?.role !== "staff" || staffRoleCapabilities[staffRoleForUser(user)].includes(view);
export const navigationForUser = (user = {}) => {
  const navigation = roleNavigation[user.role] || [];
  return user.role === "staff" ? navigation.filter(([view]) => staffCanAccess(user, view)) : navigation;
};

export const defaultViewForRole = (role) => ({
  customer: "store",
  owner: "owner-overview",
  staff: "staff-overview",
  rider: "rider-orders"
}[role] || "store");

export const serviceDisplayNames = {
  firebase: "Secure login",
  socket: "Live updates",
  openai: "Business insight",
  dialogflow: "Assistant answers",
  paymongo: "Online payment",
  twilio: "SMS updates",
  emailOtp: "Email codes",
  twoFactor: "Account security"
};

export const securityMethodLabels = {
  totp: "Security app",
  email: "Email code",
  sms: "SMS code"
};
