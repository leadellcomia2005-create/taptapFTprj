import { currency as displayCurrency, statusLabel as displayStatusLabel } from "../../utils/display";

let helpers = {};

export const setWorkspaceHelpers = (nextHelpers = {}) => {
  helpers = nextHelpers || {};
};

const call = (name, fallback) => (...args) => (helpers[name] || fallback)(...args);

export const currency = call("currency", displayCurrency);
export const statusLabel = call("statusLabel", displayStatusLabel);
export const isRevenueOrder = call("isRevenueOrder", () => false);
export const isUnremittedCod = call("isUnremittedCod", () => false);
export const localDateInputValue = call("localDateInputValue", () => new Date().toISOString().slice(0, 10));
export const reportDateRange = call("reportDateRange", () => ({ start: 0, end: Date.now() }));
export const inRange = call("inRange", () => false);
export const buildDailyReport = call("buildDailyReport", () => ({
  dateLabel: "Today",
  grossSales: 0,
  dailyOrders: [],
  pendingOrders: [],
  cancelledOrders: [],
  unremittedCodOrders: [],
  closedShifts: [],
  topItems: [],
  paymentBreakdown: { cash: 0, cod: 0, online: 0, pending: 0, codExposure: 0 }
}));
export const buildLocalDecisionSupport = call("buildLocalDecisionSupport", () => "Sales and inventory data is still loading.");
export const printOwnerDailyReport = call("printOwnerDailyReport", () => false);
export const sumByTotal = call("sumByTotal", (orders = []) => orders.reduce((sum, order) => sum + Number(order.total || 0), 0));
export const orderItemText = call("orderItemText", (order) => (order?.items || []).map((item) => String(item.qty || 0) + " x " + item.name).join(", ") || "No items");
export const orderPaymentLabel = call("orderPaymentLabel", (order) => String(order?.paymentMethod || "unknown").toUpperCase());
export const printReceipt = call("printReceipt", () => false);
