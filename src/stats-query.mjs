import { randomUUID } from "node:crypto";
import { requestLayaChoices } from "./agent/laya.mjs";

const DAY = 86_400_000;
const TOOLS = ["query_daily_sales", "query_top_products"];
const METRICS = ["revenue", "quantity"];
const CHARTS = ["bar", "line", "table"];
const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
const dayKey = value => new Date(Date.parse(value) + 7 * 3_600_000).toISOString().slice(0, 10);
const offsetDate = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * DAY).toISOString().slice(0, 10);

export function validateStatsPlan(plan) {
  if (!plan || !TOOLS.includes(plan.tool) || !METRICS.includes(plan.metric) || !CHARTS.includes(plan.chart) ||
      !Number.isInteger(plan.limit) || plan.limit < 1 || plan.limit > 50 || plan.timeZone !== "Asia/Bangkok") throw new Error("Invalid statistics query plan");
  for (const key of ["startDate", "endDate"]) {
    if (typeof plan[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(plan[key]) ||
        !Number.isFinite(Date.parse(plan[key])) || new Date(plan[key]).toISOString().slice(0, 10) !== plan[key]) throw new Error("Invalid query date");
  }
  const days = (Date.parse(plan.endDate) - Date.parse(plan.startDate)) / DAY + 1;
  if (days < 1 || days > 366) throw new Error("Query period must be 1–366 days");
  return plan;
}

export function statsParameters(message, previousPlan, now = new Date().toISOString()) {
  if (typeof message !== "string" || !message.trim() || message.length > 1000) throw new Error("กรุณาพิมพ์คำถาม 1–1,000 ตัวอักษร");
  if (previousPlan !== undefined) validateStatsPlan(previousPlan);
  const text = message.normalize("NFC").toLowerCase().replace(/[๐-๙]/g, digit => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)));
  if (/ลบข้อมูล|ลบยอดขาย|แก้ไขยอด|\b(delete|drop|insert|truncate)\b/.test(text)) throw new Error("Stat Query อ่านสถิติได้เท่านั้น ไม่รองรับการแก้ไขหรือลบข้อมูล");
  if (/รายเดือน|รายปี|รายชั่วโมง|กำไร|พยากรณ์|\b(monthly|yearly|hourly|profit|forecast)\b/.test(text)) throw new Error("ตอนนี้รองรับยอดขายรายวันและอันดับสินค้า กรุณาระบุช่วงเวลาเป็นวันหรือวันที่");
  const today = dayKey(now);
  if (/\d{1,2}[\/]\d{1,2}[\/]\d{2,4}/.test(text)) throw new Error("กรุณาระบุวันที่แบบ YYYY-MM-DD");
  let startDate = previousPlan?.startDate || offsetDate(today, -6);
  let endDate = previousPlan?.endDate || today;
  const dates = text.match(/\d{4}-\d{2}-\d{2}/g);
  const duration = text.match(/(\d+)\s*(วัน|days?|สัปดาห์|weeks?|เดือน|months?)/);
  if (dates) {
    if (dates.length > 2) throw new Error("ระบุวันที่ ISO ได้สูงสุดสองวัน");
    [startDate, endDate] = [dates[0], dates[1] || dates[0]];
  } else if (/เมื่อวาน|yesterday/.test(text)) startDate = endDate = offsetDate(today, -1);
  else if (/วันนี้|today/.test(text)) startDate = endDate = today;
  else if (/เดือนนี้|this month/.test(text)) { startDate = today.slice(0, 7) + "-01"; endDate = today; }
  else if (/สัปดาห์นี้|this week|สัปดาห์ที่แล้ว|last week/.test(text)) {
    const weekday = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7;
    startDate = offsetDate(today, -weekday); endDate = today;
    if (/สัปดาห์ที่แล้ว|last week/.test(text)) { endDate = offsetDate(startDate, -1); startDate = offsetDate(startDate, -7); }
  }
  else if (duration || /สัปดาห์|week/.test(text)) {
    const amount = Number(duration?.[1] || 1);
    const unit = duration?.[2] || "week";
    const days = amount * (/สัปดาห์|week/.test(unit) ? 7 : /เดือน|month/.test(unit) ? 30 : 1);
    if (!Number.isSafeInteger(days) || days < 1 || days > 366) throw new Error("รองรับย้อนหลัง 1–366 วัน");
    startDate = offsetDate(today, 1 - days); endDate = today;
  }
  const top = text.match(/(?:top\s*|อันดับ\s*(?:แรก\s*)?)(\d+)/) || text.match(/(\d+)\s*อันดับ/);
  const limit = top ? Number(top[1]) : previousPlan?.limit || 10;
  const plan = { tool: previousPlan?.tool || "query_daily_sales", metric: previousPlan?.metric || "revenue", chart: previousPlan?.chart || "bar", startDate, endDate, limit, timeZone: "Asia/Bangkok" };
  validateStatsPlan(plan);
  if (endDate > today) throw new Error("ช่วงเวลาต้องไม่เกินวันนี้ตามเวลาไทย");
  const hints = {
    tool: /\btop(?:\b|\d)|ขายดี|อันดับ/.test(text) ? "query_top_products" : /รายวัน|daily|ยอดขาย|sales/.test(text) ? "query_daily_sales" : null,
    metric: /จำนวนชิ้น|จำนวนสินค้า|ปริมาณ|\bunits?\b|quantity/.test(text) ? "quantity" : /ยอดเงิน|รายได้|ยอดขาย|revenue/.test(text) ? "revenue" : null,
    chart: /กราฟเส้น|\bline\b/.test(text) ? "line" : /ตาราง|\btable\b/.test(text) ? "table" : /กราฟแท่ง|\bbar\b/.test(text) ? "bar" : null,
  };
  return { message: message.trim(), defaults: plan, hints };
}

