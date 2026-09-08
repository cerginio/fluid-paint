'use strict';

/*
 * Phase 10 probe -- the picker's COLOUR SPACE.
 *
 * Phase 8 mounted an RGB-native picker next to a subtractive simulation and
 * left the widget drawing in RGB, on the reasoning that the wheel is only a
 * chooser. That reasoning was wrong and this probe is the check that would have
 * caught it: `hsvToRyb()` and `rybToRgb()` are not a round trip, so the hue the
 * wheel NAMED was not the hue the brush DEPOSITED --
 *
 *     picked 240deg (blue)   -> canvas painted pure YELLOW
 *     picked  60deg (yellow) -> canvas painted purple
 *     picked 120deg (green)  -> canvas painted slate blue
 *
 * -- red being the only fixed point. The fix routes IroColor.hsvToRgb through
 * the pigment cube, so every surface iro draws derives from the same two steps
 * the paint takes.
 *
 * What this checks that phase8-probe does not:
 *
 *   1. the cube in JS (app/ui/ryb.js) still matches the cube in the SHADERS.
 *      Three copies of eight corners; a drifted copy makes the widget lie again
 *      and nothing else in the suite would notice.
 *   2. the widget's own reported colour IS the pigment, for hues where pigment
 *      and RGB differ. This is the check that fails on the Phase 8 code.
 *   3. the wheel's rendered hue ring is pigment, not the stock RGB conic
 *      gradient -- the ring is built once at module load, so a script-order
 *      mistake would leave it RGB while everything else converted.
 *   4. the compact bar's hue stripe agrees with the wheel.
 *   5. the Natural/Digital toggle repaints BOTH, including the ring.
 *   6. the paint path is untouched: hue still reaches the RYB channel it always
 *      did. The goldens cover this too, but this fails faster and says why.
 *
 * Per the debug/ convention this is a throwaway: delete after use, write it
 * back if the colour space is reworked again.
 *
 *   node debug/phase10-probe.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');

acquireBrowserLock('phase10 probe');

/* GOLDEN_ROOT=dist runs this against the built bundle, the same switch the
 * golden suite uses. Worth doing for this phase specifically: the fix depends
 * on ryb.js being concatenated BEFORE iro.js, and minification strips the
 * comments and mangles the names that a source-level grep would look for -- so
 * running the real page is the only honest check of the bundle's order. */
const ROOT = path.resolve(__dirname, '..', process.env.GOLDEN_ROOT || '');
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

/** Parse "rgb(r, g, b)" / "rgb(r,g,b)" into [r,g,b]. */
function parseRgb(str) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str || '');
  return m ? [+m[1], +m[2], +m[3]] : null;
}

const dist = (a, b) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

