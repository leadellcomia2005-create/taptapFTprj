const dayMs = 24 * 60 * 60 * 1000;

const orderItems = (order) => Array.isArray(order?.items) ? order.items : [];
const itemQuantity = (item) => Math.max(0, Number(item?.qty || item?.quantity || 0));
const itemSales = (item) => itemQuantity(item) * Math.max(0, Number(item?.price || 0));

export function buildOwnerAnalysisScope({ orders = [], inventory = [], period = "30d", category = "all", now = Date.now(), isRevenueOrder = () => false }) {
  const periodStart = period === "today" ? new Date(now).setHours(0, 0, 0, 0)
    : period === "7d" ? now - 7 * dayMs
      : period === "30d" ? now - 30 * dayMs : 0;
  const selectedInventory = (category === "all" ? inventory : inventory.filter((item) => item.category === category)).slice(0, 250);
  const categoryNames = new Set(selectedInventory.map((item) => String(item.name || "").toLowerCase()));
  const inCategory = (item) => category === "all" || item.category === category || categoryNames.has(String(item.name || "").toLowerCase());
  const inPeriod = (order) => !periodStart || Number(order.createdAt || 0) >= periodStart;
  const projectOrder = (order) => {
    if (category === "all") return order;
    const items = orderItems(order).filter(inCategory);
    return items.length ? { ...order, items, total: Number(items.reduce((sum, item) => sum + itemSales(item), 0).toFixed(2)) } : null;
  };
  const selectedOrders = orders.filter(inPeriod).map(projectOrder).filter(Boolean)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).slice(-500);
  const salesOrders = selectedOrders.filter(isRevenueOrder);
  const productSales = new Map();
  for (const order of salesOrders) {
    for (const item of orderItems(order)) {
      const name = String(item.name || "").trim();
      if (!name) continue;
      const current = productSales.get(name) || { name, units: 0, sales: 0 };
      current.units += itemQuantity(item);
      current.sales += itemSales(item);
      productSales.set(name, current);
    }
  }
  const topProduct = [...productSales.values()].sort((a, b) => b.units - a.units || b.sales - a.sales)[0] || null;
  const previousStart = periodStart && period !== "all" ? periodStart - (period === "today" ? dayMs : now - periodStart) : 0;
  const previousOrders = previousStart ? orders.filter((order) => Number(order.createdAt || 0) >= previousStart && Number(order.createdAt || 0) < periodStart)
    .map(projectOrder).filter(Boolean).filter(isRevenueOrder) : [];
  const previousSales = previousOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  return {
    orders: selectedOrders,
    salesOrders,
    inventory: selectedInventory,
    evidence: {
      period,
      category,
      startAt: periodStart || Math.min(...selectedOrders.map((order) => Number(order.createdAt || now)), now),
      endAt: now,
      orderCount: salesOrders.length,
      sales: Number(salesOrders.reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2)),
      unitsSold: [...productSales.values()].reduce((sum, item) => sum + item.units, 0),
      topProduct,
      previousOrderCount: previousOrders.length,
      previousSales: Number(previousSales.toFixed(2)),
      lowStockCount: selectedInventory.filter((item) => Number(item.stock || 0) <= Number(item.reorderPoint || 0)).length,
      inventoryCount: selectedInventory.length
    }
  };
}

export function localAnalysisDiscussion(evidence) {
  const scope = evidence.category === "all" ? "all products" : evidence.category;
  const best = evidence.topProduct ? `${evidence.topProduct.name} had the most units sold, with ${evidence.topProduct.units} units.` : "No product sales were recorded.";
  const comparison = evidence.previousOrderCount > 0
    ? `The comparable preceding period had ${evidence.previousOrderCount} paid orders.`
    : "There is no comparable previous period with paid orders, so a change cannot be established.";
  return `For ${scope}, ${evidence.orderCount} paid orders are included. ${best} ${comparison} ${evidence.lowStockCount} of ${evidence.inventoryCount} tracked products are at or below their reorder points. Review the recorded stock counts before making a replenishment decision.`;
}
