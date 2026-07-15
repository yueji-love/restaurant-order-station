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

export function settledBillsInRange(bills, from, to) {
  return bills.filter((bill) => {
    const settledAt = Date.parse(bill.settledAt);
    return bill.status === 'settled' && Number.isFinite(settledAt) && settledAt >= from && settledAt < to;
  });
}

export function buildAnalytics(sourceBills, from, to) {
  const bills = settledBillsInRange(sourceBills, from, to);
  const items = bills.flatMap((bill) => bill.items ?? []);
  const revenueCents = bills.reduce((sum, bill) => sum + (bill.totalCents ?? 0), 0);
  const addOnRows = items.flatMap((item) => (item.addOns ?? []).map((addOn) => ({
    ...addOn,
    quantity: item.quantity ?? 1,
  })));
  return {
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    summary: {
      revenueCents,
      orderCount: bills.length,
      averageOrderCents: bills.length ? Math.round(revenueCents / bills.length) : 0,
      dishCount: items.reduce((sum, item) => sum + (item.quantity ?? 1), 0),
    },
    categories: aggregateBy(items, (item) => item.dishGroup || '未分类', (item) => item.quantity ?? 1),
    dishes: aggregateBy(items, (item) => item.dishName || item.category, (item) => item.quantity ?? 1),
    addOns: aggregateBy(addOnRows, (item) => item.name, (item) => item.quantity),
  };
}
