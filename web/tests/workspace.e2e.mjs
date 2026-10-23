import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startLocalApi } from './helpers/local-api.mjs';
import { loginAdmin } from './helpers/mock-login.mjs';

// Admin workspace: pinned Dashboard tab, floating chat, one result tab per answer, theme toggle.
// The stats endpoint is mocked so this runs without the Laya model service.
const api = await startLocalApi();
let browser;
try {
  const response = (tool, chart, rows, n) => ({
    queryId: `QRY-TEST-${n}`, generatedAt: new Date().toISOString(), source: 'DEMO',
    plan: { tool, metric: 'revenue', chart, startDate: '2026-10-17', endDate: '2026-10-23', limit: 10, timeZone: 'Asia/Bangkok' },
    model: { name: 'test-model', requestDurationMs: 900, selections: { tool: { choice: tool, confidence: 0.9, probabilities: {} } } },
    result: {
      rows, totals: { revenue: rows.reduce((sum, row) => sum + row.revenue, 0), quantity: rows.reduce((sum, row) => sum + row.quantity, 0), orderCount: 20 },
      availableGroups: rows.length, unit: 'THB', empty: false,
    },
  });
  const days = Array.from({ length: 7 }, (_, index) => ({ key: `2026-10-${17 + index}`, label: `2026-10-${17 + index}`, value: 100 * (index + 1), revenue: 100 * (index + 1), quantity: 5 * (index + 1), orderCount: index + 1 }));
  const top = [{ key: 'COKE', label: 'Coca-Cola', value: 300, revenue: 300, quantity: 12, orderCount: 8 }, { key: 'WATER', label: 'Mineral water', value: 120, revenue: 120, quantity: 8, orderCount: 6 }];
  let count = 0;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  await page.addInitScript(() => { window.EventSource = undefined; });
  // The dev-only Next.js indicator sits bottom-left, exactly where the chat launcher is.
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style); }); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/stats/query') {
      const message = JSON.parse(route.request().postData()).message;
      const reply = /top|ขายดี/.test(message) ? response('query_top_products', 'bar', top, ++count) : response('query_daily_sales', /เส้น/.test(message) ? 'line' : 'bar', days, ++count);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
    }
    await route.fulfill({ response: await route.fetch({ url: api.origin + url.pathname + url.search }) });
  });
  await page.goto(`${process.env.SHOPPER_TEST_ORIGIN || 'http://localhost:3001'}/admin`);
  await loginAdmin(page);

  const dashboardTab = page.getByRole('tab', { name: /Dashboard/ });
  await dashboardTab.waitFor();
  assert.equal(await dashboardTab.getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByRole('region', { name: 'ถามข้อมูลร้าน', exact: true }).count(), 0, 'chat starts closed');
  assert.equal(await page.getByRole('button', { name: /ปิดแท็บ/ }).count(), 0, 'Dashboard tab cannot be closed');

  await page.getByRole('button', { name: 'เปิดแชทถามข้อมูลร้าน', exact: true }).click();
  const panel = page.getByRole('region', { name: 'ถามข้อมูลร้าน', exact: true });
  const ask = async message => {
    await panel.getByLabel('คำถามสถิติ', { exact: true }).fill(message);
    await panel.getByRole('button', { name: 'ส่งคำถาม', exact: true }).click();
    await panel.locator('[role="log"][aria-busy="false"]').waitFor();
  };

  await ask('ยอดขายรายวัน 1 สัปดาห์ bar graph');
  await page.getByRole('tab', { name: /ยอดขายรายวัน/ }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /ยอดขายรายวัน/ }).getAttribute('aria-selected'), 'true', 'new answer opens and selects a tab');
  const active = () => page.locator('[role="tabpanel"]:not([hidden])');
  await active().getByRole('img', { name: /bar graph/ }).waitFor();
  await active().getByRole('heading', { name: 'ยอดขายรายวัน', exact: true }).waitFor();
  await active().getByText('ข้อมูลตัวอย่าง', { exact: true }).waitFor();

  // Hovering a bar shows its day.
  const box = await active().getByRole('img', { name: /bar graph/ }).boundingBox();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6);
  await active().getByText('2026-10-23', { exact: true }).first().waitFor();

  await active().getByRole('button', { name: 'เส้น', exact: true }).click();
  await active().getByRole('img', { name: /line graph/ }).waitFor();
  await active().getByRole('button', { name: 'ตาราง', exact: true }).click();
  assert.equal(await active().getByRole('img').count(), 0, 'table view has no chart');
  await active().getByRole('region', { name: 'ข้อมูล ยอดขายรายวัน', exact: true }).waitFor();

  await ask('สินค้า top 10 ตามยอดเงิน 7 วัน');
  assert.equal(await page.getByRole('tab').count(), 3, 'Dashboard + two result tabs');
  await active().getByRole('button', { name: 'อันดับ', exact: true }).click();
  await active().getByText('Coca-Cola').first().waitFor();

  // Dashboard stays mounted; switching back and forth keeps the chat history link working.
  await dashboardTab.click();
  await page.getByRole('heading', { name: 'บันทึกการทำงาน' }).waitFor();
  await page.getByRole('button', { name: /ยอดขายรายวัน.*เปิดแท็บ/ }).click();
  await page.getByRole('tab', { name: /ยอดขายรายวัน/ }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /ยอดขายรายวัน/ }).getAttribute('aria-selected'), 'true');

  // Keyboard: arrows move between tabs.
  await page.getByRole('tab', { name: /ยอดขายรายวัน/ }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await dashboardTab.getAttribute('aria-selected'), 'true');

  // Closing the active result goes back to Dashboard.
  await page.getByRole('tab', { name: /ยอดขายรายวัน/ }).click();
  await page.getByRole('button', { name: /ปิดแท็บ ยอดขายรายวัน/ }).click();
  assert.equal(await page.getByRole('tab').count(), 2);
  assert.equal(await dashboardTab.getAttribute('aria-selected'), 'true');

  // Night mode persists and applies theme variables.
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'day');
  await page.getByRole('button', { name: /สลับโหมดแสง/ }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'night');
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(20, 18, 16)'); // body fades over 0.2s
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'night', 'theme survives reload');

  // Narrow screens: no horizontal overflow with the chat open.
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px page overflow`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS Admin workspace: pinned Dashboard tab, floating chat, result tabs, chart views/hover, keyboard tabs, theme toggle and responsive widths.');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  await api.close();
}
