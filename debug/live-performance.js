'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('live hardware performance');
const root = path.resolve(__dirname,'..');
const mime={'.js':'application/javascript','.css':'text/css','.html':'text/html','.vert':'text/plain','.frag':'text/plain'};
const server=http.createServer((req,res)=>{
 const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({args:['--use-angle=d3d11','--renderer-process-limit=1']});
 try {
  for(const latency of ['normal','low']) {
  const page=await browser.newPage({viewport:{width:1246,height:1006},deviceScaleFactor:2});
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260907&debug=none&diag=0&latency=${latency}`);
  await page.waitForFunction(()=>window.__painter?.engine,{timeout:30000});
  const hardware=await page.evaluate(()=>{
   const p=window.__painter,gl=p.wgl.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
   return {attributes:gl.getContextAttributes(),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
     canvas:[p.canvas.width,p.canvas.height],simulation:[p.engine.simulator.resolutionWidth,p.engine.simulator.resolutionHeight]};
  });
  console.log(JSON.stringify({latency,...hardware}));

   const result=await page.evaluate(async()=>{
    const p=window.__painter,e=p.engine;
    const realUpdate=p.update.bind(p),realAdvance=e.advance.bind(e);
    const frames=[],cpu=[],steps=[];let previous=performance.now(),n=0;
    e.clear();e.resetClock(previous/1000);
    e.beginStroke({timing:'live',x:1000,y:1000,brushSize:50,
      paintingRectangle:p.paintingRectangle,color:{space:'pigment',channels:[1,0,0],alpha:.05},resolutionScale:p.getEffectiveResolutionScale()});
    
    await new Promise(resolve=>{
     p.update=()=>{
      const now=performance.now();frames.push(now-previous);previous=now;
      e.strokeTo({x:1000+400*Math.sin(n*.15),y:1000+250*Math.cos(n*.13)});
      realUpdate();cpu.push(performance.now()-now);steps.push(e.timingStats.steps);
      if(++n===48){p.update=realUpdate;resolve();}
     };
    });
    e.endStroke();e.advance=realAdvance;
    const quantile=(xs,q)=>[...xs].sort((a,b)=>a-b)[Math.floor((xs.length-1)*q)];
    return {frameMedian:quantile(frames.slice(8),.5),frameP95:quantile(frames.slice(8),.95),
      cpuP95:quantile(cpu.slice(8),.95),meanSteps:steps.reduce((a,b)=>a+b)/steps.length};
   });
   console.log(JSON.stringify({latency,...result}));
  await page.screenshot({path:require("node:os").tmpdir()+`/fluid-latency-${latency}.png`});
  await page.close();
  }
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
