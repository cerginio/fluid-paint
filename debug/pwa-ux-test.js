'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../app/pwa-register'),'utf8'),css=fs.readFileSync(require.resolve('../app/layout.css'),'utf8');
const icon=require('../app/pwa-ui-icons'),path=require('node:path'),crypto=require('node:crypto');
test('actual SVG Repo shapes are pinned, inert, coherent and accessible without glyph substitutes',()=>{
 const dir=path.resolve(__dirname,'../assets/pwa-ui'),sources=JSON.parse(fs.readFileSync(path.join(dir,'sources.json')));
 assert.equal(sources.license,'CC-BY-4.0');assert.equal(sources.icons.length,9);
 for(const entry of sources.icons){
  const raw=fs.readFileSync(path.join(dir,entry.name+'.svg'));assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),entry.sha256);
  assert.match(entry.download,/^https:\/\/www\.svgrepo\.com\/show\/\d+\/[a-z0-9-]+\.svg$/);
  const svg=icon(entry.name);assert.match(svg,/viewBox="0 0 24 24"/);assert.match(svg,/aria-hidden="true" focusable="false"/);assert.match(svg,/currentColor/);
  assert.doesNotMatch(svg,/<(?:script|style|foreignObject|image|use|animate)|\son\w+=|href=|url\(/i);
 }
 assert.throws(()=>icon('untrusted'));
 const vm=require('node:vm'),context={document:{}};context.window=context;vm.runInNewContext(fs.readFileSync(require.resolve('../app/pwa-ui-icons'),'utf8'),context);assert.equal(context.FluidPwaIcon('clock'),icon('clock'));
 const gulp=fs.readFileSync(path.resolve(__dirname,'../gulpfile.js'),'utf8');assert.match(gulp,/\['app\/pwa-ui-icons\.js', 'app\/pwa-register\.js'\]/);
 assert.doesNotMatch(source,/require\('\.\/pwa-ui-icons'\)/);
 assert.doesNotMatch(source,/[☁✓⟳◷⊕⌃⌄]/);assert.doesNotMatch(css,/[⌃⌄]/);
 assert.match(fs.readFileSync(path.resolve(__dirname,'../pwa-credits.html'),'utf8'),/Dazzle UI/);
 assert.match(source,/href="\/pwa-credits.html"/);
});
test('English-only PWA copy without a new localization framework',()=>assert.doesNotMatch(source,/[\u0400-\u04ff]/));
test('only active timestamp and last check information, Save PNG and separate credits',()=>{
 const markup=source.slice(source.indexOf('panel.innerHTML ='),source.indexOf('doc.body.appendChild(panel)'));
 for(const id of ['pwa-versions','pwa-last-check','pwa-save'])assert.ok(markup.includes(`id="${id}"`));
 for(const text of ['pwa-shell','pwa-warning','pwa-details','pwa-install-info','Discard artwork','File checked','Dazzle','Browser data','Prepare online'])assert.ok(!markup.includes(text),text);
 assert.match(source,/fluid-build-time/);assert.match(source,/activeBuildTime/);
 assert.match(source,/hasArtwork:.*hasArtwork/);assert.match(source,/save:.*painter.save/);
});
test('dock reserves measured space and keyboard focus does not rely on color',()=>{
 assert.match(source,/ResizeObserver/);assert.match(source,/--pwa-dock-height/);
 assert.match(css,/height: calc\(100dvh - var\(--pwa-dock-height/);
 assert.match(css,/:focus-visible.*outline: 3px/);assert.match(css,/min-height: 44px; min-width: 44px/);
 assert.match(source,/event.key === 'Escape'/);
});
