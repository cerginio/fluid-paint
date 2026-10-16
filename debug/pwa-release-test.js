'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync,execFileSync} = require('node:child_process');
const {sha256,canonicalInventory} = require('./pwa-release-build');
const root = path.resolve(__dirname,'..');
const dist = path.join(root,'dist');
const json = name => JSON.parse(fs.readFileSync(path.join(dist,name),'utf8'));
function build(cwd=root) {
  const r = spawnSync(process.execPath,[path.join(root,'node_modules/gulp/bin/gulp.js'),'build'],{cwd,env:{...process.env,NODE_ENV:'production',NODE_PATH:path.join(root,'node_modules')},encoding:'utf8'});
  assert.equal(r.status,0,r.stdout+r.stderr); return r.stdout+r.stderr;
}
test('canonical encoding is exact UTF-8 JSON pairs, byte ordered, no BOM/newline; invalid inputs refused',()=>{
  const a='a'.repeat(64), b='b'.repeat(64);
  const entries=[{path:'/z.js',sha256:b,size:99},{path:'/A.css',sha256:a}];
  const expected=`[["/A.css","${a}"],["/z.js","${b}"]]`;
  assert.deepEqual(canonicalInventory(entries),Buffer.from(expected,'utf8'));
  assert.deepEqual(canonicalInventory(entries.reverse()),Buffer.from(expected));
  assert.equal(sha256(canonicalInventory([])),'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945');
  for(const p of ['/../a','/a/./b','/a//b','relative','/é','/a?b','/a\\b']) assert.throws(()=>canonicalInventory([{path:p,sha256:a}]));
  assert.throws(()=>canonicalInventory([{path:'/a',sha256:a},{path:'/a',sha256:a}]));
  assert.throws(()=>canonicalInventory([{path:'/a',sha256:'A'.repeat(64)}]));
  assert.notEqual(sha256(canonicalInventory([{path:'/a',sha256:a}])),sha256(canonicalInventory([{path:'/b',sha256:a}])));
  assert.notEqual(sha256(canonicalInventory([{path:'/a',sha256:a}])),sha256(canonicalInventory([{path:'/a',sha256:b}])));
});
test('clean builds preserve hashed assets, refresh visible build metadata and delete stale output',()=>{
  build(); const first=json('precache-inventory.json'); const firstHtml=fs.readFileSync(path.join(dist,'index.html'),'utf8'); const metadata=json('release.json');
  fs.writeFileSync(path.join(dist,'stale-phase2-owned.js'),'stale');
  fs.mkdirSync(path.join(dist,'stale-phase2-owned'),{recursive:true});fs.writeFileSync(path.join(dist,'stale-phase2-owned/old.css'),'old');
  build(); const second=json('precache-inventory.json');
  assert.deepEqual(first.entries.filter(e=>e.path!=='/index.html'),second.entries.filter(e=>e.path!=='/index.html'));
  const normalized=html=>html.replace(/<meta name="fluid-(?:build-time|shell-id)"[^>]*>/g,'');
  assert.equal(normalized(firstHtml),normalized(fs.readFileSync(path.join(dist,'index.html'),'utf8')));
  assert.notEqual(first.releaseId,second.releaseId);assert.ok(fs.readFileSync(path.join(dist,'sw.js'),'utf8').includes(second.releaseId));
  assert.ok(!fs.existsSync(path.join(dist,'stale-phase2-owned.js')));assert.ok(!fs.existsSync(path.join(dist,'stale-phase2-owned')));
  assert.notEqual(metadata.buildTime,json('release.json').buildTime);
  assert.equal(second.releaseId,sha256(canonicalInventory(second.entries)));
});
test('inventory validates every content hash, hash filename and HTML/CSS/manifest reference; no SW/shader/metadata self-reference',()=>{
  const inv=json('precache-inventory.json'), meta=json('release.json');
  const urls=new Set(inv.entries.map(e=>e.path)); assert.equal(urls.size,inv.entries.length);
  assert.equal(inv.releaseId,meta.releaseId);assert.match(meta.gitSha,/^[0-9a-f]{40}$/);assert.ok(Number.isFinite(Date.parse(meta.buildTime)));
  for(const e of inv.entries){
    const bytes=fs.readFileSync(path.join(dist,e.path)); assert.equal(e.sha256,sha256(bytes));assert.equal(e.size,bytes.length);
    assert.doesNotMatch(e.path,/shaders|sw\.js|release\.json|precache-inventory|\.build/);
    if(!e.path.endsWith('.html'))assert.ok(e.path.includes(`.${e.sha256}.`),e.path);
  }
  assert.ok(fs.readFileSync(path.join(dist,'sw.js'),'utf8').includes(inv.releaseId));assert.ok(!fs.existsSync(path.join(dist,'.build')));
  for(const [source,output] of Object.entries(meta.assetMap))assert.ok(!fs.existsSync(path.join(dist,source)),source);
  const resolve=(value,base)=>{
    assert.ok(!/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value),value);
    const u=new URL(value,'https://release.test'+base);assert.equal(u.origin,'https://release.test');assert.equal(u.search+u.hash,'');
    const url=u.pathname==='/'?'/index.html':u.pathname;assert.ok(urls.has(url),`${base}: ${value}`);
  };
  for(const e of inv.entries){
    const text=fs.readFileSync(path.join(dist,e.path),'utf8');
    if(e.path.endsWith('.html')){
      for(const tag of text.matchAll(/<[a-z][^>]*>/gi)) {
        if(e.path==='/pwa-credits.html' && /^<a\s/i.test(tag[0]) && /href="https:\/\/(?:www\.svgrepo\.com\/collection\/dazzle-line-icons\/|creativecommons\.org\/licenses\/by\/4\.0\/)"/.test(tag[0]))continue;
        for(const m of tag[0].matchAll(/\b(?:href|src|poster|action)=["']([^"']+)["']/g))resolve(m[1],e.path);
      }
      assert.doesNotMatch(text,/\bsrcset\s*=/i);
    }
    if(e.path.endsWith('.css')){
      for(const m of text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g))resolve(m[1],e.path);
      for(const m of text.matchAll(/@import\s+["']([^"']+)["']/g))resolve(m[1],e.path);
    }
    if(e.path.endsWith('.webmanifest')){
      const walk=(v,k)=>{if(v&&typeof v==='object')Object.entries(v).forEach(([k,x])=>walk(x,k));else if(['src','url','id','scope','start_url'].includes(k))resolve(v,e.path);};walk(JSON.parse(text));
    }
  }
  assert.equal(inv.entries.length,Object.keys(meta.assetMap).length+inv.entries.filter(e=>e.path.endsWith('.html')).length);
});
test('real isolated production build changes identity on changed HTML bytes; checkout sources untouched',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase2-change-'));
  const before=json('precache-inventory.json');
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
  for(const file of [...new Set([...tracked,'debug/pwa-release-build.js','app/pwa-worker.js','app/pwa-register.js'])]){
    fs.mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(temp,file));
  }
  const source=fs.readFileSync(path.join(temp,'index.html'),'utf8');
  fs.writeFileSync(path.join(temp,'index.html'),source.replace('<title>','<title>Phase2 sensitivity '));
  try{
    const log=build(temp);fs.writeFileSync(path.join(temp,'build.log'),log);
    const changed=JSON.parse(fs.readFileSync(path.join(temp,'dist/precache-inventory.json')));
    assert.notEqual(before.releaseId,changed.releaseId);
    const old=new Map(before.entries.map(e=>[e.path,e.sha256]));
    assert.notEqual(old.get('/index.html'),changed.entries.find(e=>e.path==='/index.html').sha256);
    for(const e of changed.entries.filter(e=>e.path!=='/index.html'))assert.equal(e.sha256,old.get(e.path));
    fs.writeFileSync(path.join(temp,'result.json'),JSON.stringify({status:'PASS',before:before.releaseId,after:changed.releaseId,command:'NODE_ENV=production gulp build',revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),changedInput:'index.html title',sourceRoot:root,fixture:temp},null,2));
    console.log(`Change-sensitive build evidence: ${temp}`);
  }finally{fs.rmSync(path.join(temp,'dist'),{recursive:true,force:true});}
});
