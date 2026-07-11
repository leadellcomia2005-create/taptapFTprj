import { currency as displayCurrency, statusLabel as displayStatusLabel } from "../../utils/display";
import type { Order } from "../../types/domain";

type AnyFunction = (...args: any[]) => any;
type WorkspaceHelperMap = Partial<Record<string, AnyFunction>>;
type DateRange = { start: number; end: number };

let helpers: WorkspaceHelperMap = {};

export const setWorkspaceHelpers = (nextHelpers: WorkspaceHelperMap = {}) => {
  helpers = nextHelpers || {};
};

const call = <T extends AnyFunction>(name: string, fallback: T): T => (
  (...args: Parameters<T>): ReturnType<T> => {
    const helper = helpers[name] as T | undefined;
    return (helper || fallback)(...args) as ReturnType<T>;
  }
) as T;

export const currency = call<typeof displayCurrency>("currency", displayCurrency);
export const statusLabel = call<typeof displayStatusLabel>("statusLabel", displayStatusLabel);
export const isRevenueOrder = call("isRevenueOrder", (_order?: Partial<Order>) => false);
export const isUnremittedCod = call("isUnremittedCod", (_order?: Partial<Order>) => false);
export const localDateInputValue = call("localDateInputValue", () => new Date().toISOString().slice(0, 10));
export const reportDateRange = call("reportDateRange", (): DateRange => ({ start: 0, end: Date.now() }));
export const inRange = call("inRange", (_value?: unknown, _range?: DateRange) => false);
export const buildDailyReport = call("buildDailyReport", () => ({
  dateLabel: "Today",
  grossSales: 0,
  dailyOrders: [],
  pendingOrders: [],
  cancelledOrders: [],
  completedOrders: [],
  deliveredOrders: [],
  unremittedCodOrders: [],
  orderTypeBreakdown: {},
  closedShifts: [],
  topItems: [],
  paymentBreakdown: { cash: 0, cod: 0, online: 0, pending: 0, codExposure: 0 }
}));
export const buildLocalDecisionSupport = call("buildLocalDecisionSupport", () => "Sales and inventory data is still loading.");
export const printOwnerDailyReport = call("printOwnerDailyReport", () => false);
export const sumByTotal = call("sumByTotal", (orders: Array<Partial<Pick<Order, "total">>> = []) => orders.reduce((sum, order) => sum + Number(order.total || 0), 0));
export const orderItemText = call("orderItemText", (order?: Partial<Pick<Order, "items">> | null) => (
  order?.items || []
).map((item) => String(item.qty || 0) + " x " + item.name).join(", ") || "No items");
export const orderPaymentLabel = call("orderPaymentLabel", (order?: Partial<Pick<Order, "paymentMethod">> | null) => String(order?.paymentMethod || "unknown").toUpperCase());
export const printReceipt = call("printReceipt", (_order?: Partial<Order>) => false);
