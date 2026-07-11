export type EntityId = string;
export type TimestampMs = number;
export type ImageDataUrl = `data:image/${string}`;
export type TimeString = `${number}:${number}`;

export type UserRole = "customer" | "owner" | "staff" | "rider";

export type StaffRole = "manager" | "cashier" | "kitchen" | "inventory";

export type MenuCategory =
  | "Favorite Meal"
  | "Alacarte"
  | "Solo"
  | "Special Meal"
  | "Drinks"
  | "Walk-in Add-on";

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export type MenuAvailabilityMode = "always" | "schedule";

export interface MenuAvailability {
  mode: MenuAvailabilityMode;
  days?: DayKey[];
  start?: TimeString;
  end?: TimeString;
}

export interface MenuItem {
  id: EntityId;
  name: string;
  category: MenuCategory;
  price: number;
  description?: string;
  image?: string;
  imagePosition?: string;
  allergens?: string[];
  stock?: number;
  reorderPoint?: number;
  featured?: boolean;
  unavailable?: boolean;
  walkInOnly?: boolean;
  availability?: MenuAvailability;
  availabilityMode?: MenuAvailabilityMode;
  availableFrom?: TimeString;
  availableUntil?: TimeString;
  createdAt?: TimestampMs;
  updatedAt?: TimestampMs;
}

export interface CartItem extends Pick<MenuItem, "id" | "name" | "price" | "category"> {
  qty: number;
  image?: string;
  imagePosition?: string;
  stock?: number;
  walkInOnly?: boolean;
}

export type OrderStatus =
  | "pending-payment"
  | "received"
  | "preparing"
  | "ready"
  | "out-for-delivery"
  | "arrived"
  | "delivered"
  | "completed"
  | "cancelled";

export type PaymentMethod = "gcash" | "cod" | "cash";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "cod-pending"
  | "cod-collected"
  | "failed"
  | "refunded";

export type DeliveryType = "delivery" | "pickup" | "walk-in";

export type DiningOption = "dine-in" | "takeout" | DeliveryType | string;

export interface StoreDayHours {
  day: DayKey;
  label: string;
  opens: TimeString;
  closes: TimeString;
  closed?: boolean;
}

export type ServiceAvailabilityKey = DeliveryType;

export interface WebsiteStoreConfig {
  timezone: "Asia/Manila";
  hours: StoreDayHours[];
  prepTimeMinutes: {
    min: number;
    max: number;
  };
  serviceAvailability: Record<ServiceAvailabilityKey, boolean>;
  paymentMethods: PaymentMethod[];
  serviceAreaLabel: string;
  serviceAreaDetail: string;
  customerPromise: {
    label: string;
    detail: string;
  };
}

export interface WebsiteOpenStatus {
  open: boolean;
  label: string;
  detail: string;
  todayHoursLabel: string;
  nextOpeningLabel: string;
  timezone: WebsiteStoreConfig["timezone"];
}

export interface DeliveryLocation {
  lat: number;
  lng: number;
  address?: string;
  landmark?: string;
  source?: "map-picker" | "gps" | "manual" | string;
  accuracy?: number;
  confirmedAt?: TimestampMs;
  updatedAt?: TimestampMs;
}

export interface DeliveryProofHandoff {
  customerName?: string;
  signature?: string;
  otp?: string;
  otpVerified?: boolean;
  photoQualityWarning?: string;
  capturedAt?: TimestampMs;
}

export interface DeliveryProof {
  dataUrl?: ImageDataUrl | string;
  downloadUrl?: string;
  imageUrl?: string;
  storagePath?: string;
  storageBucket?: string;
  storageMode?: "database" | "storage";
  sizeBytes?: number;
  handoff?: DeliveryProofHandoff;
  riderId: EntityId;
  riderName?: string;
  orderId?: EntityId;
  createdAt: TimestampMs;
}

export interface Order {
  id: EntityId;
  customerId: EntityId;
  customerName: string;
  customerEmail?: string;
  phone?: string;
  phoneVerified?: boolean;
  phoneVerifiedAt?: TimestampMs | null;
  smsNotifications?: boolean;
  smsNotificationsRequested?: boolean;
  address?: string;
  landmark?: string;
  deliveryLocation?: DeliveryLocation | null;
  riderLocation?: DeliveryLocation | null;
  deliveryType: DeliveryType;
  diningOption?: DiningOption;
  notes?: string;
  items: CartItem[];
  subtotal: number;
  discount?: number;
  discountReason?: string;
  deliveryFee?: number;
  total: number;
  cashReceived?: number | null;
  changeDue?: number;
  paymentMethod: PaymentMethod;
  paymentStatus?: PaymentStatus;
  paymentProvider?: "paymongo" | PaymentMethod | string;
  paymentRequiredAt?: TimestampMs | null;
  paymentConfirmedAt?: TimestampMs | null;
  status: OrderStatus;
  source?: "online" | "walk-in-pos" | string;
  cashierId?: EntityId | null;
  cashierName?: string;
  riderId?: EntityId;
  riderName?: string;
  assignedAt?: TimestampMs;
  assignedBy?: EntityId | "system";
  assignmentMode?: "auto" | "manual";
  prepStartedAt?: TimestampMs;
  readyAt?: TimestampMs;
  deliveredAt?: TimestampMs;
  completedAt?: TimestampMs;
  cancelledAt?: TimestampMs;
  cancelledBy?: EntityId;
  cancelledByRole?: UserRole;
  cancelReason?: string;
  codCollectedAt?: TimestampMs;
  codHandoffRequestedAt?: TimestampMs;
  codHandoffRequestedBy?: EntityId;
  codRemittedAt?: TimestampMs;
  handoffOtp?: string | null;
  proofOfDeliveryRef?: string;
  proofOfDeliveryUrl?: string;
  proofOfDeliveryMeta?: DeliveryProofHandoff;
  deliveryIssue?: string;
  archivedAt?: TimestampMs;
  createdAt: TimestampMs;
  updatedAt?: TimestampMs;
}

