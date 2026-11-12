import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt-in only. Uses the actual frontend/proxy/API/local model, never intercepts responses.
const value = process.env.SHOPPER_LIVE_TEST_ORIGIN;
if (!value) throw new Error('Set SHOPPER_LIVE_TEST_ORIGIN explicitly to the local-model review frontend; this test performs real local inference.');
const origin = new URL(value);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)) throw new Error('Real-model browser verification is local-only');
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, 'tmp', 'shopper-model-browser-' + Date.now());
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin.origin + '/shopper');
  await page.getByRole('button', { name: 'เมนูลัด FAST (ลากเพื่อย้ายตำแหน่งได้)', exact: true }).click();
  await page.getByRole('button', { name: 'เปิดแชทผู้ช่วยช้อป', exact: true }).click();
  const response = page.waitForResponse(response => response.url().endsWith('/api/shopper/query'));
  await page.getByRole('region', { name: 'ผู้ช่วยช้อป FAST' }).getByRole('button', { name: 'คืนสินค้าอย่างไร', exact: true }).click();
  const actual = await response;
  assert.equal(actual.status(), 200);
  const answer = await actual.json();
  assert.equal(answer.mode, 'model'); assert.equal(answer.model, 'fast-shopper-qwen3-4b');
  assert.equal(answer.kind, 'answer'); assert.ok(answer.sources.some(source => source.id === 'guide:items'));
  await page.getByText('คำตอบจากโมเดล · ตรวจแหล่งข้อมูล', { exact: true }).waitFor();
  await page.getByText('โมเดล: fast-shopper-qwen3-4b · 2 ครั้ง', { exact: true }).waitFor();
  await page.locator('#shopper-chat details').filter({ hasText: 'หยิบและคืนสินค้า' }).locator('summary').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve(directory, 'real-local-model-390.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(resolve(directory, 'report.json'), JSON.stringify({ realFrontend: true, realProxy: true, realApi: true, realModel: true, replacedResponses: false, answer, errors }, null, 2));
  console.log('PASS real local-model browser/proxy/API/guide flow. Evidence: ' + directory);
} finally { await browser.close(); }
