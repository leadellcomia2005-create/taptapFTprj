import type {
  DayKey,
  DeliveryType,
  MenuCategory,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  StaffRole,
  UserRole
} from "./domain";

export const USER_ROLE = {
  CUSTOMER: "customer",
  OWNER: "owner",
  STAFF: "staff",
  RIDER: "rider"
} as const satisfies Record<string, UserRole>;

export const USER_ROLES = [
  USER_ROLE.CUSTOMER,
  USER_ROLE.OWNER,
  USER_ROLE.STAFF,
  USER_ROLE.RIDER
] as const satisfies readonly UserRole[];

export const STAFF_ROLE = {
  MANAGER: "manager",
  CASHIER: "cashier",
  KITCHEN: "kitchen",
  INVENTORY: "inventory"
} as const satisfies Record<string, StaffRole>;

export const STAFF_ROLES = [
  STAFF_ROLE.MANAGER,
  STAFF_ROLE.CASHIER,
  STAFF_ROLE.KITCHEN,
  STAFF_ROLE.INVENTORY
] as const satisfies readonly StaffRole[];

export const MENU_CATEGORIES = {
  FAVORITE_MEAL: "Favorite Meal",
  ALACARTE: "Alacarte",
  SOLO: "Solo",
  SPECIAL_MEAL: "Special Meal",
  DRINKS: "Drinks",
  WALK_IN_ADD_ON: "Walk-in Add-on"
} as const satisfies Record<string, MenuCategory>;

export const MENU_CATEGORY_OPTIONS = [
  MENU_CATEGORIES.FAVORITE_MEAL,
  MENU_CATEGORIES.ALACARTE,
  MENU_CATEGORIES.SOLO,
  MENU_CATEGORIES.SPECIAL_MEAL,
  MENU_CATEGORIES.DRINKS,
  MENU_CATEGORIES.WALK_IN_ADD_ON
] as const satisfies readonly MenuCategory[];

export const MENU_CATEGORY_STOCK = {
  [MENU_CATEGORIES.FAVORITE_MEAL]: 35,
  [MENU_CATEGORIES.ALACARTE]: 25,
  [MENU_CATEGORIES.SOLO]: 25,
  [MENU_CATEGORIES.DRINKS]: 60,
  [MENU_CATEGORIES.SPECIAL_MEAL]: 30,
  [MENU_CATEGORIES.WALK_IN_ADD_ON]: 100
} as const satisfies Record<MenuCategory, number>;

export const MENU_CATEGORY_DESCRIPTIONS = {
  [MENU_CATEGORIES.FAVORITE_MEAL]: "Served as a complete favorite meal.",
  [MENU_CATEGORIES.ALACARTE]: "Full alacarte serving for dine-in, takeout, or delivery.",
  [MENU_CATEGORIES.SOLO]: "Solo serving for a lighter order.",
  [MENU_CATEGORIES.DRINKS]: "Cold drink add-on.",
  [MENU_CATEGORIES.SPECIAL_MEAL]: "House special meal.",
  [MENU_CATEGORIES.WALK_IN_ADD_ON]: "Counter add-on for walk-in orders only."
} as const satisfies Record<MenuCategory, string>;

export const ORDER_STATUS = {
  PENDING_PAYMENT: "pending-payment",
  RECEIVED: "received",
  PREPARING: "preparing",
  READY: "ready",
  OUT_FOR_DELIVERY: "out-for-delivery",
  ARRIVED: "arrived",
  DELIVERED: "delivered",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
} as const satisfies Record<string, OrderStatus>;

export const ORDER_STATUSES = [
  ORDER_STATUS.PENDING_PAYMENT,
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY,
  ORDER_STATUS.OUT_FOR_DELIVERY,
  ORDER_STATUS.ARRIVED,
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELLED
] as const satisfies readonly OrderStatus[];

export const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.PENDING_PAYMENT]: "Payment pending",
  [ORDER_STATUS.RECEIVED]: "Received",
  [ORDER_STATUS.PREPARING]: "Preparing",
  [ORDER_STATUS.READY]: "Ready",
  [ORDER_STATUS.OUT_FOR_DELIVERY]: "Out for delivery",
  [ORDER_STATUS.ARRIVED]: "Arrived",
  [ORDER_STATUS.DELIVERED]: "Delivered",
  [ORDER_STATUS.COMPLETED]: "Completed",
  [ORDER_STATUS.CANCELLED]: "Cancelled"
} as const satisfies Record<OrderStatus, string>;

