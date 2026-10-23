import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { startLocalApi } from './helpers/local-api.mjs';
import { loginAdmin } from './helpers/mock-login.mjs';

// Real Laya, isolated JSON DB and HTTP API; Playwright routes only connect this UI to that API.
const api = await startLocalApi();
const directory = resolve('../data', 'stats-web-' + Date.now());
await mkdir(directory, { recursive: true });
let browser;
let page;
try {
  const post = async (path, data) => {
    const response = await fetch(api.origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(35000) });
    assert.ok(response.ok, await response.text());
  };
  for (let index = 0; index < 15; index++) {
    await post('/api/sessions', { basketId: 'A' });
    await post('/api/events', { eventId: `stats-coke-${index}`, laneId: 'LANE-1', eventType: 'PICK', rssi: { A: -51, B: -72 } });
    if (index % 2) await post('/api/events', { eventId: `stats-water-${index}`, laneId: 'LANE-2', eventType: 'PICK', rssi: { A: -51, B: -72 } });
    await post('/api/checkout', { basketId: 'A' });
  }
  // An unpaid cart is not a sale.
  await post('/api/sessions', { basketId: 'A' });
  await post('/api/events', { eventId: 'stats-unpaid', laneId: 'LANE-1', eventType: 'PICK', rssi: { A: -51, B: -72 } });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], results = [];
  let requests = 0, failQuery = false;
  await page.addInitScript(() => { window.EventSource = undefined; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/stats/query') {
      requests++;
      if (failQuery) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test stats unavailable' }) });
    }
    const response = await route.fetch({ url: api.origin + url.pathname + url.search, timeout: 40000 });
    if (url.pathname === '/api/stats/query' && response.ok()) results.push(await response.json());
    await route.fulfill({ response });
  });
  await page.goto(`${process.env.SHOPPER_TEST_ORIGIN || 'http://localhost:3001'}/admin`);
  await loginAdmin(page);
  // Chat lives in a floating dock; every answer opens its own result tab beside the pinned Dashboard tab.
  await page.getByRole('button', { name: /เมนูลัด FAST/ }).click();
  await page.getByRole('button', { name: 'เปิดแชทถามข้อมูลร้าน', exact: true }).click();
  const panel = page.getByRole('region', { name: 'ถามข้อมูลร้าน', exact: true });
  await panel.getByRole('heading', { name: 'ถามข้อมูลร้าน', exact: true }).waitFor();
  const latest = () => page.locator('[role="tabpanel"]:not([hidden]) article').last();
  async function query(message, doubleClick = false) {
    console.log('QUERY ' + message);
    await panel.getByLabel('คำถามสถิติ', { exact: true }).fill(message);
    const before = requests;
    const completed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/stats/query', { timeout: 45000 });
    if (doubleClick) await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).evaluate(button => { button.click(); button.click(); });
    else await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
    await completed;
    await panel.locator('[role="log"][aria-busy="false"]').waitFor({ timeout: 45000 });
    assert.equal(requests, before + 1);
    assert.equal(await panel.getByRole('alert').count(), 0);
    console.log('PASS ' + message);
  }
  await query('ยอดขายรายวัน 1 สัปดาห์ plot เป็น bar graph', true);
  await latest().getByRole('img', { name: /bar graph/ }).waitFor();
  assert.equal(results.at(-1).result.totals.revenue, 480);
  assert.equal(results.at(-1).result.totals.orderCount, 15);
  assert.equal(results.at(-1).result.rows.length, 7);
  assert.equal(results.at(-1).plan.chart, 'bar');
  await latest().scrollIntoViewIfNeeded(); await page.screenshot({ path: join(directory, 'daily-desktop.png'), fullPage: true });

  await panel.getByLabel('แหล่งข้อมูลสถิติ').selectOption('demo');
  await query('สินค้า top 10 ตามยอดเงินย้อนหลัง 7 วัน');
  assert.equal(results.at(-1).result.rows[0].key, 'COKE');
  assert.equal(results.at(-1).result.rows.length, 2);
  await latest().getByText('ข้อมูลตัวอย่าง', { exact: true }).waitFor();
  await latest().getByRole('img', { name: /bar graph/ }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} page overflow`);
    await latest().scrollIntoViewIfNeeded();
    if (width === 390 || width === 1440) {
      await page.screenshot({ path: join(directory, `top-products-${width}.png`), fullPage: true });
      await panel.screenshot({ path: join(directory, `stat-panel-${width}.png`) });
    }
  }
  await query('สินค้า top 10 ตามจำนวนชิ้น 30 วัน เป็นตาราง');
  assert.equal(results.at(-1).result.rows[0].key, 'WATER');
  assert.equal(results.at(-1).result.rows[0].value, 42);
  assert.equal(await latest().getByRole('img').count(), 0);
  const previousPlan = results.at(-1).plan;
  await query('เปลี่ยนเป็นกราฟเส้น');
  assert.deepEqual(results.at(-1).plan, { ...previousPlan, chart: 'line' });
  await latest().getByRole('img', { name: /line graph/ }).waitFor();
  await panel.getByLabel('แหล่งข้อมูลสถิติ').selectOption('orders');
  await query('ยอดขายรายวัน 2020-01-01 ถึง 2020-01-07 เป็นตาราง');
  assert.equal(results.at(-1).result.empty, true);
  await latest().getByText(/ไม่มี order ที่ checkout สำเร็จ/).waitFor();
  failQuery = true;
  await panel.getByLabel('คำถามสถิติ', { exact: true }).fill('ยอดขายรายวัน 7 วัน');
  await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
  await panel.getByRole('alert').filter({ hasText: 'Test stats unavailable' }).waitFor();
  assert.equal(await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).isEnabled(), true);
  const state = await (await fetch(api.origin + '/api/state')).json();
  assert.equal(state.auditLog.filter(entry => entry.action === 'STAT_QUERY_COMPLETED').length, 5);
  assert.equal(state.baskets[0].total, 25);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'report.json'), JSON.stringify({ results, errors, requests, checks: ['real Laya choices', '15 DB orders beyond snapshot limit', 'unpaid cart excluded', 'daily bar chart', 'Top 10 revenue bar', 'Top 10 units table', 'line follow-up', 'source labels', 'empty state', 'query failure recovery', 'double-submit guard', 'mobile/desktop overflow', 'audit'] }, null, 2));
  console.log('PASS Admin Stat Query with real Laya, full DB aggregation, charts/table, follow-up, demo/source labels, empty/error states and responsive UI. Artifacts: ' + directory);
} catch (error) {
  await page?.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error);
  throw error;
} finally {
  await page?.unrouteAll({ behavior: 'ignoreErrors' });
  await browser?.close(); await api.close();
}
