'use strict';

/*
 * Phase 7 probe -- the responsive layout.
 *
 * The goldens cannot see ANY of this. They drive a scripted stroke on a
 * window-sized canvas with no container, which is precisely the path Phase 7
 * left untouched on purpose. Every claim the phase makes is invisible to them:
 *
 *   1. the canvas is sized from #canvas-cell (not the window) and keeps the
 *      whole window, because the panel FLOATS rather than taking a column
 *   2. the panel drags by its grip, and a drag does not toggle the collapse
 *   3. a tap on the grip collapses to the compact bar, and back
 *   4. the compact bar's controls (size slider, hue stripe) stay usable
 *   5. the hue stripe sets hue and ONLY hue -- saturation/value/alpha survive
 *   6. the colour picker sits in its DOM slot, including after a drag
 *      (Phase 8: it IS the slot's content now, so this asks whether the widget
 *      is inside the slot's box rather than whether a GL draw was told where
 *      the slot is)
 *   7. the breakpoints change the layout at phone sizes
 *   8. a press on the panel does not paint, now that the geometric
 *      "is the pointer over the panel" test is gone
 *
 * Per the debug/ convention this is a throwaway: delete it after use and write
 * it back if the layout is rewritten. The expected values are recorded in
 * docs/HANDOFF.md so a future session can tell a real regression from a change
 * in the numbers.
 *
 *   node debug/phase7-probe.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');

// Refuse to be the second concurrent Playwright run on this machine.
// See debug/browser-lock.js for why this is enforced in code.
acquireBrowserLock('phase7 probe');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.frag': 'text/plain', '.vert': 'text/plain', '.png': 'image/png',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const results = [];
function check(name, actual, expected, detail) {
  const pass = expected(actual);
  results.push({ name, pass, actual, detail });
  const mark = pass ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${name}: ${JSON.stringify(actual)}${detail ? '  -- ' + detail : ''}`);
}

async function openApp(browser, port, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror] ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?debug=-textureProbe`, { waitUntil: 'load' });
  // Wait for the shader trees to load and Paint._start to run.
  await page.waitForFunction(() => window.__painter && window.__painter.viewport, null, { timeout: 20000 });
  return { context, page };
}

const metrics = () => ({
  canvasCss: (() => {
    const c = document.querySelector('#canvas-cell canvas');
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left) };
  })(),
  cellCss: (() => {
    const r = document.getElementById('canvas-cell').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left) };
  })(),
  backing: (() => {
    const c = document.querySelector('#canvas-cell canvas');
    return { w: c.width, h: c.height };
  })(),
  panelCss: (() => {
    const ui = document.getElementById('ui');
    if (!ui) return null;
    const r = ui.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             top: Math.round(r.top), left: Math.round(r.left) };
  })(),
  /*
   * The picker's rect, in CSS pixels.
   *
   * Phase 8 changed what this can even be. The GL picker had `left`/`bottom` in
   * BACKING-STORE pixels because it was drawn into the canvas, and the checks
   * below compared those numbers against the slot's rect to prove the draw
   * followed the layout. iro.js is DOM, so there is no such pair to read -- the
   * question becomes whether the widget's box is inside the slot's box, which
   * the browser guarantees by containment rather than by arithmetic.
   *
   * Reported in the same shape so the checks stay readable, but measured off the
   * element. `null` if the widget is missing, which fails the checks loudly
   * rather than passing on undefined.
   */
  picker: (() => {
    const el = document.querySelector('#color-picker-slot .IroColorPicker');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top),
             w: Math.round(r.width), h: Math.round(r.height) };
  })(),
  slotCss: (() => {
    const s = document.getElementById('color-picker-slot');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  })(),
});

