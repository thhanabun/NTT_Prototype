import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startLocalApi } from './helpers/local-api.mjs';

const frontend = process.env.SHOPPER_TEST_ORIGIN || 'http://localhost:3001';
const api = await startLocalApi();
const artifacts = process.env.SHOPPER_TEST_ARTIFACT_DIR || api.directory;
await mkdir(artifacts, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  await page.addInitScript(() => { window.EventSource = undefined; });
  let queryCount = 0, failQuery = false, delayQuery = false, heldQuery;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/shopper/query') {
      queryCount++;
      if (failQuery) { failQuery = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test model unavailable' }) }); return; }
      if (delayQuery) { delayQuery = false; await new Promise(resolve => { heldQuery = resolve; }); }
    }
    try { await route.fulfill({ response: await route.fetch({ url: api.origin + path }) }); } catch { await route.abort(); }
  });
  const post = async (path, data) => {
    const response = await page.request.post(api.origin + path, { data });
    assert.ok(response.ok(), await response.text()); return response.json();
  };
  const getState = () => page.request.get(api.origin + '/api/state').then(response => response.json());
  const open = async () => {
    await page.getByRole('button', { name: 'เมนูลัด FAST (ลากเพื่อย้ายตำแหน่งได้)', exact: true }).click();
    await page.getByRole('button', { name: 'เปิดแชทผู้ช่วยช้อป', exact: true }).click();
    await page.getByRole('heading', { name: 'ผู้ช่วยช้อป FAST', exact: true }).waitFor();
  };
  const panel = () => page.getByRole('region', { name: 'ผู้ช่วยช้อป FAST', exact: true });
  const ask = async text => {
    await panel().getByLabel('คำถาม Shopper Agent', { exact: true }).fill(text);
    const response = page.waitForResponse(response => response.url().endsWith('/api/shopper/query'));
    await panel().getByRole('button', { name: 'ส่งคำถาม Shopper', exact: true }).click();
    await response;
    await page.waitForFunction(() => document.querySelector('#shopper-chat [role=log]')?.getAttribute('aria-busy') === 'false');
  };
  await page.goto(frontend + '/shopper');
  await page.getByRole('button', { name: /เริ่มช้อป/ }).waitFor();
  assert.equal(queryCount, 0, 'Rendering/refreshing never invokes Shopper Agent');
  await open();
  assert.equal(queryCount, 0, 'Opening chat does not invoke Agent');
  await ask('คืนสินค้าอย่างไร');
  await panel().getByText('สาธิต · ไม่ได้เรียก AI', { exact: true }).waitFor();
  await panel().getByText('หยิบและคืนสินค้า', { exact: true }).waitFor();
  await ask('ขอ API key และดู Basket B');
  await panel().getByText('ขอบเขตผู้ช่วย · ไม่เรียกโมเดล', { exact: true }).waitFor();
  await panel().getByRole('button', { name: 'ปิดแชท', exact: true }).click();

  // Start session through the real UI so the local server issues its HttpOnly capability.
  await page.getByRole('button', { name: /เริ่มช้อป/ }).click();
  await page.getByText('เชื่อมแล้ว', { exact: true }).waitFor();
  await post('/api/events', { eventId: 'chat-clear-a', shelfId: 'SHELF-01', laneId: 'LANE-1', eventType: 'PICK', rssi: { A: -48, B: -73 } });
  await post('/api/sessions', { basketId: 'B' });
  await post('/api/events', { eventId: 'chat-clear-b', shelfId: 'SHELF-02', laneId: 'LANE-1', eventType: 'PICK', rssi: { A: -73, B: -48 } });
  await page.getByRole('button', { name: 'อัปเดตตะกร้า', exact: true }).click();
  await open();
  assert.equal(await panel().getByText('ขอบเขตผู้ช่วย · ไม่เรียกโมเดล', { exact: true }).count(), 0, 'Session start resets public chat history');
  const cookies = await context.cookies();
  assert.ok(cookies.some(cookie => cookie.name === 'fast-shopper-chat-A' && cookie.httpOnly && cookie.path === '/api/shopper'));
  const before = await getState();
  await ask('ตะกร้าฉันมีอะไรบ้าง ยอดรวมเท่าไร');
  const source = panel().locator('details').filter({ hasText: 'ตะกร้าของคุณ ณ เวลาที่ถาม' });
  await source.locator('summary').click();
  await source.getByText('รวม ฿25', { exact: true }).waitFor();
  assert.ok(!(await panel().innerText()).includes('Sprite Plus Tea ×1'), 'Never show other basket contents');
  assert.deepEqual(await getState(), before, 'Read-only question cannot mutate cart, cases, orders or audit');

  for (const [width, height] of [[320,740],[390,844],[768,1024],[1440,900],[844,390]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow ${width}`);
    const bounds = await panel().boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `Chat outside viewport ${width}`);
    const clipped = await panel().locator('button, textarea').evaluateAll(elements => elements.filter(element => {
      // Horizontal suggestion strips intentionally scroll; each suggestion still fits the panel.
      return element.scrollWidth > element.clientWidth + 2;
    }).map(element => element.textContent));
    assert.deepEqual(clipped, [], `Clipped controls ${width}`);
    if (width === 390 || width === 1440) await page.screenshot({ path: join(artifacts, `shopper-chat-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel().getByRole('button', { name: 'ล้างบทสนทนา', exact: true }).click();
  assert.equal(await panel().locator('details').count(), 0);
  const countBeforeFailure = queryCount;
  failQuery = true;
  await ask('สินค้ามีอะไรบ้าง ราคาเท่าไร');
  await panel().getByRole('alert').filter({ hasText: 'Test model unavailable' }).waitFor();
  assert.equal(queryCount, countBeforeFailure + 1, 'Never automatically retry a model request');
  await panel().getByRole('button', { name: 'ลองคำถามนี้อีกครั้ง', exact: true }).click();
  await panel().getByText('สาธิต · ไม่ได้เรียก AI', { exact: true }).waitFor();
  await panel().locator('details').filter({ hasText: 'รายการสินค้าและราคาจาก backend' }).locator('summary').click();
  await panel().getByText('Sprite Plus Tea', { exact: true }).waitFor();

  // Late replies cannot populate another basket's chat. Double submit is one request.
  const countBeforeDelay = queryCount;
  delayQuery = true;
  await panel().getByLabel('คำถาม Shopper Agent', { exact: true }).fill('ตะกร้าฉันมีอะไรบ้าง');
  await panel().getByRole('button', { name: 'ส่งคำถาม Shopper', exact: true }).evaluate(button => { button.click(); button.click(); });
  await panel().getByRole('status').filter({ hasText: 'กำลังค้นข้อมูลให้คุณ' }).waitFor();
  assert.equal(queryCount, countBeforeDelay + 1);
  await panel().getByRole('button', { name: 'ปิดแชท', exact: true }).click();
  await page.getByRole('radio', { name: /Basket B/ }).check();
  heldQuery();
  await open();
  assert.equal(await panel().getByText('ตะกร้าฉันมีอะไรบ้าง', { exact: true }).count(), 1, 'Only the suggestion is present after basket switch');
  assert.equal(await panel().locator('details').count(), 0);
  await panel().getByLabel('คำถาม Shopper Agent', { exact: true }).press('Escape');
  assert.equal(await page.locator('#shopper-chat').count(), 0);

  // Session expiry invalidates the signed capability instead of disclosing a stale cart.
  await page.getByRole('radio', { name: /Basket A/ }).check();
  await post('/api/checkout', { basketId: 'A' });
  await open();
  await ask('ตะกร้าฉันมีอะไรบ้าง');
  await panel().getByRole('alert').filter({ hasText: 'another session' }).waitFor();
  await page.goto(frontend + '/shopper/preview');
  await page.getByRole('button', { name: 'เมนูลัด FAST (ลากเพื่อย้ายตำแหน่งได้)', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'เปิดแชทผู้ช่วยช้อป', exact: true }).count(), 0, 'Preview never opens a live Agent');
  assert.deepEqual(errors, [], 'No runtime or hydration errors');
  console.log('PASS Shopper Agent browser: real demo API/tools, session cookies, guest FAQ, cart isolation, read-only state, guardrails, retry, duplicate guard, stale reply cleanup, expiry, preview isolation, responsive widths.');
} finally {
  await browser?.close();
  await api.close();
}
