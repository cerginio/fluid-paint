'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const H=require('./pwa-sw-harness');
const evidence=H.externalDirectory(process.env.PWA_PHASE5_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase5-probe-')));
const result={status:'RUNNING',evidence,cases:[],closures:[],screenshots:[],errors:[],limitations:['iOS UA preview is Chromium, NOT Safari or physical device.','Native install dialog acceptance is not automated; genuine event gating covered if supplied by Chromium, no synthetic prompt.','Site-data wipe without surviving evidence cannot be diagnosed as a historical wipe.']};
let server,run;
const save=()=>fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
const check=(name,data={})=>{result.cases.push({name,status:'PASS',...data});save();};
async function launch(label,options={}){run=await H.launchProfile({profile:path.join(evidence,'profile'),evidence,label,...options});run.context.on('page',p=>p.on('pageerror',e=>result.errors.push(e.message)));return run.context.pages()[0] || await run.context.newPage();}
async function close(){if(run){result.closures.push(await run.close());run=null;}}
async function shot(page,name){const file=path.join(evidence,name+'.png');await page.screenshot({path:file,fullPage:true});result.screenshots.push(file);}
async function state(page,expected){await page.waitForFunction(s=>document.getElementById('pwa-panel')?.dataset.state===s,expected,{timeout:15000});}
(async()=>{try{
 const dist=path.join(evidence,'dist-snapshot');fs.cpSync(path.resolve(__dirname,'../dist'),dist,{recursive:true});
 server=await H.startProductionServer({dist,log:event=>fs.appendFileSync(path.join(evidence,'server.jsonl'),JSON.stringify(event)+'\n')});result.port=server.port;result.base=server.base;
 let page=await launch('never-prepared-offline',{profile:path.join(evidence,'never-prepared-profile'),offline:true});
 const firstOffline=await page.goto(server.base).then(r=>({status:r?.status()}),e=>({error:e.message}));
 assert.ok(firstOffline.error);assert.equal(await page.locator('#pwa-panel').count(),0);check('never-prepared profile offline cannot launch shell or claim readiness',{firstOffline});await close();
 page=await launch('first-online');result.browserVersion=run.context.browser().version();
 await page.goto(server.base+'/?debug=none&diag=0');await page.locator('#pwa-panel > summary').click();
 await page.evaluate(()=>navigator.serviceWorker.ready);await state(page,'preparing');
 assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);
 const uncontrolledProof=await page.waitForFunction(()=>{const panel=document.getElementById('pwa-panel'),text=document.getElementById('pwa-reason')?.textContent;return panel?.dataset.update==='idle' && text?.includes('not controlled yet') && !navigator.serviceWorker.controller ? {text,state:panel.dataset.state} : false},null,{timeout:15000});
 assert.match((await uncontrolledProof.jsonValue()).text,/not controlled yet/);
 await shot(page,'first-uncontrolled');check('fresh registration success remains uncontrolled and not ready');
 // Explicit QA user reload, never application reload machinery.
 await page.reload();await state(page,'ready');await page.locator('#pwa-panel > summary').click();
 const status=await H.workerRequest(page),inventory=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../dist/precache-inventory.json')));
 assert.equal(status.complete,true);assert.equal(status.releaseId,inventory.releaseId);assert.equal(status.shellId,inventory.shellId);
 assert.equal(await page.locator('meta[name="fluid-shell-id"]').getAttribute('content'),inventory.shellId);
 result.active=status;result.caches=await H.inspectCaches(page);await shot(page,'desktop-ready');check('actual active production worker matches loaded shell and completed precache',{status});
 // Test rejection against an actual controller with an intentionally mismatched
 // loaded-shell token in a controlled same-origin diagnostic document.
 const wrong=await run.context.newPage();await wrong.goto(server.base+'/release.json');await wrong.evaluate(()=>{document.head.innerHTML='<meta name="fluid-shell-id" content="'+ 'c'.repeat(64)+'">';});
 await wrong.addScriptTag({path:path.resolve(__dirname,'../app/pwa-ui-icons.js')});
 await wrong.addScriptTag({path:path.resolve(__dirname,'../app/pwa-register.js')});await state(wrong,'unavailable');await wrong.locator('#pwa-panel > summary').click();await shot(wrong,'mismatched-shell-refused');await wrong.close();check('actual controller reply cannot authorize a different loaded shell (controlled document test)');
 await page.setViewportSize({width:320,height:900});await shot(page,'320-ready');
 const geometry=await page.locator('#pwa-panel').boundingBox();assert.ok(geometry.x>=0 && geometry.x+geometry.width<=320);
 assert.equal(await page.locator('#pwa-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.locator('#pwa-panel > summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#pwa-panel').getAttribute('open'),null);
 assert.equal(await page.locator('#pwa-status').isVisible(),true);await shot(page,'320-warning-collapsed');await page.keyboard.press('Enter');check('320px disclosure keyboard access and durable visible warning',{geometry});
 const mode=await page.locator('#pwa-install').isVisible();result.nativePromptOffered=mode;
 if(!mode)assert.match(await page.locator('#pwa-install-info').textContent(),/browser menu/);
 check('install genuine event only or graceful unsupported fallback',{nativePromptOffered:mode,dialogAccepted:false});
 await close();
 page=await launch('cold-offline',{offline:true});const response=await page.goto(server.base+'/?cold=phase5');assert.equal(response.fromServiceWorker(),true);await state(page,'ready');await page.locator('#pwa-panel > summary').click();await shot(page,'cold-offline-ready');check('persistent browser fully closed then cold offline navigation ready',{fromServiceWorker:true,offlineBeforeNavigation:true});
 await run.context.setOffline(false);
 const deleted=await page.evaluate(async()=>{const names=await caches.keys();await Promise.all(names.map(n=>caches.delete(n)));return names;});
 await page.locator('#pwa-verify').click();await state(page,'unavailable');assert.match(await page.locator('#pwa-reason').textContent(),/missing or lost/);await shot(page,'cache-wipe-unavailable');check('actual CacheStorage deletion revokes ready with honest missing-preparation explanation',{deleted});
 // Current worker deliberately fails closed after cache deletion; no fake recovery promise.
 const failed=await page.reload().then(r=>({unexpectedResponse:r?.status()}),e=>({error:e.message}));assert.ok(failed.error || failed.unexpectedResponse>=400);check('cache-only wipe reload fails closed rather than displaying a false ready',{reload:failed});
 // Actual all-origin site data wipe, then online fresh navigation.
 const cdp=await run.context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:server.base,storageTypes:'all'});await close();
 page=await launch('after-site-wipe');await page.goto(server.base+'/?after=wipe');await page.evaluate(()=>navigator.serviceWorker.ready);await state(page,'preparing');await page.locator('#pwa-panel > summary').click();assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller),null);await shot(page,'site-wipe-reloaded-uncontrolled');
 assert.match(await page.locator('#pwa-details').textContent(),/after clearing, prepare again online/);check('site-data wipe and online reload never claim ready or invent historical wipe diagnosis');
 await page.reload();await state(page,'ready');check('explicit user reload after new online preparation restores verified readiness');
 const embed=await run.context.newPage();await embed.goto(server.base+'/?embedded=1&debug=none');assert.equal(await embed.locator('#pwa-panel').count(),0);await embed.close();check('embedded host UI excludes readiness/install overlay');await close();
 page=await launch('ios-preview',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});await page.setViewportSize({width:320,height:900});await page.goto(server.base);await page.locator('#pwa-panel > summary').click();assert.equal(await page.locator('#pwa-install').isVisible(),false);assert.match(await page.locator('#pwa-install-info').textContent(),/Safari.*Share.*Add to Home Screen/);await page.locator('#pwa-details > summary').click();await page.locator('#pwa-install-info').scrollIntoViewIfNeeded();await shot(page,'ios-ua-instructions');check('iOS UA Chromium preview shows A2HS instructions, not fake install');
 await close();assert.deepEqual(result.errors,[]);result.status='PASS';
 }catch(error){result.status='FAIL';result.error=error.stack;process.exitCode=1;}
 finally{await close();if(server){await server.stop();result.serverStopped=true;result.portFree=await server.verifyStopped();}result.exitCode=process.exitCode||0;save();console.log(JSON.stringify({status:result.status,cases:result.cases.length,evidence,error:result.error},null,2));}
})();
