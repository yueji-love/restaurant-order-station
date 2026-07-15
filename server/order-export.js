import { settledBillsInRange } from './analytics.js';

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

function yuan(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2);
}

function enrichItem(item) {
  const created = timestampDetails(item.createdAt);
  const started = timestampDetails(item.startedAt);
  const completed = timestampDetails(item.completedAt);
  return {
    id: item.id,
    sourceDishId: item.sourceDishId,
    category: item.dishGroup || '未分类',
    dishName: item.dishName || item.category,
    dishNote: item.dishNote || '',
    quantity: item.quantity ?? 1,
    status: item.status,
    basePriceYuan: yuan(item.priceCents),
    addOnUnitYuan: yuan(item.addOnUnitCents),
    unitTotalYuan: yuan(item.unitTotalCents),
    lineTotalYuan: yuan(item.totalCents),
    addOns: (item.addOns ?? []).map((addOn) => ({
      id: addOn.id,
      name: addOn.name,
      priceYuan: yuan(addOn.priceCents),
    })),
    createdAt: created.iso,
    createdAtChina: created.china,
    startedAt: started.iso,
    startedAtChina: started.china,
    completedAt: completed.iso,
    completedAtChina: completed.china,
    waitingSeconds: elapsedSeconds(item.createdAt, item.startedAt),
    cookingSeconds: elapsedSeconds(item.startedAt, item.completedAt),
    totalServiceSeconds: elapsedSeconds(item.createdAt, item.completedAt),
  };
}

function enrichBill(bill) {
  const opened = timestampDetails(bill.openedAt);
  const settled = timestampDetails(bill.settledAt);
  return {
    id: bill.id,
    number: bill.number,
    status: bill.status,
    totalYuan: yuan(bill.totalCents),
    openedAt: opened.iso,
    openedAtChina: opened.china,
    settledAt: settled.iso,
    settledAtChina: settled.china,
    totalServiceSeconds: elapsedSeconds(bill.openedAt, bill.settledAt),
    items: (bill.items ?? []).map(enrichItem),
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

function serializeCsv(bills) {
  const headers = [
    '账单ID', '号牌', '结算状态', '账单总额（元）', '开单时间（北京时间）', '结算时间（北京时间）',
    '菜品任务ID', '菜品ID', '菜品大类', '菜品名称', '菜品说明', '份数',
    '基础单价（元）', '单份小料金额（元）', '单份合计（元）', '任务合计（元）',
    '小料名称', '小料明细JSON', '制作状态', '下单时间（北京时间）', '开始制作时间（北京时间）',
    '完成制作时间（北京时间）', '开单时间ISO', '结算时间ISO', '下单时间ISO', '开始制作时间ISO',
    '完成制作时间ISO', '等待制作秒数', '制作耗时秒数', '菜品总耗时秒数', '账单总耗时秒数',
  ];
  const rows = bills.flatMap((bill) => bill.items.map((item) => csvRow([
    bill.id, bill.number, bill.status, bill.totalYuan, bill.openedAtChina, bill.settledAtChina,
    item.id, item.sourceDishId, item.category, item.dishName, item.dishNote, item.quantity,
    item.basePriceYuan, item.addOnUnitYuan, item.unitTotalYuan, item.lineTotalYuan,
    item.addOns.map((addOn) => addOn.name).join('、'), JSON.stringify(item.addOns), item.status,
    item.createdAtChina, item.startedAtChina, item.completedAtChina,
    bill.openedAt, bill.settledAt, item.createdAt, item.startedAt, item.completedAt,
    item.waitingSeconds, item.cookingSeconds, item.totalServiceSeconds, bill.totalServiceSeconds,
  ])));
  return `\uFEFF${[csvRow(headers), ...rows].join('\r\n')}\r\n`;
}

function compactChinaDate(value) {
  return timestampDetails(value).china.slice(0, 10).replaceAll('-', '');
}

function exportFilename(from, to, format) {
  return `orders-${compactChinaDate(from)}-${compactChinaDate(new Date(to - 1))}.${format}`;
}

export function buildOrderExport({ bills: sourceBills, from, to, format, user }) {
  const bills = settledBillsInRange(sourceBills, from, to).map(enrichBill);
  const filename = exportFilename(from, to, format);
  if (format === 'csv') {
    return {
      filename,
      contentType: 'text/csv; charset=utf-8',
      body: serializeCsv(bills),
      orderCount: bills.length,
    };
  }
  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    merchant: { username: user.username },
    range: {
      from: new Date(from).toISOString(),
      toExclusive: new Date(to).toISOString(),
      basis: 'settledAt',
      timezone: CHINA_TIME_ZONE,
    },
    billCount: bills.length,
    itemCount: bills.reduce((sum, bill) => sum + bill.items.length, 0),
    bills,
  };
  return {
    filename,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(payload, null, 2),
    orderCount: bills.length,
  };
}
