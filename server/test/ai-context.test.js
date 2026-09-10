import test from "node:test";
import assert from "node:assert/strict";
import {
  answerCommonAssistantQuestion,
  buildAssistantContext,
  buildAssistantOrderContext,
  buildInventoryInsightContext,
  normalizeInventoryInsight
} from "../src/services.js";

test("assistant context keeps only public menu fields", () => {
  const context = buildAssistantContext({
    menu: [{ name: "Bangus Meal", description: "With rice", allergens: "Fish", stock: 4, supplierSecret: "hidden" }],
    customer: { phone: "09171234567", address: "Private address" }
  });

  assert.deepEqual(context, {
    menu: [{ name: "Bangus Meal", description: "With rice", allergens: "Fish", category: "", price: 0, available: true }],
    store: { hours: "", serviceArea: "", orderOptions: [], paymentMethods: [], prepTime: "" },
    orders: []
  });
  assert.equal(JSON.stringify(context).includes("09171234567"), false);
  assert.equal(JSON.stringify(context).includes("supplierSecret"), false);
});

test("assistant order context excludes customer, address, and payment details", () => {
  const context = buildAssistantOrderContext([{
    id: "-OrderPrivate4821",
    status: "out-for-delivery",
    deliveryType: "delivery",
    total: 445,
    createdAt: 123,
    customerName: "Private Customer",
    phone: "09171234567",
    address: "Private address",
    paymentReference: "secret-reference",
    items: [{ name: "Bangus Meal", qty: 2 }]
  }]);

  assert.deepEqual(context, [{
    reference: "TAP-TE4821",
    status: "out-for-delivery",
    orderType: "delivery",
    total: 445,
    itemCount: 2,
    createdAt: 123
  }]);
  const serialized = JSON.stringify(context);
  for (const privateValue of ["Private Customer", "09171234567", "Private address", "secret-reference"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("common assistant questions use supplied live context without an AI request", () => {
  const context = {
    menu: [{ name: "Bangus Meal", price: 99, stock: 4 }],
    store: {
      hours: "Daily: 10:00-21:00",
      serviceArea: "Las Pinas City",
      paymentMethods: ["cash", "cod"]
    },
    orders: [{ reference: "TAP-4821", status: "preparing", orderType: "delivery", total: 198, itemCount: 2 }]
  };

  assert.match(answerCommonAssistantQuestion("What meals are available?", context), /Bangus Meal \(PHP 99\)/);
  assert.match(answerCommonAssistantQuestion("Where is my order?", context), /TAP-4821 is currently preparing/);
  assert.match(answerCommonAssistantQuestion("How can I pay?", context), /cash, cod/);
  assert.match(answerCommonAssistantQuestion("Cancel my order and refund the payment", context), /cannot change orders, issue refunds/);
  assert.match(answerCommonAssistantQuestion("Here is my OTP", context), /never share passwords, one-time codes/);
});

test("inventory insight context excludes customer and payment information", () => {
  const context = buildInventoryInsightContext([
    {
      status: "delivered",
      total: 198,
      createdAt: Date.UTC(2026, 8, 9, 12),
      customerName: "Private Customer",
      phone: "09171234567",
      address: "Private address",
      paymentReference: "private-payment",
      items: [{ name: "Chicken Meal", qty: 2, price: 99 }]
    }
  ], [{ name: "Chicken Meal", category: "Rice meals", price: 99, stock: 8, reorderPoint: 5, unavailable: false, supplier: "Private Supplier" }]);

  assert.equal(context.grossSales, 198);
  assert.deepEqual(context.productSales, [{ name: "Chicken Meal", quantity: 2 }]);
  assert.deepEqual(context.inventory[0], {
    name: "Chicken Meal",
    category: "Rice meals",
    price: 99,
    stock: 8,
    reorderPoint: 5,
    unavailable: false
  });
  const serialized = JSON.stringify(context);
  for (const privateValue of ["Private Customer", "09171234567", "Private address", "private-payment", "Private Supplier"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("inventory insight keeps stock risks and reorder quantities authoritative", () => {
  const normalized = normalizeInventoryInsight({
    summary: "Model summary",
    salesTrend: "Model trend",
    peakPeriod: "No clear peak",
    ownerAction: "Review recommendations",
    stockRisks: [
      { product: "Bangus Meal", currentStock: 99, reorderPoint: 1, severity: "low", reason: "Low stock" },
      { product: "Chicken Meal", currentStock: 1, reorderPoint: 20, severity: "high", reason: "Incorrect model risk" }
    ],
    reorderRecommendations: [
      { product: "Bangus Meal", currentStock: 99, suggestedQuantity: 9999, reason: "Replenish" },
      { product: "Unknown Meal", currentStock: 0, suggestedQuantity: 9999, reason: "Invented product" }
    ],
    wasteRisks: [
      { product: "Bangus Meal", risk: "Incorrect waste risk", action: "Discount" },
      { product: "Chicken Meal", risk: "No recent sales", action: "Review demand" }
    ]
  }, {
    productSales: [{ name: "Bangus Meal", quantity: 6 }],
    inventory: [
      { name: "Bangus Meal", stock: 4, reorderPoint: 10, unavailable: false },
      { name: "Chicken Meal", stock: 30, reorderPoint: 8, unavailable: false }
    ]
  });

  assert.deepEqual(normalized.stockRisks, [{
    product: "Bangus Meal",
    currentStock: 4,
    reorderPoint: 10,
    severity: "high",
    reason: "Low stock"
  }]);
  assert.equal(normalized.reorderRecommendations[0].suggestedQuantity, 16);
  assert.deepEqual(normalized.wasteRisks, [{ product: "Chicken Meal", risk: "No recent sales", action: "Review demand" }]);
});
