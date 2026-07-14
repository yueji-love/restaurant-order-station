import { completedOrdersInRange } from './analytics.js';

const CHINA_TIME_ZONE = 'Asia/Shanghai';
const chinaTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: CHINA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function orderQuantity(order) {
  return Number.isInteger(order.quantity) && order.quantity >= 1 ? order.quantity : 1;
}

function timestampDetails(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { iso: '', china: '' };
  const parts = Object.fromEntries(
    chinaTimeFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    iso: date.toISOString(),
    china: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function elapsedSeconds(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

function enrichOrder(order) {
  const quantity = orderQuantity(order);
  const addOns = Array.isArray(order.addOns) ? order.addOns : [];
  const dishPriceCents = Number.isInteger(order.priceCents) ? order.priceCents : 0;
  const addOnUnitCents = addOns.reduce(
    (total, addOn) => total + (Number.isInteger(addOn.priceCents) ? addOn.priceCents : 0),
    0,
  );
  const unitTotalCents = dishPriceCents + addOnUnitCents;
  const totalCents = Number.isInteger(order.totalCents) ? order.totalCents : unitTotalCents * quantity;
  const created = timestampDetails(order.createdAt);
  const started = timestampDetails(order.startedAt);
  const completed = timestampDetails(order.completedAt);

  return {
    ...order,
    quantity,
    totalCents,
    exportAnalysis: {
      timezone: CHINA_TIME_ZONE,
      createdAtChina: created.china,
      startedAtChina: started.china,
      completedAtChina: completed.china,
      waitingSeconds: elapsedSeconds(order.createdAt, order.startedAt),
      cookingSeconds: elapsedSeconds(order.startedAt, order.completedAt),
      totalServiceSeconds: elapsedSeconds(order.createdAt, order.completedAt),
      dishPriceCents,
      addOnUnitCents,
      unitTotalCents,
      totalCents,
    },
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

function serializeCsv(orders) {
  const headers = [
    '订单ID',
    '号牌',
    '状态',
    '菜品ID',
    '菜品分组',
    '菜品名称',
    '份数',
    '菜品单价(分)',
    '菜品单价(元)',
    '小料名称',
    '小料明细JSON',
    '单份小料金额(分)',
    '单份金额(分)',
    '订单总额(分)',
    '订单总额(元)',
    '下单时间(北京时间)',
    '开始制作时间(北京时间)',
    '完成取餐时间(北京时间)',
    '下单时间ISO',
    '开始制作时间ISO',
    '完成取餐时间ISO',
    '等待制作秒数',
    '制作耗时秒数',
    '总耗时秒数',
    '原始订单JSON',
  ];
  const rows = orders.map((order) => {
    const analysis = order.exportAnalysis;
    const addOns = Array.isArray(order.addOns) ? order.addOns : [];
    const rawOrder = { ...order };
    delete rawOrder.exportAnalysis;
    return csvRow([
      order.id,
      order.number,
      order.status,
      order.dishId,
      order.dishGroup || '未分类',
      order.category,
      order.quantity,
      analysis.dishPriceCents,
      (analysis.dishPriceCents / 100).toFixed(2),
      addOns.map((item) => item.name).join('、'),
      JSON.stringify(addOns),
      analysis.addOnUnitCents,
      analysis.unitTotalCents,
      analysis.totalCents,
      (analysis.totalCents / 100).toFixed(2),
      analysis.createdAtChina,
      analysis.startedAtChina,
      analysis.completedAtChina,
      order.createdAt,
      order.startedAt,
      order.completedAt,
      analysis.waitingSeconds,
      analysis.cookingSeconds,
      analysis.totalServiceSeconds,
      JSON.stringify(rawOrder),
    ]);
  });
  return `\uFEFF${[csvRow(headers), ...rows].join('\r\n')}\r\n`;
}

function compactChinaDate(value) {
  return timestampDetails(value).china.slice(0, 10).replaceAll('-', '');
}

function exportFilename(from, to, format) {
  const inclusiveEnd = new Date(to - 1);
  return `orders-${compactChinaDate(from)}-${compactChinaDate(inclusiveEnd)}.${format}`;
}

export function buildOrderExport({ history, from, to, format, user }) {
  const orders = completedOrdersInRange(history, from, to).map(enrichOrder);
  const filename = exportFilename(from, to, format);
  if (format === 'csv') {
    return {
      filename,
      contentType: 'text/csv; charset=utf-8',
      body: serializeCsv(orders),
      orderCount: orders.length,
    };
  }
  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    merchant: { id: user.id, username: user.username },
    range: {
      from: new Date(from).toISOString(),
      toExclusive: new Date(to).toISOString(),
      basis: 'completedAt',
      timezone: CHINA_TIME_ZONE,
    },
    orderCount: orders.length,
    orders,
  };
  return {
    filename,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload, null, 2),
    orderCount: orders.length,
  };
}
