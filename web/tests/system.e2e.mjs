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

// Real browser/proxy/MQTT/FSM/model/DB; only shelf signals and human choices are scripted.
const repository = fileURLToPath(new URL('../../', import.meta.url));
const web = resolve(repository, 'web');
const endpoint = process.env.LAYA_ENDPOINT || 'http://127.0.0.1:8000/v1/systemone';
const agentic = process.argv.includes('--agentic');
const healthResponse = await fetch(new URL('/health', endpoint), { signal: AbortSignal.timeout(5000) });
assert.ok(healthResponse.ok, 'Start npm run model:laya first');
const api = await startLocalApi({ agentProvider: 'laya', agentMode: agentic ? 'agentic' : 'workflow' });
const directory = resolve(repository, 'data', `web-system-${Date.now()}`);
await mkdir(directory, { recursive: true });
const report = { startedAt:new Date().toISOString(), agentMode:agentic?'AGENTIC':'WORKFLOW', health:await healthResponse.json(), cycles:0, deliveries:0, telemetryMessages:0, cases:[], checks:[], errors:[], simulated:['hardware signals', 'human button choices', 'development mock staff login'], notExercised:['physical ESP32/BLE', 'AWS services', 'real payment'] };
let browser, device, broker, frontend;
const brokerLog=[], frontendLog=[];
function passed(name) { report.checks.push(name); console.log('PASS ' + name); }
async function waitFor(predicate, message, timeout=45000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) { const value=await predicate(); if(value)return value; await delay(40); }
  throw new Error('Timed out: '+message);
}
async function freePort() {
  const probe=createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening');
  const port=probe.address().port; await new Promise(done=>probe.close(done)); return port;
}
async function stop(child) {
  if(child && child.exitCode===null && child.signalCode===null) {
    const done=once(child,'exit');
    if(process.platform==='win32')await once(spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}),'exit');
    else child.kill();
    await done;
  }
}
const state=()=>fetch(api.origin+'/api/state').then(r=>r.json());
try {
  const mqttPort=await freePort();
  broker=spawn(process.execPath,['tools/mqtt-broker/broker.mjs'],{cwd:repository,windowsHide:true,env:{...process.env,MQTT_PORT:String(mqttPort),HTTP_API_URL:api.origin+'/api/events',FORWARD_TO_HTTP:'true'},stdio:['ignore','pipe','pipe']});
  broker.stdout.on('data',chunk=>brokerLog.push(chunk.toString())); broker.stderr.on('data',chunk=>brokerLog.push(chunk.toString()));
  await waitFor(()=>brokerLog.join('').includes('Local MQTT Broker running'),'broker ready');
  const port=await freePort(); const origin='http://127.0.0.1:'+port;
  frontend=spawn(process.execPath,[resolve(web,'node_modules/next/dist/bin/next'),'dev','-p',String(port),'--hostname','127.0.0.1'],{cwd:web,windowsHide:true,env:{...process.env,LOCAL_API_ORIGIN:api.origin,NEXT_PUBLIC_ENABLE_MOCK_AUTH:'true',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  frontend.stdout.on('data',chunk=>frontendLog.push(chunk.toString())); frontend.stderr.on('data',chunk=>frontendLog.push(chunk.toString()));
  await waitFor(async()=>{if(frontend.exitCode!==null)throw new Error(frontendLog.join(''));try{return (await fetch(origin+'/shopper')).ok;}catch{return false;}},'Next.js ready',180000);
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  let streams=0;
  context.on('request',request=>{if(new URL(request.url()).pathname==='/api/stream')streams++;});
  context.on('page',page=>page.on('pageerror',error=>report.errors.push(error.message)));
  const a=await context.newPage(), b=await context.newPage(), admin=await context.newPage();
  await a.goto(origin+'/shopper?basket=A'); await b.goto(origin+'/shopper?basket=B');
  await admin.goto(origin+'/admin'); await loginAdmin(admin);
  for(const page of [a,b,admin])await page.getByRole('status').filter({hasText:'Realtime connected'}).waitFor();
  for(const page of [a,b])await page.getByRole('button',{name:/เริ่ม shopping session/}).click();
  await waitFor(async()=>(await state()).baskets.every(x=>x.session),'both sessions');
  passed('Next.js same-origin proxy and three native SSE tabs; sessions started through Shopper');
  device=await mqtt.connectAsync('mqtt://127.0.0.1:'+mqttPort,{clientId:'mock-ESP32-WROOM',reconnectPeriod:500});
  await device.subscribeAsync('smartbasket/shelf/SHELF-01/acks');
  const acknowledgements=new Map();
  device.on('message',(_topic,payload)=>{const id=payload.toString();acknowledgements.set(id,(acknowledgements.get(id)||0)+1);});
  async function send(payload) {
    const before=acknowledgements.get(payload.eventId)||0;
    await device.publishAsync('smartbasket/shelf/SHELF-01/events',JSON.stringify(payload),{qos:1});
    report.deliveries++;
    await waitFor(()=>acknowledgements.get(payload.eventId)>before,'application ACK '+payload.eventId);
    return state();
  }
  const signal=(eventId,eventType,rssi,laneId='LANE-1',extra={})=>({eventId,shelfId:'SHELF-01',laneId,sku:laneId==='LANE-1'?'COKE':'WATER',eventType,timestamp:'',rssi:{...rssi,HV01:-63},...extra});
  async function total(page,expected) {
    await page.waitForFunction(value=>document.querySelector('[class*="totalRow"] strong')?.textContent===`฿${value}`,expected);
  }
  for(let i=0;i<30;i++) {
    const basket=i%2?'B':'A', page=basket==='A'?a:b;
    const lane=i%4<2?'LANE-1':'LANE-2', price=lane==='LANE-1'?25:15;
    const rssi=basket==='A'?{A:-51,B:-72}:{A:-72,B:-51};
    const pick=signal(`web-cycle-${i}-pick`,'PICK',rssi,lane);
    await send(pick); await total(page,price);
    let current=await send(pick); await total(page,price);
    assert.equal(current.baskets.find(x=>x.basketId===basket).lines[0].quantity,1);
    await send(signal(`web-cycle-${i}-return`,'PUT_BACK',rssi,lane));
    await total(page,0); report.cycles++;
    if((i+1)%10===0)console.log(`PASS ${i+1}/30 browser-visible PICK / duplicate / PUT_BACK cycles`);
  }
  let current=await state();
  assert.equal(current.cases.length,0,'Clear events bypass Agent');
  assert.ok(current.baskets.every(x=>x.lines.length===0));
  passed('30 complete MQTT cycles across A/B and Coke/Water; 60 transitions + 30 duplicates, no Agent and no wrong cart');
  const checkout=page=>page.getByRole('button',{name:/Mock checkout/});
  for(const [index,rssi] of [{A:-55,B:-57},{A:-57,B:-55},{A:-56,B:-56}].entries()) {
    if(agentic)for(let sample=0;sample<4;sample++) {
      const readings=index===1 ? sample%2 ? {A:-48,B:-73}:{A:-73,B:-48} : rssi;
      await device.publishAsync('smartbasket/shelf/SHELF-01/telemetry',JSON.stringify({shelfId:'SHELF-01',source:'MOCK',capturedAt:new Date().toISOString(),rssi:readings,uptimeMs:100000+index*10000+sample*100,queueDepth:0,droppedEvents:0,lanes:[{laneId:'LANE-1',present:false}]}),{qos:1});
      report.telemetryMessages++;await delay(100);
    }
    const payload=signal(`web-model-${index}`,'PICK',rssi);
    const delivery=send(payload);
    await waitFor(async()=>{
      const item=(await state()).cases.find(x=>x.eventId===payload.eventId);
      return item?.agent?.status==='RUNNING' && item;
    },'real Agent RUNNING');
    await admin.getByText('LAYA / RUNNING',{exact:true}).waitFor();
    assert.equal(await admin.getByRole('button',{name:/^Approve|^Reject/}).count(),0,'No staff decision while Agent is running');
    assert.ok(await checkout(a).isDisabled());
    current=await delivery;
    const item=current.cases.find(x=>x.eventId===payload.eventId);
    assert.equal(item.agent.provider,'LAYA'); assert.equal(item.agent.status,'COMPLETED');
    if(agentic) {
      assert.equal(item.agent.mode,'AGENTIC');
      const selections=item.agent.steps.filter(step=>step.phase==='SELECT');
      assert.ok(selections.length>=1 && selections.length<=8);
      assert.ok(selections.every(step=>step.source==='MODEL' && step.model));
      assert.ok(item.toolCalls.length>=1 && item.toolCalls.length<=8);
      await admin.getByRole('heading',{name:'Agentic investigation',exact:true}).waitFor();
    } else {assert.equal(item.toolCalls.length,3);assert.ok(item.agent.output.model);}
    assert.ok(current.baskets.every(x=>x.total===0),'No model result can charge an unconfirmed item');
    await admin.getByText('LAYA / COMPLETED',{exact:true}).waitFor();
    await admin.getByText('Agent confidence · LAYA',{exact:true}).waitFor();
    const entry={caseId:item.caseId,candidate:item.candidate,confidence:item.confidence,nextAction:item.nextAction,model:item.agent.output?.model ?? item.agent.steps?.find(step=>step.model)?.model,...(agentic?{steps:item.agent.steps,tools:item.toolCalls.map(call=>({name:call.name,input:call.input,summary:call.summary}))}:{})};
    report.cases.push(entry);
    if(item.status==='WAITING_CUSTOMER') {
      const owner=item.candidate==='A'?a:b;
      await owner.getByRole('button',{name:/ไม่ใช่, ให้พนักงานดู/}).click();
      await waitFor(async()=>(await state()).cases.find(x=>x.caseId===item.caseId)?.status==='OPEN_STAFF','Customer NO escalation');
    }
    await admin.getByRole('radio',{name:/Basket A/}).check();
    await admin.getByRole('button',{name:/Approve/}).click();
    await total(a,25);
    await send(signal(`web-model-${index}-return`,'PUT_BACK',{A:-51,B:-72})); await total(a,0);
    const audit=await fetch(api.origin+'/api/audit?caseId='+item.caseId).then(r=>r.json());
    for(const action of ['AGENT_STARTED','AGENT_TOOL_COMPLETED',...(agentic?['AGENT_ACTION_SELECTED']:['AGENT_RECOMMENDATION']),'STAFF_APPROVED','CART_VALIDATED','CASE_CLOSED'])assert.ok(audit.items.some(x=>x.action===action),action+' audit');
  }
  passed(agentic?'Three real model-directed Laya investigations visible in Admin; action/observation trace, telemetry tools, RUNNING guard, HITL, cart and audit':'Three real Laya investigations visible in Admin; RUNNING guard, 3 evidence tools, policy/HITL, cart and audit');
  for(const [id,extra] of [['unknown',{}],['delayed',{delayed:true}]]) {
    current=await send(signal('web-'+id,'PICK',id==='unknown'?{A:null,B:null}:{A:-51,B:-72},'LANE-2',extra));
    const item=current.cases.find(x=>x.eventId==='web-'+id);
    assert.equal(item.status,'OPEN_STAFF'); assert.equal(item.agent,undefined);
    assert.ok(current.baskets.every(x=>x.total===0));
    await admin.getByRole('button',{name:/^Reject/}).click();
    await waitFor(async()=>(await state()).cases.find(x=>x.caseId===item.caseId)?.status==='CLOSED','reject closed');
  }
  passed('Missing basket tags (HV01 only) and delayed events cannot charge; Staff rejects in real dashboard');
  await send(signal('web-checkout','PICK',{A:-51,B:-72},'LANE-2')); await total(a,15);
  await checkout(a).click(); await a.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
  await a.reload(); await a.getByRole('heading',{name:'ขอบคุณที่ช้อปกับเรา'}).waitFor();
  const persisted=JSON.parse(await readFile(join(api.directory,'state.json'),'utf8'));
  assert.equal(persisted.orders.at(0).total,15); assert.equal(persisted.activeSessions.A,null);
  await admin.getByRole('heading',{name:'บันทึกการทำงาน'}).waitFor();
  await admin.getByText('MOCK_CHECKOUT_COMPLETED',{exact:true}).waitFor();
  for(const page of [a,b,admin]) {
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No mobile page overflow');
    await page.screenshot({path:join(directory,page===a?'shopper-receipt.png':page===b?'shopper-b.png':'admin-audit.png'),fullPage:true});
  }
  assert.deepEqual(report.errors,[]); assert.ok(streams>=3);
  passed('Mock checkout/receipt survives reload, JSON persistence and Admin audit agree, mobile rendering has no runtime error');
  await writeFile(join(directory,'broker.log'),brokerLog.join(''));
  await writeFile(join(directory,'frontend.log'),frontendLog.join(''));
  report.passed=true;
} catch(error) {report.passed=false;report.error=error.stack;throw error;}
finally {
  await writeFile(join(directory,'broker.log'),brokerLog.join(''));
  await writeFile(join(directory,'frontend.log'),frontendLog.join(''));
  report.completedAt=new Date().toISOString(); await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
  console.log('System report: '+join(directory,'report.json'));
  await device?.endAsync(); await browser?.close(); await stop(frontend); await stop(broker); await api.close();
}
