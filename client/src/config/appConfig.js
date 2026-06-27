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
