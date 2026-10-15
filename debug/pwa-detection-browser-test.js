'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync,execFileSync}=require('node:child_process');
const H=require('./pwa-sw-harness'),{sha256}=require('./pwa-release-build');
require('./browser-lock').acquireBrowserLock('Fluid PWA phase 6 detection');
const root=path.resolve(__dirname,'..'),evidence=process.env.PWA_PHASE6_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase6-probe-'));
H.externalDirectory(evidence);
const result={status:'RUNNING',evidence,cases:[],commands:[],closures:[],http:[]},serverLog=[],browserLog=[],errors=[];
let server,run,served,fail=false;
const inv=d=>JSON.parse(fs.readFileSync(path.join(d,'precache-inventory.json')));
function build(cwd,label){const args=[path.join(root,'node_modules/gulp/bin/gulp.js'),'build'],b=spawnSync(process.execPath,args,{cwd,env:{...process.env,NODE_ENV:'production',NODE_PATH:path.join(root,'node_modules')},encoding:'utf8'});fs.writeFileSync(path.join(evidence,label+'-build.log'),b.stdout+b.stderr);result.commands.push({executable:process.execPath,args,cwd,exitCode:b.status});assert.equal(b.status,0,b.stdout+b.stderr);}
const screenshot=(p,name)=>p.screenshot({path:path.join(evidence,name+'.png')});
async function main(){
 build(root,'v1');const v1=path.join(evidence,'v1');fs.cpSync(path.join(root,'dist'),v1,{recursive:true});
 const source=path.join(evidence,'source');fs.mkdirSync(source,{recursive:true});
 for(const file of execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean)){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(source,file));}
 fs.writeFileSync(path.join(source,'index.html'),fs.readFileSync(path.join(source,'index.html'),'utf8').replace('<title>','<title>V2 '));
 fs.writeFileSync(path.join(source,'app/pwa-register.js'),fs.readFileSync(path.join(source,'app/pwa-register.js'),'utf8').replace('Offline / встановлення','Offline / встановлення V2'));
 build(source,'v2');const v2=path.join(evidence,'v2');fs.cpSync(path.join(source,'dist'),v2,{recursive:true});
 const first=inv(v1),second=inv(v2);assert.notEqual(first.releaseId,second.releaseId);result.identities={v1:first.releaseId,v2:second.releaseId};
 served=v1;
 server=await H.startProductionServer({dist:v1,log:e=>serverLog.push(e),overlay:pathname=>{
  if(fail&&pathname===inv(v2).entries.find(e=>e.path.endsWith('.js')).path)return {status:404,body:'Required JS missing',type:'text/plain',cache:'no-store'};
  const file=path.join(served,pathname==='/'?'index.html':pathname);
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return {body:fs.readFileSync(file),type:H.TYPES[path.extname(file)]||'application/octet-stream',cache:H.cacheControl(pathname)};
  return null;
 }});result.port=server.port;result.origin=server.base;
 run=await H.launchProfile({profile:path.join(evidence,'profile'),evidence,label:'detection'});result.browserVersion=run.context.browser().version();
 run.context.on('response',r=>browserLog.push({url:r.url(),status:r.status(),fromServiceWorker:r.fromServiceWorker()}));
 const page=run.context.pages()[0]||await run.context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const url=server.base+'/?webgl=2&debug=none&diag=0&seed=41';result.url=url;
 await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>document.querySelector('#pwa-panel')?.dataset.state==='ready');
 await page.locator('#pwa-panel summary').click();await page.waitForFunction(()=>document.getElementById('pwa-versions').textContent.includes('Активна версія: ')&&!document.getElementById('pwa-versions').textContent.includes('Активна версія: не підтверджено'));
 assert.equal((await H.workerState(page)).updateViaCache,'none');await screenshot(page,'v1-ready');result.cases.push({case:'production V1 startup verified active identity and updateViaCache none'});
 for(const e of first.entries){const r=await fetch(server.base+e.path);assert.equal(r.status,200);assert.equal(sha256(Buffer.from(await r.arrayBuffer())),e.sha256);result.http.push({path:e.path,status:r.status,cache:r.headers.get('cache-control'),sha256:e.sha256});}
 for(const p of ['/sw.js','/release.json','/precache-inventory.json']){const r=await fetch(server.base+p);assert.equal(r.headers.get('cache-control'),'no-store');result.http.push({path:p,cache:r.headers.get('cache-control')});}
 served=v2;fail=true;
 await page.click('#pwa-check');await page.waitForFunction(()=>document.querySelector('#pwa-panel').dataset.update==='failed',null,{timeout:30000});assert.equal((await H.workerRequest(page)).releaseId,first.releaseId);assert.equal((await H.workerState(page)).waiting,null);await screenshot(page,'failed-install');result.cases.push({case:'actual required JS 404 redundant install surfaces failed, V1 still active'});
 fail=false;await page.click('#pwa-check');await page.waitForFunction(()=>document.querySelector('#pwa-panel').dataset.update==='ready',null,{timeout:30000});
 const active=await H.workerRequest(page),waiting=await H.workerRequest(page,{target:'waiting'});assert.equal(active.releaseId,first.releaseId);assert.equal(waiting.releaseId,second.releaseId);assert.equal(waiting.complete,true);
 await page.waitForFunction(id=>document.querySelector('#pwa-versions').textContent.includes(id),second.releaseId);await screenshot(page,'v2-waiting');result.cases.push({case:'manual UI detects V2 ready with verified active/waiting identities',active,waiting});
 await page.click('#pwa-later');assert.equal(await page.locator('#pwa-update').textContent(),'Оновлення відкладено');await screenshot(page,'later-v1');
 // A second real navigation runs UI bootstrap with a waiting worker already present.
 const secondPage=await run.context.newPage();secondPage.on('pageerror',e=>errors.push(e.message));const response=await secondPage.goto(url+'&existingWaiting=1');assert.equal(response.fromServiceWorker(),true);
 await secondPage.waitForFunction(()=>document.querySelector('#pwa-panel')?.dataset.update==='ready');await secondPage.locator('#pwa-panel summary').click();assert.equal(await secondPage.title(),'Fluid Paint');assert.ok((await secondPage.locator('#pwa-versions').textContent()).includes(second.releaseId));await screenshot(secondPage,'existing-waiting-bootstrap');result.cases.push({case:'existing waiting before second page bootstrap detected without new updatefound',fromServiceWorker:true});
 await secondPage.setViewportSize({width:320,height:900});await screenshot(secondPage,'320-waiting');const geometry=await secondPage.locator('#pwa-panel').evaluate(el=>({x:el.getBoundingClientRect().x,width:el.getBoundingClientRect().width,overflow:el.scrollWidth>el.clientWidth}));assert.equal(geometry.x,12);assert.equal(geometry.width,296);assert.equal(geometry.overflow,false);result.cases.push({case:'320px waiting identity wraps without horizontal overflow',geometry});await secondPage.close();
 await run.context.setOffline(true);await page.click('#pwa-check');await page.waitForFunction(()=>document.querySelector('#pwa-panel').dataset.update==='failed');assert.match(await page.locator('#pwa-last-check').textContent(),/не означає/);assert.equal((await H.workerRequest(page,{target:'waiting'})).releaseId,second.releaseId);await screenshot(page,'offline-check-failed');result.cases.push({case:'offline manual check fails honestly, never no-update, verified V2 remains waiting'});
 await page.locator('#pwa-panel summary').click();
 await page.evaluate(()=>{const p=window.__painter;p.paintingRectangle.left=450;p.paintingRectangle.bottom=350;p.paintingRectangle.width=180;p.paintingRectangle.height=130;p.engine.resizePainting(p.getPaintingResolutionWidth(),p.getPaintingResolutionHeight(),0,0);p.setPaintColor('#3B82F6');p.needsRedraw=true;});
 const stroke=await page.evaluate(()=>{const p=window.__painter,r=p.paintingRectangle,b=p.canvas.getBoundingClientRect();return [.3,.7].map(t=>{const s=p.viewport.worldToScreen(r.left+r.width*t,r.bottom+r.height*.5),c=p.viewport.screenToCss(s.x,s.y);return {x:c.x+b.left,y:c.y+b.top};});});
 await page.mouse.move(stroke[0].x,stroke[0].y);await page.mouse.down();await page.mouse.move(stroke[1].x,stroke[1].y,{steps:12});await page.mouse.up();
 const drawn=await page.evaluate(()=>({magnitude:window.__painter.engine.readPaintTexture().pixels.reduce((sum,x)=>sum+Math.abs(x),0),glError:window.__painter.wgl.gl.getError()}));assert.ok(drawn.magnitude>0);assert.equal(drawn.glError,0);await screenshot(page,'later-v1-drawing');
 await page.click('#panel-grip');const [download]=await Promise.all([page.waitForEvent('download'),page.click('#save-button')]);await download.saveAs(path.join(evidence,'later-v1-export.png'));assert.equal(await download.failure(),null);
 const png=fs.readFileSync(path.join(evidence,'later-v1-export.png'));assert.equal(png.readUInt32BE(16),180);assert.equal(png.readUInt32BE(20),130);
 assert.equal((await H.workerRequest(page)).releaseId,first.releaseId);assert.equal((await H.workerRequest(page,{target:'waiting'})).releaseId,second.releaseId);assert.equal(await page.title(),'Fluid Paint');assert.equal(page.url(),url);
 const caches=await H.inspectCaches(page);fs.writeFileSync(path.join(evidence,'cache-snapshot.json'),JSON.stringify(caches,null,2));
 for(const inventory of [first,second]){const cache=caches.find(c=>c.name.includes(inventory.releaseId));assert.ok(cache);for(const e of inventory.entries){const cached=cache.entries.find(x=>new URL(x.url).pathname===e.path);assert.ok(cached,e.path);assert.equal(cached.sha256,e.sha256);}}
 const loaded=await page.evaluate(()=>[...document.scripts].filter(s=>s.src).map(s=>new URL(s.src).pathname));assert.ok(loaded.every(p=>first.entries.some(e=>e.path===p)));assert.ok(!loaded.includes(second.entries.find(e=>e.path.endsWith('.js')).path));result.cases.push({case:'Later leaves V1 drawing and PNG export usable offline; both complete caches exact, no mixed script assets or reload',drawn,loaded});
 assert.deepEqual(errors,[]);result.pageErrors=errors;result.status='PASS';
}
(async()=>{try{await main();}catch(error){result.status='FAIL';result.error=error.stack;if(run){result.failurePages=await Promise.all(run.context.pages().map(async p=>({url:p.url(),text:await p.locator('#pwa-panel').textContent().catch(()=>''),state:await p.locator('#pwa-panel').getAttribute('data-update').catch(()=>null),online:await p.evaluate(()=>navigator.onLine).catch(()=>null)})));}process.exitCode=1;}finally{try{if(run)result.closures.push(await run.close());if(server){await server.stop();result.serverStopped=true;await server.verifyStopped();result.portFree=true;}}catch(e){result.cleanupError=e.stack;result.status='FAIL';process.exitCode=1;}fs.writeFileSync(path.join(evidence,'server.json'),JSON.stringify(serverLog,null,2));fs.writeFileSync(path.join(evidence,'browser.json'),JSON.stringify(browserLog,null,2));result.exitCode=process.exitCode||0;fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,evidence,cases:result.cases.length,port:result.port,portFree:result.portFree,error:result.error},null,2));}})();
