import type { StatsPlan, StatsResponse } from "@/lib/api/types";

export const formatNumber = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
export const formatBaht = (value: number) => `฿${formatNumber(value)}`;

export function statsTitle(plan: StatsPlan) {
  return plan.tool === "query_daily_sales" ? "ยอดขายรายวัน" : `สินค้า Top ${plan.limit}`;
}

export function statsTabTitle(plan: StatsPlan) {
  const title = plan.tool === "query_daily_sales" ? "ยอดขายรายวัน" : `สินค้า Top ${plan.limit}`;
  return `${title} · ${plan.metric === "revenue" ? "ยอดเงิน" : "ชิ้น"}`;
}

export function sourceLabel(response: StatsResponse) {
  return response.source === "DEMO" ? "ข้อมูลตัวอย่าง" : "การชำระเงินจำลอง";
}

export function metricValue(response: StatsResponse, value: number) {
  return response.plan.metric === "revenue" ? formatBaht(value) : `${formatNumber(value)} ชิ้น`;
}

// One plain sentence for the chat bubble. Every number comes from the query result.
export function describeStats(response: StatsResponse) {
  const { plan, result } = response;
  if (result.empty) return "ไม่มี order ที่ checkout สำเร็จในช่วงนี้ ลองเลือกชุดข้อมูลสาธิตหรือเปลี่ยนช่วงเวลา";
  const range = `${plan.startDate} ถึง ${plan.endDate}`;
  if (plan.tool === "query_daily_sales") {
    const best = [...result.rows].sort((a, b) => b.value - a.value)[0];
    return `${range} ขายได้รวม ${formatBaht(result.totals.revenue)} จาก ${formatNumber(result.totals.orderCount)} orders · วันที่ขายดีที่สุดคือ ${best.label} (${metricValue(response, best.value)})`;
  }
  const first = result.rows[0];
  const share = result.totals.revenue && plan.metric === "revenue" ? ` หรือ ${Math.round((first.revenue / result.totals.revenue) * 100)}% ของยอดเงิน` : "";
  return `${range} ${first.label} ขายดีที่สุด ${metricValue(response, first.value)}${share}`;
}

// A short "what the data says" line shown under the chart.
export function insightFor(response: StatsResponse) {
  const { plan, result } = response;
  if (result.empty || !result.rows.length) return "ยังไม่มีข้อมูลในช่วงนี้";
  if (plan.tool === "query_daily_sales") {
    const rows = result.rows;
    const best = rows.reduce((a, b) => (b.value > a.value ? b : a));
    const worst = rows.reduce((a, b) => (b.value < a.value ? b : a));
    const first = rows[0].value, last = rows[rows.length - 1].value;
    const change = first ? Math.round(((last - first) / first) * 100) : null;
    return `สูงสุด ${best.label} (${metricValue(response, best.value)}) · ต่ำสุด ${worst.label} (${metricValue(response, worst.value)})${change === null ? "" : ` · วันสุดท้าย${change >= 0 ? "สูงกว่า" : "ต่ำกว่า"}วันแรก ${Math.abs(change)}%`}`;
  }
  const [a, b] = result.rows;
  const revenueShare = result.totals.revenue ? Math.round((a.revenue / result.totals.revenue) * 100) : 0;
  if (!b) return `${a.label} เป็นสินค้าเดียวที่ขายได้ในช่วงนี้`;
  return `${a.label} ทำยอดเงิน ${revenueShare}% ของทั้งหมด · ขาย ${formatNumber(a.quantity)} ชิ้น เทียบกับ ${b.label} ${formatNumber(b.quantity)} ชิ้น`;
}
