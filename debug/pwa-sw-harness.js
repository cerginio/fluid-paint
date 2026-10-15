'use strict';
// Reusable infrastructure for later PWA phases. No app registration, no build writes.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const net=require('node:net');
const {chromium}=require('playwright');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
function cacheControl(pathname) {
  if(pathname==='/sw.js' || pathname==='/release.json' || pathname==='/precache-inventory.json') return 'no-store';
  if(pathname==='/' || pathname.endsWith('.html')) return 'no-cache';
  return /\.[a-f0-9]{64}\.[a-z0-9]+$/.test(pathname)?'public, max-age=31536000, immutable':'no-cache';
}
function externalDirectory(directory) {
  const resolved=path.resolve(directory), tmp=path.resolve(os.tmpdir());
  const relative=path.relative(tmp,resolved);
  if(!relative || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw new Error('Evidence/profile must be a child of os.tmpdir()');
  const repo=path.resolve(__dirname,'..'), repoRelative=path.relative(repo,resolved);
  if(!repoRelative.startsWith('..'+path.sep) && repoRelative!=='..' && !path.isAbsolute(repoRelative)) throw new Error('Evidence/profile cannot be inside repo');
  fs.mkdirSync(resolved,{recursive:true});return resolved;
}
function createEvidence() {
  const parent=externalDirectory(path.join(os.tmpdir(),'fluid-pwa'));
  return fs.mkdtempSync(path.join(parent,'phase3-'));
}
async function bindBack(port) {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  return true;
}
async function startProductionServer({dist=path.resolve(__dirname,'../dist'),port=0,overlay=()=>null,log=()=>{}}={}) {
  const root=fs.realpathSync(dist);
  const server=http.createServer((request,response)=>{
    let pathname;
    try {pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);} catch {response.writeHead(400);response.end();return;}
    const send=(status,body,type,cache,headers={})=>{log({method:request.method,url:request.url,status,type,cache});response.writeHead(status,{'Content-Type':type,'Cache-Control':cache,...headers});response.end(request.method==='HEAD'?undefined:body);};
    if(!['GET','HEAD'].includes(request.method)){send(405,'Method not allowed','text/plain','no-store');return;}
    const fixture=overlay(pathname);
    if(fixture){if(fixture.disconnect){request.socket.destroy();return;}send(fixture.status || 200,fixture.body,fixture.type,fixture.cache,fixture.headers);return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    const relative=path.relative(root,file);
    if(relative.startsWith('..') || path.isAbsolute(relative)){send(403,'Forbidden','text/plain','no-store');return;}
    try {
      const real=fs.realpathSync(file), realRelative=path.relative(root,real);
      if(realRelative.startsWith('..') || path.isAbsolute(realRelative) || !fs.statSync(real).isFile()) throw new Error('Not a served file');
      send(200,fs.readFileSync(real),TYPES[path.extname(real)] || 'application/octet-stream',cacheControl(pathname));
    } catch {send(404,'Not found','text/plain','no-store');}
  });
  server.requestTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const actualPort=server.address().port;
  let stopped=false;
  return {port:actualPort,base:`http://127.0.0.1:${actualPort}`,async stop(){if(stopped)return;stopped=true;server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));},async verifyStopped(){return bindBack(actualPort);}};
}
async function launchProfile({profile,evidence,label,offline=false,headed=false,userAgent}) {
  externalDirectory(profile);externalDirectory(evidence);
  const context=await chromium.launchPersistentContext(profile,{headless:!headed,userAgent,serviceWorkers:'allow',offline,viewport:{width:1000,height:720},recordHar:{path:path.join(evidence,label+'.har'),content:'embed'},args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=1']});
  try {await context.tracing.start({screenshots:true,snapshots:true,sources:true});} catch(error){await context.close();throw error;}
  return {context,async close(){
    const browser=context.browser(),pages=context.pages().length;
    try {await context.tracing.stop({path:path.join(evidence,label+'-trace.zip')});await Promise.all(context.pages().map(page=>page.close()));} finally {await context.close();}
    return {label,pagesClosed:pages,browserDisconnected:!browser?.isConnected()};
  }};
}
async function registerWorker(page,{url='/sw.js',scope='/' }={}) {
  await page.evaluate(async({url,scope})=>{
    let timer;
    try {await Promise.race([(async()=>{await navigator.serviceWorker.register(url,{scope,updateViaCache:'none'});await navigator.serviceWorker.ready;})(),new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('SW_REGISTRATION_TIMEOUT')),10000);})]);} finally {clearTimeout(timer);}
  },{url,scope});
  await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:10000});
}
// Runs in the actual browser; handles active OR waiting worker, request IDs,
// bounded timeout and closing both MessagePorts on every completion path.
async function workerRequest(page,{target='active',type='STATUS',timeout=2000,scope}={}) {
  return page.evaluate(async({target,type,timeout,scope})=>{
    const registration=await navigator.serviceWorker.getRegistration(scope);
    const worker=registration?.[target];
    if(!worker) throw new Error('No '+target+' worker');
    const requestId=crypto.randomUUID(), started=performance.now();
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel();
      const finish=()=>{clearTimeout(timer);channel.port1.close();channel.port2.close();};
      const timer=setTimeout(()=>{finish();reject(new Error('SW_REQUEST_TIMEOUT '+target+' '+type+' '+requestId));},timeout);
      channel.port1.onmessage=event=>{if(event.data?.requestId!==requestId)return;finish();resolve({...event.data,target,elapsedMs:performance.now()-started});};
      try {worker.postMessage({requestId,type},[channel.port2]);} catch(error){finish();reject(error);}
    });
  },{target,type,timeout,scope});
}
async function workerState(page,scope) {
  return page.evaluate(async scope=>{const r=await navigator.serviceWorker.getRegistration(scope);return {scope:r?.scope,updateViaCache:r?.updateViaCache,controller:navigator.serviceWorker.controller?.scriptURL || null,active:r?.active?.state || null,waiting:r?.waiting?.state || null,installing:r?.installing?.state || null};},scope);
}
async function inspectCaches(page) {
  return page.evaluate(async()=>{const result=[];for(const name of await caches.keys()){const cache=await caches.open(name),entries=[];for(const request of await cache.keys()){const response=await cache.match(request),bytes=await response.arrayBuffer(),contentType=response.headers.get('content-type'),digest=await crypto.subtle.digest('SHA-256',bytes);entries.push({url:request.url,status:response.status,contentType,size:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),body:/text\/|json|javascript|svg/.test(contentType || '')?new TextDecoder().decode(bytes):undefined});}result.push({name,entries});}return result;});
}
module.exports={TYPES,cacheControl,externalDirectory,createEvidence,bindBack,startProductionServer,launchProfile,registerWorker,workerRequest,workerState,inspectCaches};
