'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('live timing GPU check');
const root = path.resolve(__dirname,'..');
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
   const page=await browser.newPage({viewport:{width:900,height:650},deviceScaleFactor:dpr});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260907&debug=none&diag=0&webgl=${webgl}`);
   await page.waitForFunction(()=>window.__painter?.engine,{timeout:30000});
   // First exercise the real dispatcher and the application's RAF.
   await page.mouse.move(700,350); await page.mouse.down();
   await page.mouse.move(730,360); await page.waitForTimeout(120);
   await page.mouse.up();
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
    const expected=p.viewport.cssToScreen(760-surface.getBoundingClientRect().left,
      350-surface.getBoundingClientRect().top);
    if(Math.abs(endpoint.x-expected.x)>1)throw new Error('pointerup endpoint was lost');
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
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
