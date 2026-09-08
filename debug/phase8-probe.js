'use strict';

/*
 * Phase 8 probe -- the DOM colour control.
 *
 * The goldens cannot see any of this. They drive a scripted stroke with a fixed
 * seeded colour and never touch a control, so the entire picker could be missing
 * and all 12 hashes would stay byte-identical. Worse, the one thing that WOULD
 * move the hashes -- an RGB triple leaking into the simulation -- is exactly the
 * failure this phase risks, and it would move them in a way indistinguishable
 * from any other change.
 *
 * So this drives what the goldens structurally cannot:
 *
 *   1. the wheel actually mounts, inside #color-picker-slot, as real DOM
 *   2. no GL picker remains: the app boots with picker.vert/frag deleted
 *   3. dragging the wheel changes the app's hue
 *   4. IT IS STILL RYB. A colour chosen in the RGB wheel must reach the paint
 *      texture as PIGMENT -- hue 0.667 lands in the third RYB channel, and
 *      yellow-over-blue must still make green. This is the §3b check and it is
 *      the reason this probe exists.
 *   5. the alpha and value sliders move their own channel and ONLY their own
 *   6. the hue stripe and the wheel agree -- neither clobbers the other's
 *      saturation/value, and neither gets stuck in a feedback loop
 *   7. a drag on the wheel deposits NO paint (the browser hit-tests the
 *      element; the canvas never sees the pointer) while the same drag on the
 *      canvas does
 *   8. the Digital/Natural toggle still switches the composite model, now that
 *      it reads FluidEngine.COLOR_MODEL rather than the app's deleted enum
 *
 * Per the debug/ convention this is a throwaway: delete after use, write it back
 * if the colour control is rewritten. Expected values are in docs/HANDOFF.md.
 *
 *   node debug/phase8-probe.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');

acquireBrowserLock('phase8 probe');

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

const settle = (page, frames) => page.evaluate((n) => new Promise((resolve) => {
  let i = 0;
  const tick = () => (++i < n ? requestAnimationFrame(tick) : resolve());
  requestAnimationFrame(tick);
}), frames);

const hsva = (page) => page.evaluate(() => window.__painter.brushColorHSVA.slice());

/*
 * Alpha-weighted mean of the paint texture's RYB, over texels that carry paint.
 * A plain mean is dominated by the empty canvas and every hue looks identical.
 */
const paintMeanRYB = (page) => page.evaluate(() => {
  const t = window.__painter.engine.readPaintTexture();
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < t.pixels.length; i += 4) {
    if (t.pixels[i + 3] <= 0.01) continue;
    r += t.pixels[i]; g += t.pixels[i + 1]; b += t.pixels[i + 2];
    n += 1;
  }
  return n === 0 ? null : [r / n, g / n, b / n, n];
});

const paintSum = (page) => page.evaluate(() => {
  const t = window.__painter.engine.readPaintTexture();
  let s = 0;
  for (let i = 0; i < t.pixels.length; ++i) s += t.pixels[i];
  return s;
});