export async function planStatsQuery({ message, previousPlan, now, ...options }) {
  const context = statsParameters(message, previousPlan, now);
  const result = await requestLayaChoices({ ...options, state: { originalRequest: context.message,
    normalizedRequest: { query: context.hints.tool || previousPlan?.tool || "Not specified; infer from originalRequest",
      metric: context.hints.metric || context.defaults.metric, chart: context.hints.chart || context.defaults.chart,
      dateRange: [context.defaults.startDate, context.defaults.endDate], topN: context.defaults.limit },
    schema: "Read-only completed checkout orders: createdAt, total, lines(sku,name,quantity,subtotal). No pending carts." },
    questions: {
      tool: choice("Select a read-only sales query for the request. Follow the previous query for a chart-only follow-up. Unrelated or write requests are UNSUPPORTED.", {
        query_daily_sales: "Daily sales totals over time / ยอดขายรายวัน ย้อนหลัง สรุปยอดขายแต่ละวัน",
        query_top_products: "Rank products by sales / สินค้าขายดี top N สินค้า ยอดขายสินค้าอันดับแรก",
        UNSUPPORTED: "Not a daily-sales or product-ranking request, asks to change/delete data, or needs unavailable facts.",
      }),
      metric: choice("Choose the numeric sales metric. Use revenue for ยอดขาย unless the user asks for จำนวนชิ้น/units. For a follow-up use the previous metric.", {
        revenue: "Revenue in Thai baht / ยอดเงิน รายได้ มูลค่าขาย ยอดขาย",
        quantity: "Number of sold units / จำนวนชิ้น จำนวนสินค้าที่ขาย ปริมาณ ไม่ใช่ยอดเงิน",
      }),
      chart: choice("Choose requested visualization. Default bar; preserve previous chart on a follow-up without a chart instruction.", {
        bar: "Bar graph / กราฟแท่ง bar chart; default for daily sales and top products",
        line: "Line graph / กราฟเส้น line chart",
        table: "Table only / ตาราง ไม่ต้องวาดกราฟ",
      }),
    }, label: "statistics query" });
  if (result.selections.tool.choice === "UNSUPPORTED") throw new Error("รองรับยอดขายรายวันและอันดับสินค้า เช่น ยอดขายรายวัน 7 วัน เป็น bar graph หรือ top 10 สินค้า");
  for (const [key, value] of Object.entries(context.hints)) if (value && result.selections[key].choice !== value) throw new Error("Laya เลือก query หรือกราฟไม่ตรงคำสั่ง กรุณาลองระบุใหม่ให้ชัดเจน");
  return { plan: validateStatsPlan({ ...context.defaults, ...Object.fromEntries(Object.entries(result.selections).map(([key, value]) => [key, value.choice])) }),
    model: { name: result.model, requestDurationMs: result.requestDurationMs, selections: result.selections } };
}