export const ACTIVE_PREP_ORDER_STATUSES = [
  ORDER_STATUS.RECEIVED,
  ORDER_STATUS.PREPARING
] as const satisfies readonly OrderStatus[];

export const NON_REVENUE_ORDER_STATUSES = [
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.PENDING_PAYMENT
] as const satisfies readonly OrderStatus[];

export const PAYMENT_METHOD = {
  GCASH: "gcash",
  COD: "cod",
  CASH: "cash"
} as const satisfies Record<string, PaymentMethod>;

export const PAYMENT_METHODS = [
  PAYMENT_METHOD.GCASH,
  PAYMENT_METHOD.COD,
  PAYMENT_METHOD.CASH
] as const satisfies readonly PaymentMethod[];

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PAID: "paid",
  COD_PENDING: "cod-pending",
  COD_COLLECTED: "cod-collected",
  FAILED: "failed",
  REFUNDED: "refunded"
} as const satisfies Record<string, PaymentStatus>;

export const DELIVERY_TYPE = {
  DELIVERY: "delivery",
  PICKUP: "pickup",
  WALK_IN: "walk-in"
} as const satisfies Record<string, DeliveryType>;

export const DELIVERY_TYPES = [
  DELIVERY_TYPE.DELIVERY,
  DELIVERY_TYPE.PICKUP,
  DELIVERY_TYPE.WALK_IN
] as const satisfies readonly DeliveryType[];

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const satisfies readonly DayKey[];

export const DAY_LABELS = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat"
} as const satisfies Record<DayKey, string>;

export type CustomerView = "store" | "orders" | "receipts" | "feedback" | "profile";
export type OwnerView =
  | "owner-overview"
  | "owner-sales"
  | "owner-inventory"
  | "owner-reports"
  | "owner-reviews"
  | "owner-users"
  | "owner-audit"
  | "owner-settings";
export type StaffView =
  | "staff-overview"
  | "staff-pos"
  | "staff-kitchen"
  | "staff-orders"
  | "staff-inventory"
  | "staff-shifts"
  | "staff-chat"
  | "staff-reviews"
  | "staff-settings";
export type RiderView = "rider-orders" | "rider-cod";
export type RoleView = CustomerView | OwnerView | StaffView | RiderView;
export type NavigationItem = readonly [RoleView, string];

export const ROLE_NAVIGATION = {
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
} as const satisfies Record<UserRole, readonly NavigationItem[]>;

export const DEFAULT_VIEW_BY_ROLE = {
  customer: "store",
  owner: "owner-overview",
  staff: "staff-overview",
  rider: "rider-orders"
} as const satisfies Record<UserRole, RoleView>;

export const STAFF_ROLE_LABELS = {
  manager: "Manager",
  cashier: "Cashier",
  kitchen: "Kitchen",
  inventory: "Inventory"
} as const satisfies Record<StaffRole, string>;

export const STAFF_ROLE_CAPABILITIES = {
  manager: ["staff-overview", "staff-pos", "staff-kitchen", "staff-orders", "staff-inventory", "staff-shifts", "staff-chat", "staff-reviews", "staff-settings"],
  cashier: ["staff-overview", "staff-pos", "staff-orders", "staff-shifts", "staff-chat", "staff-settings"],
  kitchen: ["staff-overview", "staff-kitchen", "staff-orders", "staff-settings"],
  inventory: ["staff-overview", "staff-inventory", "staff-orders", "staff-settings"]
} as const satisfies Record<StaffRole, readonly StaffView[]>;

export const SERVICE_DISPLAY_NAMES = {
  api: "App connection",
  firebase: "Secure login",
  socket: "Live updates",
  openai: "Business insight",
  dialogflow: "Assistant answers",
  paymongo: "Online payment",
  twilio: "SMS updates",
  emailOtp: "Email codes",
  twoFactor: "Account security",
  turnstile: "Bot protection"
} as const;

export const SECURITY_METHOD_LABELS = {
  totp: "Security app",
  email: "Email code",
  sms: "SMS code"
} as const;
