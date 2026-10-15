'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createActivation,updateMarker}=require('../app/pwa-register');
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const container=new EventTarget(),worker={state:'installed'},registration={waiting:worker};
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 let active=false,reloads=0,sends=0,locks=[],messages=[];
 const id='a'.repeat(64);const options={registration,container,storage,safety:()=>({active,dirty:'unknown'}),loadedRelease:id,status:async()=>({releaseId:id,complete:true}),send:async()=>{sends++},reload:()=>{reloads++},lock:v=>locks.push(v),render:s=>messages.push(s)};
 const api=createActivation(options);return {api,options,registration,container,storage,values,id,worker,messages,locks,get reloads(){return reloads},get sends(){return sends},set active(v){active=v}};
}
test('unknown dirty requires separate explicit consent, cancel never activates',async()=>{const f=fixture();assert.equal(await f.api.allow('discard'),false);assert.equal(await f.api.begin(),true);assert.equal(f.sends,0);f.api.cancel();assert.equal(await f.api.allow('discard'),false);assert.equal(f.sends,0)});
test('own active work refuses both before dialog and at final confirmation',async()=>{const f=fixture();f.active=true;assert.equal(await f.api.begin(),false);f.active=false;await f.api.begin();f.active=true;assert.equal(await f.api.allow('discard'),false);assert.equal(f.sends,0)});
test('missing safety API is not a clean page',async()=>{const f=fixture();const api=createActivation({...f.options,safety:()=>undefined});assert.equal(await api.begin(),false);assert.equal(f.sends,0)});
test('production Paint API traces real active branches and never calls unknown dirty clean',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const Paint=vm.runInNewContext(fs.readFileSync(require.resolve('../paint.js'),'utf8')+';Paint',{InteractionMode:{NONE:0}});
 const p={engine:{strokeActive:false},interactionState:0,storyPlaybackController:{state:'ready',backgroundLoading:false}};
 const read=()=>Paint.prototype.getUpdateSafety.call(p);assert.equal(read().active,false);assert.equal(read().dirty,'unknown');
 for(const field of ['manualStrokeActive','_manualInputPending','_updateOperations']){p[field]=1;assert.equal(read().active,true,field);p[field]=0}
 p.engine.strokeActive=true;assert.equal(read().active,true);p.engine.strokeActive=false;
 p.interactionState=1;assert.equal(read().active,true);p.interactionState=0;
 const c=p.storyPlaybackController;for(const state of ['loading','playing','paused']){c.state=state;assert.equal(read().active,true,state)}c.state='ready';
 c.backgroundLoading=true;assert.equal(read().active,true);c.backgroundLoading=false;c._runPromise=Promise.resolve();assert.equal(read().active,true);c._runPromise=null;p.storyPlaybackController=null;assert.equal(read().active,true);
});
test('export completion alone never allows activation; error never activates',async()=>{const f=fixture();await f.api.begin();assert.equal(await f.api.allow('saved'),false);await f.api.export(async()=>{});assert.equal(f.sends,0);assert.equal(f.api.snapshot().exported,true);await f.api.allow('saved');assert.equal(f.sends,1);const e=fixture();await e.api.begin();await e.api.export(async()=>{throw Error('encode')});assert.equal(await e.api.allow('discard'),false);assert.equal(e.sends,0)});
test('export in flight blocks cancel/duplicate allow; separate confirmation rechecks work',async()=>{const f=fixture();await f.api.begin();let finish;const p=f.api.export(()=>new Promise(r=>finish=r));assert.equal(await f.api.allow('discard'),false);finish();await p;f.active=true;assert.equal(await f.api.allow('saved'),false);assert.equal(f.sends,0)});
test('allow is once only, own session marker consumed before reload; duplicate events no loop',async()=>{const f=fixture();await f.api.begin();await Promise.all([f.api.allow('discard'),f.api.allow('discard')]);assert.equal(f.sends,1);f.container.controller=f.worker;f.container.dispatchEvent(new Event('controllerchange'));f.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(f.reloads,1);assert.equal(JSON.parse(f.storage.getItem(updateMarker)).reloaded,true);f.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(f.reloads,1)});
test('nonconsenting tab never reloads; unresponsive clients require no replies',async()=>{const f=fixture();f.container.controller=f.worker;f.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(f.reloads,0);await f.api.begin();await f.api.allow('discard');f.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(f.sends,1);assert.equal(f.reloads,1)});
test('storage denial fails closed, no activation',async()=>{const f=fixture();f.options.storage.setItem=()=>{throw Error('denied')};await f.api.begin();assert.equal(await f.api.allow('discard'),false);assert.equal(f.sends,0)});
test('changed candidate and wrong controller identity refuse activation/reload',async()=>{
 const f=fixture();await f.api.begin();f.registration.waiting={};assert.equal(await f.api.allow('discard'),false);assert.equal(f.sends,0);
 const g=fixture();g.api.dispose();const wrong={};const api=createActivation({...g.options,status:async worker=>({releaseId:worker===wrong?'b'.repeat(64):g.id,complete:true})});await api.begin();await api.allow('discard');g.container.controller=wrong;g.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(g.reloads,0);g.container.controller=g.worker;g.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(g.reloads,1);api.dispose();
});
test('loaded release verification consumes marker with no second reload, mismatch is explicit',async()=>{const f=fixture();f.storage.setItem(updateMarker,JSON.stringify({target:f.id,reloaded:true}));await f.api.verifyLoaded();const source=require('node:fs').readFileSync(require.resolve('../app/pwa-register'),'utf8');assert.doesNotMatch(source,/localStorage/);assert.match(source,/storage:root.sessionStorage/);assert.equal(f.api.snapshot().phase,'verified');assert.equal(f.storage.getItem(updateMarker),null);assert.equal(f.reloads,0);f.storage.setItem(updateMarker,JSON.stringify({target:'b'.repeat(64),reloaded:true}));await f.api.verifyLoaded();assert.equal(f.api.snapshot().phase,'error');assert.equal(f.reloads,0)});

test('ALLOW acknowledgement is not controllerchange: no early STATUS against old controller',async()=>{const f=fixture();let reads=0;f.container.controller={old:true};const api=createActivation({...f.options,status:async()=>{reads++;return {releaseId:f.id,complete:true}}});await api.begin();await api.allow('discard');assert.equal(reads,2);assert.equal(f.reloads,0);f.container.controller=f.worker;f.container.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(f.reloads,1);api.dispose()});
