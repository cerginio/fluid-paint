'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('./pwa-autosave-test');
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
test('Paint nonempty detection uses pigment and background, not unknown dirty',()=>{
 const fs=require('node:fs'),vm=require('node:vm');const Paint=vm.runInNewContext(fs.readFileSync(require.resolve('../paint.js'),'utf8')+';Paint',{});
 const engine={renderer:{hasBackground:false},readPaintTexture:()=>({pixels:new Float32Array(16)})};const p={engine};
 assert.equal(Paint.prototype.hasArtwork.call(p),false);engine.readPaintTexture=()=>({pixels:new Float32Array([0,0,.1,0])});assert.equal(Paint.prototype.hasArtwork.call(p),true);
 engine.renderer.hasBackground=true;engine.readPaintTexture=()=>{throw Error('should not read')};assert.equal(Paint.prototype.hasArtwork.call(p),true);
 engine.renderer.hasBackground=false;engine.readPaintTexture=()=>({pixels:[NaN]});assert.throws(()=>Paint.prototype.hasArtwork.call(p));
});
