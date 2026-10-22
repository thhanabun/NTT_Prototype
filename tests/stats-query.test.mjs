import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statsParameters, planStatsQuery, executeStatsQuery, demoSalesOrders, validateStatsPlan } from "../src/stats-query.mjs";
import { LocalJsonRepository } from "../src/store-repository.mjs";
import { createPrototypeApplication } from "../src/application.mjs";

const now = "2026-10-22T10:00:00Z";
const plan = { tool: "query_daily_sales", metric: "revenue", chart: "bar", startDate: "2026-10-16", endDate: "2026-10-22", limit: 10, timeZone: "Asia/Bangkok" };
function modelResponse(questions, picks = {}) {
  return { model: "fixture-laya", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => {
    const keys = Object.keys(question.criteria); const selected = picks[id] || keys[0];
    return [id, { type: "choice", choice: selected, probabilities: Object.fromEntries(keys.map(key => [key, key === selected ? 0.8 : 0.2 / (keys.length - 1)])) }];
  })) };
}

test("Stat parameters preserve Thai quantity words, top limits, date range and Bangkok calendar boundaries", () => {
  const parsed = statsParameters("สินค้า top10 ตามจำนวนชิ้น 1 สัปดาห์ เป็นตาราง", undefined, now);
  assert.deepEqual(parsed.defaults, plan); // Numeric limits/dates are independent of model-selected presentation.
  assert.deepEqual(parsed.hints, { tool: "query_top_products", metric: "quantity", chart: "table" });
  assert.equal(statsParameters("สินค้า ๕ อันดับแรก ย้อนหลัง ๓๐ วัน", undefined, now).defaults.limit, 5);
  assert.equal(statsParameters("ยอดขายรายวัน 7 วัน", undefined, "2026-10-22T17:01:00Z").defaults.endDate, "2026-10-23");
  assert.equal(statsParameters("ยอดขายสัปดาห์นี้", undefined, now).defaults.startDate, "2026-10-19");
  assert.equal(statsParameters("ยอดขายสัปดาห์ที่แล้ว", undefined, now).defaults.endDate, "2026-10-18");
  assert.equal(statsParameters("เปลี่ยนเป็นกราฟเส้น", { ...plan, startDate: "2026-10-01" }, now).defaults.startDate, "2026-10-01");
  assert.equal(statsParameters("ยอดขาย 2026-10-01 ถึง 2026-10-05", undefined, now).defaults.endDate, "2026-10-05");
});

test("Stat requests reject invalid, future or oversized parameters before inference", () => {
  for (const message of ["", "x".repeat(1001), "top 51", "ยอดขาย 0 วัน", "ยอดขาย 367 วัน", "ยอดขาย 2026-02-30", "ยอดขาย 2027-01-01", "ยอดขาย 2026-10-21 ถึง 2026-10-19", "ยอดขาย 01/10/2026", "ลบข้อมูลยอดขายทั้งหมด", "ยอดขายรายเดือน"]) assert.throws(() => statsParameters(message, undefined, now));
  assert.throws(() => validateStatsPlan({ ...plan, tool: "delete_orders" }), /Invalid/);
  assert.throws(() => statsParameters("กราฟเส้น", { ...plan, limit: -1 }, now));
});

test("Daily query zero-fills days, uses Bangkok dates and sums cents without floating-point drift", () => {
  const orders = [
    { createdAt: "2026-10-15T17:00:00Z", paymentMode: "MOCK", total: 0.1 + 0.2, lines: [{ sku: "COKE", quantity: 1, subtotal: 0.1 }, { sku: "WATER", quantity: 1, subtotal: 0.2 }] },
    { createdAt: "2026-10-22T16:59:59Z", paymentMode: "MOCK", total: 25, lines: [{ sku: "COKE", quantity: 1, subtotal: 25 }] },
    { createdAt: "2026-10-22T17:00:00Z", paymentMode: "MOCK", total: 999, lines: [] },
  ];
  const result = executeStatsQuery(orders, plan);
  assert.equal(result.rows.length, 7); assert.equal(result.rows[0].value, 0.3); assert.equal(result.rows[1].value, 0);
  assert.equal(result.rows[6].value, 25); assert.deepEqual(result.totals, { revenue: 25.3, quantity: 3, orderCount: 2 });
  assert.equal(executeStatsQuery([], plan).empty, true);
  assert.throws(() => executeStatsQuery([{ ...orders[0], total: NaN }], plan), /invalid sales/);
});

