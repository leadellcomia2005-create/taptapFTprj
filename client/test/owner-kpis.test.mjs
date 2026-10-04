import test from "node:test";
import assert from "node:assert/strict";
import { calculateOwnerDecisionSupport, evaluateForecastHistory, recordForecast } from "../src/utils/ownerKpis.js";

const dayMs = 24 * 60 * 60 * 1000;
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

test("forecast requires enough history and returns deterministic demand", () => {
  const orders = Array.from({ length: 28 }, (_, index) => ({
    id: `order-${index}`,
    status: "completed",
    paymentStatus: "paid",
    total: 100,
    createdAt: now - index * dayMs,
    updatedAt: now,
    items: [{ id: "meal", name: "Meal", qty: 2 }]
  }));
  const inventory = [{ id: "meal", name: "Meal", stock: 10, reorderPoint: 5, updatedAt: now }];
  const result = calculateOwnerDecisionSupport({ orders, inventory, complaints: [], shiftLogs: [], now, isRevenueOrder });

  assert.equal(result.forecast.available, true);
  assert.equal(result.forecast.confidence, "moderate");
  assert.equal(result.forecast.tomorrow.sales, 100);
  assert.equal(result.forecast.sevenDays.orders, 7);
  assert.equal(result.forecast.products[0].dailyDemand, 2);
  assert.equal(result.forecast.products[0].daysToDepletion, 5);
  assert.equal(result.comparisons[1].currentSales, 700);
  assert.equal(result.comparisons[1].previousSales, 700);
});

test("forecast stays unavailable when history is insufficient", () => {
  const orders = [{ id: "one", status: "completed", paymentStatus: "paid", total: 100, createdAt: now, updatedAt: now, items: [] }];
  const result = calculateOwnerDecisionSupport({ orders, inventory: [], complaints: [], shiftLogs: [], now, isRevenueOrder });
  assert.equal(result.forecast.available, false);
  assert.equal(result.forecast.confidence, "limited");
  assert.equal(result.forecast.tomorrow.sales, 0);
});

test("forecast history compares completed predictions with actual results", () => {
  const targetDate = "2026-10-03";
  const history = [{ targetDate, predictedSales: 900, predictedOrders: 9, confidence: "moderate", createdAt: now - 2 * dayMs }];
  const orders = Array.from({ length: 10 }, (_, index) => ({ id: String(index), status: "completed", paymentStatus: "paid", total: 100, createdAt: Date.UTC(2026, 9, 3, 4 + index) }));
  const result = evaluateForecastHistory(history, orders, now, isRevenueOrder);
  assert.equal(result.completedCount, 1);
  assert.equal(result.latest.actualSales, 1000);
  assert.equal(result.latest.salesErrorPercent, 10);
  assert.equal(result.latest.accuracyPercent, 90);

  const recorded = recordForecast([], { available: true, confidence: "moderate", tomorrow: { sales: 500, orders: 5 } }, now);
  assert.equal(recorded[0].targetDate, "2026-10-05");
});
