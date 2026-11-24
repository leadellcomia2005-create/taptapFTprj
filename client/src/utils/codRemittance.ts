import type { Order } from "../types/domain";

export type CodRemittanceStatus =
  | "cash-pending"
  | "ready"
  | "awaiting-owner"
  | "remitted"
  | "disputed";

export function isCodDelivery(order: Partial<Order>): boolean {
  return order.paymentMethod === "cod" && order.deliveryType === "delivery";
}

export function codRemittanceStatus(order: Partial<Order>): CodRemittanceStatus {
  if (order.codRemittedAt) return "remitted";
  if (order.codDiscrepancy?.status === "open") return "disputed";
  if (order.codHandoffRequestedAt) return "awaiting-owner";
  if (order.status === "delivered") return "ready";
  return "cash-pending";
}

export const codRemittanceStatusLabels: Record<CodRemittanceStatus, string> = {
  "cash-pending": "Cash collection pending",
  ready: "Ready to hand over",
  "awaiting-owner": "Awaiting owner confirmation",
  remitted: "Remitted",
  disputed: "Disputed"
};

export function codRemittanceStatusLabel(order: Partial<Order>): string {
  return codRemittanceStatusLabels[codRemittanceStatus(order)];
}

export function remittanceTimestamp(value: unknown): string {
  const timestamp = Number(value || 0);
  if (!timestamp) return "Not recorded";
  return new Date(timestamp).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}