(async () => {
  const { server, port } = await serve(ROOT);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__painter && window.__painter.colorControl);
  await settle(page, 5);

  console.log('\n[cube] the JS copy still matches the shaders');

  // The shaders are fetched rather than read through the page, because the page
  // compiles them and does not keep the text around.
  const shaderText = {
    picker: fs.readFileSync(path.join(ROOT, 'app/shaders/picker.frag'), 'utf8'),
    painting: fs.readFileSync(path.join(ROOT, 'fluid-engine/shaders/painting.frag'), 'utf8'),
  };

  const cubeMatch = await page.evaluate((texts) => ({
    picker: assertMatchesShader(texts.picker),
    painting: assertMatchesShader(texts.painting),
  }), shaderText);

  check('the JS cube matches picker.frag', cubeMatch.picker, (v) => v.ok === true,
    'eight corners, in the shader\'s own argument order');
  check('the JS cube matches painting.frag', cubeMatch.painting, (v) => v.ok === true,
    'the engine shader is the one actually on the paint path');

  console.log('\n[widget] the picker reports PIGMENT, not light');

  /*
   * Three hues where the two spaces disagree loudly, plus red where they agree.
   * Red is included deliberately: it is the fixed point, so a test suite made
   * only of red would pass on the broken code and prove nothing.
   */
  const HUES = [
    { deg: 0, name: 'red', pigment: [255, 0, 0], rgb: [255, 0, 0] },
    { deg: 60, name: 'yellow', pigment: [128, 0, 128], rgb: [255, 255, 0] },
    { deg: 120, name: 'green', pigment: [42, 95, 153], rgb: [0, 255, 0] },
    { deg: 240, name: 'blue', pigment: [255, 255, 0], rgb: [0, 0, 255] },
  ];

  for (const hue of HUES) {
    const got = await page.evaluate((h) => {
      const c = window.__painter.colorControl.picker.color;
      c.set({ h, s: 100, v: 100, a: 1 });
      const rgb = c.rgb;
      return [rgb.r, rgb.g, rgb.b];
    }, hue.deg);

    const toPigment = dist(got, hue.pigment);
    const toRgb = dist(got, hue.rgb);

    check(`hue ${hue.deg} (${hue.name}) reads as pigment`,
      { got, pigment: hue.pigment, rgb: hue.rgb },
      () => toPigment < 12,
      hue.deg === 0
        ? 'red is the fixed point -- both spaces agree here'
        : `pigment dist ${toPigment.toFixed(1)} vs RGB dist ${toRgb.toFixed(1)}`);
  }

  console.log('\n[ring] the wheel\'s hue ring is drawn in pigment');

  /*
   * The ring is a conic-gradient built ONCE at iro's module load, so it is the
   * surface a script-order mistake breaks while leaving everything else right.
   * Checking a stop the two spaces disagree on rather than the whole string:
   * the stop count is an implementation detail, the colour is not.
   */
  const ring = await page.evaluate(() => {
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    return el ? getComputedStyle(el).backgroundImage : null;
  });

  check('the ring is a conic gradient at all', ring !== null && /conic/.test(ring || ''),
    (v) => v === true, 'the wheel mounted and kept its ring');

  // Stock iro emits `red, yellow, lime, aqua, blue, magenta, red`. Pure lime
  // and pure aqua cannot occur in the pigment ring, so their presence is proof
  // the stock gradient survived.
  const hasStockStops = /rgb\(0,\s*255,\s*0\)/.test(ring || '')
    && /rgb\(0,\s*255,\s*255\)/.test(ring || '');
  check('the ring is NOT the stock RGB sweep', hasStockStops, (v) => v === false,
    'pure lime + pure aqua together are the stock gradient\'s signature');

  // And positively: the pigment ring must contain a yellow stop, which is where
  // BLUE sits in this space -- the single most visible consequence of the fix.
  const hasPigmentYellow = /rgb\(25[0-5],\s*25[0-5],\s*0\)/.test(ring || '');
  check('the ring contains the pigment\'s yellow', hasPigmentYellow, (v) => v === true,
    'hue 240 renders yellow under the cube; its absence means the ring is RGB');

  console.log('\n[stripe] the compact bar agrees with the wheel');

  const stripe = await page.evaluate(() => {
    const el = document.getElementById('bar-hue-stripe');
    return el ? getComputedStyle(el).backgroundImage : null;
  });

  const stripeStock = /rgb\(0,\s*255,\s*0\)/.test(stripe || '')
    && /rgb\(0,\s*255,\s*255\)/.test(stripe || '');
  check('the hue stripe is not the stock RGB sweep', stripeStock, (v) => v === false,
    'the stripe is the hue control when the panel is collapsed');

  console.log('\n[toggle] Natural/Digital repaints the widget');

  /*
   * Hue 0, NOT 240.
   *
   * The two models coincide at hue 240: RYB there is (0,0,1), and the additive
   * path `1 - ryb.yxz` gives (1,1,0) -- the same yellow the cube's blue corner
   * gives. A toggle test written on 240 passes whether or not the toggle does
   * anything, which is how the first version of this check "passed" while
   * measuring nothing. Hue 0 is the most discriminating: red vs magenta, 255
   * apart. Measured across the wheel in 15deg steps.
   */
  const beforeToggle = await page.evaluate(() => {
    const c = window.__painter.colorControl.picker.color;
    c.set({ h: 0, s: 100, v: 100, a: 1 });
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    const rgb = c.rgb;
    return { swatch: [rgb.r, rgb.g, rgb.b], ring: getComputedStyle(el).backgroundImage };
  });

  // Click Digital.
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('#models > div');
    if (buttons[1]) buttons[1].click();
  });
  await settle(page, 3);

  const afterToggle = await page.evaluate(() => {
    const c = window.__painter.colorControl.picker.color;
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    const rgb = c.rgb;
    return {
      swatch: [rgb.r, rgb.g, rgb.b],
      ring: getComputedStyle(el).backgroundImage,
      model: window.__painter.colorModel,
    };
  });

  check('the toggle actually switched model', afterToggle.model, (v) => v === 1,
    'COLOR_MODEL.RGB -- the control check for the two below');
  check('the swatch changes with the model',
    { before: beforeToggle.swatch, after: afterToggle.swatch },
    (v) => dist(v.before, v.after) > 12,
    'the two cube paths give different colours for the same hue');
  check('the RING changes with the model too',
    beforeToggle.ring !== afterToggle.ring, (v) => v === true,
    'built once at load, so this is the one that needs an explicit rebuild');

  // Back to Natural for the paint check below.
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('#models > div');
    if (buttons[0]) buttons[0].click();
  });
  await settle(page, 3);

  console.log('\n[paint] the simulation is untouched by all of the above');

  /*
   * The whole risk of this phase is a display change leaking into the paint
   * path. The goldens are the real guard, but they take minutes; this says the
   * same thing in seconds and names the channel when it fails.
   */
  const painted = await page.evaluate(async () => {
    const p = window.__painter;
    p.colorControl.picker.color.set({ h: 240, s: 100, v: 100, a: 1 });
    await new Promise((r) => requestAnimationFrame(r));
    return p.brushColorHSVA.slice();
  });

  check('hue 240 still stores as 0.667', painted,
    (v) => Math.abs(v[0] - 2 / 3) < 0.01,
    'the widget writes HSV, not RGB -- an RGB leak would land elsewhere');

  const rybChannel = await page.evaluate(() => hsvToRyb(2 / 3, 1, 1));
  check('hue 240 still reaches the RYB blue channel', rybChannel,
    (v) => v[2] > 0.9 && v[0] < 0.1 && v[1] < 0.1,
    'the cube\'s blue corner -- this is the §3b invariant, unchanged');

  check('no page errors', errors, (v) => v.length === 0,
    'a throw inside the picker leaves a plausible-looking but dead widget');

  await browser.close();
  server.close();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
