'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const h=require('./pwa-sw-harness');
const fixture=require('./pwa-sw-fixture');
async function selftest({evidence=h.createEvidence(),profile=path.join(evidence,'profile'),port=Number(process.env.PWA_QA_PORT || 0),headed=false,resume=false}={}) {
  evidence=h.externalDirectory(evidence);profile=h.externalDirectory(profile);
  const marker=path.join(profile,'fluid-pwa-fixture-state.json');
  const previous=resume?JSON.parse(fs.readFileSync(marker,'utf8')):null;
  if(previous && previous.fixtureOnly!==true) throw new Error('Not a disposable fixture profile');
  if(previous && port===0) port=previous.port;
  if(previous && port!==previous.port) throw new Error('Persistent profile must use its original port/origin');
  if(!Number.isInteger(port) || port<0 || port>65535) throw new Error('Invalid port');
  const baseline=previous?.version || 'v1';
  const nextVersion='v'+(Number(baseline.slice(1))+1);
  const result={status:'RUNNING',evidence,profile,startedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform},revision:execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}).trim(),fixtureOnly:true,cases:[],runs:[],coldStarts:[],protocol:[],http:[],pageErrors:[],cleanup:{contextsClosed:0,contextClosures:[]},limitations:['Disposable fixture only; production SW/app offline behavior not implemented or accepted.','Desktop Chromium, not physical Android/iOS, storage eviction or CDN/deploy acceptance.','Cold browser process restart at same localhost origin; OS restart is not tested.']};
  result.resume=resume;result.baseline=baseline;result.nextVersion=nextVersion;
  let server,session,version=baseline;
  const serverLog=[],browserLog=[];
  const pass=(name,details={})=>{result.cases.push({name,status:'PASS',...details});console.log('PASS '+name);};
  const open=async(label,offline=false)=>{
    session=await h.launchProfile({profile,evidence,label,offline,headed});
    result.browserVersion=session.context.browser()?.version();
    session.context.on('requestfailed',request=>browserLog.push({label,url:request.url(),failure:request.failure()}));
    const page=session.context.pages()[0] || await session.context.newPage();
    page.on('pageerror',error=>result.pageErrors.push({label,error:error.message}));
    return page;
  };
  const close=async()=>{if(session){const current=session;session=null;const proof=await current.close();result.cleanup.contextClosures.push(proof);assert.equal(proof.browserDisconnected,true);result.cleanup.contextsClosed++;}};
  const snapshot=async(page,label,data)=>{
    const readable={label,offline:label.includes('offline'),active:data.active?.version || data.replies?.[0]?.version || data.second?.active?.version,waiting:data.replies?.[1]?.version || null,state:data.state || data.states || data.second?.state,byte:data.byte || fixture.BYTE,requests:(data.replies || [data.active || data.second?.active]).filter(Boolean).map(reply=>({target:reply.target,version:reply.version,requestId:reply.requestId,elapsedMs:reply.elapsedMs})),negativeTimeout:data.negativeTimeout?{expectedFailure:true,timeoutMs:data.negativeTimeout.timeoutMs,elapsedMs:data.negativeTimeout.elapsedMs,error:'SW_REQUEST_TIMEOUT waiting IGNORE'}:undefined,caches:(data.caches || data.second?.caches || []).map(cache=>({name:cache.name,entries:cache.entries.map(entry=>({url:entry.url,status:entry.status,sha256:entry.sha256,size:entry.size}))}))};
    await page.locator('#report').evaluate((element,data)=>element.textContent=JSON.stringify(data,null,2),readable);
    await page.screenshot({path:path.join(evidence,label+'.png'),fullPage:true});
  };
  const cold=async(label,expected)=>{
    await close(); // every tab and persistent Chromium process closed, not just reload
    const page=await open(label,true); // offline BEFORE the very first navigation
    const response=await page.goto(server.base+fixture.PREFIX+'?cold='+label);
    assert.equal(response.status(),200);assert.equal(response.fromServiceWorker(),true);
    const byte=await page.evaluate(async()=>await (await fetch('/__pwa_fixture/byte.txt')).text());assert.equal(byte,fixture.BYTE);
    const state=await h.workerState(page,fixture.PREFIX), active=await h.workerRequest(page,{scope:fixture.PREFIX});assert.equal(active.version,expected);assert.ok(state.controller);
    const caches=await h.inspectCaches(page);assert.ok(caches.some(cache=>cache.name==='fluid-pwa-fixture-'+expected && cache.entries.some(entry=>entry.body===fixture.BYTE)));
    const record={label,offlineBeforeNavigation:true,fromServiceWorker:response.fromServiceWorker(),byte,state,active,caches};result.coldStarts.push(record);await snapshot(page,label,record);await close();return record;
  };
  try {
    assert.equal(fs.existsSync(path.resolve(__dirname,'../dist/sw.js')),false,'Production dist must have no SW in phase 3');
    server=await h.startProductionServer({port,overlay:fixture.fixtureRoutes(()=>version),log:entry=>serverLog.push(entry)});result.port=server.port;result.origin=server.base;
    console.log('Fixture review URL '+server.base+fixture.PREFIX);
    // Real production dist, exact byte readback plus production-like local headers.
    const inventory=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../dist/precache-inventory.json'),'utf8'));
    for(const entry of inventory.entries){const response=await fetch(server.base+entry.path),bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(response.headers.get('cache-control'),h.cacheControl(entry.path));assert.equal(response.headers.get('content-type'),h.TYPES[path.extname(entry.path)]);result.http.push({path:entry.path,status:response.status,hashVerified:true,type:response.headers.get('content-type'),cache:response.headers.get('cache-control')});}
    for(const url of ['/sw.js','/release.json','/precache-inventory.json']){const response=await fetch(server.base+url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),h.TYPES[path.extname(url)]);result.http.push({path:url,status:response.status,type:response.headers.get('content-type'),cache:response.headers.get('cache-control')});}
    const missing=await fetch(server.base+'/missing.js');assert.equal(missing.status,404);assert.doesNotMatch(missing.headers.get('content-type'),/html/);
    pass('production serving: inventory bytes/MIME/cache headers and real 404',{inventoryEntries:inventory.entries.length});
    let page=await open('run1-online');await page.goto(server.base+fixture.PREFIX);
    const startup=await h.workerState(page,fixture.PREFIX);
    if(resume){
      const persisted=await h.workerRequest(page,{scope:fixture.PREFIX});
      assert.equal(persisted.version,baseline);
      const persistedCaches=await h.inspectCaches(page);
      assert.deepEqual(persistedCaches,previous.caches);
      result.persistedFromPreviousInvocation={startup,persisted,caches:persistedCaches};
    } else {
      assert.equal(startup.active,null,'Use --resume to inspect a previously seeded profile');
      await h.registerWorker(page,{scope:fixture.PREFIX});
    }
    const active=await h.workerRequest(page,{scope:fixture.PREFIX});assert.equal(active.version,baseline);assert.match(active.requestId,/^[a-f0-9-]{36}$/);
    const first={run:1,state:await h.workerState(page,fixture.PREFIX),active,caches:await h.inspectCaches(page)};assert.equal(first.state.updateViaCache,'none');assert.ok(first.state.controller);result.runs.push(first);result.protocol.push(active);await snapshot(page,'run1-online',first);
    pass('run 1: disposable '+baseline+' controls page and caches server byte');
    await cold('run1-cold-offline',baseline);pass('run 1: all pages/process closed, offline cold launch');
    page=await open('run2-online');await page.goto(server.base+fixture.PREFIX);
    const second={run:2,state:await h.workerState(page,fixture.PREFIX),active:await h.workerRequest(page,{scope:fixture.PREFIX}),caches:await h.inspectCaches(page)};
    assert.equal(second.active.version,baseline);assert.equal(second.state.active,'activated');assert.ok(second.state.controller);assert.deepEqual(second.caches,first.caches);result.runs.push(second);result.protocol.push(second.active);
    pass('run 2: same profile sees run 1 SW/cache before registration');
    version=nextVersion;await page.evaluate(async scope=>(await navigator.serviceWorker.getRegistration(scope)).update(),fixture.PREFIX);
    await page.evaluate(async scope=>{
      const started=performance.now();
      while(performance.now()-started<15000){
        const registration=await navigator.serviceWorker.getRegistration(scope);
        if(registration?.waiting?.state==='installed') return;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw new Error('Waiting worker did not reach installed within 15000ms');
    },fixture.PREFIX);
    const states=await h.workerState(page,fixture.PREFIX);
    const replies=await Promise.all(['active','waiting'].map(target=>h.workerRequest(page,{target,scope:fixture.PREFIX})));
    assert.equal(states.waiting,'installed');assert.equal(replies[0].version,baseline);assert.equal(replies[1].version,nextVersion);assert.notEqual(replies[0].requestId,replies[1].requestId);assert.ok(replies.every(reply=>reply.elapsedMs<2000));result.protocol.push(...replies);
    pass('active '+baseline+' / waiting '+nextVersion+' request IDs ignore unrelated replies',{states,replies});
    const start=Date.now();let timeoutError;
    try {await h.workerRequest(page,{target:'waiting',type:'IGNORE',timeout:250,scope:fixture.PREFIX});} catch(error){timeoutError=error.message;}
    assert.match(timeoutError || '',/SW_REQUEST_TIMEOUT waiting IGNORE/);const elapsedMs=Date.now()-start;assert.ok(elapsedMs>=200 && elapsedMs<3000);
    result.negativeTimeout={expectedFailure:true,timeoutMs:250,elapsedMs,error:timeoutError};
    const recovery=await h.workerRequest(page,{target:'waiting',scope:fixture.PREFIX});assert.equal(recovery.version,nextVersion);result.protocol.push(recovery);
    pass('negative timeout is bounded; subsequent waiting request succeeds');
    await snapshot(page,'run2-waiting',{second,states,replies,negativeTimeout:result.negativeTimeout,caches:await h.inspectCaches(page)});
    const finalCold=await cold('run2-cold-offline',nextVersion);pass('run 2: natural activation then offline cold launch of '+nextVersion);
    fs.writeFileSync(marker,JSON.stringify({fixtureOnly:true,port:server.port,version:nextVersion,caches:finalCold.caches},null,2));
    assert.deepEqual(result.pageErrors,[]);assert.equal(fs.existsSync(path.resolve(__dirname,'../dist/sw.js')),false);
    pass('zero page errors and production SW remains absent');result.status='PASS';
  } catch(error) {result.status='FAIL';result.error=error.stack;}
  finally {
    try {await close();} catch(error){result.status='FAIL';result.cleanup.browserError=error.stack;}
    try {if(server){await server.stop();result.cleanup.serverStopped=true;result.cleanup.portFree=await server.verifyStopped();}} catch(error){result.status='FAIL';result.cleanup.serverError=error.stack;}
    result.finishedAt=new Date().toISOString();result.exitCode=result.status==='PASS'?0:1;
    result.artifacts={screenshots:fs.readdirSync(evidence).filter(name=>name.endsWith('.png')),traces:fs.readdirSync(evidence).filter(name=>name.endsWith('-trace.zip')),hars:fs.readdirSync(evidence).filter(name=>name.endsWith('.har'))};
    fs.writeFileSync(path.join(evidence,'server.json'),JSON.stringify(serverLog,null,2));fs.writeFileSync(path.join(evidence,'browser.json'),JSON.stringify(browserLog,null,2));fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({status:result.status,passed:result.cases.length,failed:result.status==='PASS'?0:1,runs:result.runs.length,coldStarts:result.coldStarts.length,port:result.port,cleanup:result.cleanup,artifacts:result.artifacts,evidence,profile,error:result.error},null,2));
  }
  return result;
}
if(require.main===module){
  const release=require('./browser-lock').acquireBrowserLock('Fluid PWA phase 3 persistent SW selftest');
  const args=process.argv.slice(2);const option=name=>{const index=args.indexOf(name);if(index<0)return undefined;if(!args[index+1] || args[index+1].startsWith('--'))throw new Error('Missing '+name+' value');return args[index+1];};
  selftest({profile:option('--profile'),evidence:option('--evidence'),port:option('--port')===undefined?Number(process.env.PWA_QA_PORT || 0):Number(option('--port')),headed:args.includes('--review'),resume:args.includes('--resume')}).then(result=>{release();process.exitCode=result.exitCode;},error=>{release();console.error(error);process.exitCode=1;});
}
module.exports={selftest};
