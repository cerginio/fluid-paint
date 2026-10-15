'use strict';
// Run from the real checkout: never write its retained dist or stop its server.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase7a-')),source=path.join(evidence,'source');
const result={status:'RUNNING',evidence,source,commands:[],suites:[],probes:[]};
const save=()=>fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
function command(label,args,env={},timeout=600000){
 const r=spawnSync(process.execPath,args,{cwd:source,env:{...process.env,...env},encoding:'utf8',timeout});
 const stdout=path.join(evidence,label+'.stdout.log'),stderr=path.join(evidence,label+'.stderr.log');fs.writeFileSync(stdout,r.stdout||'');fs.writeFileSync(stderr,r.stderr||'');
 result.commands.push({label,executable:process.execPath,args,cwd:source,env,exitCode:r.status,stdout,stderr,error:r.error?.message});
 if(args.includes('--test'))result.suites.push({label,passed:Number(r.stdout?.match(/# pass (\d+)/)?.[1]||0),failed:Number(r.stdout?.match(/# fail (\d+)/)?.[1]||0)});
 save();assert.equal(r.status,0,label+'\n'+r.stdout+'\n'+r.stderr+'\n'+r.error);
}
function probe(label,file,variable){const destination=path.join(evidence,label);command(label,['debug/'+file],{[variable]:destination});const p=JSON.parse(fs.readFileSync(path.join(destination,'result.json')));assert.equal(p.status,'PASS');assert.equal(p.portFree,true);result.probes.push({label,path:path.join(destination,'result.json'),cases:p.cases.length,port:p.port,attackerPort:p.attackerPort,portFree:p.portFree});save();}
function retainedReadback(label){
 const script=`const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{sha256}=require('./debug/pwa-release-build');(async()=>{const root=${JSON.stringify(root)},inventory=JSON.parse(fs.readFileSync(path.join(root,'dist/precache-inventory.json'))),entries=[];for(const e of [...inventory.entries,{path:'/sw.js',sha256:sha256(fs.readFileSync(path.join(root,'dist/sw.js')))}]){const response=await fetch('http://127.0.0.1:3000'+e.path);assert.equal(response.status,200);assert.equal(sha256(Buffer.from(await response.arrayBuffer())),e.sha256);entries.push({path:e.path,status:200,sha256:e.sha256});}console.log(JSON.stringify({releaseId:inventory.releaseId,entries}));})().catch(e=>{console.error(e);process.exitCode=1});`;
 command(label,['-e',script]);
 return JSON.parse(fs.readFileSync(path.join(evidence,label+'.stdout.log'),'utf8'));
}
try{
 fs.mkdirSync(source);
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
 for(const file of files){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.copyFileSync(path.join(root,file),path.join(source,file));}
 fs.symlinkSync(path.join(root,'node_modules'),path.join(source,'node_modules'),'junction');
 execFileSync('git',['init','--quiet'],{cwd:source});
 // Retain source revision metadata without a new commit or touching the shared index.
 execFileSync('git',['fetch','--quiet',root,'HEAD'],{cwd:source});execFileSync('git',['update-ref','HEAD','FETCH_HEAD'],{cwd:source});
 execFileSync('git',['-c','core.autocrlf=false','add','--all'],{cwd:source});
 const inventory=()=>fs.readFileSync(path.join(root,'dist/precache-inventory.json'),'utf8');const sw=()=>fs.readFileSync(path.join(root,'dist/sw.js'));
 result.retainedBefore={inventory:inventory(),swSha:require('./pwa-release-build').sha256(sw()),http:retainedReadback('retained-http-before')};
 command('build',['node_modules/gulp/bin/gulp.js','build'],{NODE_ENV:'production'});
 for(const [label,file] of [['activation','pwa-activation-test.js'],['detection','pwa-detection-test.js'],['readiness','pwa-readiness-test.js'],['worker','pwa-worker-test.js'],['ux','pwa-ux-test.js']])command(label,['--test','--test-reporter=tap','debug/'+file],{NODE_ENV:'production'});
 probe('production-browser','pwa-worker-browser-test.js','PWA_PHASE4_EVIDENCE');
 probe('readiness-browser','pwa-readiness-browser-test.js','PWA_PHASE5_EVIDENCE');
 probe('detection-browser','pwa-detection-browser-test.js','PWA_PHASE6_EVIDENCE');
 probe('activation-browser','pwa-activation-browser-test.js','PWA_PHASE7_EVIDENCE');
 result.ownedPorts=result.probes.flatMap(p=>[p.port,p.attackerPort]).filter(Boolean);
 command('owned-bind-back',['-e',`const H=require('./debug/pwa-sw-harness');Promise.all(${JSON.stringify(result.ownedPorts)}.map(p=>H.bindBack(p))).then(()=>console.log('Owned ports bindable'))`]);
 assert.equal(inventory(),result.retainedBefore.inventory);assert.equal(require('./pwa-release-build').sha256(sw()),result.retainedBefore.swSha);result.retainedDistUnchanged=true;
 result.retainedAfter=retainedReadback('retained-http-after');assert.deepEqual(result.retainedAfter,result.retainedBefore.http);
 result.status='PASS';
}catch(e){result.status='FAIL';result.error=e.stack;process.exitCode=1;}
finally{result.exitCode=process.exitCode||0;save();console.log(JSON.stringify({status:result.status,evidence,suites:result.suites,probes:result.probes,error:result.error},null,2));}
