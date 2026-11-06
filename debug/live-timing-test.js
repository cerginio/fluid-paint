const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('fluid-engine/index.js', 'utf8') + '\nglobalThis.Engine = FluidEngine;', context);
function fixture() {
  const e = Object.create(context.Engine.prototype);
  const calls = { brush: [], splat: [], fluid: 0, seeds: 0 };
  e.brush = {
    initialize(x,y,z,scale) { Object.assign(this,{positionX:x,positionY:y,positionZ:z,scale}); calls.seeds++; },
    update(x,y,z,scale) { Object.assign(this,{positionX:x,positionY:y,positionZ:z,scale}); calls.brush.push([x,y,z]); },
  };
  e.simulator = { simulate() { calls.fluid++; return true; }, splat(...args) { calls.splat.push(args); } };
  e.beginStroke({timing:'live', x:0,y:0,brushSize:50,paintingRectangle:{left:0,bottom:0,width:1000,height:1000},color:{space:'pigment',channels:[1,0,0],alpha:.8}});
  e.advance(0);
  return {e,calls};
}
for (const hz of [30,60,144]) {
  const {e,calls}=fixture();
  for(let i=1;i<=hz*2;i++) e.advance(i/hz);
  assert.equal(calls.fluid,120, `held contact at ${hz} Hz`);
  assert.equal(calls.brush.length,120);
  assert.equal(calls.splat.length,121); // initial contact + 120 timed contacts
  assert.equal(e.timingStats.totalDroppedSeconds,0);
}
{
 const {e,calls}=fixture();
 for(let i=0;i<10000;i++) e.strokeTo({x:i*100,y:0});
 assert.equal(calls.fluid,0); assert.equal(calls.brush.length,0); assert.equal(calls.splat.length,1);
 e.advance(1/60); assert.equal(calls.fluid,1); assert.equal(calls.brush.length,1);
 assert.equal(e.getBristleGeometry().displayOffset[0],0);
 e.strokeTo({x:999903,y:0});
 assert.equal(e.getBristleGeometry().displayOffset[0],3);
 e.endStroke(); assert.equal(calls.fluid,1); assert.equal(calls.splat.at(-1)[6][0],3);
 assert.equal(calls.seeds,1);
}
{
 const {e,calls}=fixture(); const r=e.advance(3);
 assert.equal(r.steps,5); assert.ok(Math.abs(r.droppedSeconds-(3-5/60))<1e-9);
 assert.ok(r.accumulator<1/60);
 const next=e.advance(3+1/60); assert.equal(next.steps,1); assert.equal(next.droppedSeconds,0);
 e.resetClock(13); assert.equal(e.advance(13).steps,0);
 e.resetClock(23); assert.equal(e.advance(23).steps,0);
 assert.equal(e.advance(23+1/60).steps,1);
 assert.equal(calls.fluid,7);
}
{
 const {e,calls}=fixture(); e.endStroke();
 assert.equal(calls.splat.length,1, 'sub-tick tap paints without ten settling steps');
 assert.equal(calls.fluid,0); e.advance(1/60); assert.equal(calls.fluid,1,'fluid runs after lift');
}
// INV-MAX-1: stepTick() is one step with the live target, whatever the wall time.
{
 const {e,calls}=fixture();
 e.strokeTo({x:30,y:0});
 const r=e.stepTick();
 assert.equal(r.steps,1); assert.equal(calls.fluid,1); assert.equal(calls.brush.length,1);
 assert.equal(calls.brush[0][0],30,'the tick lands on the current target, not an interpolation');
 e.resetClock(5); assert.equal(e.advance(5).steps,0,'stepTick leaves the host clock to resetClock()');
 for(let i=0;i<4;i++) e.stepTick();
 assert.equal(calls.fluid,5);
}
// Constant-speed input reaches the same tick positions at different display rates.
const paths=[];
for(const hz of [30,60,144]) {
 const {e,calls}=fixture();
 for(let i=1;i<=hz;i++){ e.strokeTo({x:120*i/hz,y:0}); e.advance(i/hz); }
 paths.push(calls.brush.map(p=>p[0]));
}
for(const path of paths) path.forEach((x,i)=>assert.ok(Math.abs(x-paths[0][i])<1e-8));
// Session observer (SPEC §2.3): ticks report what brush.update() received,
// including advance()'s interpolated steps; outside a stroke a tick is idle.
{
 const {e,calls}=fixture(); const log=[];
 e.setSessionObserver({
  onTick:(...a)=>log.push(['tick',...a]), onIdleTick:()=>log.push(['idle']),
  onContact:(x,y,p)=>log.push(['contact',x,y,p]), onEndStroke:()=>log.push(['end']),
 });
 e.strokeTo({x:30,y:0}); e.advance(3/60);
 const ticks=log.filter(r=>r[0]==='tick');
 assert.equal(ticks.length,3);
 ticks.forEach((r,i)=>assert.deepEqual(r.slice(1,4),calls.brush[i]));
 assert.ok(Math.abs(ticks[0][1]-10)<1e-9,'an interpolated step is recorded as interpolated');
 e.strokeTo({x:40,y:0}); e.endStroke();
 assert.deepEqual(log.slice(-2),[['contact',40,0,1],['end']]);
 e.advance(4/60); assert.deepEqual(log.at(-1),['idle']);
 e.setSessionObserver(null); e.advance(5/60); assert.equal(log.length,6);
}
// A throwing observer is detached; the stroke it watched goes on.
{
 // The engine runs in the vm context, so it logs to that context's console.
 const engineConsole=vm.runInContext('console',context);
 const {e,calls}=fixture(); const error=engineConsole.error; let errors=0; engineConsole.error=()=>errors++;
 e.setSessionObserver({onTick(){throw new Error('boom');}});
 e.strokeTo({x:30,y:0}); e.stepTick(); e.stepTick(); engineConsole.error=error;
 assert.equal(errors,1); assert.equal(e._sessionObserver,null); assert.equal(calls.fluid,2);
 assert.equal(e.strokeActive,true);
 assert.throws(()=>e.setSessionObserver(()=>{}),{name:'TypeError'});
}
// Replay: recorded variation, explicit final contact, ticks bit for bit.
{
 const {e,calls}=fixture(); e.endStroke();
 const rect={left:0,bottom:0,width:1000,height:1000}, color={space:'pigment',channels:[1,0,0],alpha:.8};
 let begun; e.setSessionObserver({onBeginStroke:(params,variation)=>{begun={params,variation};}});
 e.brush.initialize=function(x,y,z,scale,reset,variation){Object.assign(this,{positionX:x,positionY:y,positionZ:z,scale,strokeVariation:variation===undefined?.5:variation});};
 for(const bad of [-0.1,1,NaN]) assert.throws(()=>e.beginStroke({timing:'live',x:0,y:0,brushSize:50,paintingRectangle:rect,color,variation:bad}));
 assert.equal(e.strokeActive,false);
 e.beginStroke({timing:'live',x:5,y:6,brushSize:50,paintingRectangle:rect,color,variation:.25});
 assert.equal(e.brush.strokeVariation,.25); assert.equal(begun.variation,.25);
 assert.equal(JSON.stringify(begun.params.paintingRectangle),JSON.stringify(rect)); assert.equal(begun.params.timing,'live');
 assert.throws(()=>e.reseedBristleRandoms(1),/not allowed while a named stroke/);
 const x=0.1+0.2, y=1/3;
 e.replayTick(x,y,40,50); assert.deepEqual(calls.brush.at(-1),[x,y,40]);
 assert.throws(()=>e.replayTick(x,y,40,0));
 const splats=calls.splat.length;
 e.endStroke({contact:null}); assert.equal(calls.splat.length,splats,'null: no final contact');
 e.beginStroke({timing:'live',x:5,y:6,brushSize:50,paintingRectangle:rect,color,variation:.25});
 e.replayTick(7,8,40,50); e.endStroke({contact:{x:9,y:8,pressure:.5}});
 assert.equal(calls.splat.length,splats+3,'begin contact, tick contact, recorded final contact');
 assert.equal(calls.splat.at(-1)[6][0],2);
 assert.throws(()=>e.replayTick(1,2,3,4),/needs an active stroke/);
 const fluid=calls.fluid; e.replayTick(); assert.equal(calls.fluid,fluid+1,'idle replay tick: fluid only');
 assert.throws(()=>e.reseedBristleRandoms(-1),{name:'RangeError'});
 assert.throws(()=>e.reseedBristleRandoms(2**32),{name:'RangeError'});
}
// Dispatcher state checks use deterministic timers; GPU/input coverage lives
// in live-gpu-test.js. Coordinates deliberately have a 2x backing/CSS ratio.
{
 const timers=new Map();let next=0;
 const c=vm.createContext({performance:{now:()=>0},window:{addEventListener(){}},
  requestAnimationFrame:()=>{},setTimeout:fn=>{timers.set(++next,fn);return next;},
  clearTimeout:id=>timers.delete(id),setInterval:()=>++next,clearInterval(){}});
 vm.runInContext(fs.readFileSync('app/ui/pointer-dispatcher.js','utf8')+';globalThis.Dispatcher=PointerDispatcher',c);
 const d=new c.Dispatcher({width:200,height:200,addEventListener(){},setPointerCapture(){},
  getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})},{cancelOnMultitouch:true});
 const logs=[];for(const name of ['panstart','panend','pancancel','hold','holdcancel'])d.on(name,e=>logs.push([name,e.reason]));
 const ev=(id,x=20,type='pointerdown')=>({pointerId:id,pointerType:'touch',clientX:x,clientY:20,pressure:.5,button:0,type,preventDefault(){}});
 d._down(ev(1));d._processMoveSample(ev(1,26));
 assert.ok(d._hold,'6 CSS px stays within 8px even at backing ratio 2');
 timers.get(d._hold.timer)();assert.equal(d._hold.active,true);
 d._processMoveSample(ev(1,40));assert.equal(d._hold.active,true,'activated hold permits drag');
 d._down(ev(2));assert.equal(d.navigationOnly,true);assert.equal(d._pending.pan,null);
 assert.equal(logs.filter(e=>e[0]==='panend').length,0,'promotion cancels, never commits');
 d._down(ev(3));d._up(ev(3,20,'pointerup'));d._up(ev(2,20,'pointerup'));
 d._processMoveSample(ev(1,60));assert.equal(d._pending.pan,null,'3→2→1 remains navigation only');
 d._up(ev(1,60,'pointerup'));assert.equal(d.navigationOnly,false);
 d._down(ev(4));d._up(ev(4,20,'lostpointercapture'));
 assert.equal(d.pointers.size,0);assert.equal(d._hold,null);
 d._down(ev(5));d._processMoveSample(ev(5,29));assert.equal(d._hold,null,'9 CSS px abandons pending hold');
 d._up(ev(5,29,'pointerup'));
 assert.equal(logs.filter(e=>e[0]==='panstart').length,3);
}
console.log('live timing: PASS (clock, observer/replay, touch latch/cancel, CSS hold tolerance and hold-drag)');
