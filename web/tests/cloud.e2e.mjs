import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';
import { createServer as httpsServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createStore } from '../../src/domain.mjs';
import { createCloudHandlers } from '../../src/cloud/handlers.mjs';
import { pairingCode } from '../../src/cloud/auth.mjs';
import { createAgentRuntime, createCloudToolsHandler } from '../../src/cloud/agent-runtime.mjs';

// Actual production Next BFF + native WSS; AWS, identity provider and model responses are explicit fixtures.
const root = fileURLToPath(new URL('../../', import.meta.url)), web = resolve(root, 'web');
const directory = resolve(root, 'data', `cloud-browser-${Date.now()}`); await mkdir(directory, { recursive: true });
const logs = [], checks = [], errors = [], control = new Map(), sockets = new Set(), challenges = new Map();
const secret = 'isolated-cloud-browser-secret-' + 'x'.repeat(32);
let connectionCount = 0;
let store = createStore(), server, frontend, browser;
async function processRun(file, args, options = {}) {
  const child = spawn(file, args, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => logs.push(chunk.toString())); child.stderr.on('data', chunk => logs.push(chunk.toString()));
  const [code] = await once(child, 'exit'); assert.equal(code, 0, logs.slice(-15).join('')); return child;
}
async function freePort() { const probe = tcpServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(done => probe.close(done)); return port; }
function passed(label) { checks.push(label); console.log('PASS ' + label); }
async function until(predicate, label, timeout = 30000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await predicate()) return; await delay(50); } throw new Error('Timeout: ' + label); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks).toString(); }
function changed() { for (const socket of sockets) if (socket.readyState === 1) socket.send('{"type":"STATE_CHANGED"}'); }
const repository = { async read() { return structuredClone(store); }, async mutate(fn) { const next = structuredClone(store), result = fn(next); store = next; changed(); return { result, store: structuredClone(store) }; } };
const services = {
  repository, key: async () => secret,
  verifyJwt: async token => { assert.equal(token, 'fixture-staff-token'); return { sub: 'staff-test', username: 'staff@test.invalid', 'cognito:groups': ['STAFF'], exp: Math.floor(Date.now() / 1000) + 3600 }; },
  get: async id => control.get(id), put: async item => control.set(item.id, item), scan: async filter => [...control.values()].filter(filter),
  async ticket() { const ticket = randomBytes(32).toString('base64url'); control.set(ticket, true); return { ticket, connectionExpiresAt: Math.floor(Date.now() / 1000) + 35 }; },
  async startWorkflow() {}, async acknowledge() {}, async resume() {},
};
const handlers = createCloudHandlers(services), tools = createCloudToolsHandler(repository);
services.invokeAgent = async input => {
  const actions = ['get_shelf_event', 'get_basket_evidence', 'get_cart_history', 'DECIDE'];
  return createAgentRuntime({ repository, toolFunctionArn: 'fixture-tools', planner: async () => ({ action: actions.shift(), model: 'BEDROCK_FIXTURE' }), decision: async () => ({ candidate: 'A', confidence: 0.82, model: 'LAYA_FIXTURE' }), lambda: { async send(command) { return { Payload: Buffer.from(JSON.stringify(await tools(JSON.parse(command.input.Payload)))) }; } } })(input);
};
const signal = (eventId, rssi, eventType = 'PICK') => handlers.ingest({ eventId, rssi, eventType, shelfId: 'SHELF-01', laneId: 'LANE-1', mqttTopic: 'smartbasket/shelf/SHELF-01/events', mqttClientId: 'SHELF-01' });
process.env.SHELF_ID = 'SHELF-01';
try {
  const openssl = process.env.OPENSSL_EXECUTABLE || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const cert = join(directory, 'local.crt'), privateKey = join(directory, 'local.key');
  await processRun(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', privateKey, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE']);
  const frontPort = await freePort(), origin = 'http://localhost:' + frontPort;
  server = httpsServer({ key: await readFile(privateKey), cert: await readFile(cert) }, async (request, response) => {
    try {
      const url = new URL(request.url, 'https://localhost');
      if (url.pathname === '/oauth2/authorize') {
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        const code = randomBytes(12).toString('hex'); challenges.set(code, url.searchParams.get('code_challenge'));
        const callback = new URL(url.searchParams.get('redirect_uri')); callback.searchParams.set('code', code); callback.searchParams.set('state', url.searchParams.get('state'));
        response.writeHead(302, { location: callback.href }); return response.end();
      }
      if (url.pathname === '/oauth2/token') {
        const params = new URLSearchParams(await body(request));
        assert.equal(challenges.get(params.get('code')), createHash('sha256').update(params.get('code_verifier')).digest('base64url')); challenges.delete(params.get('code'));
        response.writeHead(200, { 'content-type': 'application/json' }); return response.end(JSON.stringify({ access_token: 'fixture-staff-token', expires_in: 3600 }));
      }
      if (url.pathname === '/logout') { response.writeHead(302, { location: url.searchParams.get('logout_uri') }); return response.end(); }
      const result = await handlers.api({ rawPath: url.pathname, requestContext: { http: { method: request.method } }, headers: request.headers, body: await body(request) });
      response.writeHead(result.statusCode, result.headers); response.end(result.body);
    } catch (error) { errors.push(error.message); response.writeHead(500); response.end('{}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const backend = 'https://localhost:' + server.address().port;
  const ws = new WebSocketServer({ server });
  ws.on('connection', (socket, request) => {
    const ticket = new URL(request.url, backend).searchParams.get('ticket');
    if (!control.get(ticket)) return socket.close(1008);
    control.delete(ticket); connectionCount++; sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  });
  const env = { ...process.env, NEXT_PUBLIC_CLOUD_MODE: 'true', NEXT_DIST_DIR: '.next-cloud', NEXT_TELEMETRY_DISABLED: '1', CLOUD_API_ORIGIN: backend, COGNITO_DOMAIN: backend, COGNITO_CLIENT_ID: 'fixture-client', WEB_ORIGIN: origin, CLOUD_WEBSOCKET_URL: backend.replace('https:', 'wss:'), NODE_EXTRA_CA_CERTS: cert };
  await processRun(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { cwd: web, env });
  frontend = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(frontPort), '--hostname', '127.0.0.1'], { cwd: web, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  frontend.stdout.on('data', chunk => logs.push(chunk.toString())); frontend.stderr.on('data', chunk => logs.push(chunk.toString()));
  await until(async () => { if (frontend.exitCode !== null) throw new Error(logs.slice(-10).join('')); try { return (await fetch(origin)).ok; } catch { return false; } }, 'production Next server', 60000);
  browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] }); // Test-only local CA, not application TLS configuration.
  const aContext = await browser.newContext({ ignoreHTTPSErrors: true }), bContext = await browser.newContext({ ignoreHTTPSErrors: true }), staffContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const a = await aContext.newPage(), b = await bContext.newPage(), admin = await staffContext.newPage();
  for (const page of [a, b, admin]) page.on('pageerror', error => errors.push(error.message));
  await admin.goto(origin + '/admin'); await admin.getByRole('button', { name: 'เข้าสู่ระบบพนักงาน', exact: true }).click();
  await admin.getByRole('button', { name: 'ออกจากระบบ', exact: true }).waitFor();
  await admin.getByRole('status').filter({ hasText: 'เชื่อมต่อแล้ว' }).waitFor();
  assert.ok((await staffContext.cookies()).some(cookie => cookie.name === 'basketly-staff' && cookie.httpOnly && cookie.secure));
  assert.ok(!JSON.stringify(await admin.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).includes('fixture-staff-token'));
  assert.equal(await admin.getByText('เครื่องมือทดสอบ', { exact: true }).count(), 0);
  const csrf = await staffContext.request.post(origin + '/api/checkout', { data: { basketId: 'A' }, headers: { origin: 'https://attacker.invalid' } }); assert.equal(csrf.status(), 403);
  passed('Production Cognito code/PKCE BFF contract, HttpOnly secure cookies, staff access and CSRF rejection');
  for (const [page, basket] of [[a, 'A'], [b, 'B']]) {
    await page.goto(origin + '/shopper?' + new URLSearchParams({ basket, code: pairingCode(secret, basket) }));
    await page.getByRole('status').filter({ hasText: 'เชื่อมต่อแล้ว' }).waitFor();
    await page.getByRole('button', { name: /เริ่มช้อป/ }).click();
    await page.getByText('เชื่อมแล้ว', { exact: true }).waitFor();
  }
  const total = (page, value) => page.waitForFunction(value => document.querySelector('[class*="totalRow"] strong')?.textContent === `฿${value}`, value);
  await signal('cloud-browser-clear', { A: -51, B: -72 }); await total(a, 25); await total(b, 0);
  await signal('cloud-browser-clear', { A: -51, B: -72 }); await total(a, 25);
  await signal('cloud-browser-return', { A: -51, B: -72 }, 'PUT_BACK'); await total(a, 0);
  assert.ok((await aContext.cookies()).some(cookie => cookie.name === 'basketly-shopper-A' && cookie.httpOnly && cookie.secure));
  const foreign = await a.evaluate(() => fetch('/api/state', { headers: { 'x-basket-id': 'B' } }).then(response => response.json())); assert.equal(foreign.baskets.find(item => item.basketId === 'B').session, null);
  passed('Signed QR basket pairing, scoped cookies and native WSS invalidation update A/B correctly for PICK/duplicate/PUT_BACK');
  await signal('cloud-browser-ambiguous', { A: -55, B: -57 });
  await handlers.investigate({ caseId: 'CASE-001', investigate: true });
  await handlers.handoff({ caseId: 'CASE-001', stage: 'CUSTOMER', taskToken: 'fixture-private-token' });
  await a.getByRole('button', { name: 'ใช่, ฉันหยิบ', exact: true }).click(); await total(a, 25);
  await signal('cloud-browser-unknown', { A: -51, B: null }); await handlers.handoff({ caseId: 'CASE-002', stage: 'STAFF', taskToken: 'fixture-staff-token' });
  await admin.getByRole('button', { name: /CASE-002/ }).click(); await admin.getByRole('button', { name: 'Reject', exact: true }).click();
  await a.getByRole('button', { name: 'ชำระเงิน', exact: true }).click();
  await a.getByRole('heading', { name: 'ขอบคุณที่ช้อปกับเรา' }).waitFor();
  assert.equal(store.orders.length, 1); assert.equal(store.orders[0].total, 25); assert.equal(store.carts.A.COKE, undefined);
  passed('Production web customer YES, staff rejection and checkout reach actual shared cloud handlers/domain without unconfirmed charges');
  await admin.getByRole('button', { name: 'คืน Basket B', exact: true }).click();
  await until(() => store.activeSessions.B === null, 'staff release empty basket');
  await handlers.ingest({ shelfId: 'SHELF-01', mqttClientId: 'SHELF-01', mqttTopic: 'smartbasket/shelf/SHELF-01/telemetry', rssi: { A: -51, B: -72 }, uptimeMs: 123000, lanes: [{ laneId: 'LANE-1', present: true }, { laneId: 'LANE-2', present: false }] });
  await admin.getByTestId('device-status').filter({ hasText: 'ONLINE' }).waitFor();
  const beforeRenewal = connectionCount;
  await admin.getByTestId('device-status').filter({ hasText: 'OFFLINE' }).waitFor();
  assert.ok(connectionCount > beforeRenewal, 'Native WebSocket renews before its connection authorization expires');
  passed('Staff can release an empty resolved basket; cloud device expiry refreshes to OFFLINE without manual reload');
  assert.deepEqual(errors, []);
  await admin.screenshot({ path: join(directory, 'cloud-admin.png'), fullPage: true });
  await a.screenshot({ path: join(directory, 'cloud-shopper.png'), fullPage: true });
  await admin.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await admin.getByRole('button', { name: 'เข้าสู่ระบบพนักงาน', exact: true }).waitFor();
  assert.ok(!(await staffContext.cookies()).some(cookie => cookie.name === 'basketly-staff'));
  passed('Hosted logout clears staff cookie; no browser runtime errors');
} finally {
  await browser?.close();
  if (frontend && frontend.exitCode === null) { const exited = once(frontend, 'exit'); frontend.kill(); await exited; }
  for (const socket of sockets) socket.terminate();
  if (server) await new Promise(done => server.close(done));
  await writeFile(join(directory, 'report.json'), JSON.stringify({ checks, errors, fixtures: ['Cognito issuer/JWT verification', 'AWS persistence/API/Lambda/Step Functions services', 'Bedrock and Laya model responses'], real: ['production Next build/server', 'HTTPS BFF', 'OAuth PKCE validation', 'HttpOnly cookies', 'native secure WebSocket', 'domain/cloud handler code'], cloudResourcesCreated: false }, null, 2));
  await writeFile(join(directory, 'frontend.log'), logs.join(''));
}
console.log('Cloud browser evidence: ' + directory);
