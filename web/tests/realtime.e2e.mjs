import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startLocalApi } from './helpers/local-api.mjs';
import { loginAdmin } from './helpers/mock-login.mjs';

const frontend=process.env.SHOPPER_TEST_ORIGIN ?? 'http://localhost:3001';
const api=await startLocalApi({corsOrigin:new URL(frontend).origin});
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext();
  const artifacts=process.env.SHOPPER_TEST_ARTIFACT_DIR ?? api.directory;
  await mkdir(artifacts,{recursive:true});
  await context.addInitScript(({origin})=>{
    // Real native SSE, directed to the isolated backend instead of the team's demo data.
    const NativeEventSource=window.EventSource;
    window.EventSource=class extends NativeEventSource {
      constructor(url,options){super(new URL(url,location.origin).pathname==='/api/stream' ? origin+'/api/stream' : url,options);}
    };
  },{origin:api.origin});
  const errors=[];
  let getRequests=0;
  let mutations=0;
  let holdGet=false;
  let releaseHeld;
  let heldReady;
  const apiPost=async(path,data={})=>{
    const response=await context.request.post(api.origin+path,{data});
    assert.ok(response.ok(),await response.text());return response.json();
  };
  const event=(id,rssi,eventType='PICK',laneId='LANE-1')=>apiPost('/api/events',{eventId:id,shelfId:laneId==='LANE-2'?'SHELF-02':'SHELF-01',rssi,eventType,laneId});
  async function open(path) {
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error' && !message.text().startsWith('Failed to load resource:'))errors.push(message.text());});
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/stream') {await route.continue();return;}
      if(route.request().method()==='POST')mutations++;
      if(url.pathname==='/api/state')getRequests++;
      try {
        const response=await route.fetch({url:api.origin+url.pathname+url.search});
        if(holdGet && path.includes('basket=B') && url.pathname==='/api/state') {
          holdGet=false;
          const body=await response.body();
          await new Promise(resolveRelease=>{releaseHeld=resolveRelease;heldReady();});
          await route.fulfill({status:response.status(),contentType:'application/json',body});return;
        }
        await route.fulfill({response});
      } catch {await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test backend stopped'})});}
    });
    await page.goto(frontend+path);
    if (path === '/admin') await loginAdmin(page);
    await page.getByRole('status').filter({hasText:'เชื่อมต่อแล้ว'}).waitFor();
    return page;
  }
  const total=async(page,value)=>page.waitForFunction(value=>document.querySelector('[class*="totalRow"] strong')?.textContent===value,value);
  const subscribers=async()=>context.request.get(api.origin+'/__test/subscribers').then(response=>response.json()).then(value=>value.count);
  async function responsive(page,label) {
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} overflow at ${width}`);
      const clipped=await page.locator('main button').evaluateAll(elements=>elements.filter(element=>element.getBoundingClientRect().width>0 && element.scrollWidth>element.clientWidth+2).map(element=>element.textContent));
      assert.deepEqual(clipped,[],`${label} controls clipped at ${width}`);
      if(width===390)await page.screenshot({path:join(artifacts,`${label}-390.png`),fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
  }
  const shopperA=await open('/shopper?basket=A');
  const shopperB=await open('/shopper?basket=B');
  const admin=await open('/admin');
  await responsive(shopperA,'live-shopper');await responsive(admin,'live-admin');
  assert.equal(await subscribers(),3,'One SSE stream per tab, including React Strict Mode');
  await shopperA.getByRole('button',{name:/เริ่มช้อป/}).click();
  await shopperB.getByRole('button',{name:/เริ่มช้อป/}).click();
  await shopperA.getByText('เชื่อมแล้ว',{exact:true}).waitFor();await shopperB.getByText('เชื่อมแล้ว',{exact:true}).waitFor();
  await admin.locator('summary').filter({hasText:'Local simulator'}).click();
  await admin.getByRole('button',{name:'Clear pick → A',exact:true}).click();
  await total(shopperA,'฿25');
  await admin.getByRole('status').filter({hasText:'PICK · Basket A · ยืนยันแล้ว'}).waitFor();
  await admin.getByRole('button',{name:'Duplicate delivery',exact:true}).click();
  await admin.getByRole('status').filter({hasText:'Duplicate event'}).waitFor();await total(shopperA,'฿25');
  await admin.getByRole('button',{name:'Ambiguous pick',exact:true}).click();
  await shopperA.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).click();await total(shopperA,'฿50');
  await admin.getByRole('button',{name:'Ambiguous pick',exact:true}).click();
  await shopperA.getByRole('button',{name:'ไม่ใช่, ให้พนักงานดู',exact:true}).click();
  const rejectedCase=(await context.request.get(api.origin+'/api/state').then(response=>response.json())).cases[0];
  await admin.getByRole('button',{name:new RegExp(rejectedCase.caseId)}).click();
  await admin.getByRole('button',{name:'Reject',exact:true}).click();
  await shopperA.getByRole('heading',{name:'พนักงานกำลังตรวจสอบ'}).waitFor({state:'hidden'});
  const unknown=await event('live-unknown',{A:null,B:null});
  await shopperA.getByRole('heading',{name:'พนักงานกำลังตรวจสอบ'}).waitFor();
  assert.equal(await shopperA.getByRole('button',{name:'ชำระเงิน',exact:true}).isDisabled(),true);
  await admin.getByRole('button',{name:new RegExp(unknown.caseId)}).click();
  await admin.getByRole('radio',{name:/Basket B/}).check();
  await admin.getByRole('button',{name:'Approve → B',exact:true}).click();
  await total(shopperB,'฿25');
  await shopperA.getByRole('button',{name:'ชำระเงิน',exact:true}).click();
  await shopperA.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
  await event('live-return',{A:-73,B:-48},'PUT_BACK');await total(shopperB,'฿0');
  await event('live-multi-1',{A:-57,B:-55},'PICK','LANE-2');
  await event('live-multi-2',{A:-57,B:-55},'PICK','LANE-2');
  await shopperB.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).click();await total(shopperB,'฿15');
  assert.equal(await shopperB.getByRole('button',{name:'ชำระเงิน',exact:true}).isDisabled(),true);
  await shopperB.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).click();await total(shopperB,'฿30');

  // Deliberately release an older GET after a newer stream update.
  holdGet=true;
  const held=new Promise(resolveReady=>{heldReady=resolveReady;});
  await shopperB.getByRole('button',{name:'อัปเดตตะกร้า',exact:true}).click();await held;
  await event('live-newer',{A:-73,B:-48},'PICK','LANE-2');await total(shopperB,'฿45');
  releaseHeld();await shopperB.waitForTimeout(200);await total(shopperB,'฿45');
  const idleGets=getRequests;
  await shopperB.waitForTimeout(1000);
  assert.equal(getRequests,idleGets,'Healthy realtime must not poll /api/state');

  const beforeOutage=mutations;
  await api.stop();
  for(const page of [shopperA,shopperB,admin])await page.getByRole('status').filter({hasText:/กำลังเชื่อมต่อใหม่/}).waitFor();
  await total(shopperB,'฿45');
  assert.equal(await shopperB.getByRole('button',{name:'ชำระเงิน',exact:true}).isDisabled(),true);
  assert.equal(await admin.getByRole('button',{name:'Clear pick → A',exact:true}).isDisabled(),true);
  await responsive(shopperB,'disconnected-shopper');await responsive(admin,'disconnected-admin');
  await api.restart();
  for(const page of [shopperA,shopperB,admin])await page.getByRole('status').filter({hasText:'เชื่อมต่อแล้ว'}).waitFor();
  await total(shopperB,'฿45');assert.equal(mutations,beforeOutage,'Reconnect must not replay mutations');
  assert.equal(await subscribers(),3);
  await shopperA.close();await admin.close();

  // Advance browser timers to exercise the full retry cap without waiting a minute.
  await shopperB.clock.install();
  await context.request.get(api.origin+'/__test/invalid');
  await shopperB.getByRole('status').filter({hasText:/1\/5/}).waitFor();
  for(const [index,delay] of [1500,3000,6000,12000,30000].entries()) {
    await shopperB.clock.runFor(delay);
    await shopperB.getByRole('status').filter({hasText:index===4?/ออฟไลน์/:`${index+2}/5`}).waitFor();
  }
  assert.equal(await subscribers(),0,'Retry exhaustion must close the stream');
  assert.equal(await shopperB.getByRole('button',{name:'ชำระเงิน',exact:true}).isDisabled(),true);
  await context.request.get(api.origin+'/__test/valid');
  await shopperB.getByRole('button',{name:'อัปเดตตะกร้า',exact:true}).click();
  await shopperB.getByRole('status').filter({hasText:'เชื่อมต่อแล้ว'}).waitFor();
  await total(shopperB,'฿45');assert.equal(await subscribers(),1);
  await shopperB.goto(frontend+'/shopper/preview');
  await shopperB.getByText('Preview screen states',{exact:false}).waitFor();
  await shopperB.clock.runFor(1); // Run the store's deferred Strict Mode cleanup.
  assert.equal(await subscribers(),0,'Navigating to fixture preview must close SSE');
  assert.deepEqual(errors,[]);
  console.log('PASS native SSE: three-tab workflows, one stream per tab, no polling, GET/stream race, disconnect/restart, bounded retries, no mutation replay, cleanup and preview isolation.');
} finally {await browser?.close();await api.close();}
