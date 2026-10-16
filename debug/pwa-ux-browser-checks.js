'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
async function geometry(page){
 const value=await page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
  const panel=document.querySelector('#pwa-panel'),popup=panel.querySelector('.pwa-content');
  return {icon:rect(panel.querySelector('summary')),popup:panel.open?rect(popup):null,app:rect(document.querySelector('#app')),viewport:{width:innerWidth,height:innerHeight}};
 });
 assert.equal(value.app.height,value.viewport.height,'popover never reserves canvas height');
 assert.equal(value.icon.width,44);assert.equal(value.icon.height,44);assert.equal(value.icon.x,8);assert.equal(value.icon.bottom,value.viewport.height-8);
 if(value.popup){assert.equal(value.popup.width,Math.min(320,value.viewport.width-16));assert.ok(value.popup.y>=0&&value.popup.right<=value.viewport.width);assert.ok(value.popup.bottom<value.icon.y);}
 return value;
}
async function checkDock(page,evidence,result){
 const original=page.viewportSize();result.ux=[];
 for(const width of [1000,320]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>document.querySelector('#pwa-panel').open=false);
  const summary=page.locator('#pwa-panel > summary');await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#pwa-panel').evaluate(e=>e.open),true);
  for(const id of ['pwa-verify','pwa-check']){
   const button=page.locator('#'+id);assert.ok(await button.getAttribute('aria-label'));assert.equal(await button.getAttribute('title'),await button.getAttribute('aria-label'));
   assert.equal(await button.locator('svg[aria-hidden="true"][focusable="false"]').count(),1);const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44);
  }
  assert.equal(await page.getByRole('link',{name:'Credits',exact:true}).count(),0);
  assert.equal(await page.locator('#pwa-save').isVisible(),false);
  await page.locator('#pwa-check').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!['checking','downloading'].includes(document.querySelector('#pwa-panel').dataset.update));
  const focus=await page.locator('#pwa-check').evaluate(e=>({active:document.activeElement===e,outline:getComputedStyle(e).outlineStyle}));assert.equal(focus.active,true);assert.notEqual(focus.outline,'none');
  const open=await geometry(page);await page.screenshot({path:path.join(evidence,'ux-'+width+'-popover.png')});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#pwa-panel').evaluate(e=>e.open),false);assert.equal(await summary.evaluate(e=>document.activeElement===e),true);
  const collapsed=await geometry(page);assert.deepEqual(open.app,collapsed.app);await page.screenshot({path:path.join(evidence,'ux-'+width+'-collapsed.png')});
  await page.keyboard.press('Enter');await page.mouse.click(width-60,100);assert.equal(await page.locator('#pwa-panel').evaluate(e=>e.open),false);
  result.ux.push({width,open,collapsed,keyboard:true,focus,outsideDismiss:true});
 }
 await page.setViewportSize(original);await page.evaluate(()=>document.querySelector('#pwa-panel').open=true);
}
module.exports={checkDock,geometry};
