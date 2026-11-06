'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('live timing GPU check');
const root = path.resolve(__dirname,'..',process.argv.includes('--built')?'dist':'.');
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.vert':'text/plain','.frag':'text/plain'};
const server=http.createServer((req,res)=>{
 const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--renderer-process-limit=1']});
 try {
  for(const webgl of [2,1]) {
   for(const dpr of [1,2]) {
   if (process.env.FLUID_GPU_CASE && process.env.FLUID_GPU_CASE !== `${webgl}:${dpr}`) continue;
   const page=await browser.newPage({viewport:{width:900,height:650},deviceScaleFactor:dpr});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260907&debug=none&diag=0&webgl=${webgl}`);
   await page.waitForFunction(()=>window.__painter?.engine,{timeout:30000});
   // First exercise the real dispatcher and the application's RAF.
   await page.mouse.move(700,350); await page.mouse.down();
   await page.mouse.move(730,360); await page.waitForTimeout(120);
   await page.mouse.up();
   if (webgl === 2) {
    if (dpr === 2) {
      await page.setViewportSize({width:900,height:1000});
      await page.waitForTimeout(80);
    }
    // Real multi-contact Chromium input, not dispatchEvent(single pointer).
    const origin = await page.evaluate(() => {
      const p = window.__painter; p.update = () => {};
      window.touchBaseline = Array.from(p.engine.readPaintTexture().pixels);
      window.touchHistory = [p.snapshotIndex,p.undoing,p.maxRedoIndex];
      p.sessionRecorder.start({bristleSeed:17,prepare:()=>({})});
      const r=p.paintingRectangle;
      const s=p.viewport.worldToScreen(r.left+r.width/2,r.bottom+r.height/2);
      return p.viewport.screenToCss(s.x,s.y);
    });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:.5}))
    });
    const strokeTouch = (type, points) => touch(type,points.map(([id,x,y])=>
      [id,origin.x+(x-700)/2,origin.y+(y-350)/2]));
    for (const steps of [0,3]) {
      await strokeTouch('touchStart',[[1,700,350]]);
      if (steps) {
        await strokeTouch('touchMove',[[1,740,370]]);
        await page.waitForTimeout(30);
      }
      await page.evaluate(n => { for(let i=0;i<n;i++)window.__painter.engine.stepTick(); },steps);
      await strokeTouch('touchStart',[[1,700,350],[2,800,400]]);
      assert.deepEqual(await page.evaluate(() => {
        const p=window.__painter;
        const pixels=p.engine.readPaintTexture().pixels;
        return {same:window.touchBaseline.every((v,i)=>v===pixels[i]),
          history:[p.snapshotIndex,p.undoing,p.maxRedoIndex],active:p.engine.strokeActive,
          ticks:p.sessionRecorder.ticks,strokes:p.sessionRecorder.strokes};
      }), {same:true,history:await page.evaluate(()=>window.touchHistory),active:false,ticks:0,strokes:0});
      if (steps) await strokeTouch('touchStart',[[1,700,350],[2,800,400],[3,750,450]]);
      await strokeTouch('touchEnd',[[1,700,350]]);
      await strokeTouch('touchMove',[[1,740,370]]);
      await page.waitForTimeout(30);
      assert.equal(await page.evaluate(()=>window.__painter.engine.strokeActive),false,'all-up latch');
      await touch('touchEnd',[]);
    }
    await strokeTouch('touchStart',[[1,700,350]]);
    await touch('touchEnd',[]);
    assert.equal(await page.evaluate(()=>window.__painter.sessionRecorder.strokes),1,'fresh touch commits');
    await page.evaluate(()=>window.__painter.sessionRecorder.stop());
    // Hold recognizer, pending movement, indicator, cancel and one-step commit.
    await page.evaluate(()=>{
      const p=window.__painter;
      p.viewport.zoomViewAt(p.viewport.width/2,p.viewport.height/2,.8,
        p.viewport.worldRectToScreen(p.paintingRectangle));
      p.rebuildProjectionMatrix();
    });
    const edge = await page.evaluate(()=>{
      const p=window.__painter,r=p.viewport.worldRectToScreen(p.paintingRectangle);
      const rect=p.canvas.getBoundingClientRect();
      const css=p.viewport.screenToCss(r.getRight(),r.bottom+r.height/2);
      return {x:rect.left+css.x,y:rect.top+css.y};
    });
    const rectBefore=await page.evaluate(()=>JSON.stringify(window.__painter.paintingRectangle));
    await touch('touchStart',[[1,edge.x,edge.y]]);
    await touch('touchMove',[[1,edge.x-20,edge.y]]);
    await touch('touchEnd',[]);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__painter.paintingRectangle)),rectBefore);
    await touch('touchStart',[[1,edge.x,edge.y]]);
    await page.waitForTimeout(560);
    assert.equal(await page.locator('#resize-hold-indicator').isVisible(),true);
    const shot=path.join(process.env.FLUID_QA_DIR || os.tmpdir(),`fluid-MU-2G-hold-dpr${dpr}.png`);
    await page.screenshot({path:shot}); console.log(JSON.stringify({screenshot:shot}));
    await touch('touchMove',[[1,edge.x-30,edge.y]]);
    await page.waitForTimeout(30);
    await touch('touchCancel',[]);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.__painter.paintingRectangle)),rectBefore);
    assert.equal(await page.locator('#resize-hold-indicator').isVisible(),false);
    await touch('touchStart',[[1,edge.x,edge.y]]);
    await touch('touchStart',[[1,edge.x,edge.y],[2,edge.x-30,edge.y+40]]);
    await page.waitForTimeout(560);
    assert.equal(await page.locator('#resize-hold-indicator').isVisible(),false,'second touch abandons pending hold');
    await touch('touchEnd',[]);
    const historyBefore=await page.evaluate(()=>window.__painter.snapshotIndex);
    await touch('touchStart',[[1,edge.x,edge.y]]);
    await page.waitForTimeout(560);
    await touch('touchEnd',[]);
    assert.equal(await page.evaluate(()=>window.__painter.snapshotIndex),historyBefore,'hold without drag has no undo step');
    await touch('touchStart',[[1,edge.x,edge.y]]);
    await page.waitForTimeout(560);
    await touch('touchMove',[[1,edge.x-30,edge.y]]);
    await touch('touchEnd',[]);
    assert.equal(await page.evaluate(()=>window.__painter.snapshotIndex),historyBefore+1,'one resize undo step');
    assert.notEqual(await page.evaluate(()=>JSON.stringify(window.__painter.paintingRectangle)),rectBefore,'hold-drag commits');
    // Restore by the real Undo route, then guard stale asynchronous takeover.
    await page.evaluate(()=>window.__painter.undo());
    // Trusted desktop mouse and Chromium pen pointer input take the same hold
    // route. This is not a claim about a physical stylus.
    for (const pointerType of ['mouse','pen']) {
      const input=(type,x=edge.x)=>cdp.send('Input.dispatchMouseEvent',{
        type,x,y:edge.y,button:type==='mouseMoved'?'none':'left',
        buttons:type==='mouseReleased'?0:1,pointerType});
      await input('mousePressed');
      await page.waitForTimeout(560);
      assert.equal(await page.locator('#resize-hold-indicator').isVisible(),true,`${pointerType} hold`);
      await input('mouseMoved',edge.x-20);
      await page.waitForTimeout(30);
      await page.keyboard.press('Escape');
      await input('mouseReleased',edge.x-20);
      assert.equal(await page.evaluate(()=>JSON.stringify(window.__painter.paintingRectangle)),rectBefore,`${pointerType} Escape restores rectangle`);
    }
    await page.evaluate(()=>{
      const p=window.__painter;
      window.realController=p.storyPlaybackController;
      p.storyPlaybackController={state:'playing',yieldToManualInput:()=>new Promise(r=>window.resolveTakeover=r)};
    });
    await strokeTouch('touchStart',[[1,700,350]]);
    await strokeTouch('touchStart',[[1,700,350],[2,800,400]]);
    await page.evaluate(async()=>{window.resolveTakeover();await Promise.resolve();});
    assert.equal(await page.evaluate(()=>window.__painter.engine.strokeActive),false,'stale await cannot revive cancelled input');
    await touch('touchEnd',[]);
    await page.evaluate(()=>window.__painter.storyPlaybackController=window.realController);
    await cdp.detach();
    console.log(JSON.stringify({check:'MU-2G touch rollback/latch/hold-cancel',dpr,passed:true}));
    if (dpr === 2) {
      await page.setViewportSize({width:900,height:650});
      await page.waitForTimeout(80);
    }
   }
   const output=await page.evaluate(()=>{
    const p=window.__painter; p.update=()=>{}; const e=p.engine;
    if(e.strokeActive)e.endStroke();
    // pointerup carries a new endpoint without an intervening move/RAF.
    const surface=p.pointerDispatcher.el;
    for (const [type,x] of [['pointerdown',700],['pointerup',760]]) {
      surface.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:91,
        pointerType:'mouse',button:0,buttons:type==='pointerdown'?1:0,
        clientX:x,clientY:350,pressure:.5}));
    }
    const endpoint={x:p.brushX,y:p.brushY};
    const rect=surface.getBoundingClientRect();
    const expected=p._toWorld((760-rect.left)*surface.width/rect.width,
      (350-rect.top)*surface.height/rect.height);
    if(Math.abs(endpoint.x-expected.x)>1)throw new Error('pointerup endpoint was lost '+JSON.stringify({endpoint,expected,
      mode:p.interactionState,enabled:p.manualPaintingEnabled,rectangle:p.paintingRectangle,rotation:p.viewport.presentationRotation}));
    e.changeResolution(256,192);
    const run=(fluidity)=>{
     e.clear(); e.simulator.clearTextures([e.simulator.velocityTexture,e.simulator.velocityTextureTemp]);
     e.simulator.splatAreas=[];
     e.brush.random=()=>.4;
     e.setSimulation({fluidity}); e.resetClock(0);
     e.beginStroke({timing:'live',x:300,y:250,brushSize:35,paintingRectangle:p.paintingRectangle,color:{space:'pigment',channels:[1,0,0],alpha:.2},resolutionScale:1});
     for(let i=1;i<=15;i++){e.strokeTo({x:300+12*i,y:250});e.advance(i/60);}
     e.endStroke();
     const before=e.readPaintTexture().pixels;
     for(let i=16;i<=30;i++)e.advance(i/60);
     const after=e.readPaintTexture().pixels;
     let change=0,alpha=0,finite=true;
     for(let i=0;i<after.length;i++){change+=Math.abs(after[i]-before[i]);finite=finite&&Number.isFinite(after[i]);if(i%4===3)alpha+=after[i];}
     return {change,alpha,finite,pixels:Array.from(after)};
    };
    const low=run(.6), high=run(.9);
    let difference=0;for(let i=0;i<low.pixels.length;i++)difference+=Math.abs(low.pixels[i]-high.pixels[i]);
    delete low.pixels;delete high.pixels;
    // Tap and release before any advance must still leave pigment.
    e.clear();e.beginStroke({timing:'live',x:600,y:250,brushSize:35,paintingRectangle:p.paintingRectangle,color:{space:'pigment',channels:[1,0,0],alpha:.2}});e.endStroke();
    const tap=e.readPaintTexture().pixels;let tapAlpha=0;for(let i=3;i<tap.length;i+=4)tapAlpha+=tap[i];
    return {low,high,difference,tapAlpha,glError:p.wgl.gl.getError()};
   });
   assert.deepEqual(errors,[]);assert.equal(output.glError,0);
   assert.ok(output.low.finite&&output.high.finite);assert.ok(output.tapAlpha>0);
   assert.ok(output.low.alpha>0&&output.high.alpha>0);
   assert.ok(output.high.change>0);assert.ok(output.difference>1);
   console.log(JSON.stringify({webgl,dpr,...output}));
   await page.close();
   }
  }
 } finally {
  await browser.close();
  const port=server.address().port;
  await new Promise(r=>server.close(r));
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,'127.0.0.1',()=>server.close(resolve));
  });
  console.log('live GPU cleanup: browser closed, own port bind-back PASS');
 }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
