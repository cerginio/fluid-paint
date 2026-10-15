'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {webcrypto,randomUUID}=require('node:crypto');
const {sha256}=require('./pwa-release-build');
const {fluidPwaWorker}=require('../app/pwa-worker');
function environment(failure) {
  const bytes=Buffer.from('const ok = 1;'), entry={path:'/a.'+sha256(bytes)+'.js',size:bytes.length,sha256:sha256(bytes)}, inv={releaseId:'a'.repeat(64),entries:[entry,{...entry,path:'/b.js'}]};
  const stores=new Map([['foreign-user-data',new Map()],['fluid-pwa-shell-v1-old-complete',new Map([['old',new Response('old')]])]]);
  let puts=0,fetches=0;
  const caches={keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n),open:async n=>{if(!stores.has(n))stores.set(n,new Map());const m=stores.get(n);return {keys:async()=>[...m.keys()],match:async u=>m.get(u)?.clone(),put:async(u,r)=>{if(failure==='quota'&&++puts===2)throw new DOMException('quota','QuotaExceededError');m.set(u,r.clone());}};}};
  const listeners={};let skips=0;const self={location:{origin:'https://app.test'},registration:{scope:'https://app.test/'},clients:{get:async id=>id==='own'?{type:'window',url:'https://app.test/'}:null,matchAll:async options=>{assert.equal(options.includeUncontrolled,true);return [{url:'https://app.test/'},{url:'https://app.test/?uncontrolled'}]}},skipWaiting:async()=>{skips++},addEventListener:(type,fn)=>listeners[type]=fn};
  const context={self,caches,crypto:{subtle:webcrypto.subtle,randomUUID},URL,Response,TextDecoder,Uint8Array,DataView,Map,Error,fetch:async()=>{
    fetches++;
    if(fetches===2&&failure==='network')throw new TypeError('network');
    let body=bytes,status=200,mime='text/javascript';
    if(fetches===2){if(failure==='404')status=404;if(failure==='mime')mime='text/plain';if(failure==='html')body=Buffer.from('<html>oops</html>');if(failure==='hash')body=Buffer.from('const bad =2;');}
    return new Response(body,{status,headers:{'Content-Type':mime}});
  }};
  const api=vm.runInNewContext('('+fluidPwaWorker.toString()+')('+JSON.stringify(inv)+')',context);
  return {api,stores,entry,inv,listeners,get skips(){return skips}};
}
for(const failure of ['quota','network','404','mime','html','hash'])test('atomic rejection: '+failure,async()=>{
  const {api,stores}=environment(failure),before=[...stores.keys()];
  await assert.rejects(api.install(),failure==='404'?/PWA_STATUS/:failure==='mime'?/PWA_MIME/:failure==='html'?/PWA_FORMAT/:failure==='hash'?/PWA_HASH/:failure==='quota'?/quota/:/network/);
  assert.deepEqual([...stores.keys()],before);assert.equal(await api.completeCache(),null);
  assert.equal((await api.serve({},'/b.js')).type,'error');assert.equal(await stores.get('fluid-pwa-shell-v1-old-complete').get('old').text(),'old');
});
test('complete marker last; restart lookup; same identity does not overwrite; partial never serves',async()=>{
  const {api,stores,entry}=environment();await api.install();const keys=[...stores.keys()];await api.install();assert.deepEqual([...stores.keys()],keys);
  assert.equal(await (await api.serve({},entry.path)).text(),'const ok = 1;');
  const complete=stores.get(keys[2]);assert.equal(complete.size,3);complete.delete('https://app.test/b.js');assert.equal(await api.completeCache(),null);assert.equal((await api.serve({},entry.path)).type,'error');
});
test('routing is exact GET same-origin inventory/navigation allowlist, query preserved outside request',()=>{
  const {api,entry}=environment();const r=(url,mode='cors',method='GET',headers={})=>api.route({url:'https://app.test'+url,mode,method,headers:new Headers(headers)});
  assert.equal(r('/?embedded=1&origin=https%3A%2F%2Fhost.test','navigate'),'/index.html');assert.equal(r('/index.html?seed=4','navigate'),'/index.html');assert.equal(r(entry.path),entry.path);
  for(const u of ['/examples/x','/sw.js','/release.json','/precache-inventory.json','/unknown.js','/index.html','/app/shaders/a.frag',entry.path+'?x=1'])assert.equal(r(u),null,u);
  assert.equal(r(entry.path,'cors','POST'),null);assert.equal(r(entry.path,'cors','GET',{authorization:'secret'}),null);assert.equal(r(entry.path,'cors','GET',{range:'bytes=0-1'}),null);
  assert.equal(api.route({url:'https://editor.test'+entry.path,method:'GET',headers:new Headers(),mode:'cors'}),null);
});
test('all formats and opaque/redirect/status fail closed before hash',async()=>{
  const {api}=environment();
  for(const [ext,mime,body] of [['html','text/html','oops'],['css','text/css','<html>oops'],['webmanifest','application/manifest+json','{}'],['png','image/png','bad'],['woff2','font/woff2','bad']])await assert.rejects(api.verified(new Response(body,{headers:{'Content-Type':mime}}),{path:'/a.'+ext,size:body.length,sha256:sha256(body)}),/PWA_FORMAT/);
  for(const headers of [{'Content-Type':'text/javascript','Cache-Control':'private'},{'Content-Type':'text/javascript','Set-Cookie':'secret=1'}])await assert.rejects(api.verified(new Response('const ok=1;',{headers}),{path:'/a.js'}),/PWA_PRIVATE/);
  for(const extra of [{type:'opaque'},{redirected:true},{status:201}])await assert.rejects(api.verified({status:200,type:'basic',redirected:false,...extra},{path:'/a.js'}),/PWA_STATUS/);
});
test('production-only inclusion and no forced lifecycle/UX; actual dev build is exercised by runner',()=>{
  const root=path.resolve(__dirname,'..'),gulp=fs.readFileSync(path.join(root,'gulpfile.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'dist/sw.js'),'utf8');
  assert.match(gulp,/isProd \? \[[^\]]*'app\/pwa-register\.js'[^\]]*\] : \[\]/);assert.doesNotMatch(html,/pwa-register|pwa-worker|serviceWorker/);assert.doesNotMatch(sw,/clients\.claim\s*\(/);assert.match(sw,/ALLOW_UPDATE/);assert.match(sw,/data.releaseId !== inventory.releaseId/);
});

test('actual worker ALLOW requires source, same release and complete install; clients are notifications only',async()=>{
 const e=environment();const send=async(type,releaseId=e.inv.releaseId,id='own')=>{let promise,reply;e.listeners.message({data:{type,releaseId,requestId:'request'},source:{id},ports:[{postMessage:r=>reply=r}],waitUntil:p=>promise=p});await promise;return reply};
 await send('ALLOW_UPDATE');assert.equal(e.skips,0);await e.api.install();
 assert.equal((await send('ALLOW_UPDATE','wrong')).allowed,false);assert.equal((await send('ALLOW_UPDATE',e.inv.releaseId,'foreign')).allowed,false);assert.equal(e.skips,0);
 assert.equal((await send('CLIENTS')).count,2);assert.equal(e.skips,0);assert.equal((await send('ALLOW_UPDATE')).allowed,true);assert.equal(e.skips,1);
});
test('compatibility serves only exact old hash bytes from committed namespace, never old HTML',async()=>{
 const e=environment();await e.api.install();const oldName=[...e.stores.keys()].at(-1),old=e.stores.get(oldName);
 // Use real factory with a distinct release, sharing persistent caches
 const source=fluidPwaWorker.toString();let networkOnly=0;const cacheApi={keys:async()=>[...e.stores.keys()],open:async name=>{const m=e.stores.get(name);return {keys:async()=>[...m.keys()],match:async u=>m.get(u)?.clone()}}};
 const api=vm.runInNewContext('('+source+')('+JSON.stringify({...e.inv,releaseId:'b'.repeat(64),entries:[]})+')',{self:{location:{origin:'https://app.test'},addEventListener(){}},caches:cacheApi,URL,Response,fetch:async()=>{networkOnly++;return Response.error()},crypto:webcrypto,Uint8Array,Map});
 assert.equal(await (await api.serve({},e.entry.path)).text(),'const ok = 1;');assert.equal((await api.serve({},'/index.html')).type,'error');assert.equal(networkOnly,0);await api.serve({},'/unknown.'+'c'.repeat(64)+'.js');assert.equal(networkOnly,1);
 old.set('https://app.test'+e.entry.path,new Response('tampered'));assert.equal((await api.serve({},e.entry.path)).type,'error');old.delete('https://app.test/__fluid_pwa_complete__');assert.equal((await api.serve({},e.entry.path)).type,'error');
});
