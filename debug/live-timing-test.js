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
// Constant-speed input reaches the same tick positions at different display rates.
const paths=[];
for(const hz of [30,60,144]) {
 const {e,calls}=fixture();
 for(let i=1;i<=hz;i++){ e.strokeTo({x:120*i/hz,y:0}); e.advance(i/hz); }
 paths.push(calls.brush.map(p=>p[0]));
}
for(const path of paths) path.forEach((x,i)=>assert.ok(Math.abs(x-paths[0][i])<1e-8));
console.log('live timing: PASS (hold, 30/60/144 Hz, bounded burst, cursor, endpoint, tap, overload, repeated resume)');
