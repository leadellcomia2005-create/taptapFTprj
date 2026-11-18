const dayMs = 24 * 60 * 60 * 1000;
const manilaOffsetMs = 8 * 60 * 60 * 1000;

const dateKey = (timestamp) => new Date(Number(timestamp || 0) + manilaOffsetMs).toISOString().slice(0, 10);
const dayKeyFromOffset = (timestamp, offset) => dateKey(Number(timestamp) + offset * dayMs);
const round = (value, digits = 0) => Number(Number(value || 0).toFixed(digits));
const percent = (value, total) => total > 0 ? round(value / total * 100, 1) : 0;
const validTime = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const manilaHourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "2-digit", hourCycle: "h23" });
const manilaWeekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "long" });

function buildBusinessPatterns(orders, inventory, now, isRevenueOrder) {
  const revenueOrders = orders.filter(isRevenueOrder).filter((order) => validTime(order.createdAt));
  const recent30 = revenueOrders.filter((order) => Number(order.createdAt) >= now - 30 * dayMs);
  const recent7 = revenueOrders.filter((order) => Number(order.createdAt) >= now - 7 * dayMs);
  const previous7 = revenueOrders.filter((order) => Number(order.createdAt) >= now - 14 * dayMs && Number(order.createdAt) < now - 7 * dayMs);
  const sales = (rows) => rows.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const productStats = new Map();
  const hourCounts = new Map();
  const weekdayStats = new Map();
  let unitsSold = 0;

  for (const order of recent30) {
    const hour = Number(manilaHourFormatter.format(new Date(Number(order.createdAt))));
    const weekday = manilaWeekdayFormatter.format(new Date(Number(order.createdAt)));
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    const day = weekdayStats.get(weekday) || { orders: 0, sales: 0 };
    day.orders += 1;
    day.sales += Number(order.total || 0);
    weekdayStats.set(weekday, day);
    for (const item of order.items || []) {
      const quantity = Number(item.qty || 0);
      const itemSales = quantity * Number(item.price || 0);
      unitsSold += quantity;
      const current = productStats.get(item.id) || { id: item.id, name: item.name || "Unnamed product", units: 0, sales: 0 };
      current.units += quantity;
      current.sales += itemSales;
      productStats.set(item.id, current);
    }
  }

  const products = [...productStats.values()].sort((a, b) => b.units - a.units);
  const topByRevenue = [...productStats.values()].sort((a, b) => b.sales - a.sales)[0] || null;
  const peakHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  const strongestWeekday = [...weekdayStats.entries()].sort((a, b) => b[1].sales - a[1].sales)[0] || null;
  const sevenDaySales = sales(recent7);
  const previousSevenDaySales = sales(previous7);
  const currentStockUnits = inventory.reduce((sum, item) => sum + Math.max(0, Number(item.stock || 0)), 0);

  return {
    sales: {
      dailyAverageSales: round(sales(recent30) / 30, 2),
      dailyAverageOrders: round(recent30.length / 30, 1),
      sevenDaySales: round(sevenDaySales, 2),
      thirtyDaySales: round(sales(recent30), 2),
      sevenDayGrowthPercent: previousSevenDaySales > 0 ? round((sevenDaySales - previousSevenDaySales) / previousSevenDaySales * 100, 1) : null,
      orderVolume: recent30.length,
      averageOrderValue: recent30.length ? round(sales(recent30) / recent30.length, 2) : 0,
      unitsSold,
      highestDemandProduct: products[0] ? { name: products[0].name, units: products[0].units } : null,
      highestRevenueProduct: topByRevenue ? { name: topByRevenue.name, sales: round(topByRevenue.sales, 2) } : null,
      peakHour: peakHour ? { hour: peakHour[0], orders: peakHour[1] } : null,
      strongestWeekday: strongestWeekday ? { day: strongestWeekday[0], sales: round(strongestWeekday[1].sales, 2), orders: strongestWeekday[1].orders } : null
    },
    inventory: {
      productsTracked: inventory.length,
      currentStockUnits,
      outOfStockCount: inventory.filter((item) => Number(item.stock || 0) <= 0 || item.unavailable).length,
      lowStockCount: inventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0)).length,
      thirtyDayUnitsSold: unitsSold,
      sellThroughPercent: unitsSold + currentStockUnits > 0 ? percent(unitsSold, unitsSold + currentStockUnits) : 0
    },
    unavailable: [
      { metric: "Ingredient consumption", reason: "Recipe and ingredient usage records are not available." },
      { metric: "Stock variance", reason: "Expected-versus-actual stock counts are not recorded." },
      { metric: "Waste and spoilage", reason: "Waste event records are not available." },
      { metric: "Inventory turnover", reason: "Historical stock valuation is not available." },
      { metric: "Reorder frequency", reason: "Purchase and receiving history is not available." },
      { metric: "Supplier lead time", reason: "Supplier order and arrival dates are not available." }
    ]
  };
}

