function aggregateBy(items, keySelector, valueSelector = () => 1) {
  const totals = new Map();
  items.forEach((item) => {
    const key = keySelector(item);
    if (!key) return;
    totals.set(key, (totals.get(key) ?? 0) + valueSelector(item));
  });
  return [...totals.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function orderQuantity(order) {
  return Number.isInteger(order.quantity) && order.quantity >= 1 ? order.quantity : 1;
}

export function buildAnalytics(history, from, to) {
  const orders = completedOrdersInRange(history, from, to);
  const revenueCents = orders.reduce((sum, order) => sum + (order.totalCents ?? 0), 0);
  const addOnRows = orders.flatMap((order) => (
    (order.addOns ?? []).map((addOn) => ({ ...addOn, quantity: orderQuantity(order) }))
  ));
  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    summary: {
      revenueCents,
      orderCount: orders.length,
      averageOrderCents: orders.length ? Math.round(revenueCents / orders.length) : 0,
      addOnCount: addOnRows.reduce((sum, addOn) => sum + addOn.quantity, 0),
    },
    categories: aggregateBy(orders, (order) => order.dishGroup || '未分类', orderQuantity),
    dishes: aggregateBy(orders, (order) => order.category, orderQuantity),
    addOns: aggregateBy(addOnRows, (addOn) => addOn.name, (addOn) => addOn.quantity),
  };
}

export function completedOrdersInRange(history, from, to) {
  return history.filter((order) => {
    const completedAt = Date.parse(order.completedAt);
    return Number.isFinite(completedAt) && completedAt >= from && completedAt < to;
  });
}
