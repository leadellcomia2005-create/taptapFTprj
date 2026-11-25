const dayMs = 24 * 60 * 60 * 1000;

const orderItems = (order) => Array.isArray(order?.items) ? order.items : [];
const itemQuantity = (item) => Math.max(0, Number(item?.qty || item?.quantity || 0));
const itemSales = (item) => itemQuantity(item) * Math.max(0, Number(item?.price || 0));

export function buildOwnerAnalysisScope({ orders = [], inventory = [], period = "30d", category = "all", now = Date.now(), isRevenueOrder = () => false }) {
  const periodStart = period === "today" ? new Date(now).setHours(0, 0, 0, 0)
    : period === "7d" ? now - 7 * dayMs
      : period === "30d" ? now - 30 * dayMs : 0;
  const selectedInventory = (category === "all" ? inventory : inventory.filter((item) => item.category === category)).slice(0, 250);
  const productKey = (name) => String(name || "").trim().toLowerCase();
  const categoryNames = new Set(selectedInventory.map((item) => productKey(item.name)));
  const inCategory = (item) => category === "all" || item.category === category || categoryNames.has(productKey(item.name));
  const inPeriod = (order) => {
    const createdAt = Number(order.createdAt || 0);
    return createdAt >= periodStart && createdAt <= now;
  };
  const projectOrder = (order) => {
    if (category === "all") return order;
    const items = orderItems(order).filter(inCategory);
    return items.length ? { ...order, items, total: Number(items.reduce((sum, item) => sum + itemSales(item), 0).toFixed(2)) } : null;
  };
  const salesOrders = orders.filter((order) => inPeriod(order) && isRevenueOrder(order)).map(projectOrder).filter(Boolean)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).slice(-500);
  const productSales = new Map();
  for (const order of salesOrders) {
    for (const item of orderItems(order)) {
      const name = productKey(item.name);
      if (!name) continue;
      productSales.set(name, (productSales.get(name) || 0) + itemQuantity(item));
    }
  }
  const stockRows = selectedInventory.map((item) => ({
    id: item.id,
    name: item.name,
    stock: Math.max(0, Number(item.stock) || 0),
    reorderPoint: Math.max(0, Number(item.reorderPoint) || 0),
    unavailable: item.unavailable === true,
    unitsSold: productSales.get(productKey(item.name)) || 0
  }));
  const stockRisks = stockRows.filter((item) => item.stock <= item.reorderPoint)
    .sort((a, b) => Number(b.stock === 0) - Number(a.stock === 0) || b.unitsSold - a.unitsSold || a.stock - b.stock);
  return {
    salesOrders,
    inventory: selectedInventory,
    evidence: {
      orderCount: salesOrders.length,
      stockRisks,
      inventoryCount: selectedInventory.length
    }
  };
}

export function summarizeInventory({ stockRisks, inventoryCount }) {
  if (!inventoryCount) return {
    summary: "No inventory records are available for this category.",
    action: "Select a category with inventory records."
  };
  const first = stockRisks[0];
  if (!first) return {
    summary: `All ${inventoryCount} tracked products are above their reorder points.`,
    action: "Continue checking stock counts during your regular inventory review."
  };
  const count = stockRisks.length;
  const stock = first.stock === 0 ? `${first.name} is out of stock.`
    : `${first.name} has ${first.stock} on hand, with a reorder point of ${first.reorderPoint}.`;
  return {
    summary: `${count} ${count === 1 ? "product is" : "products are"} at or below the reorder point. ${stock}`,
    action: `Check whether a restock for ${first.name} is already on the way before placing a replenishment order.`
  };
}
