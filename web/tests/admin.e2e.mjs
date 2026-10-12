import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startLocalApi } from './helpers/local-api.mjs';

const api = await startLocalApi();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const faults = {load:false, loseDecision:false};
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if(url.pathname==='/api/state' && faults.load) {await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test dashboard unavailable'})});return;}
    const response = await route.fetch({ url: api.origin + url.pathname + url.search });
    if(url.pathname.endsWith('/staff') && faults.loseDecision) {faults.loseDecision=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test decision response lost'})});return;}
    await route.fulfill({ response });
  });
  const post = async (path, data = {}) => {
    const response = await page.request.post(api.origin + path, { data });
    assert.ok(response.ok(), await response.text());
    return response.json();
  };
  const event = (eventId, rssi, eventType = 'PICK', laneId = 'LANE-1') => post('/api/events', { eventId, laneId, eventType, rssi });
  const refresh = async () => {
    await page.getByRole('button', { name: 'อัปเดต dashboard', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role="status"][class*="loading"]'));
  };
  const detail = () => page.getByRole('region', { name: /^CASE-/ });
  await page.goto(`${process.env.SHOPPER_TEST_ORIGIN ?? 'http://localhost:3001'}/admin`);
  await page.getByRole('heading', { name: 'ไม่มีเคสในหมวดนี้' }).waitFor();
  await post('/api/sessions', { basketId: 'A' });
  await post('/api/sessions', { basketId: 'B' });
  await event('admin-clear', { A: -48, B: -73 });
  const unknown = await event('admin-unknown', { A: null, B: null });
  const ambiguous = await event('admin-ambiguous', { A: -57, B: -55 });
  await refresh();
  await detail().getByText('Agent confidence · simulation').waitFor();
  await detail().getByText('82%', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'รอพนักงาน', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(unknown.caseId) }).click();
  await detail().getByText('ZONE_UNKNOWN', { exact: true }).waitFor();
  await detail().getByText('ยังระบุไม่ได้', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'รอลูกค้า', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(ambiguous.caseId) }).click();
  await detail().getByText(/รอคำตอบจากลูกค้า/).waitFor();
  assert.equal(await detail().getByRole('button', { name: /Approve|Reject/ }).count(), 0, 'Waiting-customer cases must not expose staff actions');
  await page.getByRole('heading', { name: 'Case timeline' }).waitFor();
  const artifacts = process.env.SHOPPER_TEST_ARTIFACT_DIR ?? api.directory;
  await mkdir(artifacts, { recursive: true });
  for (const [width, height] of [[320,740],[375,812],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} page overflow`);
    const clipped = await page.locator('main button, main [class*="card"]').evaluateAll(elements => elements.filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2);
    }).map(element => element.textContent?.slice(0,100)));
    assert.deepEqual(clipped, [], `${width} clipped controls`);
    if (width === 390 || width === 1440) await page.screenshot({ path: join(artifacts, `admin-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button', {name:'รอพนักงาน',exact:true}).click();
  await page.getByRole('button', {name:new RegExp(unknown.caseId)}).click();
  assert.equal(await detail().getByRole('button',{name:'Approve',exact:true}).isDisabled(),true);
  await detail().getByRole('radio',{name:/Basket B/}).check();
  let decisions=0;
  page.on('request',request=>{if(request.method()==='POST' && request.url().endsWith('/staff'))decisions++;});
  await detail().getByRole('button',{name:'Approve → B',exact:true}).evaluate(button=>{button.click();button.click();});
  await detail().getByText('STAFF · APPROVE · Basket B',{exact:true}).waitFor();
  assert.equal(decisions,1,'Double click must send one decision');
  let snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());
  assert.equal(snapshot.baskets[1].total,25);
  assert.equal(await detail().getByRole('button',{name:/Approve|Reject/}).count(),0,'Closed cases are read-only');
  await post(`/api/cases/${ambiguous.caseId}/customer`,{answer:'NO'});await refresh();
  await page.getByRole('button',{name:new RegExp(ambiguous.caseId)}).click();
  await detail().getByRole('button',{name:'Reject',exact:true}).click();
  await detail().getByText('STAFF · REJECT',{exact:true}).waitFor();
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());assert.equal(snapshot.baskets[1].total,25);
  await event('admin-return',{A:-48,B:-73},'PUT_BACK');
  const conflict=await event('admin-conflict',{A:-48,B:-73},'PUT_BACK');await refresh();
  await page.getByRole('button',{name:new RegExp(conflict.caseId)}).click();
  assert.equal(await detail().getByRole('button',{name:'Approve → A',exact:true}).isDisabled(),true,'Unmatched return cannot be approved');
  await detail().getByRole('button',{name:'Reject',exact:true}).click();await detail().getByText('STAFF · REJECT',{exact:true}).waitFor();
  await post('/api/checkout',{basketId:'B'});
  const missing=await event('admin-missing',{A:-73,B:-48});await refresh();
  await page.getByRole('button',{name:new RegExp(missing.caseId)}).click();
  assert.equal(await detail().getByRole('button',{name:'Approve → B',exact:true}).isDisabled(),true,'Inactive basket approval is blocked');
  await detail().getByRole('radio',{name:/Basket A/}).check();
  await detail().getByRole('button',{name:'Approve → A',exact:true}).click();
  await detail().getByText('STAFF · APPROVE · Basket A',{exact:true}).waitFor();
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());assert.equal(snapshot.baskets[0].total,25);
  await page.getByRole('button',{name:'ปิดแล้ว',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:/CASE-/}).count(),4);
  // The simulator and staff tools work on the new Admin route.
  await page.locator('summary').filter({hasText:'Local simulator'}).click();
  await page.getByLabel('Shelf lane').selectOption('LANE-2');
  await page.getByRole('button',{name:'Clear pick → A',exact:true}).click();
  await page.getByRole('status').filter({hasText:'PICK · Basket A · ยืนยันแล้ว'}).waitFor();
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());assert.equal(snapshot.baskets[0].total,40);
  await page.getByRole('button',{name:'Duplicate delivery',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Duplicate event ถูกข้าม'}).waitFor();
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());assert.equal(snapshot.baskets[0].total,40);
  await page.getByRole('button',{name:'Put back → A',exact:true}).click();
  await page.getByRole('status').filter({hasText:'PUT_BACK · Basket A · ยืนยันแล้ว'}).waitFor();
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());assert.equal(snapshot.baskets[0].total,25);
  await page.getByRole('button',{name:'Unknown zone',exact:true}).click();
  await page.getByRole('status').filter({hasText:'รอการตรวจสอบ'}).waitFor();
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());
  const staleCase=snapshot.cases[0];
  await page.getByRole('button',{name:'รอพนักงาน',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(staleCase.caseId)}).click();
  await detail().getByRole('radio',{name:/Basket A/}).check();
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Staff/simulator overflow at ${width}`);
    const clipped=await page.locator('main button, main [class*="card"]').evaluateAll(elements=>elements.filter(element=>element.getBoundingClientRect().width>0 && element.scrollWidth>element.clientWidth+2).map(element=>element.textContent?.slice(0,100)));
    assert.deepEqual(clipped,[],`Staff/simulator controls clipped at ${width}`);
    if(width===390 || width===1440) await page.screenshot({path:join(artifacts,`admin-actions-${width}.png`),fullPage:true});
  }
  faults.load=true;await refresh();
  await page.getByRole('alert').filter({hasText:'Test dashboard unavailable'}).waitFor();
  assert.equal(await detail().getByRole('button',{name:'Approve → A',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Unknown zone',exact:true}).isDisabled(),true);
  faults.load=false;await refresh();
  await post(`/api/cases/${staleCase.caseId}/staff`,{decision:'REJECT'});
  await detail().getByRole('button',{name:'Approve → A',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Case is already closed'}).waitFor();
  assert.equal(await detail().getByRole('button',{name:/Approve|Reject/}).count(),0);
  const lost=await event('admin-lost',{A:null,B:null});await refresh();
  await page.getByRole('button',{name:new RegExp(lost.caseId)}).click();await detail().getByRole('radio',{name:/Basket A/}).check();
  const beforeLost=decisions;faults.loseDecision=true;
  await detail().getByRole('button',{name:'Approve → A',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Test decision response lost'}).waitFor();
  await detail().getByText('STAFF · APPROVE · Basket A',{exact:true}).waitFor();
  assert.equal(decisions,beforeLost+1,'Uncertain response must not retry decision');
  snapshot=await page.request.get(api.origin+'/api/state').then(response=>response.json());assert.equal(snapshot.baskets[0].total,50);
  // A second UI reads the same persisted local state; realtime comes in Phase 6.
  await page.goto(`${process.env.SHOPPER_TEST_ORIGIN ?? 'http://localhost:3001'}/shopper?basket=A`);
  await page.waitForFunction(()=>document.querySelector('[class*="totalRow"] strong')?.textContent==='฿50');
  assert.deepEqual(errors, []);
  console.log('PASS Admin overview/cases/decisions, simulator, stale-data/concurrent-case/uncertain-response recovery, Shopper consistency, and responsive sizes.');
} finally { await browser?.close(); await api.close(); }