test("Top N ranks revenue or units correctly, keeps only actual products and labels demo separately", () => {
  const demo = demoSalesOrders(now);
  const money = executeStatsQuery(demo, { ...plan, tool: "query_top_products" });
  const units = executeStatsQuery(demo, { ...plan, tool: "query_top_products", metric: "quantity", limit: 1 });
  assert.equal(money.rows.length, 2); assert.equal(money.rows[0].key, "COKE"); assert.equal(money.rows[0].value, 875);
  assert.equal(units.rows[0].key, "WATER"); assert.equal(units.rows[0].value, 42);
  assert.equal(units.availableGroups, 2); assert.deepEqual(units.totals, { revenue: 1505, quantity: 77, orderCount: 7 });
});

test("Laya chooses three validated query fields; unsupported, conflicting and malformed outputs cannot run", async () => {
  const selected = { tool: "query_top_products", metric: "quantity", chart: "table" };
  const response = await planStatsQuery({ message: "สินค้า top 10 ตามจำนวนชิ้น 30 วัน เป็นตาราง", now, fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body.questions), ["tool", "metric", "chart"]);
    assert.equal(body.state.normalizedRequest.metric, "quantity"); assert.ok(!JSON.stringify(body).includes("orderId"));
    return { ok: true, json: async () => modelResponse(body.questions, selected) };
  } });
  assert.equal(response.plan.metric, "quantity"); assert.equal(response.plan.tool, "query_top_products"); assert.equal(response.plan.startDate, "2026-09-23");
  for (const mode of ["unsupported", "conflict", "malformed", "offline"]) await assert.rejects(planStatsQuery({ message: "สินค้า top 10 ตามจำนวนชิ้น เป็นตาราง", now, fetchImpl: async (_url, init) => {
    if (mode === "offline") throw new Error("offline");
    const payload = modelResponse(JSON.parse(init.body).questions, mode === "unsupported" ? { ...selected, tool: "UNSUPPORTED" } : mode === "conflict" ? { ...selected, metric: "revenue" } : selected);
    if (mode === "malformed") payload.answers.chart.probabilities.table = 99;
    return { ok: true, json: async () => payload };
  } }));
});

test("Application queries full order history, excludes carts, persists audit and leaves orders/cart unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "basket-stats-"));
  try {
    const repository = new LocalJsonRepository(join(directory, "state.json"));
    let calls = 0;
    const app = createPrototypeApplication({ repository, logger: () => {}, statsPlanner: async () => { calls++; return { plan, model: { name: "fixture-planner" } }; } });
    await app.init();
    await repository.mutate(store => {
      store.orders = Array.from({ length: 15 }, (_, index) => ({ orderId: String(index), createdAt: now, paymentMode: "MOCK", total: 25, lines: [{ sku: "COKE", name: "Coke", quantity: 1, subtotal: 25 }] }));
      store.carts.A.COKE = 100;
    });
    const before = structuredClone(await repository.read());
    const result = await app.queryStatistics({ message: "ยอดขายรายวัน 7 วัน", source: "orders" });
    assert.equal(result.result.totals.revenue, 375); assert.equal(result.result.totals.orderCount, 15); assert.equal(result.source, "MOCK_CHECKOUT_ORDERS");
    await app.queryStatistics({ message: "ยอดขายรายวัน 7 วัน", source: "demo" });
    const after = await repository.read(); assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.carts, before.carts);
    assert.equal(after.auditLog.filter(item => item.action === "STAT_QUERY_COMPLETED").length, 2); assert.equal(calls, 2);
    const reopened = new LocalJsonRepository(repository.path); await reopened.init(); assert.equal((await reopened.read()).auditLog[0].action, "STAT_QUERY_COMPLETED");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