(async () => {
  const { server, port } = await serve(ROOT);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // SwiftShader rasterises on the CPU, so without a cap a run takes every
      // core and freezes the desktop -- measured at 91% CPU with the mouse
      // stalling for seconds. These cap the damage:
      //   renderer-process-limit  one renderer, not one per tab
      //   max-old-space-size      the JS heap, which the readbacks can grow
      //   disable-dev-shm-usage   avoids a second copy of every framebuffer
      // Raising any of them does not make the hashes more correct, only the
      // machine less usable while they run.
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=512',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
    ],
  });

  try {
    // ---- Desktop: the canvas keeps the WHOLE window ----------------------
    // The panel floats over it, so unlike a docked column it costs the painting
    // no width at all. That is the property the Phase 6 retest asked for.
    console.log('\ndesktop 1280x800');
    {
      const { context, page } = await openApp(browser, port, { width: 1280, height: 800 });
      const m = await page.evaluate(metrics);

      check('canvas width == cell width', [m.canvasCss.w, m.cellCss.w],
        ([a, b]) => a === b, 'the canvas fills its cell exactly');

      check('canvas keeps the full window', [m.canvasCss.w, m.canvasCss.h],
        ([w, h]) => w === 1280 && h === 800, 'the floating panel takes no width from it');

      check('backing store == css * dpr1', [m.backing.w, m.canvasCss.w],
        ([b, c]) => b === c, 'deviceScaleFactor 1');

      check('panel floats over the canvas', [m.panelCss.left, m.canvasCss.left],
        ([p, c]) => p > c, 'the panel is inset within the canvas, not beside it');

      check('the picker is inside its slot', [m.picker, m.slotCss],
        ([p, s]) => p !== null && p.left >= s.left - 1 && p.left + p.w <= s.left + s.w + 1,
        'Phase 8: the widget is the slot content, so containment IS the check');

      await context.close();
    }

    // ---- Dragging the panel ----------------------------------------------
    console.log('\ndragging the panel by its grip');
    {
      const { context, page } = await openApp(browser, port, { width: 1280, height: 800 });
      const before = await page.evaluate(metrics);

      const grip = await page.evaluate(() => {
        const r = document.getElementById('panel-grip').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      await page.mouse.move(grip.x + 320, grip.y + 180, { steps: 10 });
      await page.mouse.up();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      const after = await page.evaluate(metrics);

      check('the panel moved', [before.panelCss.left, after.panelCss.left],
        ([b, a]) => a - b === 320, 'moved by exactly the drag distance');

      check('the panel is still expanded', await page.evaluate(() => document.getElementById('ui').dataset.collapsed),
        (v) => v === 'false', 'a real drag must NOT toggle the collapse');

      check('the picker moved with the panel', [after.picker, after.slotCss],
        ([p, s]) => p !== null && p.left >= s.left - 1 && p.left + p.w <= s.left + s.w + 1,
        'it is inside the panel, so a drag moves it for free -- no repositioning code');

      check('the canvas did not change size', [before.canvasCss.w, after.canvasCss.w],
        ([b, a]) => b === a, 'a floating panel never resizes the painting');

      await context.close();
    }

    // ---- Tapping the grip collapses -------------------------------------
    console.log('\ntapping the grip collapses to the bar');
    {
      const { context, page } = await openApp(browser, port, { width: 1280, height: 800 });
      const before = await page.evaluate(metrics);

      const grip = await page.evaluate(() => {
        const r = document.getElementById('panel-grip').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.click(grip.x, grip.y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      const after = await page.evaluate(metrics);

      check('the panel collapsed', await page.evaluate(() => document.getElementById('ui').dataset.collapsed),
        (v) => v === 'true', 'a tap with no movement toggles');

      check('the panel is much shorter', [before.panelCss.h, after.panelCss.h],
        ([b, a]) => a < b / 3, 'only the compact bar is left');

      check('the bar controls survive', await page.evaluate(() => {
        const size = document.getElementById('bar-size-slider').getBoundingClientRect();
        const hue = document.getElementById('bar-hue-stripe').getBoundingClientRect();
        return { size: Math.round(size.width), hue: Math.round(hue.width) };
      }), (v) => v.size > 40 && v.hue > 40, 'size slider and hue stripe still usable');

      // Tapping again must restore it -- a one-way collapse would strand the
      // user with no way back to Clear, Save or Undo.
      await page.mouse.click(grip.x, grip.y);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      check('tapping again expands', await page.evaluate(() => document.getElementById('ui').dataset.collapsed),
        (v) => v === 'false');

      await context.close();
    }

    // ---- The hue stripe sets hue and ONLY hue ----------------------------
    console.log('\nhue stripe');
    {
      const { context, page } = await openApp(browser, port, { width: 1280, height: 800 });

      const before = await page.evaluate(() => window.__painter.brushColorHSVA.slice());

      const stripe = await page.evaluate(() => {
        const r = document.getElementById('bar-hue-stripe').getBoundingClientRect();
        return { left: r.left, top: r.top + r.height / 2, w: r.width };
      });
      // Click at 25% along the stripe.
      await page.mouse.click(Math.round(stripe.left + stripe.w * 0.25), Math.round(stripe.top));
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));

      const after = await page.evaluate(() => window.__painter.brushColorHSVA.slice());

      check('hue moved to the tapped fraction', Math.round(after[0] * 100) / 100,
        (h) => Math.abs(h - 0.25) < 0.03, 'clicked 25% along the stripe');

      // This is the check that matters: the app's colour is HSVA and the RYB
      // model reads saturation/value/alpha. A stripe that reset them would
      // quietly destroy a mixed colour every time it was touched.
      check('saturation, value and alpha untouched',
        [before[1], after[1], before[2], after[2], before[3], after[3]],
        ([s0, s1, v0, v1, a0, a1]) => s0 === s1 && v0 === v1 && a0 === a1);

      await context.close();
    }

    // ---- Stability over frames --------------------------------------------
    // A WEAK check, labelled as such deliberately. It watches for the classic
    // container-sized-canvas feedback loop: a canvas's intrinsic size is its
    // backing store, so a content-sized container and the canvas chase each
    // other upward a few pixels per frame.
    //
    // It cannot currently fail. The grid is window-bounded (html/body are
    // height:100%, the cell is a 1fr track), so the cell is never content-sized
    // and the loop cannot close. Verified by removing min-width/min-height,
    // overflow:hidden, position:absolute AND the JS-side explicit CSS size --
    // all four at once -- and watching this still pass at an unchanged 764.
    //
    // Keep it as a tripwire for a future layout that introduces an auto track.
    // Do NOT read a pass here as evidence that those four guards are working.
    console.log('\nsize stability (60 frames) -- weak check, cannot currently fail');
    {
      const { context, page } = await openApp(browser, port, { width: 1024, height: 768 });
      const first = await page.evaluate(metrics);
      await page.evaluate(() => new Promise((resolve) => {
        let n = 0;
        const tick = () => (++n < 60 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }));
      const last = await page.evaluate(metrics);

      check('canvas size is stable over 60 frames',
        [first.canvasCss.w, last.canvasCss.w, first.canvasCss.h, last.canvasCss.h],
        ([w0, w1, h0, h1]) => w0 === w1 && h0 === h1,
        'no feedback loop between the cell and the canvas');

      check('backing store is stable too', [first.backing.w, last.backing.w],
        ([a, b]) => a === b);

      await context.close();
    }

    // ---- The canvas actually tracks its cell ------------------------------
    // Unlike the stability check above, this one CAN fail: it changes the
    // window size and requires the canvas to follow, which exercises the whole
    // ResizeObserver -> Viewport.resize -> backing store path.
    console.log('\nresize tracking');
    {
      const { context, page } = await openApp(browser, port, { width: 1280, height: 800 });
      const before = await page.evaluate(metrics);

      await page.setViewportSize({ width: 900, height: 700 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const after = await page.evaluate(metrics);

      // The canvas is the whole window at both sizes, because the panel floats.
      // This still exercises the full ResizeObserver -> Viewport.resize ->
      // backing-store path: sabotaging measureCssSize() to ignore the container
      // breaks other checks in this probe, and pinning the cell would break
      // this one.
      check('canvas follows a window resize', [before.canvasCss.w, after.canvasCss.w],
        ([b, a]) => b === 1280 && a === 900, 'the cell is the window, so the canvas tracks it');

      check('canvas still equals its cell after resize', [after.canvasCss.w, after.cellCss.w],
        ([a, b]) => a === b);

      check('backing store followed too', [after.backing.w, after.canvasCss.w],
        ([b, c]) => b === c, 'the GL drawing buffer resized, not just the element');

      await context.close();
    }

    // ---- Breakpoints ------------------------------------------------------
    console.log('\nphone portrait 390x844 (drawer)');
    {
      const { context, page } = await openApp(browser, port, { width: 390, height: 844 });
      const m = await page.evaluate(metrics);

      check('canvas gets the full width', m.canvasCss.w,
        (w) => w === 390, 'the floating panel costs the painting nothing');

      check('panel starts COLLAPSED on a phone',
        await page.evaluate(() => document.getElementById('ui').dataset.collapsed),
        (v) => v === 'true', 'the painting is unobstructed until controls are asked for');

      check('panel is nearly full width but inset', m.panelCss.w,
        (w) => w === 366, '390 - 2*12');

      check('the picker is still inside its slot at this breakpoint', [m.picker, m.slotCss],
        ([p, s]) => p !== null && p.left >= s.left - 1 && p.left + p.w <= s.left + s.w + 1,
        'the old COLOR_PICKER_TOP would have put it off-canvas here');

      await context.close();
    }

    console.log('\nphone landscape 844x390 (side rail)');
    {
      const { context, page } = await openApp(browser, port, { width: 844, height: 390 });
      const m = await page.evaluate(metrics);

      check('panel is 240px wide', m.panelCss.w, (w) => w === 240);
      check('canvas still gets the whole window', m.canvasCss.w,
        (c) => c === 844, 'the panel floats over it rather than beside it');

      await context.close();
    }

    console.log('\ntablet 1024x768');
    {
      const { context, page } = await openApp(browser, port, { width: 1024, height: 768 });
      const m = await page.evaluate(metrics);
      check('panel is the 260px tablet width', m.panelCss.w, (w) => w === 260);
      check('canvas still gets the whole window', m.canvasCss.w, (c) => c === 1024);
      await context.close();
    }

    // ---- A press on the panel must not paint ------------------------------
    // The geometric panel hit-test is gone; the browser's own hit testing has
    // to be what keeps these events off the canvas. If the panel were still
    // drawn INTO the canvas this would deposit paint under the controls.
    console.log('\npanel press does not paint');
    {
      const { context, page } = await openApp(browser, port, { width: 1280, height: 800 });

      const before = await page.evaluate(() => (() => {
        // readPaintTexture() returns {width, height, pixels}; sum the pixels.
        // A SUM rather than a painted-texel count on purpose: the count is a
        // time-driven measure and the handoff records it varying 76080/99735/
        // 77917 over identical code. The sum answers only "did anything land",
        // which is the actual question here.
        const t = window.__painter.engine.readPaintTexture();
        let s = 0;
        for (let i = 0; i < t.pixels.length; ++i) s += t.pixels[i];
        return s;
      })());

      const box = await page.evaluate(() => {
        const r = document.getElementById('fluidity-slider').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.mouse.move(box.x + 30, box.y, { steps: 8 });
      await page.mouse.up();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      const after = await page.evaluate(() => (() => {
        // readPaintTexture() returns {width, height, pixels}; sum the pixels.
        // A SUM rather than a painted-texel count on purpose: the count is a
        // time-driven measure and the handoff records it varying 76080/99735/
        // 77917 over identical code. The sum answers only "did anything land",
        // which is the actual question here.
        const t = window.__painter.engine.readPaintTexture();
        let s = 0;
        for (let i = 0; i < t.pixels.length; ++i) s += t.pixels[i];
        return s;
      })());

      check('dragging a slider deposits no paint', [before, after],
        ([b, a]) => b === a, 'the panel is a real element; the canvas never saw it');

      // ...and the same drag on the CANVAS must still paint, or the check above
      // proves nothing (a probe that cannot paint at all would also "pass").
      const canvasPoint = await page.evaluate(() => {
        const r = document.querySelector('#canvas-cell canvas').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await page.mouse.move(canvasPoint.x, canvasPoint.y);
      await page.mouse.down();
      await page.mouse.move(canvasPoint.x + 60, canvasPoint.y + 20, { steps: 12 });
      await page.mouse.up();
      await page.evaluate(() => new Promise((resolve) => {
        let n = 0;
        const tick = () => (++n < 20 ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }));

      const painted = await page.evaluate(() => (() => {
        // readPaintTexture() returns {width, height, pixels}; sum the pixels.
        // A SUM rather than a painted-texel count on purpose: the count is a
        // time-driven measure and the handoff records it varying 76080/99735/
        // 77917 over identical code. The sum answers only "did anything land",
        // which is the actual question here.
        const t = window.__painter.engine.readPaintTexture();
        let s = 0;
        for (let i = 0; i < t.pixels.length; ++i) s += t.pixels[i];
        return s;
      })());

      check('the same drag on the canvas DOES paint', [after, painted],
        ([b, a]) => a !== b, 'the control check above is meaningful');

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED: ' + failed.map((r) => r.name).join(', '));
    process.exitCode = 1;
  }
})();