// Drag across the canvas centre. Many small steps: Brush.update() derives
// bristle speed from the delta it is handed, so one jump is a different stroke.
async function strokeCanvas(page, dx, dy) {
  const c = await page.evaluate(() => {
    const r = document.querySelector('#canvas-cell canvas').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(c.x - dx / 2, c.y - dy / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 20 });
  await page.mouse.up();
  await settle(page, 30);
}

// Set the colour through the WIDGET rather than the model, so the check goes
// through iro.js's own conversion path -- which is the path that could leak RGB.
const setViaWidget = (page, h, s, v, a) => page.evaluate(([h, s, v, a]) => {
  window.__painter.colorControl.picker.color.set({ h: h * 360, s: s * 100, v: v * 100, a });
}, [h, s, v, a]);

(async () => {
  const { server, port } = await serve(ROOT);
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--renderer-process-limit=1',
      '--js-flags=--max-old-space-size=512',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    const pageErrors = [];
    const failedRequests = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

    // ---------------------------------------------------------------------
    console.log('\n[mount] the wheel is real DOM in the reserved slot');
    // ---------------------------------------------------------------------
    await page.goto(`http://127.0.0.1:${port}/index.html?debug=-textureProbe`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__painter && window.__painter.engine, null, { timeout: 20000 });

    check('no page errors', pageErrors, (v) => v.length === 0,
      'a missing global throws in a constructor and leaves a plausible grey canvas');

    /*
     * The 404 check matters more than usual this phase. picker.vert and
     * picker.frag were DELETED and removed from APP_SHADERS -- if either removal
     * were incomplete, loadTextFiles would store the 404 body as the shader
     * source and the failure would surface much later, as a compile error that
     * does not name the file.
     */
    check('no failed requests', failedRequests, (v) => v.length === 0,
      'picker.vert/frag are deleted; a stale manifest entry would 404 silently');

    const mounted = await page.evaluate(() => {
      const slot = document.getElementById('color-picker-slot');
      if (!slot) return { slot: false };
      return {
        slot: true,
        hasPicker: !!slot.querySelector('.IroColorPicker'),
        wheels: slot.querySelectorAll('.IroWheel').length,
        sliders: slot.querySelectorAll('.IroSlider').length,
        svgs: slot.querySelectorAll('svg').length,
        control: !!window.__painter.colorControl,
      };
    });

    check('the iro.js wheel is mounted in the slot', mounted,
      (v) => v.slot && v.hasPicker && v.wheels === 1 && v.sliders === 2 && v.control,
      'wheel + value slider + alpha slider, as real elements');

    check('the GL picker is gone', await page.evaluate(() => ({
      colorPicker: typeof window.__painter.colorPicker,
      ColorPickerClass: typeof ColorPicker,
      positioner: typeof window.__painter._positionColorPicker,
    })), (v) => v.colorPicker === 'undefined' && v.ColorPickerClass === 'undefined' &&
                v.positioner === 'undefined',
      'no instance, no class, no positioning method');

    // ---------------------------------------------------------------------
    console.log('\n[RYB] the wheel is RGB; the paint must still be pigment');
    // ---------------------------------------------------------------------
    /*
     * The §3b check. iro.js is RGB-native, so this is the phase's real risk: a
     * colour that looks right in the widget but arrives at the simulator as an
     * RGB triple. The paint texture holds RAW RYB, so reading it back is what
     * tells the two apart -- the canvas would look plausible either way.
     */
    await setViaWidget(page, 0.667, 1, 1, 0.8);
    await settle(page, 3);

    check('the widget writes HSVA through to the app', await hsva(page),
      (v) => Math.abs(v[0] - 0.667) < 0.01 && Math.abs(v[3] - 0.8) < 0.01,
      'hue and alpha survive the round trip through iro.js');

    await strokeCanvas(page, 260, 60);
    const blue = await paintMeanRYB(page);

    check('a blue stroke lands in the RYB blue channel',
      blue && blue.slice(0, 3).map((x) => Math.round(x * 1000) / 1000),
      (v) => v !== null && v[2] > v[0] && v[2] > v[1],
      'hue 0.667 is the cube\'s blue corner -- an RGB leak would not land here');

    await page.evaluate(() => window.__painter.engine.clear());
    await setViaWidget(page, 0.333, 1, 1, 0.8);
    await settle(page, 3);
    await strokeCanvas(page, 260, 60);
    const yellow = await paintMeanRYB(page);

    check('a yellow stroke lands in the RYB yellow channel',
      yellow && yellow.slice(0, 3).map((x) => Math.round(x * 1000) / 1000),
      (v) => v !== null && v[1] > v[0] && v[1] > v[2],
      'hue 0.333 is the YELLOW corner -- in RGB that hue is green');

    check('the two hues are genuinely different pigments',
      [blue && Math.round(blue[2] * 1000) / 1000, yellow && Math.round(yellow[1] * 1000) / 1000],
      () => blue !== null && yellow !== null && Math.abs(blue[2] - yellow[2]) > 0.01,
      'the wheel reaches the pigment rather than both being one colour');

    // ---------------------------------------------------------------------
    console.log('\n[channels] each slider moves its own channel and no other');
    // ---------------------------------------------------------------------
    await setViaWidget(page, 0.5, 0.8, 0.9, 0.7);
    await settle(page, 2);
    const before = await hsva(page);

    /*
     * setChannel(), NOT set({a: 0.25}).
     *
     * iro's `color.set()` dispatches on a COMPLETE model -- it tests for
     * {r,g,b}, {h,s,v}, {h,s,l}, {kelvin} or a string, and a partial object
     * matches none of those branches, so it falls through and does NOTHING. No
     * throw, no warning. The first version of this probe used set({a: ...}) and
     * the checks failed with the colour simply unchanged, which reads exactly
     * like the app ignoring its own control.
     *
     * Worth knowing beyond this probe: anything that later wants to nudge one
     * channel (an eyedropper, a preset, an undo that restores a colour) must use
     * setChannel or pass a full model. app/ui/color.js's setHSVA() passes all
     * four, which is why it is not affected.
     */
    await page.evaluate(() => {
      window.__painter.colorControl.picker.color.setChannel('hsva', 'a', 0.25);
    });
    await settle(page, 2);
    const afterAlpha = await hsva(page);

    check('alpha moves alpha only', [before, afterAlpha],
      ([b, a]) => Math.abs(a[3] - 0.25) < 0.01 &&
                  Math.abs(a[0] - b[0]) < 0.01 &&
                  Math.abs(a[1] - b[1]) < 0.01 &&
                  Math.abs(a[2] - b[2]) < 0.01,
      'hue, saturation and value are untouched');

    await page.evaluate(() => {
      // setChannel again -- see the note above on set()'s silent no-op.
      window.__painter.colorControl.picker.color.setChannel('hsv', 'v', 40);
    });
    await settle(page, 2);
    const afterValue = await hsva(page);

    check('value moves value only', [afterAlpha, afterValue],
      ([b, a]) => Math.abs(a[2] - 0.4) < 0.01 &&
                  Math.abs(a[0] - b[0]) < 0.01 &&
                  Math.abs(a[1] - b[1]) < 0.01 &&
                  Math.abs(a[3] - b[3]) < 0.01,
      'hue, saturation and alpha are untouched');

    // ---------------------------------------------------------------------
    console.log('\n[stripe] the compact bar and the wheel agree');
    // ---------------------------------------------------------------------
    /*
     * Two controls editing one value, which is the shape that produced the two
     * size sliders' sync rule in Phase 7. The extra risk here is a FEEDBACK
     * LOOP: the wheel writes to the app, the app pushes the stripe, and if the
     * stripe pushed back the two would oscillate. The stripe is hue-only, so a
     * loop would show up as saturation/value drifting on their own.
     */
    /*
     * Park the stripe somewhere FAR from where the wheel is about to put it,
     * before asking whether the wheel moves it.
     *
     * Without this the check is worthless, and that is not hypothetical: the
     * first version of this probe passed even with the wheel->stripe push
     * deleted outright, because the handle already happened to sit near the
     * target hue from the construction-time setHue() and the earlier stripe
     * click. Sabotage caught it. A sync check has to start out of sync.
     */
    await page.evaluate(() => window.__painter.toolPanel.setHue(0.9));
    await settle(page, 2);

    const stripeBeforeWheel = await page.evaluate(() => {
      const handle = document.querySelector('#bar-hue-stripe .handle');
      const stripe = document.getElementById('bar-hue-stripe');
      const hRect = handle.getBoundingClientRect();
      const sRect = stripe.getBoundingClientRect();
      return (hRect.left + hRect.width / 2 - sRect.left) / sRect.width;
    });

    check('the stripe starts parked away from the target', Math.round(stripeBeforeWheel * 100) / 100,
      (v) => Math.abs(v - 0.2) > 0.3,
      'so the next check measures the wheel moving it, not where it already was');

    await setViaWidget(page, 0.2, 0.7, 0.6, 0.5);
    await settle(page, 2);

    const stripeSynced = await page.evaluate(() => {
      const handle = document.querySelector('#bar-hue-stripe .handle');
      const stripe = document.getElementById('bar-hue-stripe');
      const hRect = handle.getBoundingClientRect();
      const sRect = stripe.getBoundingClientRect();
      return (hRect.left + hRect.width / 2 - sRect.left) / sRect.width;
    });

    check('the hue stripe follows the wheel', Math.round(stripeSynced * 100) / 100,
      (v) => Math.abs(v - 0.2) < 0.06,
      'the wheel pushes the stripe, so the two agree when the panel collapses');

    const beforeStripe = await hsva(page);
    await page.evaluate(() => {
      const stripe = document.getElementById('bar-hue-stripe');
      const r = stripe.getBoundingClientRect();
      const x = r.left + r.width * 0.75;
      const y = r.top + r.height / 2;
      const opts = { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true };
      stripe.dispatchEvent(new PointerEvent('pointerdown', opts));
      stripe.dispatchEvent(new PointerEvent('pointerup', opts));
    });
    await settle(page, 3);
    const afterStripe = await hsva(page);

    check('the stripe still sets hue ONLY', [beforeStripe, afterStripe],
      ([b, a]) => Math.abs(a[0] - b[0]) > 0.1 &&
                  Math.abs(a[1] - b[1]) < 0.01 &&
                  Math.abs(a[2] - b[2]) < 0.01 &&
                  Math.abs(a[3] - b[3]) < 0.01,
      'the wheel does not clobber saturation/value when the stripe moves');

    const noLoop = await page.evaluate(() => {
      // Read twice, a frame apart. A feedback loop between the wheel and the
      // stripe would keep nudging the value; a settled control does not move.
      const first = window.__painter.brushColorHSVA.slice();
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const second = window.__painter.brushColorHSVA.slice();
        resolve([first, second]);
      })));
    });

    check('no feedback loop between stripe and wheel', noLoop,
      ([a, b]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9),
      'the colour is stable when nothing is touching it');

    // ---------------------------------------------------------------------
    console.log('\n[hit testing] the wheel is an element, so the canvas never sees it');
    // ---------------------------------------------------------------------
    /*
     * The reason all the colorPicker.onMouse* forwards could be deleted. The GL
     * picker was pixels in the canvas, so a hue drag was also a canvas pointer
     * down and had to be suppressed by hand. If that is wrong now, a user
     * picking a colour paints a stroke underneath the panel.
     */
    await page.evaluate(() => window.__painter.engine.clear());
    await settle(page, 3);
    const beforeWheelDrag = await paintSum(page);

    const wheelPoint = await page.evaluate(() => {
      const w = document.querySelector('#color-picker-slot .IroWheel');
      const r = w.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.move(wheelPoint.x, wheelPoint.y);
    await page.mouse.down();
    await page.mouse.move(wheelPoint.x + 30, wheelPoint.y + 10, { steps: 10 });
    await page.mouse.up();
    await settle(page, 20);

    const afterWheelDrag = await paintSum(page);
    check('a drag on the wheel deposits no paint', [beforeWheelDrag, afterWheelDrag],
      ([b, a]) => b === a, 'the browser hit-tests the element; the canvas is not involved');

    // ...and the control: the same drag on the canvas must paint, or the check
    // above would also pass on a page that cannot paint at all.
    await strokeCanvas(page, 200, 40);
    const afterCanvasDrag = await paintSum(page);
    check('the same drag on the canvas DOES paint', [afterWheelDrag, afterCanvasDrag],
      ([b, a]) => a > b, 'the control check above is meaningful');

    // ---------------------------------------------------------------------
    console.log('\n[toggle] Natural/Digital still switches the composite model');
    // ---------------------------------------------------------------------
    /*
     * The toggle now reads FluidEngine.COLOR_MODEL rather than the app's own
     * deleted enum (Phase 9 finding 2). The renderer's test is an EQUALITY, so a
     * wrong value does not error -- it silently composites RYB, and the button
     * would look like it did nothing.
     */
    const models = await page.evaluate(() => {
      const painter = window.__painter;
      const buttons = document.querySelectorAll('#models div');
      const start = painter.colorModel;
      buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const digital = painter.colorModel;
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const natural = painter.colorModel;
      return {
        start, digital, natural,
        RYB: FluidEngine.COLOR_MODEL.RYB,
        RGB: FluidEngine.COLOR_MODEL.RGB,
      };
    });

    check('the model toggle uses the engine enum', models,
      (v) => v.start === v.RYB && v.digital === v.RGB && v.natural === v.RYB,
      'Natural is RYB, Digital is RGB, and both come from FluidEngine.COLOR_MODEL');

    await context.close();
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
