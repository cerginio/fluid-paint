'use strict';
// Reuses the phase-1 production gulp/Playwright runner contract, browser lock,
// Paint debug API and retained story UI input; offline acceptance has its own runner.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {spawn,spawnSync,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
require('./browser-lock').acquireBrowserLock('Fluid PWA phase 2 production release');
const root=path.resolve(__dirname,'..');
const parent=path.join(os.tmpdir(),'fluid-pwa');fs.mkdirSync(parent,{recursive:true});
const evidence=process.env.PWA_RELEASE_EVIDENCE_DIR ? require('./pwa-sw-harness').externalDirectory(process.env.PWA_RELEASE_EVIDENCE_DIR) : fs.mkdtempSync(path.join(parent,'phase2-'));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const result={status:'RUNNING',startedAt:new Date().toISOString(),evidence,revision:git(['rev-parse','HEAD']),dirtyScope:git(['status','--short','--untracked-files=all']),command:'npm run test:pwa-release:browser',environment:{node:process.version,platform:process.platform,arch:process.arch,backend:'Chromium ANGLE SwiftShader',serverCommand:'NODE_ENV=production PORT=0 node node_modules/gulp/bin/gulp.js startServer'},inputs:{story:'docs/story-2026-09-08-4-frames.json',png:'real PNG exported in this run',seed:41},builds:[],cases:[],requests:[],responses:[],requestFailures:[],completedSteps:[],limitations:['Headless Chromium/SwiftShader, not physical Android/iOS or native GPU.','Online production regression with production registration; offline cold start/install/update are exercised by pwa-worker-browser-test, not this runner. No CDN/deploy proof.','Optional CDN Demo data not accepted; localhost not CORS allowlisted.','GPU allocations bounded using existing Paint debug API; painting resize uses existing preview/commit API, viewport resize and drawing/Bake/export/import use real UI.']};
let server,browser,context,port,serverLog='';
const inventory=()=>JSON.parse(fs.readFileSync(path.join(root,'dist/precache-inventory.json'),'utf8'));
function build(label){
  const b=spawnSync(process.execPath,[path.join(root,'node_modules/gulp/bin/gulp.js'),'build'],{cwd:root,env:{...process.env,NODE_ENV:'production'},encoding:'utf8'});
  fs.writeFileSync(path.join(evidence,`build-${label}.log`),(b.stdout||'')+(b.stderr||''));assert.equal(b.status,0,b.stdout+b.stderr);
  const inv=inventory();result.builds.push({label,command:'NODE_ENV=production node node_modules/gulp/bin/gulp.js build',exitCode:b.status,releaseId:inv.releaseId,entries:inv.entries.length});
  fs.copyFileSync(path.join(root,'dist/precache-inventory.json'),path.join(evidence,`inventory-${label}.json`));
  fs.copyFileSync(path.join(root,'dist/release.json'),path.join(evidence,`release-${label}.json`));
  return inv;
}
async function bindBack(p){const s=net.createServer();await new Promise((ok,no)=>{s.once('error',no);s.listen(p,'127.0.0.1',ok);});await new Promise(ok=>s.close(ok));}
async function main(){
  const first=build('first');
  server=spawn(process.execPath,[path.join(root,'node_modules/gulp/bin/gulp.js'),'startServer'],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:process.env.PWA_QA_PORT||'0'},stdio:['ignore','pipe','pipe']});
  result.serverPid=server.pid;result.environment.serverCommand=`NODE_ENV=production PORT=${process.env.PWA_QA_PORT||'0'} node node_modules/gulp/bin/gulp.js startServer`;
  port=await new Promise((ok,no)=>{const timer=setTimeout(()=>no(new Error('Server readiness timeout')),15000);const collect=data=>{serverLog+=data;const m=serverLog.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);ok(Number(m[1]));}};server.stdout.on('data',collect);server.stderr.on('data',collect);server.once('exit',code=>{clearTimeout(timer);no(new Error(`Server exited ${code}`));});});
  result.port=port;const base=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=1']});result.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:960,height:720},acceptDownloads:true,recordHar:{path:path.join(evidence,'network.har'),content:'embed'}});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  context.on('request',r=>result.requests.push({url:r.url(),type:r.resourceType()}));
  context.on('response',r=>result.responses.push({url:r.url(),status:r.status()}));
  context.on('requestfailed',r=>result.requestFailures.push({url:r.url(),failure:r.failure()}));
  for(const version of [1,2]){
    if(version===2){const second=build('second');assert.deepEqual(second.entries.filter(e=>e.path!=='/index.html'),first.entries.filter(e=>e.path!=='/index.html'));assert.notEqual(second.releaseId,first.releaseId);result.completedSteps.push('two builds preserve immutable assets and refresh timestamp identity');}
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url=`${base}/?webgl=${version}&debug=none&diag=0&seed=41`;await page.goto(url);await page.waitForFunction(()=>window.__painter?.engine?.capabilities?.canDepositPaint);
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
    await page.setInputFiles('#story-file-input',path.join(root,result.inputs.story));await page.waitForFunction(()=>window.__painter.storyPlaybackController.state==='ready');assert.equal(await page.locator('#story-player-page').isVisible(),true);
    assert.match(await page.locator('#story-player-file-name').textContent(),/story-2026-09-08-4-frames.json/);await page.screenshot({path:path.join(evidence,`webgl${version}-story.png`)});
    assert.deepEqual(errors,[]);assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),1);
    result.cases.push({version,url,releaseId:inventory().releaseId,drawn,resized,baked,png,pngBytes:bytes.length,imported,storyState:'ready',errors});
    result.completedSteps.push(`WebGL${version}: pointer draw, painting resize, viewport resize, UI Bake, real PNG download, local PNG + story import`);
    await page.close();
  }
  result.inventoryHttp=[];
  for(const e of inventory().entries){const response=await context.request.get(base+e.path);assert.equal(response.status(),200,e.path);const bytes=await response.body();assert.equal(require('./pwa-release-build').sha256(bytes),e.sha256,e.path);result.inventoryHttp.push({path:e.path,status:response.status(),hashVerified:true,contentType:response.headers()['content-type']});}
  assert.equal(result.requests.filter(r=>/fonts\.(googleapis|gstatic)\.com/.test(r.url)).length,0);
  assert.equal(result.requests.filter(r=>/\/shaders\//.test(r.url)).length,0);
  assert.deepEqual(result.responses.filter(r=>r.url.startsWith(base)&&r.status>=400),[]);assert.deepEqual(result.requestFailures.filter(r=>r.url.startsWith(base)),[]);
  result.completedSteps.push('every inventory URL HTTP 200 and SHA-256 readback; no hashed 404 or shader XHR');result.status='PASS';
}
(async()=>{try{await main();}catch(error){result.status='FAIL';result.error=error.stack;process.exitCode=1;}finally{
  try{if(context){await context.tracing.stop({path:path.join(evidence,'trace.zip')});await context.close();}if(browser)await browser.close();}catch(e){result.cleanupError=e.stack;result.status='FAIL';process.exitCode=1;}
  if(server&&server.exitCode===null){const exited=new Promise(ok=>server.once('exit',ok));server.kill();await exited;}result.serverExitCode=server?.exitCode;result.serverSignal=server?.signalCode;
  try{if(port){await bindBack(port);result.portFree=true;}}catch(e){result.cleanupError=e.stack;result.status='FAIL';process.exitCode=1;}
  result.finishedAt=new Date().toISOString();result.exitCode=process.exitCode||0;
  fs.writeFileSync(path.join(evidence,'server.log'),serverLog);fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status,cases:result.cases.length,builds:result.builds,port,portFree:result.portFree,evidence,error:result.error},null,2));
}})();
