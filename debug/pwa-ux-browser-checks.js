'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
async function geometry(page){
 const value=await page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
  const panel=document.querySelector('#pwa-panel'),canvas=document.querySelector('#canvas-cell');
  const controls=['#panel-bar','#story-file-tab','#story-player-tab','#bake-tab'].map(s=>document.querySelector(s)).filter(e=>e&&e.getClientRects().length).map(rect);
  return {dock:rect(panel),canvas:rect(canvas),controls,overflow:panel.scrollWidth>panel.clientWidth,viewport:innerWidth};
 });
 assert.equal(value.overflow,false);assert.ok(value.dock.x>=0&&value.dock.right<=value.viewport);
 assert.ok(value.canvas.bottom<=value.dock.y+1,'dock must not cover canvas');
 for(const box of value.controls)assert.ok(box.bottom<=value.dock.y+1,'dock must not cover drawing/story controls');
 return value;
}
async function settle(page){await page.waitForTimeout(250);}
async function checkDock(page,evidence,result){
 const original=page.viewportSize();result.ux=[];
 for(const width of [1000,320]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>document.querySelector('#pwa-panel').open=false);await settle(page);
  const summary=page.locator('#pwa-panel > summary');await summary.focus();await page.keyboard.press('Enter');await settle(page);
  assert.equal(await page.locator('#pwa-panel').evaluate(e=>e.open),true);
  assert.equal(await page.locator('#pwa-details').evaluate(e=>e.open),false);
  for(const id of ['pwa-verify','pwa-check']){
   const button=page.locator('#'+id);assert.ok(await button.getAttribute('aria-label'));assert.equal(await button.getAttribute('title'),await button.getAttribute('aria-label'));
   assert.equal(await button.locator('svg[aria-hidden="true"][focusable="false"]').count(),1);
   const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44);
   assert.equal((await button.textContent()).trim(),'');
  }
  for(const id of ['pwa-later','pwa-apply','pwa-install'])assert.equal(await page.locator('#'+id+' > svg').count(),1);
  assert.equal(await page.locator('#pwa-details > summary > svg').count(),2);
  assert.equal(await page.locator('#pwa-panel svg script, #pwa-panel svg image, #pwa-panel svg use').count(),0);
  await page.locator('#pwa-check').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!['checking','downloading'].includes(document.querySelector('#pwa-panel').dataset.update));
  const focus=await page.locator('#pwa-check').evaluate(e=>({active:document.activeElement===e,outline:getComputedStyle(e).outlineStyle}));assert.equal(focus.active,true);assert.notEqual(focus.outline,'none');
  // Open actual Story tools: their tabs must remain outside the reserved dock.
  if(await page.locator('#panel-extension-toggle').isVisible()){
   const extension=page.locator('#panel-extension');if(!await extension.isVisible())await page.locator('#panel-extension-toggle').click();
  }
  const open=await geometry(page);await page.screenshot({path:path.join(evidence,`ux-${width}-actions.png`)});
  const details=page.locator('#pwa-details > summary');await details.focus();await page.keyboard.press('Enter');await settle(page);
  assert.equal(await page.locator('#pwa-details').evaluate(e=>e.open),true);
  assert.match(await page.locator('#pwa-shell').textContent(),/[a-f0-9]{64}/);
  assert.equal(await page.locator('#pwa-install-info').isVisible(),true);
  const expanded=await geometry(page);await page.screenshot({path:path.join(evidence,`ux-${width}-details.png`)});
  await page.locator('#pwa-install-info').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`ux-${width}-install.png`)});
  await page.keyboard.press('Escape');await settle(page);assert.equal(await page.locator('#pwa-panel').evaluate(e=>e.open),false);
  assert.equal(await summary.evaluate(e=>document.activeElement===e),true);
  const collapsed=await geometry(page);assert.ok(collapsed.dock.height<=50);
  await page.screenshot({path:path.join(evidence,`ux-${width}-collapsed.png`)});
  result.ux.push({width,open,expanded,collapsed,keyboard:true,focus,technicalDisclosure:true});
  await page.evaluate(()=>document.querySelector('#pwa-details').open=false);
 }
 if(await page.locator('#panel-extension').isVisible())await page.locator('#panel-extension-close').click();
 await page.setViewportSize(original);await page.evaluate(()=>document.querySelector('#pwa-panel').open=true);await settle(page);
}
async function checkConsent(page,evidence,name){
 const original=page.viewportSize();await page.setViewportSize({width:320,height:900});await settle(page);
 assert.equal(await page.locator('#pwa-consent').isVisible(),true);
 assert.equal(await page.locator('#pwa-activation-status').getAttribute('role'),'status');
 assert.ok((await page.locator('#pwa-activation-status').textContent()).length>0);
 await geometry(page);
 if(name==='consent'){
  assert.match(await page.locator('#pwa-activation-status').textContent(),/artwork, wet paint and Undo/);
  assert.match(await page.locator('#pwa-activation-status').textContent(),/flattened, not a backup/);
  assert.equal(await page.locator('#pwa-saved').isVisible(),false);
 }
 if(name==='file-confirmation')assert.equal(await page.locator('#pwa-saved').isVisible(),true);
 await page.locator('#pwa-consent').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,`ux-320-${name}.png`)});
 await page.setViewportSize(original);await settle(page);
}
module.exports={checkDock,checkConsent,geometry};