export function demoSalesOrders(now = new Date().toISOString()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = offsetDate(dayKey(now), -index);
    const lines = [{ sku: "COKE", name: "Coke", quantity: index + 2, subtotal: (index + 2) * 25 },
      { sku: "WATER", name: "Water", quantity: 9 - index, subtotal: (9 - index) * 15 }];
    return { orderId: `DEMO-${date}`, createdAt: date + "T00:00:00+07:00", paymentMode: "MOCK", lines, total: lines.reduce((sum, line) => sum + line.subtotal, 0) };
  });
}

export function executeStatsQuery(orders, plan) {
  validateStatsPlan(plan);
  const selected = orders.filter(order => order.paymentMode === "MOCK" && dayKey(order.createdAt) >= plan.startDate && dayKey(order.createdAt) <= plan.endDate);
  const groups = new Map();
  if (plan.tool === "query_daily_sales") for (let date = plan.startDate; date <= plan.endDate; date = offsetDate(date, 1)) groups.set(date, { key: date, label: date, revenueCents: 0, quantity: 0, orderCount: 0 });
  let revenueCents = 0, quantity = 0;
  for (const order of selected) {
    const validMoney = value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
    if (!validMoney(order.total) || !Array.isArray(order.lines) || order.lines.some(line =>
      typeof line.sku !== "string" || !line.sku || !Number.isSafeInteger(line.quantity) || line.quantity < 0 || !validMoney(line.subtotal))) throw new Error("Order contains invalid sales values");
    const date = dayKey(order.createdAt);
    revenueCents += Math.round(order.total * 100);
    if (plan.tool === "query_daily_sales") {
      const group = groups.get(date); group.revenueCents += Math.round(order.total * 100); group.orderCount++;
    }
    const counted = new Set();
    for (const line of order.lines) {
      quantity += line.quantity;
      if (plan.tool === "query_daily_sales") groups.get(date).quantity += line.quantity;
      else {
        if (!groups.has(line.sku)) groups.set(line.sku, { key: line.sku, label: line.name || line.sku, revenueCents: 0, quantity: 0, orderCount: 0 });
        const group = groups.get(line.sku); group.revenueCents += Math.round(line.subtotal * 100); group.quantity += line.quantity;
        if (!counted.has(line.sku)) group.orderCount++;
        counted.add(line.sku);
      }
    }
  }
  let rows = [...groups.values()].map(({ revenueCents, ...row }) => ({ ...row, revenue: revenueCents / 100,
    value: plan.metric === "revenue" ? revenueCents / 100 : row.quantity }));
  if (!Number.isSafeInteger(revenueCents) || !Number.isSafeInteger(quantity) || rows.some(row => !Number.isSafeInteger(Math.round(row.revenue * 100)) || !Number.isSafeInteger(row.quantity))) throw new Error("Sales totals exceed the supported numeric range");
  const availableGroups = rows.length;
  if (plan.tool === "query_top_products") rows = rows.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)).slice(0, plan.limit);
  return { rows, totals: { revenue: revenueCents / 100, quantity, orderCount: selected.length }, availableGroups,
    unit: plan.metric === "revenue" ? "THB" : "units", empty: selected.length === 0 };
}

export async function queryStatistics(repository, input, { planner = planStatsQuery, now = new Date().toISOString() } = {}) {
  if (!input || !["orders", "demo"].includes(input.source)) throw new Error("Invalid statistics data source");
  statsParameters(input.message, input.previousPlan, now);
  const { plan, model } = await planner({ message: input.message, previousPlan: input.previousPlan, now });
  validateStatsPlan(plan);
  const store = await repository.read();
  const result = executeStatsQuery(input.source === "demo" ? demoSalesOrders(now) : store.orders, plan);
  return { queryId: "STAT-" + randomUUID(), generatedAt: now, source: input.source === "demo" ? "DEMO" : "MOCK_CHECKOUT_ORDERS", plan, model, result };
}
