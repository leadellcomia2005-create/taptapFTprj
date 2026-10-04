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

function dailySeries(orders, days, now, isRevenueOrder) {
  return Array.from({ length: days }, (_, index) => {
    const key = dayKeyFromOffset(now, index - (days - 1));
    const scoped = orders.filter((order) => dateKey(order.createdAt) === key && isRevenueOrder(order));
    return {
      date: key,
      sales: scoped.reduce((sum, order) => sum + Number(order.total || 0), 0),
      orders: scoped.length
    };
  });
}

function coefficientOfVariation(values) {
  if (!values.length) return Infinity;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (!mean) return Infinity;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function buildForecast(orders, inventory, now, isRevenueOrder) {
  const revenueOrders = orders.filter(isRevenueOrder).filter((order) => validTime(order.createdAt));
  const earliest = revenueOrders.reduce((value, order) => Math.min(value, Number(order.createdAt)), Infinity);
  const historyDays = Number.isFinite(earliest) ? Math.min(28, Math.max(1, Math.floor((now - earliest) / dayMs) + 1)) : 0;
  const series = dailySeries(revenueOrders, 28, now, isRevenueOrder);
  const observed = historyDays ? series.slice(-historyDays) : [];
  const recent7 = series.slice(-7);
  const earlier21 = series.slice(-28, -7);
  const recentSalesAverage = recent7.reduce((sum, row) => sum + row.sales, 0) / 7;
  const earlierSalesAverage = earlier21.reduce((sum, row) => sum + row.sales, 0) / 21;
  const recentOrderAverage = recent7.reduce((sum, row) => sum + row.orders, 0) / 7;
  const earlierOrderAverage = earlier21.reduce((sum, row) => sum + row.orders, 0) / 21;
  const variation = coefficientOfVariation(observed.map((row) => row.orders));
  const confidence = historyDays >= 28 && revenueOrders.length >= 50 && variation <= 1
    ? "strong"
    : historyDays >= 14 && revenueOrders.length >= 20
      ? "moderate"
      : "limited";
  const available = historyDays >= 7 && revenueOrders.length >= 10;
  const tomorrowSales = available ? recentSalesAverage * .7 + earlierSalesAverage * .3 : 0;
  const tomorrowOrders = available ? recentOrderAverage * .7 + earlierOrderAverage * .3 : 0;
  const productQuantities = new Map();
  for (const order of revenueOrders.filter((entry) => Number(entry.createdAt || 0) >= now - Math.max(7, historyDays) * dayMs)) {
    for (const item of order.items || []) {
      productQuantities.set(item.id, (productQuantities.get(item.id) || 0) + Number(item.qty || 0));
    }
  }
  const denominator = Math.max(1, historyDays);
  const products = inventory.map((item) => {
    const dailyDemand = (productQuantities.get(item.id) || 0) / denominator;
    const stock = Number(item.stock || 0);
    const reorderPoint = Number(item.reorderPoint || 0);
    return {
      id: item.id,
      name: item.name,
      dailyDemand: round(dailyDemand, 2),
      sevenDayDemand: round(dailyDemand * 7, 1),
      daysToDepletion: dailyDemand > 0 ? round(stock / dailyDemand, 1) : null,
      suggestedReorder: Math.max(0, Math.ceil(dailyDemand * 7 + reorderPoint - stock))
    };
  }).filter((item) => item.dailyDemand > 0).sort((a, b) => (a.daysToDepletion ?? Infinity) - (b.daysToDepletion ?? Infinity)).slice(0, 8);

  const shifts = [
    { label: "Morning", start: 6, end: 12 },
    { label: "Afternoon", start: 12, end: 18 },
    { label: "Evening", start: 18, end: 24 }
  ].map((shift) => {
    const count = revenueOrders.filter((order) => {
      const hour = Number(manilaHourFormatter.format(new Date(Number(order.createdAt || 0))));
      return hour >= shift.start && hour < shift.end;
    }).length;
    const expectedOrders = historyDays ? count / historyDays : 0;
    return { label: shift.label, expectedOrders: round(expectedOrders, 1), suggestedStaff: available ? Math.max(1, Math.ceil(expectedOrders / 8)) : null };
  });

  return {
    available,
    confidence,
    historyDays,
    analyzedOrders: revenueOrders.length,
    reason: available ? "Weighted moving average using the latest 28 days." : "At least 10 paid orders across 7 days are required for a reliable forecast.",
    tomorrow: { sales: round(tomorrowSales, 2), orders: round(tomorrowOrders, 1) },
    sevenDays: { sales: round(tomorrowSales * 7, 2), orders: round(tomorrowOrders * 7, 1) },
    products,
    staffing: shifts
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
  const forecast = buildForecast(orders, inventory, now, isRevenueOrder);
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
    forecast,
    priorities,
    freshness: {
      latestDataAt,
      ageMinutes: latestDataAt ? Math.max(0, Math.round((now - latestDataAt) / 60000)) : null,
      stale: latestDataAt ? now - latestDataAt > 24 * 60 * 60 * 1000 : true
    }
  };
}

export function evaluateForecastHistory(history = [], orders = [], now = Date.now(), isRevenueOrder = () => false) {
  const today = dateKey(now);
  const completed = (Array.isArray(history) ? history : []).filter((entry) => entry?.targetDate && entry.targetDate < today).map((entry) => {
    const actualOrders = orders.filter((order) => dateKey(order.createdAt) === entry.targetDate && isRevenueOrder(order));
    const actualSales = actualOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const salesErrorPercent = actualSales > 0 ? Math.abs(Number(entry.predictedSales || 0) - actualSales) / actualSales * 100 : Number(entry.predictedSales || 0) > 0 ? 100 : 0;
    const orderErrorPercent = actualOrders.length > 0 ? Math.abs(Number(entry.predictedOrders || 0) - actualOrders.length) / actualOrders.length * 100 : Number(entry.predictedOrders || 0) > 0 ? 100 : 0;
    return {
      targetDate: entry.targetDate,
      predictedSales: Number(entry.predictedSales || 0),
      actualSales: round(actualSales, 2),
      predictedOrders: Number(entry.predictedOrders || 0),
      actualOrders: actualOrders.length,
      salesErrorPercent: round(salesErrorPercent, 1),
      orderErrorPercent: round(orderErrorPercent, 1),
      accuracyPercent: round(Math.max(0, 100 - (salesErrorPercent + orderErrorPercent) / 2), 1)
    };
  }).sort((a, b) => b.targetDate.localeCompare(a.targetDate));
  return { completedCount: completed.length, latest: completed[0] || null, recent: completed.slice(0, 7) };
}

export function recordForecast(history = [], forecast, now = Date.now()) {
  const current = Array.isArray(history) ? history.filter((entry) => entry?.targetDate) : [];
  if (!forecast?.available) return current.slice(-60);
  const targetDate = dayKeyFromOffset(now, 1);
  const next = {
    targetDate,
    createdAt: now,
    predictedSales: Number(forecast.tomorrow?.sales || 0),
    predictedOrders: Number(forecast.tomorrow?.orders || 0),
    confidence: forecast.confidence
  };
  return [...current.filter((entry) => entry.targetDate !== targetDate), next].sort((a, b) => a.targetDate.localeCompare(b.targetDate)).slice(-60);
}

