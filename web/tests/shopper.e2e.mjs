import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startLocalApi } from './helpers/local-api.mjs';

const backend = await startLocalApi();
const temporary = backend.directory;
const artifacts = process.env.SHOPPER_TEST_ARTIFACT_DIR ?? temporary;
await mkdir(artifacts, {recursive:true});
const api = backend.origin;
let browser;
try {
browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})});
const page=await browser.newPage({viewport:{width:390,height:844}});
const errors=[];
const faults={load:false,malformed:false,rejectCheckout:false,loseConfirmation:false};
  await page.addInitScript(() => { window.EventSource = undefined; });
page.on('pageerror',error=>errors.push(error.message));
page.on('console',msg=>{if(msg.type()==='error' && !msg.text().startsWith('Failed to load resource:'))errors.push(msg.text());});
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());
 if(url.pathname==='/api/state' && faults.load) {await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test backend temporarily unavailable'})});return;}
 if(url.pathname==='/api/state' && faults.malformed) {await route.fulfill({status:200,contentType:'application/json',body:'null'});return;}
 if(url.pathname==='/api/checkout' && faults.rejectCheckout) {await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Test checkout rejected'})});return;}
 const response=await route.fetch({url:api+url.pathname+url.search});
 if(url.pathname.endsWith('/customer') && faults.loseConfirmation) {faults.loseConfirmation=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Test response lost after mutation'})});return;}
 await route.fulfill({response});
});
const post=async(path,data={})=>{const r=await page.request.post(api+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
const refresh=async()=>{await page.getByRole('button',{name:'อัปเดตตะกร้า',exact:true}).click();await page.getByRole('button',{name:'อัปเดตตะกร้า',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('section[aria-busy="true"]'));};
const cart=()=>page.getByRole('region',{name:/รายการของคุณ/});
const total=async value=>{await page.waitForFunction(value=>document.querySelector('[class*="totalRow"] strong')?.textContent===value,value);};
const responsive=async label=>{
 for(const [width,height] of [[320,740],[375,812],[390,844],[768,1024],[1024,768],[1440,900],[844,390]]) {
  await page.setViewportSize({width,height});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label}: page overflow at ${width}x${height}`);
  const overflow=await page.locator('main button, main [class*="cartLine"], main dialog[open]').evaluateAll(elements=>elements.filter(element=>{
   const rect=element.getBoundingClientRect();
   return rect.width>0 && (rect.left < -1 || rect.right > innerWidth+1 || element.scrollWidth>element.clientWidth+2);
  }).map(element=>element.textContent?.trim()));
  assert.deepEqual(overflow,[],`${label}: clipped controls at ${width}x${height}`);
  if(width===390 || width===1440) await page.screenshot({path:join(artifacts,`${label}-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});
};
 await post('/api/reset');
 await page.goto(`${process.env.SHOPPER_TEST_ORIGIN ?? 'http://localhost:3001'}/shopper`);
 await page.getByRole('button',{name:/เริ่มช้อป/}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('section[aria-busy="true"]'));
 await responsive('connection');
 await page.getByRole('radio',{name:/Basket B/}).check();
 await page.getByRole('button',{name:/เริ่มช้อป/}).click();
 await page.getByText('เชื่อมแล้ว',{exact:true}).waitFor();
 const snapshot=await page.request.get(api+'/api/state').then(r=>r.json());
 assert.equal(snapshot.baskets[1].session.status,'ACTIVE');
 await post('/api/events',{eventId:'test-step1',shelfId:'SHELF-02',laneId:'LANE-2',eventType:'PICK',rssi:{A:-73,B:-48}});
 await refresh();await total('฿15');
 await cart().getByRole('heading',{name:'Sprite Plus Tea',exact:true}).waitFor();
 await page.reload();await total('฿15');
 assert.equal(await page.getByRole('radio',{name:/Basket B/}).isChecked(),true);
 const event=async(id,rssi={A:-73,B:-48},eventType='PICK',laneId='LANE-1')=>post('/api/events',{eventId:id,shelfId:laneId==='LANE-2'?'SHELF-02':'SHELF-01',laneId,eventType,rssi});
 const check=()=>page.getByRole('button',{name:'ชำระเงิน',exact:true});
 await event('step2-clear');await refresh();await total('฿40');
 await responsive('cart');
 await event('step2-clear');await refresh();await total('฿40');
 await event('step2-confirm',{A:-57,B:-55});await refresh();await total('฿40');
 await responsive('confirmation');
 assert.equal(await check().isDisabled(),true);
 let confirmations=0; page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/customer'))confirmations++;});
 await page.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).evaluate(button=>{button.click();button.click();});
 await total('฿65');assert.equal(confirmations,1,'double click must submit once');
 await event('step2-return',{A:-57,B:-55},'PUT_BACK');await refresh();
 await page.getByRole('button',{name:'ใช่, ฉันคืน',exact:true}).click();await total('฿40');
 await event('step2-no',{A:-57,B:-55});await refresh();
 await page.getByRole('button',{name:'ไม่ใช่, ให้พนักงานดู',exact:true}).click();
 await page.getByRole('heading',{name:'พนักงานกำลังตรวจสอบ'}).waitFor();await total('฿40');
 await responsive('staff-review');
 let state=await page.request.get(api+'/api/state').then(r=>r.json());
 await post(`/api/cases/${state.cases[0].caseId}/staff`,{decision:'REJECT'});await refresh();
 await event('step2-multi-1',{A:-57,B:-55},'PICK','LANE-2');
 await event('step2-multi-2',{A:-57,B:-55},'PICK','LANE-2');await refresh();
 await page.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).click();await total('฿55');assert.equal(await check().isDisabled(),true);
 await page.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).click();await total('฿70');
 await event('step2-unknown',{A:null,B:null});await refresh();assert.equal(await check().isDisabled(),true);
 state=await page.request.get(api+'/api/state').then(r=>r.json());await post(`/api/cases/${state.cases[0].caseId}/staff`,{decision:'REJECT'});await refresh();
 await check().click();await page.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
 assert.equal(await cart().locator('[class*="receiptTotal"] dd').innerText(),'฿70');
 await responsive('receipt');
 state=await page.request.get(api+'/api/state').then(r=>r.json());assert.equal(state.baskets[1].session,null);assert.equal(state.baskets[1].lines.length,0);
 await page.reload();await page.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
 await page.getByRole('button',{name:'เตรียมช้อปครั้งใหม่',exact:true}).click();
 await page.getByRole('button',{name:/เริ่มช้อป/}).click();await page.getByText('เชื่อมแล้ว',{exact:true}).waitFor();
 await page.getByRole('button',{name:'สแกนตะกร้า',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 await page.getByRole('button',{name:'ใช้ Basket A',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByText('เชื่อมแล้ว',{exact:true}).waitFor();
 state=await page.request.get(api+'/api/state').then(r=>r.json());assert.equal(state.baskets[0].session.status,'ACTIVE');
 await page.reload();assert.ok(page.url().includes('basket=A'));
 await page.getByRole('button',{name:'สแกนตะกร้า',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('section[aria-busy="true"]'));
 await page.evaluate(()=>{
  window.__qr='';window.__stopCount=0;window.__deny=false;
  window.BarcodeDetector=class {static async getSupportedFormats(){return ['qr_code'];}async detect(){return window.__qr?[{rawValue:window.__qr}]:[];}};
  navigator.mediaDevices.getUserMedia=async()=>{
   if(window.__deny)throw new DOMException('denied','NotAllowedError');
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;
   const stream=canvas.captureStream(5);
   const frames=setInterval(()=>{canvas.getContext('2d').fillStyle='black';canvas.getContext('2d').fillRect(0,0,320,240);},100);
   stream.getTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{clearInterval(frames);window.__stopCount++;stop();};});
   return stream;
  };
 });
 await page.getByRole('button',{name:'สแกนตะกร้า',exact:true}).click();
 await page.getByRole('status').filter({hasText:'วาง QR'}).waitFor();
 await page.evaluate(()=>{window.__qr='https://example.com/?basket=C';});
 await page.getByRole('status').filter({hasText:'QR ไม่ถูกต้อง'}).waitFor();
 await page.evaluate(()=>{window.__qr='https://example.com/?basket=B';});
 await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.waitForFunction(()=>!document.querySelector('section[aria-busy="true"]'));
 assert.equal(await page.getByRole('radio',{name:/Basket B/}).isChecked(),true);
 assert.ok(await page.evaluate(()=>window.__stopCount)>0,'camera tracks stopped after QR success');
 await page.evaluate(()=>{window.__qr='';window.__deny=true;});
 await page.getByRole('button',{name:'สแกนตะกร้า',exact:true}).click();
 await page.getByRole('status').filter({hasText:'ไม่ได้รับอนุญาต'}).waitFor();
 await responsive('scanner');
 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.evaluate(()=>{window.__deny=false;});
 await page.getByRole('button',{name:'สแกนตะกร้า',exact:true}).click();await page.getByRole('status').filter({hasText:'วาง QR'}).waitFor();
 const stopBefore=await page.evaluate(()=>window.__stopCount);
 await page.getByRole('button',{name:'ปิดกล้อง',exact:true}).click();
 assert.ok(await page.evaluate(()=>window.__stopCount)>stopBefore,'camera tracks stopped after close');
 for (const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' overflow');}
 await page.screenshot({path:join(temporary,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(temporary,'mobile.png'),fullPage:true});
 // Mutations are never blindly retried after an uncertain response.
 await event('failure-base');await refresh();await total('฿25');
 await event('failure-confirm',{A:-57,B:-55});await refresh();
 const beforeLost=confirmations;faults.loseConfirmation=true;
 await page.getByRole('button',{name:'ใช่, ฉันหยิบ',exact:true}).click();
 await total('฿50');await page.getByRole('alert').filter({hasText:'Test response lost'}).waitFor();
 assert.equal(confirmations,beforeLost+1);
 await refresh();
 faults.rejectCheckout=true;await check().click();await page.getByRole('alert').filter({hasText:'Test checkout rejected'}).waitFor();await total('฿50');
 faults.rejectCheckout=false;await refresh();
 faults.load=true;await check().click();
 await page.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
 assert.equal(await cart().locator('[class*="receiptTotal"] dd').innerText(),'฿50');
 await page.getByRole('alert').filter({hasText:'Test backend temporarily unavailable'}).waitFor();
 await responsive('error');
 assert.equal(await page.getByRole('button',{name:/เริ่มช้อป/}).isDisabled(),true);
 faults.load=false;await refresh();
 faults.malformed=true;await page.reload();await page.getByRole('alert').filter({hasText:'invalid JSON'}).waitFor();
 assert.equal(await check().isDisabled(),true);
 faults.malformed=false;await page.getByRole('button',{name:'ลองโหลดข้อมูลอีกครั้ง',exact:true}).click();
 await page.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS Phase 4: API workflows, duplicate prevention, receipts, uncertain/failed response recovery, QR fallback/detection/denial/cleanup, responsive widths, and no unexpected browser errors.');
} finally {
 await browser?.close();
 await backend.close();
}