function summarizeWindow(orders, startOffset, dayCount, now, isRevenueOrder) {
  const keys = new Set(Array.from({ length: dayCount }, (_, index) => dayKeyFromOffset(now, startOffset + index)));
  const scoped = orders.filter((order) => keys.has(dateKey(order.createdAt)));
  const revenue = scoped.filter(isRevenueOrder);
  const cancelled = scoped.filter((order) => order.status === "cancelled");
  const sales = revenue.reduce((sum, order) => sum + Number(order.total || 0), 0);
  return { orderCount: revenue.length, sales, cancelledCount: cancelled.length, allOrderCount: scoped.length };
}

function comparison(label, current, previous, destination = "owner-sales") {
  const delta = current.sales - previous.sales;
  return {
    label,
    currentSales: round(current.sales, 2),
    previousSales: round(previous.sales, 2),
    salesChange: round(delta, 2),
    salesChangePercent: previous.sales > 0 ? round(delta / previous.sales * 100, 1) : null,
    currentOrders: current.orderCount,
    previousOrders: previous.orderCount,
    destination
  };
}

function priority(id, title, value, threshold, weight, detail, action, role, deadline, destination) {
  const ratio = threshold > 0 ? value / threshold : value > 0 ? 2 : 0;
  const score = Math.min(100, Math.round(ratio * weight));
  return { id, title, value, score, detail, action, role, deadline, destination };
}

