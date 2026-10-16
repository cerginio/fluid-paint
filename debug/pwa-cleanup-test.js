'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm');
const {webcrypto,randomUUID}=require('node:crypto');
const {fluidPwaWorker}=require('../app/pwa-worker');
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64), origin='https://app.test';
const name=id=>'fluid-pwa-shell-v1-'+id+'-11111111-1111-4111-8111-111111111111';
function env({locks=true,entries=[],fetchImpl=async()=>Response.error()}={}) {
 const stores=new Map(),listeners={};let clients=[],tail=Promise.resolve();
 const caches={keys:async()=>[...stores.keys()],delete:async n=>stores.delete(n),open:async n=>{if(!stores.has(n))stores.set(n,new Map());const m=stores.get(n);return {keys:async()=>[...m.keys()],match:async k=>m.get(k)?.clone(),put:async(k,v)=>m.set(k,v.clone())};}};
 const self={location:{origin},registration:{scope:origin+'/',active:{state:'activated'}},navigator:locks?{locks:{request:(_,f)=>{const p=tail.then(f);tail=p.catch(()=>{});return p;}}}:{},clients:{matchAll:async o=>{assert.equal(o.includeUncontrolled,true);return clients;},get:async id=>clients.find(c=>c.id===id)},addEventListener:(t,f)=>listeners[t]=f};
 const api=vm.runInNewContext('('+fluidPwaWorker.toString()+')('+JSON.stringify({releaseId:B,shellId:'shell-b',entries})+')',{self,caches,URL,Response,crypto:{subtle:webcrypto.subtle,randomUUID},Map,Set,TextDecoder,Uint8Array,DataView,fetch:fetchImpl});
 const add=async id=>{const c=await caches.open(name(id));await c.put(origin+'/__fluid_pwa_complete__',new Response(id));};
 const activate=async()=>{let p;listeners.activate({waitUntil:x=>p=x});await p;};
 return {api,stores,self,add,activate,clients:ids=>clients=ids.map(id=>({id,url:origin+'/',type:'window'})),async seed(){await add(A);await add(B);await activate();}};
}
test('slow install does not hold the lifecycle lock across network fetch',async()=>{
 let releaseFetch, started;const fetching=new Promise(r=>started=r);
 const e=env({entries:[{path:'/bundle.js'}],fetchImpl:()=>{started();return new Promise(r=>releaseFetch=r);}});
 const install=e.api.install();await fetching;
 let timer;try{await Promise.race([e.api.rememberDocument('still-working',null,A),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('install blocks readiness lock')),1000))]);}
 finally{clearTimeout(timer);releaseFetch(Response.error());}
 await assert.rejects(install,/PWA_STATUS/);
});
// Each guard is a distinct eligibility/race invariant, not a browser claim.
test('active and foreign/user/demo namespaces survive exact owned cleanup',async()=>{const e=env();e.clients(['unknown']);await e.seed();for(const n of ['foreign','fluid-demo-v1','fluid-pwa-user-data','fluid-pwa-shell-v1-'+A+'-not-owned'])e.stores.set(n,new Map());e.clients([]);await e.api.cleanup();assert.ok(!e.stores.has(name(A)));assert.ok(e.stores.has(name(B)));assert.equal(e.stores.size,6);});
test('uncontrolled/unidentified client fails safe',async()=>{const e=env();e.clients(['unknown']);await e.seed();assert.ok(e.stores.has(name(A)));assert.equal((await e.api.cleanup()).unknown,true);});
test('observed old document protects its release without responding again',async()=>{const e=env();e.clients(['old']);await e.seed();await e.api.rememberDocument('old',null,A);await e.api.cleanup();assert.ok(e.stores.has(name(A)));});
test('last old close collects at next opportunity; current remains',async()=>{const e=env();e.clients(['old']);await e.seed();await e.api.rememberDocument('old',null,A);await e.api.cleanup();e.clients([]);await e.api.cleanup();assert.ok(!e.stores.has(name(A)));assert.ok(e.stores.has(name(B)));});
test('two old clients require last close',async()=>{const e=env();e.clients(['one','two']);await e.seed();for(const id of ['one','two'])await e.api.rememberDocument(id,null,A);e.clients(['two']);await e.api.cleanup();assert.ok(e.stores.has(name(A)));e.clients([]);await e.api.cleanup();assert.ok(!e.stores.has(name(A)));});
for(const field of ['waiting','installing'])test(field+' protects all candidate/partial caches',async()=>{const e=env();e.clients(['unknown']);await e.seed();await e.add(C);e.clients([]);e.self.registration[field]={state:'installed'};await e.api.cleanup();assert.ok(e.stores.has(name(C)));assert.ok(e.stores.has(name(A)));});
test('retired/waiting factory cannot collect active releases',async()=>{const e=env();await e.add(A);await e.add(B);assert.equal((await e.api.cleanup()).deferred,true);assert.ok(e.stores.has(name(A)));});
test('missing Web Locks refuses collection, not installation or serving',async()=>{const e=env({locks:false});await e.add(A);await e.add(B);await e.activate();assert.equal(await e.api.cleanup(),null);assert.ok(e.stores.has(name(A)));assert.ok(await e.api.completeCache());});
test('reserved new navigation pin protects before client becomes visible',async()=>{const e=env();e.clients(['unknown']);await e.seed();await e.api.rememberDocument('reserved',null,A,true);e.clients([]);await e.api.cleanup();assert.ok(e.stores.has(name(A)));});
test('pending pin becomes observed and later collects after closure',async()=>{const e=env();e.clients(['unknown']);await e.seed();await e.api.rememberDocument('reserved',null,A,true);e.clients(['reserved']);await e.api.cleanup();e.clients([]);await e.api.cleanup();assert.ok(!e.stores.has(name(A)));});
test('unknown shell never guesses current release',async()=>{const e=env();e.clients(['old']);await e.seed();await e.api.rememberDocument('old','unknown-shell');assert.equal((await e.api.cleanup()).unknown,true);assert.ok(e.stores.has(name(A)));});
test('known document reports pinned shell not active controller identity',async()=>{const e=env();e.clients(['new']);await e.seed();await e.api.rememberDocument('new','shell-b');await e.api.cleanup();assert.ok(!e.stores.has(name(A)));assert.ok(e.stores.has(name(B)));});
test('concurrent pin and collection serialize; durable state survives calls',async()=>{const e=env();e.clients(['unknown']);await e.seed();await Promise.all([e.api.rememberDocument('reserved',null,A,true),e.api.cleanup()]);e.clients([]);await e.api.cleanup();assert.ok(e.stores.has(name(A)));});
