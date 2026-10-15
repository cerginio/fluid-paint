'use strict';
// Serial acceptance runner: guards/builds share dist. All evidence stays in Temp.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=fs.mkdtempSync(path.join(os.tmpdir(),'fluid-pwa-phase7-final-'));
const result={status:'RUNNING',evidence,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),commands:[],suites:[],probes:[],limitations:['Owner review pending; no commit/deploy.','No phase8 retention/cap/rollback or offline demos.','Physical Android/iOS, real Safari A2HS, native GPU, OS reboot, browser quota/eviction fault injection, full large-story playback, live CDN headers/CORS/deploy and full make verify NOT TESTED.','Install system dialog acceptance NOT TESTED when Chromium supplies no genuine beforeinstallprompt; no synthetic event presented as native proof.','15-minute scheduler verified using injected clock guard, not 15-minute wall-clock mobile background acceptance.']};
const save=()=>fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));
function command(label,args,env={},timeout=300000){
 const r=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout});
 const stdout=path.join(evidence,label+'.stdout.log'),stderr=path.join(evidence,label+'.stderr.log');fs.writeFileSync(stdout,r.stdout||'');fs.writeFileSync(stderr,r.stderr||'');
 result.commands.push({label,executable:process.execPath,args,cwd:root,env,exitCode:r.status,signal:r.signal,error:r.error?.message,stdout,stderr});
 if(args.includes('--test'))result.suites.push({label,passed:Number(r.stdout?.match(/# pass (\d+)/)?.[1]||0),failed:Number(r.stdout?.match(/# fail (\d+)/)?.[1]||0)});
 save();assert.equal(r.status,0,label+'\n'+r.stdout+'\n'+r.stderr+'\n'+r.error);return r;
}
function probe(label,file,variable,extra=[]){
 const destination=path.join(evidence,label);
 command(label,['debug/'+file,...extra],variable?{[variable]:destination}:{});
 const value=JSON.parse(fs.readFileSync(path.join(destination,'result.json')));
 assert.equal(value.status,'PASS');assert.equal(value.exitCode,0);
 result.probes.push({label,path:path.join(destination,'result.json'),passed:value.pages?.length||value.cases.length,failed:0,port:value.port,attackerPort:value.attackerPort,portFree:value.portFree||value.cleanup?.portFree});
 assert.ok(result.probes.at(-1).portFree);save();
}
try {
 command('build',['node_modules/gulp/bin/gulp.js','build'],{NODE_ENV:'production'});
 for(const [label,file] of [['activation','pwa-activation-test.js'],['detection','pwa-detection-test.js'],['readiness','pwa-readiness-test.js'],['worker','pwa-worker-test.js'],['release','pwa-release-test.js'],['assets','pwa-assets-test.js'],['harness','pwa-sw-harness-test.js'],['shader','shader-bundle-test.js'],['demo','story-demo-catalog-test.js'],['palette','paint-color-adapter-test.js']])command(label,['--test','--test-reporter=tap','debug/'+file],{NODE_ENV:'production'});
 command('control',['debug/fluid-control-api-test.js']);
 probe('production-regression','pwa-worker-browser-test.js','PWA_PHASE4_EVIDENCE');
 probe('assets-regression','pwa-assets-browser-test.js','PWA_EVIDENCE_DIR');
 probe('release-regression','pwa-release-browser-test.js','PWA_RELEASE_EVIDENCE_DIR');
 probe('fixture-regression','pwa-sw-selftest.js',null,['--evidence',path.join(evidence,'fixture-regression'),'--profile',path.join(evidence,'fixture-profile')]);
 command('final-production-build',['node_modules/gulp/bin/gulp.js','build'],{NODE_ENV:'production'});
 probe('readiness-browser','pwa-readiness-browser-test.js','PWA_PHASE5_EVIDENCE');
 probe('detection-browser','pwa-detection-browser-test.js','PWA_PHASE6_EVIDENCE');
 probe('activation-browser','pwa-activation-browser-test.js','PWA_PHASE7_EVIDENCE');
 const ports=[...new Set(result.probes.flatMap(p=>[p.port,p.attackerPort]).filter(Boolean))];result.verifiedPorts=ports;
 command('independent-bind-back',['-e',`const h=require('./debug/pwa-sw-harness');Promise.all(${JSON.stringify(ports)}.map(p=>h.bindBack(p))).then(()=>console.log('all exact owned ports independently bindable'))`]);
 command('diff-check',['-e',"const r=require('node:child_process').spawnSync('git',['diff','--check'],{encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status)"]);
 result.status='PASS';
}catch(error){result.status='FAIL';result.error=error.stack;process.exitCode=1;}
finally{result.exitCode=process.exitCode||0;result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:result.status,evidence,suites:result.suites,probes:result.probes,error:result.error},null,2));}