export function calculateOwnerDecisionSupport({ orders = [], inventory = [], complaints = [], shiftLogs = [], targets = {}, now = Date.now(), isRevenueOrder = () => false }) {
  const revenueOrders = orders.filter(isRevenueOrder);
  const cancelledOrders = orders.filter((order) => order.status === "cancelled");
  const paidCancellations = cancelledOrders.filter((order) => order.paymentStatus === "paid");
  const failedPayments = orders.filter((order) => order.paymentStatus === "failed");
  const paymentAttempts = orders.filter((order) => ["paid", "failed", "pending"].includes(order.paymentStatus));
  const openComplaints = complaints.filter((item) => !["resolved", "closed", "rejected"].includes(String(item.status || "pending").toLowerCase()));
  const delivered = orders.filter((order) => validTime(order.deliveredAt) && validTime(order.assignedAt || order.createdAt));
  const averageDeliveryMinutes = delivered.length
    ? delivered.reduce((sum, order) => sum + (Number(order.deliveredAt) - Number(order.assignedAt || order.createdAt)) / 60000, 0) / delivered.length
    : 0;
  const delayedDeliveryCount = delivered.filter((order) => (Number(order.deliveredAt) - Number(order.assignedAt || order.createdAt)) / 60000 > Number(targets.deliveryTargetMinutes || 45)).length;
  const overduePrepCount = orders.filter((order) => ["received", "preparing"].includes(order.status) && now - Number(order.prepStartedAt || order.createdAt || now) > Number(targets.prepTargetMinutes || 15) * 60000).length;
  const cashVariance = shiftLogs.reduce((sum, shift) => sum + Math.abs(Number(shift.variance || 0)), 0);
  const staffOrderCount = shiftLogs.reduce((sum, shift) => sum + Number(shift.orderCount || 0), 0);
  const cancellationReasonCounts = new Map();
  for (const order of cancelledOrders) {
    const reason = String(order.cancelReason || "Not recorded").trim().slice(0, 100) || "Not recorded";
    cancellationReasonCounts.set(reason, (cancellationReasonCounts.get(reason) || 0) + 1);
  }
  const lowStock = inventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0));
  const outOfStock = inventory.filter((item) => Number(item.stock || 0) <= 0 || item.unavailable);
  const latestDataAt = Math.max(0, ...orders.map((order) => Number(order.updatedAt || order.createdAt || 0)), ...inventory.map((item) => Number(item.updatedAt || 0)));
  const cancellationRate = percent(cancelledOrders.length, orders.length);
  const kpis = {
    grossSales: round(revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), 2),
    paidOrders: revenueOrders.length,
    averageOrderValue: revenueOrders.length ? round(revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0) / revenueOrders.length, 2) : 0,
    paymentSuccessRate: percent(paymentAttempts.filter((order) => order.paymentStatus === "paid").length, paymentAttempts.length),
    paymentFailureCount: failedPayments.length,
    cancellationCount: cancelledOrders.length,
    cancellationRate,
    cancelledOrderValue: round(cancelledOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), 2),
    paidCancellationReviewCount: paidCancellations.length,
    cancellationReasons: [...cancellationReasonCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    openComplaintCount: openComplaints.length,
    averageDeliveryMinutes: round(averageDeliveryMinutes, 1),
    delayedDeliveryCount,
    overduePrepCount,
    closedShiftCount: shiftLogs.length,
    staffOrderCount,
    averageOrdersPerShift: shiftLogs.length ? round(staffOrderCount / shiftLogs.length, 1) : 0,
    cashVariance: round(cashVariance, 2),
    lowStockCount: lowStock.length,
    outOfStockCount: outOfStock.length
  };
  const comparisons = [
    comparison("Today vs yesterday", summarizeWindow(orders, 0, 1, now, isRevenueOrder), summarizeWindow(orders, -1, 1, now, isRevenueOrder)),
    comparison("Last 7 days vs previous 7", summarizeWindow(orders, -6, 7, now, isRevenueOrder), summarizeWindow(orders, -13, 7, now, isRevenueOrder)),
    comparison("Last 30 days vs previous 30", summarizeWindow(orders, -29, 30, now, isRevenueOrder), summarizeWindow(orders, -59, 30, now, isRevenueOrder))
  ];
  const businessPatterns = buildBusinessPatterns(orders, inventory, now, isRevenueOrder);
  const priorities = [
    priority("paid-cancellations", "Paid cancellations", paidCancellations.length, 1, 60, "Cancelled paid orders require manual payment review.", "Review the payment record and document the outcome.", "Owner", "Today", "owner-reports"),
    priority("failed-payments", "Failed payments", failedPayments.length, 2, 45, "Failed online payments can block order completion.", "Review failed payment attempts and provider status.", "Owner", "Today", "owner-reports"),
    priority("cancellations", "Cancellation rate", cancellationRate, Number(targets.cancellationRateLimit || 5), 45, `${cancellationRate}% of loaded orders were cancelled.`, "Review cancellation reasons and affected products.", "Manager", "Within 24 hours", "owner-sales"),
    priority("complaints", "Open complaints", openComplaints.length, Number(targets.complaintLimit || 3), 50, "Unresolved customer complaints need a recorded decision.", "Review the complaint queue and record the resolution.", "Manager", "Today", "owner-reviews"),
    priority("prep-delays", "Preparation delays", overduePrepCount, 1, 45, `Orders exceeded the ${Number(targets.prepTargetMinutes || 15)}-minute preparation target.`, "Review the active kitchen queue and unblock delayed orders.", "Manager", "Now", "owner-sales"),
    priority("delivery-delays", "Delivery delays", delayedDeliveryCount, 1, 40, `Completed deliveries exceeded the ${Number(targets.deliveryTargetMinutes || 45)}-minute target.`, "Review assignment and route timing for delayed deliveries.", "Manager", "Within 24 hours", "owner-sales"),
    priority("stock", "Low stock", lowStock.length, Math.max(1, Math.ceil(inventory.length * .1)), 40, "Items are at or below their reorder points.", "Confirm counts and receive or reorder stock.", "Inventory staff", "Before next service", "owner-inventory"),
    priority("cash", "Cash variance", cashVariance, Number(targets.cashVarianceLimit || 100), 55, "Closed shifts contain absolute cash variance.", "Review shift close records and reconcile the variance.", "Owner", "Today", "owner-reports")
  ].filter((item) => item.value > 0).sort((a, b) => b.score - a.score).map((item) => ({
    ...item,
    level: item.score >= 80 ? "critical" : item.score >= 55 ? "high" : item.score >= 30 ? "medium" : "low"
  })).slice(0, 6);
  return {
    kpis,
    comparisons,
    businessPatterns,
    priorities,
    freshness: {
      latestDataAt,
      ageMinutes: latestDataAt ? Math.max(0, Math.round((now - latestDataAt) / 60000)) : null,
      stale: latestDataAt ? now - latestDataAt > 24 * 60 * 60 * 1000 : true
    }
  };
}
