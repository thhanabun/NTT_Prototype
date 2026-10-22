import { chromium } from 'playwright';
import mqtt from 'mqtt';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startLocalApi } from './helpers/local-api.mjs';
import { loginAdmin } from './helpers/mock-login.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const frontend = process.env.SHOPPER_TEST_ORIGIN || 'http://localhost:3001';
const api = await startLocalApi({ corsOrigin: new URL(frontend).origin });
const artifacts = resolve(repository, 'data', `web-telemetry-${Date.now()}`);
await mkdir(artifacts, { recursive: true });
const report = { checks: [], errors: [], simulated: ['ESP32 signals', 'staff login'], transport: 'production MQTT forwarder / HTTP / native SSE / actual browser', notExercised: ['physical hardware', 'real model inference', 'AWS'] };
const brokerLog = [];
let browser, broker, device;
async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(50); }
  throw new Error('Timed out: ' + label);
}
function passed(check) { report.checks.push(check); console.log('PASS ' + check); }
const state = () => fetch(api.origin + '/api/state').then(response => response.json());
try {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(done => probe.close(done));
  broker = spawn(process.execPath, ['tools/mqtt-broker/broker.mjs'], { cwd: repository, windowsHide: true, env: { ...process.env, MQTT_PORT: String(port), HTTP_API_URL: api.origin + '/api/events', FORWARD_TO_HTTP: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  broker.stdout.on('data', chunk => brokerLog.push(chunk.toString()));
  broker.stderr.on('data', chunk => brokerLog.push(chunk.toString()));
  await waitFor(() => brokerLog.join('').includes('Local MQTT Broker running'), 'broker ready');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Native browser SSE points to the isolated API; real user data is never mutated.
  await context.addInitScript(({ origin }) => {
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url, options) { super(new URL(url, location.origin).pathname === '/api/stream' ? origin + '/api/stream' : url, options); }
    };
  }, { origin: api.origin });
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/stream') return route.continue();
    const response = await route.fetch({ url: api.origin + url.pathname + url.search });
    await route.fulfill({ response });
  });
  const shopper = await context.newPage(), admin = await context.newPage();
  for (const page of [shopper, admin]) page.on('pageerror', error => report.errors.push(error.message));
  await shopper.goto(frontend + '/shopper?basket=A');
  await admin.goto(frontend + '/admin'); await loginAdmin(admin);
  for (const page of [shopper, admin]) await page.getByRole('status').filter({ hasText: 'Realtime connected' }).waitFor();
  await shopper.getByRole('button', { name: /เริ่ม shopping session/ }).click();
  const text = (id, expected) => admin.waitForFunction(({ id, expected }) => document.querySelector(`[data-testid="${id}"]`)?.textContent === expected, { id, expected });
  const total = value => shopper.waitForFunction(value => document.querySelector('[class*="totalRow"] strong')?.textContent === `฿${value}`, value);
  await text('device-status', 'UNKNOWN');
  device = await mqtt.connectAsync('mqtt://127.0.0.1:' + port, { clientId: 'isolated-ESP32-telemetry-fixture' });
  await device.subscribeAsync('smartbasket/shelf/SHELF-01/acks');
  const acknowledgements = new Map();
  device.on('message', (_topic, payload) => { const id = payload.toString(); acknowledgements.set(id, (acknowledgements.get(id) || 0) + 1); });
  async function telemetry(uptimeMs, present, rssi = { A: -51, B: -72, HV01: -63 }) {
    await device.publishAsync('smartbasket/shelf/SHELF-01/telemetry', JSON.stringify({ shelfId: 'SHELF-01', source: 'DEVICE', uptimeMs, rssi, lanes: [{ laneId: 'LANE-1', present }, { laneId: 'LANE-2', present: false }], queueDepth: 0, droppedEvents: 0 }), { qos: 1 });
    await text('device-status', 'ONLINE'); await text('device-uptime', Math.floor(uptimeMs / 1000) + ' s');
  }
  async function event(eventId, eventType, rssi = { A: -51, B: -72 }) {
    const count = acknowledgements.get(eventId) || 0;
    await device.publishAsync('smartbasket/shelf/SHELF-01/events', JSON.stringify({ eventId, shelfId: 'SHELF-01', laneId: 'LANE-1', sku: 'COKE', eventType, rssi }), { qos: 1 });
    await waitFor(() => acknowledgements.get(eventId) > count, 'application ACK ' + eventId);
  }
  await telemetry(12000, true);
  await text('device-rssi-A', '-51 dBm'); await text('device-lane-LANE-1', 'PRESENT');
  const firstSeen = await admin.getByTestId('device-last-seen').getAttribute('datetime');
  await telemetry(13000, false, { A: -58, B: null, HV01: -65 });
  await text('device-rssi-A', '-58 dBm'); await text('device-rssi-B', '—'); await text('device-lane-LANE-1', 'EMPTY');
  assert.notEqual(await admin.getByTestId('device-last-seen').getAttribute('datetime'), firstSeen);
  await total(0); assert.equal((await state()).shelf.fsmState, 'IDLE');
  passed('MQTT telemetry persists and updates actual Admin via native SSE; heartbeat alone cannot mutate cart/FSM');
  await event('telemetry-pick', 'PICK'); await total(25);
  await event('telemetry-pick', 'PICK'); await total(25);
  assert.equal((await state()).baskets[0].lines[0].quantity, 1);
  await telemetry(14000, true); await total(25);
  await event('telemetry-return', 'PUT_BACK'); await total(0);
  passed('MQTT PICK / duplicate / PUT_BACK traverses FSM, database and Shopper realtime with correct totals');
  await event('telemetry-unknown', 'PICK', { A: -51, B: null });
  const unresolved = (await state()).cases[0];
  assert.equal(unresolved.type, 'ZONE_UNKNOWN'); assert.equal(unresolved.status, 'OPEN_STAFF');
  await total(0); assert.ok(await shopper.getByRole('button', { name: 'Mock checkout', exact: true }).isDisabled());
  await admin.getByRole('button', { name: new RegExp(unresolved.caseId) }).waitFor();
  passed('Missing basket tag creates staff case visible in Admin and blocks Shopper checkout without charging');
  await text('device-status', 'OFFLINE'); await text('device-rssi-A', '—'); await text('device-lane-LANE-1', 'UNKNOWN');
  assert.equal((await state()).shelf.fsmState, 'WAITING_STAFF'); await total(0);
  await telemetry(20000, false); await text('device-rssi-A', '-51 dBm');
  passed('Silent device goes OFFLINE without refresh and recovers on telemetry; unresolved transaction remains unchanged');
  for (const width of [320, 390, 768, 1440]) {
    await admin.setViewportSize({ width, height: 1000 });
    assert.ok(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Admin overflow at ' + width);
    if (width === 390 || width === 1440) await admin.locator('[aria-labelledby="proximity-heading"]').screenshot({ path: join(artifacts, `hardware-${width}.png`) });
  }
  const persisted = JSON.parse(await readFile(join(api.directory, 'state.json'), 'utf8'));
  assert.ok(persisted.telemetry.some(sample => sample.uptimeMs === 20000));
  assert.ok(persisted.events.some(event => event.eventId === 'telemetry-pick'));
  assert.deepEqual(report.errors, []);
  passed('Persisted event/telemetry verified; responsive hardware card at 320/390/768/1440; no browser runtime errors');
} finally {
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(artifacts, 'broker.log'), brokerLog.join(''));
  await browser?.close(); await device?.endAsync();
  if (broker && broker.exitCode === null) { const exit = once(broker, 'exit'); broker.kill(); await exit; }
  await api.close();
}
console.log('Telemetry integration evidence: ' + artifacts);
