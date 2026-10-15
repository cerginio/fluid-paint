'use strict';
// Phase-1 regression: real Chromium, exact phase-2 built dist, real gulp MIME.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');
acquireBrowserLock('Fluid PWA phase 1 assets');
const root = path.resolve(__dirname,'..');
const assetMap = JSON.parse(fs.readFileSync(path.join(root,'dist/release.json'),'utf8')).assetMap;
const evidence = path.resolve(process.env.PWA_EVIDENCE_DIR || path.join(os.tmpdir(), 'fluid-pwa', `phase1-${Date.now()}-${process.pid}`));
assert.ok(!evidence.startsWith(root + path.sep), 'Evidence must live outside repository');
fs.mkdirSync(evidence,{recursive:true});
const result = { startedAt:new Date().toISOString(), evidence, revision:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), dirtyScope:require('node:child_process').execFileSync('git',['status','--short','--untracked-files=all'],{cwd:root,encoding:'utf8'}), requests:[], responses:[], requestFailures:[], pages:[], manifest:null, limitations:['Headless Chromium/SwiftShader only; no physical Android/iOS or install/offline acceptance.', 'Optional remote demo catalog is outside phase 1 and localhost is not CDN CORS-allowlisted.'] };
let server, browser, context, port, serverLog='';
const svgFile = path.join(root,'dist','.pwa-mime-probe.svg');
const free = async (port) => {
  const socket = net.createServer();
  await new Promise((resolve,reject) => { socket.once('error',reject); socket.listen(port,'127.0.0.1',resolve); });
  await new Promise((resolve) => socket.close(resolve));
};
async function main() {
  fs.writeFileSync(svgFile,'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  server = spawn(process.execPath,[path.join(path.dirname(require.resolve('gulp')), 'bin', 'gulp.js'),'startServer'],{cwd:root,env:{...process.env,PORT:process.env.PWA_QA_PORT || '0',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  port = await new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('Server readiness timeout')),15000);
    const collect=(chunk)=> { serverLog+=chunk; const m=serverLog.match(/http:\/\/127\.0\.0\.1:(\d+)/); if(m){clearTimeout(timer);resolve(Number(m[1]));} };
    server.stdout.on('data',collect); server.stderr.on('data',collect);
    server.once('exit',(code)=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`));});
  });
  result.port=port; const base=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=1']});
  result.browserVersion=browser.version();
  context=await browser.newContext({recordHar:{path:path.join(evidence,'network.har'),content:'embed'}});
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  context.on('request',(request)=>result.requests.push({url:request.url(),type:request.resourceType()}));
  context.on('response',(response)=>result.responses.push({url:response.url(),status:response.status()}));
  context.on('requestfailed',(request)=>result.requestFailures.push({url:request.url(),failure:request.failure()}));
  for (const viewport of [{width:1280,height:900},{width:320,height:900}]) {
    const page=await context.newPage(); await page.setViewportSize(viewport);
    const errors=[]; page.on('pageerror',(error)=>errors.push(error.message));
    await page.goto(`${base}/`,{waitUntil:'load'});
    await page.waitForFunction(()=>window.__painter?.storyTools,{timeout:30000});
    await page.evaluate(async()=>{for(const weight of [400,600,700]) await document.fonts.load(`${weight} 14px "Open Sans"`,'Paint Fluidity Ї Є Ґ Ł'); await document.fonts.ready;});
    await page.click('#panel-grip');
    await page.locator('#fluidity-slider').waitFor({state:'visible'});
    const slider=page.locator('#fluidity-slider'); const box=await slider.boundingBox();
    await slider.click({position:{x:box.width*.7,y:box.height/2}});
    await page.screenshot({path:path.join(evidence,`${viewport.width}-panel.png`)});
    await page.click('#panel-extension-toggle');
    await page.click('#story-file-tab');
    assert.equal(await page.locator('#story-file-tab').getAttribute('aria-selected'),'true');
    assert.equal(await page.locator('#story-file-dropzone').isVisible(),true);
    await page.screenshot({path:path.join(evidence,`${viewport.width}-file.png`)});
    await page.click('#story-player-tab');
    assert.equal(await page.locator('#story-player-empty').isVisible(),true);
    await page.click('#bake-tab');
    assert.equal(await page.locator('#bake-button').isVisible(),true);
    await page.screenshot({path:path.join(evidence,`${viewport.width}-state.png`)});
    const geometry=await page.evaluate(()=>Object.fromEntries(['ui','panel-bar','panel-extension','fluidity-slider','bristles-slider','size-slider','bake-button'].map((id)=>{const e=document.getElementById(id);const r=e.getBoundingClientRect();return [id,{x:r.x,y:r.y,width:r.width,height:r.height,visible:!!e.getClientRects().length}];})));
    for(const id of ['ui','panel-bar','panel-extension','bake-button']) {
      const r=geometry[id]; assert.ok(r.visible); assert.ok(r.x>=-1 && r.x+r.width<=viewport.width+1,`${viewport.width} ${id} horizontal fit ${JSON.stringify(r)}`);
      assert.ok(r.y>=-1 && r.y+r.height<=viewport.height+1,`${viewport.width} ${id} vertical fit`);
    }
    const fontFaces=await page.evaluate(()=>Array.from(document.fonts).map((f)=>({family:f.family,weight:f.weight,status:f.status})));
    for(const weight of ['400','600','700']) assert.ok(fontFaces.some((f)=>f.family==='Open Sans'&&f.weight===weight&&f.status==='loaded'));
    const client=await context.newCDPSession(page);
    const parsed=await client.send('Page.getAppManifest');
    assert.equal(parsed.errors.length,0,JSON.stringify(parsed.errors));
    const m=JSON.parse(parsed.data);assert.equal(m.name,'Fluid Paint');assert.equal(m.start_url,'/');
    for(const icon of m.icons) {
      const dimensions=await page.evaluate(async(src)=>{const image=new Image();image.src=src;await image.decode();return [image.naturalWidth,image.naturalHeight];},new URL(icon.src,base+'/').href);
      assert.deepEqual(dimensions,icon.sizes.split('x').map(Number));
    }
    const apple=await page.evaluate(async()=>{const i=new Image();i.src=document.querySelector('link[rel="apple-touch-icon"]').href;await i.decode();return [i.naturalWidth,i.naturalHeight];});
    assert.deepEqual(apple,[180,180]);
    assert.equal(await page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).length),1);
    assert.deepEqual(errors,[]);
    result.manifest=parsed;result.pages.push({viewport,geometry,fontFaces,pageErrors:errors,manifestErrors:parsed.errors});
    await page.close();
  }
  result.mime=[];
  for(const [file,type] of [['manifest.webmanifest','application/manifest+json'],['assets/icons/icon-512.png','image/png'],['.pwa-mime-probe.svg','image/svg+xml'],['assets/fonts/open-sans/open-sans-latin-400-normal.woff2','font/woff2']]) {
    const response=await context.request.get(`${base}/${assetMap[file] || file}`); assert.equal(response.status(),200);
    assert.equal(response.headers()['content-type'].split(';')[0],type);result.mime.push({file,status:response.status(),contentType:response.headers()['content-type']});
  }
  assert.equal(result.requests.filter((r)=>/fonts\.(googleapis|gstatic)\.com/.test(r.url)).length,0);
  assert.deepEqual(result.responses.filter((r)=>r.url.startsWith(base)&&r.status>=400),[], 'No failed same-origin assets');
  assert.deepEqual(result.requestFailures.filter((r)=>r.url.startsWith(base)),[], 'No failed same-origin requests');
  result.command='npm run test:pwa-assets:browser';
  result.environment={node:process.version,platform:process.platform,arch:process.arch,serverCommand:`NODE_ENV=production PORT=${process.env.PWA_QA_PORT||'0'} node node_modules/gulp/bin/gulp.js startServer`};
  result.inputs={releaseId:JSON.parse(fs.readFileSync(path.join(root,'dist/release.json'),'utf8')).releaseId,assetMap};
  result.status='PASS';
}
(async()=>{
  try{await main();}catch(error){result.status='FAIL';result.error=error.stack;process.exitCode=1;}
  finally {
    if(context){await context.tracing.stop({path:path.join(evidence,'trace.zip')});await context.close();}
    if(browser) await browser.close();
    if(server && server.exitCode===null){const exited=new Promise((resolve)=>server.once('exit',resolve));server.kill();await exited;}
    if(fs.existsSync(svgFile)) fs.unlinkSync(svgFile);
    if(port){await free(port);result.portFree=true;}
    result.finishedAt=new Date().toISOString();result.exitCode=process.exitCode||0;fs.writeFileSync(path.join(evidence,'server.log'),serverLog);
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify({status:result.status,pages:result.pages.length,googleFontRequests:result.requests.filter((r)=>/fonts\.(googleapis|gstatic)\.com/.test(r.url)).length,port:result.port,portFree:result.portFree,evidence,error:result.error},null,2));
  }
})();
