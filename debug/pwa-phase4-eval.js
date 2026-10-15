'use strict';
// Bounded phase-4 acceptance runner. All logs/builds/profile remain outside repo.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync,execFileSync}=require('node:child_process');
const H=require('./pwa-sw-harness');
const root=path.resolve(__dirname,'..'), evidence=fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase4-final-'));
const result={status:'RUNNING',evidence,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),commands:[],suites:[],artifacts:[],limitations:['make verify / full suite not run.','Physical devices, native GPU, OS reboot, storage eviction and live CDN/deploy not tested.','Browser wrong MIME/hash/quota rejection tested by Node exact worker guards, not real browser quota exhaustion.','Large retained story imports successfully; completed playback uses 12-tile subset of same retained source, not whole 1.9 MB story.','Phases 5-10 not implemented or accepted.']};
function command(label,args,env={},timeout=240000){
 const r=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout});
 const stdout=path.join(evidence,label+'.stdout.log'),stderr=path.join(evidence,label+'.stderr.log');fs.writeFileSync(stdout,r.stdout||'');fs.writeFileSync(stderr,r.stderr||'');
 const quote=x=>JSON.stringify(x);result.commands.push({label,executable:process.execPath,args,cwd:root,env,command:Object.entries(env).map(([k,v])=>k+'='+quote(v)).join(' ')+' '+[process.execPath,...args].map(quote).join(' '),exitCode:r.status,signal:r.signal,error:r.error?.message,stdout,stderr});
 if(args.includes('--test')){const text=r.stdout||'';result.suites.push({label,passed:Number(text.match(/# pass (\d+)/)?.[1]||0),failed:Number(text.match(/# fail (\d+)/)?.[1]||0),skipped:Number(text.match(/# skipped (\d+)/)?.[1]||0)});}
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));assert.equal(r.status,0,(r.stdout||'')+(r.stderr||'')+(r.error||''));return r;
}
function artifacts(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){if(['profile','harness-profile','source','v1','v2','v3'].includes(e.name))result.artifacts.push({directory:p});else artifacts(p);}else if(p!==path.join(evidence,'result.json')) result.artifacts.push({path:p,bytes:fs.statSync(p).size});}}
(async()=>{try{
 command('build',['node_modules/gulp/bin/gulp.js','build'],{NODE_ENV:'production'});
 for(const [label,file] of [['worker','pwa-worker-test.js'],['release','pwa-release-test.js'],['assets','pwa-assets-test.js'],['harness','pwa-sw-harness-test.js'],['shader','shader-bundle-test.js'],['demo','story-demo-catalog-test.js']])command(label,['--test','--test-reporter=tap','debug/'+file],{NODE_ENV:'production'});
 command('control',['debug/fluid-control-api-test.js']);command('palette',['--test','--test-reporter=tap','debug/paint-color-adapter-test.js']);
 command('production-browser',['debug/pwa-worker-browser-test.js'],{PWA_PHASE4_EVIDENCE:path.join(evidence,'production-probe')});
 const probe=JSON.parse(fs.readFileSync(path.join(evidence,'production-probe/result.json')));assert.equal(probe.status,'PASS');assert.equal(probe.cases.length,10);assert.ok(probe.closures.every(x=>x.browserDisconnected));assert.equal(probe.portFree,true);assert.equal(probe.attackerPortFree,true);result.probe={cases:probe.cases.length,failed:0,path:path.join(evidence,'production-probe/result.json'),closures:probe.closures.length,port:probe.port,attackerPort:probe.attackerPort};
 command('phase1-browser',['debug/pwa-assets-browser-test.js'],{PWA_EVIDENCE_DIR:path.join(evidence,'assets-probe')});command('phase2-browser',['debug/pwa-release-browser-test.js'],{PWA_RELEASE_EVIDENCE_DIR:path.join(evidence,'release-probe')});
 command('phase3-selftest',['debug/pwa-sw-selftest.js','--evidence',path.join(evidence,'harness-selftest'),'--profile',path.join(evidence,'harness-profile')]);
 // Different Node process binds both exact owned review ports after runner cleanup.
 const regressions=['assets-probe','release-probe','harness-selftest'].map(name=>({name,value:JSON.parse(fs.readFileSync(path.join(evidence,name,'result.json')))}));for(const {name,value} of regressions){assert.equal(value.status,'PASS');assert.equal(value.exitCode,0);assert.ok(value.portFree || value.cleanup?.portFree);result.suites.push({label:name,passed:value.pages?.length || value.cases.length,failed:0,level:'browser',path:path.join(evidence,name,'result.json')});}
 const ports=[probe.port,probe.attackerPort,...regressions.map(x=>x.value.port)];result.verifiedPorts=ports;
 command('independent-bind-back',['-e',`const h=require('./debug/pwa-sw-harness');Promise.all(${JSON.stringify(ports)}.map(p=>h.bindBack(p))).then(()=>console.log('all owned review ports independently bindable'))`]);
 const sensitivity=fs.readFileSync(path.join(evidence,'release.stdout.log'),'utf8').match(/Change-sensitive build evidence: (.+)/)?.[1];if(sensitivity)result.artifacts.push({directory:sensitivity.trim(),purpose:'real isolated content-sensitive build'});
 command('diff-check',['-e',"const c=require('node:child_process').spawnSync('git',['diff','--check'],{encoding:'utf8'});process.stdout.write(c.stdout);process.stderr.write(c.stderr);process.exit(c.status)"]);
 result.status='PASS';
}catch(e){result.status='FAIL';result.error=e.stack;process.exitCode=1;}finally{result.exitCode=process.exitCode||0;result.finishedAt=new Date().toISOString();artifacts(evidence);fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,evidence,suites:result.suites,probe:result.probe,error:result.error},null,2));}})();
