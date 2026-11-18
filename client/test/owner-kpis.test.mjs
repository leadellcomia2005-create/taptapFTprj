import test from "node:test";
import assert from "node:assert/strict";
import { calculateOwnerDecisionSupport } from "../src/utils/ownerKpis.js";

const now = Date.UTC(2026, 9, 4, 12);
const isRevenueOrder = (order) => order.status !== "cancelled" && order.paymentStatus === "paid";

test("owner decision support reports cancellation without refund claims", () => {
  const orders = [
    { id: "paid", status: "completed", paymentStatus: "paid", total: 200, createdAt: now, updatedAt: now, items: [{ id: "meal", name: "Meal", qty: 2 }] },
    { id: "cancelled", status: "cancelled", paymentStatus: "paid", total: 100, createdAt: now, updatedAt: now, cancelReason: "Customer request", items: [] },
    { id: "failed", status: "pending-payment", paymentStatus: "failed", total: 100, createdAt: now, updatedAt: now, items: [] }
  ];
  const result = calculateOwnerDecisionSupport({ orders, inventory: [], complaints: [], shiftLogs: [], now, isRevenueOrder });

  assert.equal(result.kpis.cancellationCount, 1);
  assert.equal(result.kpis.paidCancellationReviewCount, 1);
  assert.equal(result.kpis.cancelledOrderValue, 100);
  assert.equal(result.priorities.some((item) => item.id === "paid-cancellations"), true);
  assert.equal(JSON.stringify(result).toLowerCase().includes("refund"), false);
});

test("business patterns use paid sales and disclose unsupported inventory metrics", () => {
  const orders = [
    { id: "one", status: "completed", paymentStatus: "paid", total: 300, createdAt: now, updatedAt: now, items: [{ id: "meal", name: "Meal", qty: 2, price: 150 }] },
    { id: "two", status: "cancelled", paymentStatus: "paid", total: 999, createdAt: now, updatedAt: now, items: [{ id: "ignored", name: "Ignored", qty: 10, price: 99.9 }] }
  ];
  const inventory = [{ id: "meal", name: "Meal", stock: 8, reorderPoint: 5, updatedAt: now }];
  const result = calculateOwnerDecisionSupport({ orders, inventory, complaints: [], shiftLogs: [], now, isRevenueOrder });

  assert.equal(result.businessPatterns.sales.thirtyDaySales, 300);
  assert.equal(result.businessPatterns.sales.unitsSold, 2);
  assert.deepEqual(result.businessPatterns.sales.highestDemandProduct, { name: "Meal", units: 2 });
  assert.deepEqual(result.businessPatterns.sales.highestRevenueProduct, { name: "Meal", sales: 300 });
  assert.equal(result.businessPatterns.inventory.currentStockUnits, 8);
  assert.equal(result.businessPatterns.unavailable.some((item) => item.metric === "Waste and spoilage"), true);
});
