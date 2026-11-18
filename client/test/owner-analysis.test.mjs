import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnerAnalysisScope, localAnalysisDiscussion } from "../src/utils/ownerAnalysis.js";

const day = 24 * 60 * 60 * 1000;
const now = new Date(2026, 10, 18, 12).getTime();
const inventory = [
  { name: "Bangus Meal", category: "Rice Meals", stock: 2, reorderPoint: 3 },
  { name: "Iced Tea", category: "Drinks", stock: 20, reorderPoint: 5 }
];
const paid = (createdAt, status = "paid") => ({
  createdAt, paymentStatus: status, total: 150,
  items: [{ name: "Bangus Meal", qty: 2, price: 60 }, { name: "Iced Tea", qty: 1, price: 30 }]
});
const isRevenueOrder = (order) => order.paymentStatus === "paid";

test("analysis category and period use the same paid product records", () => {
  const scope = buildOwnerAnalysisScope({
    orders: [paid(now - 2 * day), paid(now - 8 * day), paid(now - day, "pending")],
    inventory, period: "7d", category: "Rice Meals", now, isRevenueOrder
  });
  assert.equal(scope.orders.length, 2);
  assert.equal(scope.salesOrders.length, 1);
  assert.equal(scope.salesOrders[0].total, 120);
  assert.deepEqual(scope.salesOrders[0].items.map((item) => item.name), ["Bangus Meal"]);
  assert.equal(scope.evidence.sales, 120);
  assert.equal(scope.evidence.orderCount, 1);
  assert.equal(scope.evidence.lowStockCount, 1);
});

test("analysis omits a change claim when the preceding period has no paid orders", () => {
  const scope = buildOwnerAnalysisScope({ orders: [paid(now - day)], inventory, period: "7d", now, isRevenueOrder });
  assert.equal(scope.evidence.previousOrderCount, 0);
  assert.match(localAnalysisDiscussion(scope.evidence), /no comparable previous period/i);
});
