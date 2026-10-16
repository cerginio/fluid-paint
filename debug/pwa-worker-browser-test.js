'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync,execFileSync}=require('node:child_process');
const H=require('./pwa-sw-harness'),{sha256}=require('./pwa-release-build');
require('./browser-lock').acquireBrowserLock('Fluid PWA phase 4 production worker');
const root=path.resolve(__dirname,'..');
const evidence=process.env.PWA_PHASE4_EVIDENCE || fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase4-probe-'));
H.externalDirectory(evidence);
const profile=path.join(evidence,'profile'), result={status:'RUNNING',evidence,commands:[],cases:[],closures:[],http:[],inputs:{story:'docs/story-2026-09-08-4-frames.json'},limitations:['Desktop Chromium SwiftShader, not physical GPU/Android/iOS/OS reboot.','Resize uses existing debug preview/commit API; other actions actual UI.','No phases 5-10 UI/retention/CDN/deploy acceptance.']};
let server,attackerServer,run,served,negative=null,networkEntries=0;const serverLog=[],browserLog=[];
function build(cwd,label,production=true){const args=[path.join(root,'node_modules/gulp/bin/gulp.js'),'build'];const b=spawnSync(process.execPath,args,{cwd,env:{...process.env,NODE_ENV:production?'production':'development',NODE_PATH:path.join(root,'node_modules')},encoding:'utf8'});fs.writeFileSync(path.join(evidence,label+'-build.log'),b.stdout+b.stderr);result.commands.push({command:`NODE_ENV=${production?'production':'development'} NODE_PATH=${path.join(root,'node_modules')} node ${args.join(' ')}`,cwd,exitCode:b.status,log:path.join(evidence,label+'-build.log')});assert.equal(b.status,0,b.stdout+b.stderr);}
function copySource(){const target=path.join(evidence,'source');fs.mkdirSync(target,{recursive:true});const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);for(const file of new Set([...tracked,'app/pwa-register.js','app/pwa-worker.js'])){fs.mkdirSync(path.dirname(path.join(target,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(target,file));}return target;}
const inventory=directory=>JSON.parse(fs.readFileSync(path.join(directory,'precache-inventory.json')));
async function open(label,offline=false){run=await H.launchProfile({profile,evidence,label,offline});result.browserVersion=run.context.browser().version();run.context.on('requestfailed',r=>browserLog.push({label,url:r.url(),failure:r.failure()}));run.context.on('response',r=>browserLog.push({label,url:r.url(),status:r.status(),fromServiceWorker:r.fromServiceWorker()}));const p=run.context.pages()[0]||await run.context.newPage();await p.setViewportSize({width:960,height:720});return p;}
async function close(){if(run){result.closures.push(await run.close());run=null;}}
async function exercise(page,version){
    await page.evaluate(()=>{const p=window.__painter;p.paintingRectangle.left=450;p.paintingRectangle.bottom=350;p.paintingRectangle.width=180;p.paintingRectangle.height=130;p.engine.resizePainting(p.getPaintingResolutionWidth(),p.getPaintingResolutionHeight(),0,0);p.setPaintColor('#3B82F6');p.needsRedraw=true;});
    const stroke=await page.evaluate(()=>{const p=window.__painter,r=p.paintingRectangle;const v=p.viewport;const box=p.canvas.getBoundingClientRect();return [.3,.7].map(t=>{const s=v.worldToScreen(r.left+r.width*t,r.bottom+r.height*.5),c=v.screenToCss(s.x,s.y);return {x:c.x+box.left,y:c.y+box.top};});});
    await page.mouse.move(stroke[0].x,stroke[0].y);await page.mouse.down();await page.mouse.move(stroke[1].x,stroke[1].y,{steps:12});await page.mouse.up();
    const drawn=await page.evaluate(()=>{const p=window.__painter;let magnitude=0;for(const x of p.engine.readPaintTexture().pixels)magnitude+=Math.abs(x);return {materialMagnitude:magnitude,webglVersion:p.engine.capabilities.webglVersion,glError:p.wgl.gl.getError()};});
    assert.ok(drawn.materialMagnitude>0);assert.equal(drawn.webglVersion,version);assert.equal(drawn.glError,0);await page.screenshot({path:path.join(evidence,`webgl${version}-draw.png`)});
    const resized=await page.evaluate(()=>{const p=window.__painter;p.newPaintingRectangle=p.paintingRectangle.clone();p.newPaintingRectangle.width+=16;p.newPaintingRectangle.height+=12;p.resizingSide=ResizingSide.TOP_RIGHT;p.interactionState=InteractionMode.RESIZING;p.needsRedraw=true;p.update();const previewError=p.wgl.gl.getError();p.interactionState=InteractionMode.NONE;p._commitResize();p.needsRedraw=true;p.update();return {width:p.paintingRectangle.width,height:p.paintingRectangle.height,previewError,commitError:p.wgl.gl.getError()};});
    assert.deepEqual(resized,{width:196,height:142,previewError:0,commitError:0});await page.setViewportSize({width:1000,height:740});
    await page.screenshot({path:path.join(evidence,`webgl${version}-resize.png`)});
    await page.click('#panel-grip');await page.click('#panel-extension-toggle');await page.click('#bake-tab');
    // Compare actual rendered pixels immediately around asynchronous UI Bake.
    const baked=await page.evaluate(async()=>{const p=window.__painter,e=p.engine,r=p.paintingRectangle;const options={width:Math.round(r.width),height:Math.round(r.height),resolutionScale:p.resolutionScale,colorModel:p.colorModel};const before=e.exportPixels(options);document.getElementById('bake-button').click();await new Promise((ok,no)=>{const start=performance.now();function tick(){if(!document.getElementById('bake-button').disabled&&e.renderer.hasBackground)ok();else if(performance.now()-start>10000)no(new Error('Bake timeout'));else requestAnimationFrame(tick);}tick();});const after=e.exportPixels(options);let maxDelta=0,magnitude=0;for(let i=0;i<before.length;i++)maxDelta=Math.max(maxDelta,Math.abs(before[i]-after[i]));for(const x of e.readPaintTexture().pixels)magnitude+=Math.abs(x);return {maxRenderedDelta:maxDelta,materialMagnitude:magnitude,hasBackground:e.renderer.hasBackground,canUndo:p.canUndo(),canRedo:p.canRedo(),status:document.getElementById('bake-status').textContent,glError:p.wgl.gl.getError()};});
    assert.ok(baked.maxRenderedDelta<=1,JSON.stringify(baked));assert.equal(baked.materialMagnitude,0);assert.equal(baked.hasBackground,true);assert.equal(baked.canUndo,false);assert.equal(baked.canRedo,false);assert.match(baked.status,/Baked/);assert.equal(baked.glError,0);
    await page.screenshot({path:path.join(evidence,`webgl${version}-bake.png`)});
    // Close extension so the production Save button is clickable.
    await page.click('#panel-extension-toggle');
    await page.click('#panel-grip');
    await page.screenshot({path:path.join(evidence,`webgl${version}-baked-artwork.png`)});
    await page.click('#panel-grip');
    const [download]=await Promise.all([page.waitForEvent('download'),page.click('#save-button')]);
    const png=path.join(evidence,`webgl${version}-export.png`);await download.saveAs(png);assert.equal(await download.failure(),null);
    const bytes=fs.readFileSync(png);assert.deepEqual(bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));assert.ok(bytes.length>100);assert.equal(bytes.readUInt32BE(16),196);assert.equal(bytes.readUInt32BE(20),142);
    await page.click('#panel-extension-toggle');await page.click('#story-file-tab');await page.setInputFiles('#story-file-input',png);
    await page.waitForFunction(name=>window.__painter.storyPlaybackController.backgroundSummary?.fileName===name,path.basename(png));
    const imported=await page.evaluate(()=>({background:window.__painter.engine.renderer.hasBackground,summary:window.__painter.storyPlaybackController.backgroundSummary,status:document.getElementById('story-background-name').textContent}));assert.equal(imported.background,true);assert.match(imported.status,/export.png/);
    await page.screenshot({path:path.join(evidence,`webgl${version}-import.png`)});
    await page.setInputFiles('#story-file-input',path.join(root,'docs/story-2026-09-08-4-frames.json'));await page.waitForFunction(()=>window.__painter.storyPlaybackController.state==='ready');assert.equal(await page.locator('#story-player-page').isVisible(),true);
    assert.match(await page.locator('#story-player-file-name').textContent(),/story-2026-09-08-4-frames.json/);await page.screenshot({path:path.join(evidence,`webgl${version}-story.png`)});

    const boundedStory=JSON.parse(fs.readFileSync(path.join(root,'docs/story-2026-09-08-4-frames.json'),'utf8'));
    let remaining=12;for(const layer of boundedStory.layers){layer.tiles=layer.tiles.slice(0,remaining);remaining-=layer.tiles.length;}
    const localStory=path.join(evidence,'local-story-12-tiles.json');fs.writeFileSync(localStory,JSON.stringify(boundedStory));
    await page.setInputFiles('#story-file-input',localStory);await page.waitForFunction(()=>window.__painter.storyPlaybackController.state==='ready');
    await page.selectOption('#story-speed','16');
    await page.click('#story-play-pause');
    await page.waitForFunction(()=>['completed','completed-with-gaps','player-error'].includes(window.__painter.storyPlaybackController.state),null,{timeout:90000});
    const playback=await page.evaluate(()=>{const c=window.__painter.storyPlaybackController;return {state:c.state,progress:c.progress,lastStats:c.lastStats,error:c.error?.message,glError:window.__painter.wgl.gl.getError()};});
    assert.equal(playback.state,'completed',JSON.stringify(playback));assert.ok(playback.progress.paintedOperations>0,JSON.stringify(playback));assert.equal(playback.glError,0);
    await page.screenshot({path:path.join(evidence,`webgl${version}-playback.png`)});
    result.cases.push({case:'offline UI WebGL'+version,drawn,resized,baked,png,imported,playback});
}
async function main(){
  const source=copySource();build(source,'dev',false);assert.ok(!fs.existsSync(path.join(source,'dist/sw.js')));assert.doesNotMatch(fs.readFileSync(path.join(source,'dist/bundle.js'),'utf8'),/serviceWorker\.register/);result.cases.push({case:'actual development build excludes worker/registration'});
  build(root,'v1');const v1=path.join(evidence,'v1');fs.cpSync(path.join(root,'dist'),v1,{recursive:true});const first=inventory(v1);
  for(const label of ['v2','v3']){fs.writeFileSync(path.join(source,'index.html'),fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<title>','<title>'+label+' '));build(source,label);fs.cpSync(path.join(source,'dist'),path.join(evidence,label),{recursive:true});}
  served=v1;
  const log=serverLog;
  server=await H.startProductionServer({dist:v1,port:Number(process.env.PWA_QA_PORT||0),log:e=>log.push(e),overlay:pathname=>{
    if(pathname==='/__phase4_host.html')return {body:`<!doctype html><title>Phase 4 embedded security probe</title><iframe name="painting" width="960" height="720" src="/?webgl=2&debug=none&diag=0&editorOrigin=${encodeURIComponent(server.base)}"></iframe>`,type:'text/html',cache:'no-store'};
    if(negative && inventory(served).entries.some(e=>e.path===pathname)){networkEntries++;if(pathname===negative.path){if(negative.kind==='network'){negative.hits++;return {disconnect:true};}negative.hits++;return {status:404,body:'Not found',type:'text/plain',cache:'no-store'};}}
    const file=path.join(served,pathname==='/'?'index.html':pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile())return {body:fs.readFileSync(file),type:H.TYPES[path.extname(file)]||'application/octet-stream',cache:H.cacheControl(pathname)};
    return null;
  }});result.port=server.port;result.origin=server.base;
  let page=await open('online');const query='?webgl=2&debug=none&diag=0&seed=41';await page.goto(server.base+'/'+query);
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const active=await H.workerRequest(page);assert.equal(active.releaseId,first.releaseId);assert.equal(active.complete,true);result.active=active;
  const cachesBefore=await H.inspectCaches(page);fs.writeFileSync(path.join(evidence,'v1-cache.json'),JSON.stringify(cachesBefore,null,2));const releaseCaches=cachesBefore.filter(c=>c.name.startsWith('fluid-pwa-shell-'));assert.equal(releaseCaches.length,1);const v1Cache=releaseCaches.find(c=>c.name.includes(first.releaseId));assert.ok(v1Cache);assert.equal(v1Cache.entries.length,first.entries.length+1);
  for(const e of first.entries){const cached=v1Cache.entries.find(c=>new URL(c.url).pathname===e.path);assert.equal(cached.sha256,e.sha256);const r=await fetch(server.base+e.path);assert.equal(r.status,200);assert.equal(sha256(Buffer.from(await r.arrayBuffer())),e.sha256);result.http.push({path:e.path,status:r.status,mime:r.headers.get('content-type'),cache:r.headers.get('cache-control'),sha256:e.sha256});}
  for(const url of ['/sw.js','/release.json','/precache-inventory.json']){const r=await fetch(server.base+url);assert.equal(r.headers.get('cache-control'),'no-store');}
  await page.screenshot({path:path.join(evidence,'online.png')});await run.context.setOffline(true);await close();
  page=await open('cold-offline',true);let response=await page.goto(server.base+'/'+query);assert.equal(response.fromServiceWorker(),true);assert.equal(page.url(),server.base+'/'+query);await page.waitForFunction(()=>window.__painter?.engine?.capabilities?.canDepositPaint);result.cases.push({case:'all pages closed/browser restarted/offline before first navigation',fromServiceWorker:true,url:page.url()});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await exercise(page,2);
  await page.goto(server.base+'/?webgl=1&debug=none&diag=0&seed=41');await page.waitForFunction(()=>window.__painter?.engine?.capabilities?.canDepositPaint);await exercise(page,1);assert.deepEqual(errors,[]);result.pageErrors=errors;
  // Actual controlled page fetch failures, not HTML fallback.
  const refused=await page.evaluate(async()=>{const out=[];for(const u of ['/missing.js','/release.json','/sw.js','/app/shaders/missing.frag']){try{await fetch(u);out.push({u,unexpected:true});}catch{out.push({u,networkOnlyFailure:true});}}return out;});assert.ok(refused.every(x=>x.networkOnlyFailure));result.routingOffline=refused;
  await close();page=await open('upgrades');await page.goto(server.base+'/'+query);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  for(const [label,kind] of [['v2','network'],['v3','404']]){
    served=path.join(evidence,label);const inv=inventory(served);negative={kind,path:inv.entries.find(e=>e.path.endsWith('.js')).path,hits:0};networkEntries=0;
    const failed=await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return await new Promise((ok,no)=>{const timer=setTimeout(()=>no(new Error('failed update deadline')),20000);r.addEventListener('updatefound',()=>{const w=r.installing;w.addEventListener('statechange',()=>{if(w.state==='redundant'){clearTimeout(timer);ok({state:w.state,waiting:!!r.waiting});}});},{once:true});r.update().catch(no);});});
    assert.equal(failed.state,'redundant');assert.equal(failed.waiting,false);assert.ok(negative.hits>0);assert.ok(networkEntries>1);assert.equal((await H.workerRequest(page)).releaseId,first.releaseId);assert.deepEqual((await H.inspectCaches(page)).filter(c=>c.name.startsWith('fluid-pwa-shell-')),releaseCaches);
    result.cases.push({case:'actual failed upgrade '+kind,newReleaseId:inv.releaseId,oldReleaseId:first.releaseId,failed,asset:negative.path,hits:negative.hits,fetchedEntries:networkEntries});
    await run.context.setOffline(true);response=await page.reload();assert.equal(response.fromServiceWorker(),true);await page.waitForFunction(()=>window.__painter?.engine?.capabilities?.canDepositPaint);await page.screenshot({path:path.join(evidence,'failed-'+kind+'-old-offline.png')});// Restore the V1 fixture BEFORE reconnecting: the production online/startup
    // detector must not race fixture teardown and install the now-unblocked V2/V3.
    // All negative-case assertions above still require redundant/no waiting/exact V1 cache.
    await page.waitForFunction(()=>!['checking','downloading'].includes(document.querySelector('#pwa-panel')?.dataset.update));served=v1;negative=null;await run.context.setOffline(false);
  }
  result.finalCaches=await H.inspectCaches(page);
  served=v1;await page.goto(server.base+'/__phase4_host.html');
  const painting=page.frames().find(f=>f.name()==='painting');await painting.waitForFunction(()=>window.__painter?.engine);
  const embedUrl=painting.url();assert.equal(new URL(embedUrl).searchParams.get('editorOrigin'),server.base);
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'vendor/tilecraft/message-api.js'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'vendor/tilecraft/fluid-gamifier-bridge.js'),'utf8')});
  const [connected]=await Promise.all([page.evaluate(async origin=>{window.qaBridge=new FluidGamifierBridge({createMessageApi,iframe:document.querySelector('iframe'),fluidOrigin:origin,exportModel:()=>null,renderBackground:()=>null});return await qaBridge.connect(5000);},server.base),painting.evaluate(()=>startFluidEmbed().then(()=>true))]);assert.equal(connected,true);
  const embeddedState=await painting.evaluate(()=>({url:location.href,controller:!!navigator.serviceWorker.controller,ready:!!window.__fluidEmbeddedClient,state:window.__painter.storyPlaybackController.state}));assert.equal(embeddedState.controller,true);assert.equal(embeddedState.ready,true);
  attackerServer=await H.startProductionServer({dist:v1,overlay:()=>({body:'<!doctype html><title>Wrong-origin attacker probe</title>',type:'text/html',cache:'no-store'})});result.attackerPort=attackerServer.port;
  const attackerHandle=await page.evaluateHandle(url=>{const f=document.createElement('iframe');f.name='attacker';f.src=url;document.body.appendChild(f);return f;},attackerServer.base+'/__attacker.html');
  await page.waitForFunction(()=>window.frames.length===2);const attacker=await attackerHandle.asElement().contentFrame();await attacker.waitForLoadState();
  await attacker.addScriptTag({content:fs.readFileSync(path.join(root,'vendor/tilecraft/message-api.js'),'utf8')});
  const refusal=await attacker.evaluate(async origin=>{const api=createMessageApi({channel:'tilecraft-fluid-gamifier',role:'story-editor',targetOrigin:origin,allowedOrigins:[origin],adoptSessionId:false,protocolVersion:'fluid-paint-v1'});api.addPeer('fluid-player',window.parent.frames[0],{origin});try{await api.waitReady('fluid-player',600);api.dispose();return {unexpected:true};}catch(e){api.dispose();return {refused:true,error:e.message};}},server.base);assert.equal(refusal.refused,true);
  assert.deepEqual(await painting.evaluate(()=>({url:location.href,controller:!!navigator.serviceWorker.controller,ready:!!window.__fluidEmbeddedClient,state:window.__painter.storyPlaybackController.state})),embeddedState);
  await page.screenshot({path:path.join(evidence,'embedded-security.png')});result.cases.push({case:'same-origin controlled iframe exact editorOrigin handshake; real wrong-origin/window attacker refused',embeddedState,refusal});
  await page.evaluate(()=>qaBridge.dispose());await close();page=await open('final-cold',true);response=await page.goto(server.base+'/index.html'+query);assert.equal(response.fromServiceWorker(),true);await page.waitForFunction(()=>window.__painter?.engine?.capabilities?.canDepositPaint);assert.equal((await H.workerRequest(page)).releaseId,first.releaseId);await page.screenshot({path:path.join(evidence,'final-cold.png')});  result.cases.push({case:'old release survives failed upgrades and second offline restart'});
  await run.context.setOffline(false);served=path.join(evidence,'v2');
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await page.evaluate(async()=>{const start=performance.now();while(performance.now()-start<20000){const r=await navigator.serviceWorker.getRegistration();if(r.waiting?.state==='installed')return;await new Promise(ok=>setTimeout(ok,50));}throw new Error('Waiting worker deadline');});
  result.validUpgradeState=await H.workerState(page);
  const waiting=await H.workerRequest(page,{target:'waiting'}),stillActive=await H.workerRequest(page);assert.equal(waiting.releaseId,inventory(served).releaseId);assert.equal(waiting.complete,true);assert.equal(stillActive.releaseId,first.releaseId);
  assert.equal(page.url(),server.base+'/index.html'+query);result.cases.push({case:'verified actual upgrade waits without activation/reload',active:stillActive,waiting});await page.screenshot({path:path.join(evidence,'valid-upgrade-waiting.png')});
  await run.context.setOffline(true);await close();page=await open('natural-activation-cold',true);response=await page.goto(server.base+'/'+query);assert.equal(response.fromServiceWorker(),true);await page.waitForFunction(()=>window.__painter?.engine?.capabilities?.canDepositPaint);const naturallyActive=await H.workerRequest(page);assert.equal(naturallyActive.releaseId,waiting.releaseId);assert.equal(await page.title(),'v2 Fluid Paint');result.cases.push({case:'browser natural activation only after all pages close',active:naturallyActive});await page.screenshot({path:path.join(evidence,'natural-activation-cold.png')});result.finalCaches=await H.inspectCaches(page);
  fs.writeFileSync(path.join(evidence,'server.json'),JSON.stringify(log,null,2));result.status='PASS';
}
(async()=>{try{await main();}catch(e){result.status='FAIL';result.error=e.stack;process.exitCode=1;}finally{try{await close();if(attackerServer){await attackerServer.stop();result.attackerStopped=true;await attackerServer.verifyStopped();result.attackerPortFree=true;}if(server){await server.stop();result.serverStopped=true;await server.verifyStopped();result.portFree=true;}}catch(e){result.cleanupError=e.stack;result.status='FAIL';process.exitCode=1;}fs.writeFileSync(path.join(evidence,'server.json'),JSON.stringify(serverLog,null,2));fs.writeFileSync(path.join(evidence,'browser.json'),JSON.stringify(browserLog,null,2));result.exitCode=process.exitCode||0;result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,cases:result.cases.length,evidence,port:result.port,portFree:result.portFree,error:result.error},null,2));}})();
