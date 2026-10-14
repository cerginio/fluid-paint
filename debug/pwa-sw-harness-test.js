'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const h=require('./pwa-sw-harness');
const fixture=require('./pwa-sw-fixture');
test('cache policy scopes metadata, HTML and only full SHA-256 names',()=>{
  for(const name of ['/sw.js','/release.json','/precache-inventory.json'])assert.equal(h.cacheControl(name),'no-store');
  assert.equal(h.cacheControl('/'),'no-cache');assert.equal(h.cacheControl('/index.html'),'no-cache');
  assert.match(h.cacheControl('/bundle.'+'a'.repeat(64)+'.js'),/immutable/);
  for(const name of ['/bundle.js','/app/layout.css','/bundle.abc.js'])assert.equal(h.cacheControl(name),'no-cache');
});
test('external evidence rejects checkout and temp root',()=>{
  assert.throws(()=>h.externalDirectory(path.resolve(__dirname,'..')),/os.tmpdir|repo/);
  assert.throws(()=>h.externalDirectory(os.tmpdir()),/os.tmpdir/);
});
test('fixture has isolated scope and natural lifecycle; no production output worker',()=>{
  assert.equal(fixture.PREFIX,'/__pwa_fixture/');assert.equal(fs.existsSync(path.resolve(__dirname,'../dist/sw.js')),false);
  const source=fixture.workerSource('v1');new Function(source);
  assert.doesNotMatch(source,/self\.skipWaiting\(|clients\.claim\(/);assert.match(source,/requestId/);assert.match(source,/IGNORE/);
  const sw=fixture.fixtureRoutes(()=>'v2')('/sw.js');assert.equal(sw.cache,'no-store');assert.equal(sw.headers['Service-Worker-Allowed'],fixture.PREFIX);
});
test('real HTTP serving has MIME, no SPA fallback, method refusal and bind-back',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-server-guard-'));
  let server;
  try {
    fs.writeFileSync(path.join(root,'index.html'),'fixture guard');fs.writeFileSync(path.join(root,'manifest.webmanifest'),'{}');
    server=await h.startProductionServer({dist:root,overlay:fixture.fixtureRoutes(()=>'v1')});
    const home=await fetch(server.base+'/');assert.equal(await home.text(),'fixture guard');assert.equal(home.headers.get('cache-control'),'no-cache');
    const manifest=await fetch(server.base+'/manifest.webmanifest');assert.equal(manifest.headers.get('content-type'),'application/manifest+json');
    assert.equal((await fetch(server.base+'/absent.js')).status,404);assert.equal((await fetch(server.base+'/',{method:'POST'})).status,405);
    assert.equal((await fetch(server.base+'/sw.js')).headers.get('cache-control'),'no-store');
  } finally {if(server){await server.stop();assert.equal(await server.verifyStopped(),true);}fs.rmSync(root,{recursive:true,force:true});}
});
test('harness public API is import-safe and reusable',()=>{
  for(const name of ['launchProfile','registerWorker','workerRequest','workerState','inspectCaches','startProductionServer','bindBack'])assert.equal(typeof h[name],'function');
  assert.equal(typeof require('./pwa-sw-selftest').selftest,'function');
});