export interface InventoryItem extends MenuItem {
  stock: number;
  reorderPoint: number;
  lowStock?: boolean;
  unavailable?: boolean;
}

export type ReviewModerationStatus = "pending" | "approved" | "hidden";

export interface Review {
  id: EntityId;
  orderId: EntityId;
  customerId: EntityId;
  customerName: string;
  rating: number;
  comment: string;
  items?: string[];
  moderationStatus: ReviewModerationStatus;
  reply?: string;
  moderatedAt?: TimestampMs;
  moderatedBy?: EntityId;
  createdAt: TimestampMs;
}

export type ComplaintStatus = "pending" | "reviewed" | "resolved" | "rejected";

export type ComplaintType =
  | "wrong_item"
  | "missing_item"
  | "late_delivery"
  | "food_quality"
  | "payment"
  | "service"
  | "other";

export interface Complaint {
  id: EntityId;
  orderId: EntityId;
  customerId: EntityId;
  customerName: string;
  type: ComplaintType | string;
  details: string;
  requestedResolution?: string;
  resolution?: string;
  status: ComplaintStatus;
  items?: string[];
  resolvedBy?: EntityId;
  resolverName?: string;
  reviewedAt?: TimestampMs;
  resolvedAt?: TimestampMs;
  createdAt: TimestampMs;
  updatedAt?: TimestampMs;
}

export type AuditAction =
  | "order_created"
  | "order_updated"
  | "orders_archived"
  | "menu_item_created"
  | "menu_item_updated"
  | "inventory_received"
  | "inventory_adjusted"
  | "review_moderated"
  | "complaint_created"
  | "complaint_updated"
  | "shift_started"
  | "shift_closed"
  | "approval_requested"
  | "approval_approved"
  | "approval_rejected"
  | "rider_auto_assigned"
  | `2fa_${string}`
  | `passkey_${string}`
  | string;

export interface AuditLog {
  id: EntityId;
  action: AuditAction;
  actorId?: EntityId;
  actorName?: string;
  actorRole?: UserRole | "system";
  orderId?: EntityId;
  itemId?: EntityId;
  itemName?: string;
  complaintId?: EntityId;
  reviewId?: EntityId;
  shiftLogId?: EntityId;
  approvalId?: EntityId;
  status?: string;
  reason?: string;
  total?: number;
  quantity?: number;
  details?: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  createdAt: TimestampMs;
}

export interface ShiftLog {
  id: EntityId;
  staffId: EntityId;
  staffName: string;
  startedAt: TimestampMs;
  endedAt: TimestampMs;
  openingCash: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  expenses: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  orderCount: number;
  notes?: string;
  createdAt: TimestampMs;
}

export interface ActiveShift {
  id: EntityId;
  staffId: EntityId;
  staffName: string;
  openingCash: number;
  notes?: string;
  startedAt: TimestampMs;
  createdAt: TimestampMs;
}

export type NotificationType =
  | "order"
  | "sale"
  | "delivery"
  | "inventory"
  | "review"
  | "complaint"
  | "shift"
  | "chat"
  | "system";

export interface Notification {
  id: EntityId;
  targetUserId?: EntityId;
  targetRole?: UserRole;
  title: string;
  message: string;
  type: NotificationType | string;
  orderId?: EntityId;
  readAt?: TimestampMs | null;
  createdAt: TimestampMs;
  expiresAt?: TimestampMs;
}

export interface AppUser {
  uid: EntityId;
  email: string | null;
  name: string;
  role: UserRole;
  staffRole?: StaffRole;
  emailVerified?: boolean;
  mfaVerified?: boolean;
  phone?: string;
  phoneVerified?: boolean;
  phoneVerifiedAt?: TimestampMs | null;
  smsNotifications?: boolean;
  smsNotificationsRequested?: boolean;
  address?: string;
  landmark?: string;
  deliveryLocation?: DeliveryLocation | null;
  notificationPreferences?: {
    orderUpdates?: boolean;
    promotions?: boolean;
  };
}
