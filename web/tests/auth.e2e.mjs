import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startLocalApi } from './helpers/local-api.mjs';
import { loginAdmin } from './helpers/mock-login.mjs';

const frontend = process.env.SHOPPER_TEST_ORIGIN ?? 'http://localhost:3001';
const sessionKey = 'basketly.mock-admin-session.v1';
const disabled = process.env.AUTH_TEST_MODE === 'disabled';
const api = await startLocalApi({ corsOrigin: new URL(frontend).origin });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext();
  const errors = [];
  let reads = 0, streams = 0, mutations = 0;
  await context.addInitScript(({ origin }) => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url, options) { super(new URL(url, location.origin).pathname === '/api/stream' ? origin + '/api/stream' : url, options); }
    };
  }, { origin: api.origin });
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/stream') { streams++; await route.continue(); return; }
    if (route.request().method() === 'POST') mutations++; else reads++;
    try { await route.fulfill({ response: await route.fetch({ url: api.origin + path }) }); }
    catch { await route.abort(); }
  });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  });
  const page = await context.newPage();
  const subscribers = async () => (await context.request.get(api.origin + '/__test/subscribers').then(r => r.json())).count;
  const waitForSubscribers = async count => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await subscribers() === count) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(await subscribers(), count, 'Admin must release its live subscription');
  };
  const noAdminRequests = () => {
    assert.equal(reads, 0, 'No state reads before mock login');
    assert.equal(streams, 0, 'No streams before mock login');
    assert.equal(mutations, 0, 'Login must not submit credentials or mutations to an API');
  };
  const artifacts = process.env.SHOPPER_TEST_ARTIFACT_DIR ?? api.directory;
  await mkdir(artifacts, { recursive: true });
  // Seed a real previous page so Back exercises application navigation, not about:blank.
  await page.goto(frontend + '/shopper/preview');
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  if (disabled) {
    await page.getByRole('heading', { name: 'Admin login ยังไม่เปิดใช้งาน' }).waitFor();
    await page.evaluate(({ key }) => sessionStorage.setItem(key, JSON.stringify({ email: 'admin@basketly.test', expiresAt: Date.now() + 600000 })), { key: sessionKey });
    for (const path of ['/admin', '/admin/login']) {
      await page.goto(frontend + path);
      await page.getByRole('heading', { name: 'Admin login ยังไม่เปิดใช้งาน' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'เข้าสู่ระบบ (Mock)', exact: true }).count(), 0);
    }
    noAdminRequests();
    console.log('Auth disabled-mode checks passed: Admin unavailable despite a forged mock session, no state/API/SSE access.');
  } else {
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).waitFor();
    noAdminRequests();
    for (const [width, height] of [[320,740],[390,844],[768,1024],[1440,900],[844,390]]) {
      await page.setViewportSize({ width, height });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Login overflow at ${width}`);
      const clipped = await page.locator('main input, main button').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.outerHTML));
      assert.deepEqual(clipped, [], `Login controls clipped at ${width}`);
      if (width === 390 || width === 1440) await page.screenshot({ path: join(artifacts, `login-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const submit = () => page.getByRole('button', { name: 'เข้าสู่ระบบ (Mock)', exact: true });
    await submit().click();
    assert.equal(await page.getByLabel('Email', { exact: true }).getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('aria-invalid'), 'true');
    assert.equal(await page.getByLabel('Email', { exact: true }).evaluate(element => document.activeElement === element), true);
    await page.getByLabel('Email', { exact: true }).fill('invalid-email');
    await submit().click();
    await page.getByText('กรุณากรอกอีเมลให้ถูกต้อง', { exact: true }).waitFor();
    await page.getByLabel('Email', { exact: true }).fill('admin@basketly.test');
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'แสดงรหัสผ่าน', exact: true }).click();
    assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'ซ่อนรหัสผ่าน', exact: true }).click();
    await submit().evaluate(button => { button.click(); button.click(); });
    await page.getByRole('status').filter({ hasText: 'กำลังเข้าสู่ระบบ…' }).waitFor();
    assert.equal(await page.getByLabel('Email', { exact: true }).isDisabled(), true);
    await page.getByRole('alert').filter({ hasText: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' }).waitFor();
    noAdminRequests();
    // Keyboard submission and credentials normalization.
    await page.getByLabel('Email', { exact: true }).fill('ADMIN@BASKETLY.TEST');
    await page.getByLabel('Password', { exact: true }).fill('BasketlyDemo123!');
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Logout', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Realtime connected' }).waitFor();
    await waitForSubscribers(1);
    const storage = await page.evaluate(() => ({ session: { ...sessionStorage }, local: { ...localStorage } }));
    assert.ok(!JSON.stringify(storage).includes('BasketlyDemo123!'), 'Never persist passwords');
    assert.equal(mutations, 0, 'Mock login performs no HTTP POST');
    await page.reload();
    await page.getByRole('button', { name: 'Logout', exact: true }).waitFor();
    await waitForSubscribers(1);
    await page.screenshot({ path: join(artifacts, 'admin-mock-session-390.png'), fullPage: true });

    // Independent tab starts signed out; logging out there must not affect this tab.
    const other = await context.newPage();
    await other.goto(frontend + '/admin');
    await other.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).waitFor();
    await other.close();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.waitForURL('**/admin/login');
    await page.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).waitFor();
    await waitForSubscribers(0);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), sessionKey), null);
    await page.goBack();
    await page.waitForURL('**/shopper/preview');
    assert.equal(await page.getByRole('button', { name: 'Logout', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'Admin', exact: true }).click();
    await page.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).waitFor();
    await waitForSubscribers(0);

    await loginAdmin(page);
    await page.getByText('Mock session controls', { exact: true }).click();
    await page.getByRole('button', { name: 'จำลอง session หมดอายุ', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Mock session หมดอายุ' }).waitFor();
    await waitForSubscribers(0);
    await page.screenshot({ path: join(artifacts, 'login-expired-390.png'), fullPage: true });

    // Real timeout path, not only the simulation control.
    await loginAdmin(page);
    await page.evaluate(key => sessionStorage.setItem(key, JSON.stringify({ email: 'admin@basketly.test', expiresAt: Date.now() + 2500 })), sessionKey);
    await page.reload();
    await page.getByRole('button', { name: 'Logout', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Mock session หมดอายุ' }).waitFor();
    await waitForSubscribers(0);

    const beforeCorrupt = { reads, streams };
    await page.evaluate(key => sessionStorage.setItem(key, '{invalid-json'), sessionKey);
    await page.reload();
    await page.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).waitFor();
    assert.deepEqual({ reads, streams }, beforeCorrupt, 'Malformed session cannot mount dashboard');
    const blocked = await context.newPage();
    await blocked.addInitScript(key => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException('Test storage blocked', 'SecurityError'); return setItem.call(this, name, value); };
    }, sessionKey);
    await blocked.goto(frontend + '/admin/login');
    await blocked.getByLabel('Email', { exact: true }).fill('admin@basketly.test');
    await blocked.getByLabel('Password', { exact: true }).fill('BasketlyDemo123!');
    await blocked.getByRole('button', { name: 'เข้าสู่ระบบ (Mock)', exact: true }).click();
    await blocked.getByRole('alert').filter({ hasText: 'ไม่สามารถบันทึก session' }).waitFor();
    assert.deepEqual({ reads, streams }, beforeCorrupt, 'Unavailable storage must not grant access');
    await blocked.close();

    await page.getByRole('link', { name: 'ไป Shopper App →', exact: true }).click();
    await page.waitForURL('**/shopper');
    await page.getByRole('status').filter({ hasText: 'Realtime connected' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'เข้าสู่ระบบ Admin', exact: true }).count(), 0, 'Shopper remains guest-accessible');
    await page.close();
    await waitForSubscribers(0);
    console.log('Mock auth browser checks passed: validation, keyboard, login, refresh, logout/back, tab isolation, expiry, invalid/blocked storage, SSE cleanup, guest Shopper, responsive layout.');
  }
  assert.deepEqual(errors, [], 'No hydration/runtime errors');
} finally {
  await browser?.close();
  await api.close();
}
