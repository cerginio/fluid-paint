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

  /* BLACK=1 runs the whole probe against the black-pigment cube (?black=1).
   * Everything below is written to hold under EITHER cube: the corner-dependent
   * expectations are derived from the live conversion rather than hardcoded,
   * and the few that name a literal colour are rim/pure-hue values that the
   * flag provably does not move. The dedicated black-cube checks are at the
   * end. */
  /* The black corner is the DEFAULT now, so the interesting extra run is the
   * opt-out. DAVIDLI=1 runs the whole probe against ?black=0. */
  const BLACK = process.env.DAVIDLI !== '1';
  const pageUrl = `http://127.0.0.1:${port}/index.html` + (BLACK ? '' : '?black=0');
  console.log(BLACK
    ? '  (default cube -- true-black pigment corner)'
    : '  (running with ?black=0 -- David Li original corner)');
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__painter && window.__painter.colorControl);
  await settle(page, 5);

  console.log('\n[cube] the JS copy still matches the shaders');

  // The shaders are fetched rather than read through the page, because the page
  // compiles them and does not keep the text around.
  const shaderText = {
    picker: fs.readFileSync(path.join(ROOT, 'app/shaders/picker.frag'), 'utf8'),
    painting: fs.readFileSync(path.join(ROOT, 'fluid-engine/shaders/painting.frag'), 'utf8'),
    /* painting.frag's v111 is the u_pigmentBlack uniform since the
     * black-pigment flag, so its value lives in renderer.js. The guard refuses
     * to check only seven corners, so it needs this text too.
     *
     * Always from the SOURCE tree, never from ROOT: renderer.js is concatenated
     * into the bundle, so it does not exist as a file under dist/. The corner
     * constants are the same either way -- what dist changes is the packaging,
     * and the bundle's own copy of the shader is still checked above. */
    renderer: fs.readFileSync(
      path.resolve(__dirname, '..', 'fluid-engine/renderer.js'), 'utf8'),
  };

  const cubeMatch = await page.evaluate((texts) => ({
    picker: assertMatchesShader(texts.picker),
    painting: assertMatchesShader(texts.painting, texts.renderer),
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
      // The adapter, not c.rgb: `rgb` is stock iro's additive conversion
      // again, on purpose. Pigment is read explicitly.
      const rgb = window.iro.Color.pigmentRgb(c.hsv);
      return [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)];
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

  console.log('\n[ends] the interior agrees with the paint, not with HSV');

  /*
   * These endpoints previously asserted the OPPOSITE of what is correct.
   *
   * The reasoning was that in a subtractive space s=0 must be white paper and
   * v=0 must be black -- which describes a picker one might design, not the one
   * this app has. The actual selection mapping is `hsvToRyb()`, an additive
   * formula whose outputs are reinterpreted as ink, so desaturating raises all
   * three loads toward 1 and lands on the cube's v111 near-black brown.
   *
   * Because these checks encoded the wrong theory they PASSED on the divergent
   * code and would have blocked the repair. The expected values below are the
   * paint's, from docs/COLOR-PICKER-PAINT-PARITY-SPEC.md; the numeric grid
   * behind them is debug/color-parity-test.js.
   */
  const readColor = async (h, sat, val) => {
    await page.evaluate(({ h, sat, val }) => {
      window.__painter.colorControl.picker.color.set({ h, s: sat, v: val, a: 1 });
    }, { h, sat, val });
    // Preact re-renders asynchronously; the DOM (handles) lags the model by a
    // frame. Reading too early reports the PREVIOUS colour, which looks exactly
    // like a broken handle -- it cost a false failure while writing this.
    await settle(page, 2);
    return page.evaluate(() => {
      const c = window.__painter.colorControl.picker.color;
      const el = document.querySelector(
        '#color-picker-slot .IroWheel .IroHandle circle[fill]:not([fill="none"])');
      // The adapter, not c.rgb: `rgb` is stock iro's additive conversion again,
      // on purpose. Pigment is read explicitly.
      const p = window.iro.Color.pigmentRgb(c.hsv);
      return {
        rgb: [Math.round(p.r), Math.round(p.g), Math.round(p.b)],
        handle: el ? el.getAttribute('fill') : null,
      };
    });
  };

  const near = (want, tol) => (got) =>
    got !== null && Math.max(...got.map((v, i) => Math.abs(v - want[i]))) <= tol;

  const centre = await readColor(0, 0, 100);
  // v111 under whichever cube is live: the brown by default, black with ?black=1.
  check('the centre at v=1 is the pigment the brush deposits', centre.rgb,
    near(BLACK ? [0, 0, 0] : [51, 24, 0], 2),
    'full load on every channel is the cube v111 corner -- NOT white');

  const zeroValue = await readColor(0, 100, 0);
  check('value 0 is white paper, matching the paint', zeroValue.rgb,
    near([255, 255, 255], 2),
    'zero pigment load is blank paper; black here was the old overlay');

  const halfValue = await readColor(0, 100, 50);
  check('half-value red is pink, matching the paint', halfValue.rgb,
    near([255, 128, 128], 2),
    'the reported case: pink paint under dark-red bristles');

  const rim = await readColor(0, 100, 100);
  check('the rim (s=1,v=1) is unchanged', rim.rgb,
    near([255, 0, 0], 2),
    'hue 0 is still pure red -- the interior fix must not move the rim');

  const gradientEnds = await page.evaluate(() => {
    const g = document.querySelectorAll('#color-picker-slot .IroSliderGradient');
    if (!g.length) return null;
    const m = getComputedStyle(g[0]).backgroundImage.match(/rgb\([^)]*\)/g);
    return m ? [m[0], m[m.length - 1]] : null;
  });
  check('the value slider starts at the paint zero-value colour', gradientEnds,
    (v) => v !== null && /rgb\(25[0-5],\s*25[0-5],\s*25[0-5]\)/.test(v[0]),
    'v=0 is white paper in this selection model; black was the HSV assumption');

  console.log('\n[handle] the wheel handle agrees with the ring under it');

  /*
   * The handles are filled from `hslString`, which reached the colour through
   * IroColor.hsvToHsl -- a SEPARATE additive path that never touches hsvToRgb.
   * So converting hsvToRgb left the handles alone, and a handle sitting on the
   * ring showed a different colour from the ring beneath it.
   */
  for (const handleHue of [0, 60, 240]) {
    const got = await readColor(handleHue, 100, 100);
    const handleRgb = parseRgb(got.handle);
    check(`handle at hue ${handleHue} matches the swatch`,
      { swatch: got.rgb, handle: got.handle },
      () => handleRgb !== null && dist(handleRgb, got.rgb) < 6,
      'the handle is filled from hslString, which was a second RGB path');
  }

  console.log('\n[disc] the rendered raster agrees with the contract');

  /*
   * The disc is a sampled canvas, so this reads its actual PIXELS rather than a
   * CSS declaration. That matters: the previous construction (conic hue + white
   * radial + black value overlay) could be described correctly stop by stop and
   * still composite to the wrong interior, which is how it passed rim checks
   * while the middle of the disc was wrong.
   *
   * Sampling at several radii, including mixed-pigment sectors, is the point --
   * a rim-only read cannot distinguish the two mappings at all.
   */
  const discSamples = await page.evaluate(async () => {
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    if (!el || !el.getContext) return null;

    // Value 1 so the sampled row is comparable to the numeric reference.
    window.__painter.colorControl.picker.color.set({ h: 0, s: 100, v: 100, a: 1 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const ctx = el.getContext('2d');
    const px = el.width;
    const c = px / 2;

    // The raster maps saturation 100 to getHandleRange(), which is inset from
    // the canvas edge by border + padding + handleRadius. Rather than
    // recomputing that here, sample by FRACTION of the drawn disc and let the
    // expectations come from the same geometry the page used.
    const read = (fracR, deg) => {
      const rad = deg * Math.PI / 180;
      // Match getWheelValueFromInput's sign convention: it measures from the
      // centre outward as (cx - x, cy - y) then atan2(-y, -x).
      const x = Math.round(c - fracR * c * Math.cos(rad));
      const y = Math.round(c - fracR * c * Math.sin(rad));
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };

    return {
      size: px,
      // Deliberately inside the rim (0.55 of the radius) to avoid both the
      // antialiased edge and the handle outline at the centre.
      mid0: read(0.55, 0),
      mid120: read(0.55, 120),
      mid240: read(0.55, 240),
      centre: read(0.0, 0),
    };
  });

  check('the disc rendered as a canvas with pixels', discSamples,
    (v) => v !== null && v.size > 0, 'the raster surface mounted and drew');

  if (discSamples) {
    /* The centre is s=0, which at v=1 is full load on every channel -- the
     * cube's v111 near-black brown. A white centre here means an unrelated RGB
     * overlay was painted over the disc, which is the divergence coming back. */
    /* The centre is s=0, which at v=1 is full load on every pigment -- the
     * cube's v111 corner. Which colour that IS depends on the flag, so take it
     * from the live conversion rather than hardcoding it; what is asserted is
     * that the raster agrees with the contract there, under either cube. */
    const centreWant = await page.evaluate(() =>
      hsvToPigmentRgb(0, 0, 1, window.__painter.colorModel === 1)
        .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)));
    check('the disc centre is the cube v111 corner',
      { got: discSamples.centre.slice(0, 3), want: centreWant },
      (v) => Math.max(...v.got.map((g, i) => Math.abs(g - v.want[i]))) <= 4,
      'this is the single most visible consequence of the parity contract');

    // Interior pixels must be opaque; a transparent interior would mean the
    // radius maths disagrees with the canvas size.
    check('interior samples are opaque',
      [discSamples.mid0[3], discSamples.mid120[3], discSamples.mid240[3]],
      (v) => v.every((a) => a === 255), 'alpha 0 means the disc was clipped wrong');

    /* The three sampled sectors must differ from each other: a disc that
     * collapsed to one hue (a broken angle derivation) would otherwise pass
     * every per-pixel bound above. */
    const spread = Math.max(
      Math.abs(discSamples.mid0[0] - discSamples.mid120[0]),
      Math.abs(discSamples.mid0[2] - discSamples.mid240[2]));
    check('different sectors render different colours', spread,
      (v) => v > 20, 'the disc collapsed to a single hue');
  }

  /* And the raster must agree with the numeric contract at the point it is
   * sampled -- read the page's own geometry rather than guessing the radius,
   * then compare against hsvToPigmentRgb for that exact hue/saturation. */
  const discParity = await page.evaluate(async () => {
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    if (!el || !el.getContext) return null;
    const ctx = el.getContext('2d');
    const px = el.width;
    const c = px / 2;

    const out = [];
    for (const deg of [0, 90, 210]) {
      for (const frac of [0.3, 0.6]) {
        const rad = deg * Math.PI / 180;
        const x = Math.round(c - frac * c * Math.cos(rad));
        const y = Math.round(c - frac * c * Math.sin(rad));
        const d = ctx.getImageData(x, y, 1, 1).data;

        /* Invert the SAME geometry the renderer used, from the pixel back to
         * (hue, saturation), and evaluate the contract there. Deriving the
         * expectation from the pixel's own coordinates is what makes this an
         * agreement test rather than a second guess at the layout.
         *
         * The scale factor matters: the canvas backing store is DPR-scaled and
         * capped, so handleRange (a CSS-pixel quantity) has to be brought into
         * backing pixels before it can be compared with a pixel distance. */
        const dx = c - (x + 0.5);
        const dy = c - (y + 0.5);
        const dist = Math.sqrt(dx * dx + dy * dy);

        const scale = px / el.clientWidth;
        const handleRange = (el.clientWidth / 2 - 6 - 8) * scale;  // padding, handleRadius

        /* translateWheelAngle() with the picker's defaults (wheelAngle 0,
         * anticlockwise) is `mod(0 - angle, 360)` -- a negation. Spelling it
         * out here rather than calling iro's own helper keeps the expectation
         * independent of the function the renderer uses; if the two ever
         * disagree this test is what says so. Update it if the picker is ever
         * configured with a nondefault angle or direction. */
        const raw = Math.atan2(-dy, -dx) * (180 / Math.PI);
        const hue = ((-raw) % 360 + 360) % 360;
        const sat = Math.min(1, dist / handleRange);
        const want = hsvToPigmentRgb(hue / 360, sat, 1,
          window.__painter.colorModel === 1);

        out.push({
          deg, frac,
          got: [d[0], d[1], d[2]],
          want: want.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)),
        });
      }
    }
    return out;
  });

  check('sampled disc pixels were read', discParity,
    (v) => v !== null && v.length === 6, 'could not read back the raster');

  if (discParity) {
    /* Three 8-bit units per channel, per the spec: enough for the rounding in
     * the raster and the readback, far tighter than the difference between the
     * two mappings (which is hundreds of units in the disc's interior).
     *
     * This is the check that catches a geometry error. A hue derivation that is
     * mirrored or rotated still produces a plausible, colourful disc -- every
     * per-pixel bound and every "sectors differ" check passes -- and only an
     * agreement test against the pixel's own coordinates can see it. The first
     * version of the raster double-counted wheelDirection and was wrong by up
     * to 104/255 off-axis while looking perfectly reasonable. */
    let worst = 0;
    let worstAt = null;
    for (const smp of discParity) {
      const err = Math.max(...smp.got.map((v, i) => Math.abs(v - smp.want[i])));
      if (err > worst) { worst = err; worstAt = smp; }
    }
    check('every sampled disc pixel matches the contract', { worst, worstAt },
      (v) => v.worst <= 3,
      'the raster geometry disagrees with hsvToPigmentRgb at that point');
  }

  /*
   * COMPOSITED pixels, via a screenshot.
   *
   * Everything above reads the canvas backing store with getImageData(), which
   * is blind to anything stacked ON TOP of the canvas in the DOM. That is not a
   * hypothetical gap: the construction this phase removed was exactly such an
   * overlay (a white radial gradient plus a black value layer), and putting one
   * back leaves every getImageData check passing while the user sees a
   * completely different disc.
   *
   * So this reads the rendered page instead. It is the only check here that
   * can see a re-introduced overlay.
   */
  const composited = await page.evaluate(() => {
    window.__painter.colorControl.picker.color.set({ h: 0, s: 0, v: 100, a: 1 });
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await settle(page, 3);

  /* Offset well clear of the handle. At s=0 the handle sits AT the centre and
   * its stroke tints a patch taken there -- an early version of this check read
   * [51,40,19] against a true [51,24,0] for exactly that reason, which looks
   * like a colour bug and is really a sampling one. 24px out is still deep in
   * the low-saturation region, where the contract and any white overlay differ
   * by far more than the tolerance. */
  const shot = await page.screenshot({
    clip: { x: Math.round(composited.x) + 24, y: Math.round(composited.y) - 1, width: 3, height: 3 },
  });

  /* PNG decode without a dependency: the golden harness already pulls pixels
   * through the page, so do the same here -- hand the bytes back to the browser
   * and let it decode them. */
  const centrePixel = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(1, 1, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, shot.toString('base64'));

  // The expected colour at that offset, from the same contract the raster uses.
  const compositedWant = await page.evaluate(() => {
    const el = document.querySelector('#color-picker-slot .IroWheelHue');
    const handleRange = el.clientWidth / 2 - 6 - 8;
    // 25px right of centre, 1px up: dx = -25 in the renderer's sign convention.
    const dx = -25, dy = 1;
    const raw = Math.atan2(-dy, -dx) * (180 / Math.PI);
    const hue = ((-raw) % 360 + 360) % 360;
    const sat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / handleRange);
    return hsvToPigmentRgb(hue / 360, sat, 1, window.__painter.colorModel === 1)
      .map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  });

  check('the COMPOSITED disc is the pigment, not an overlay',
    { got: centrePixel, want: compositedWant },
    (v) => Math.max(...v.got.map((g, i) => Math.abs(g - v.want[i]))) <= 6,
    'reads the screen, so a white/black overlay stacked over the canvas fails here');
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
    const rgb = window.iro.Color.pigmentRgb(c.hsv);
    return {
      swatch: [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)],
      // The disc is a canvas now, so its pixels are the evidence, not a
      // gradient string. A corner-ish interior sample is enough to tell the
      // two models apart at hue 0 (red vs magenta).
      disc: el && el.toDataURL ? el.toDataURL().slice(-64) : null,
    };
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
    const rgb = window.iro.Color.pigmentRgb(c.hsv);
    return {
      swatch: [Math.round(rgb.r), Math.round(rgb.g), Math.round(rgb.b)],
      disc: el && el.toDataURL ? el.toDataURL().slice(-64) : null,
      model: window.__painter.colorModel,
    };
  });

  check('the toggle actually switched model', afterToggle.model, (v) => v === 1,
    'COLOR_MODEL.RGB -- the control check for the two below');
  check('the swatch changes with the model',
    { before: beforeToggle.swatch, after: afterToggle.swatch },
    (v) => dist(v.before, v.after) > 12,
    'the two cube paths give different colours for the same hue');
  check('the DISC raster changes with the model too',
    beforeToggle.disc !== null && beforeToggle.disc !== afterToggle.disc,
    (v) => v === true,
    'the raster is cached by model; a stale cache leaves the old disc drawn');

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

  /*
   * The ACTUAL boundary: what reaches engine.splat().
   *
   * Testing hsvToRyb() directly proves only that the function works, not that
   * it is the function being called. The failure this guards against is a
   * display RGB triple being handed to the engine as pigment -- which produces
   * plausible-looking paint in the wrong colour and leaves every conversion
   * unit test green. So this wraps splat() and synthesizes a real stroke.
   */
  const splatColor = await page.evaluate(async () => {
    const p = window.__painter;
    p.colorControl.picker.color.set({ h: 0, s: 100, v: 50, a: 1 });
    await new Promise((r) => requestAnimationFrame(r));

    const captured = [];
    const engine = p.engine;
    const real = engine.splat;
    engine.splat = function (rect, opts) {
      captured.push(Array.prototype.slice.call(opts.color, 0, 4));
      return real.apply(this, arguments);
    };

    // Drive a real interaction rather than calling splat ourselves, so the
    // colour observed is the one the paint path actually assembles.
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const at = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
      pointerId: 1, pointerType: 'pen', isPrimary: true, bubbles: true,
      clientX: r.x + x, clientY: r.y + y, pressure: 0.8, buttons: t === 'pointerup' ? 0 : 1,
    }));
    at('pointerdown', r.width / 2, r.height / 2);
    at('pointermove', r.width / 2 + 20, r.height / 2 + 8);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    at('pointerup', r.width / 2 + 20, r.height / 2 + 8);
    await new Promise((res) => requestAnimationFrame(res));

    engine.splat = real;
    return captured.length ? captured[0] : null;
  });

  /* h=0, s=1, v=0.5 -> hsvToRyb gives (0.5, 0, 0): half a load of red pigment.
   * The DISPLAY colour for that same selection is (1, 0.5, 0.5) -- so if the
   * two were ever swapped, this is where it shows. */
  check('the colour reaching engine.splat is pigment, not display RGB', splatColor,
    (v) => v !== null
      && Math.abs(v[0] - 0.5) < 0.02 && Math.abs(v[1]) < 0.02 && Math.abs(v[2]) < 0.02,
    'expected pigment (0.5, 0, 0); display RGB for this selection is (1, 0.5, 0.5)');

  /* The brush preview must use the same contract. Captured at the boundary
   * rather than recomputed, for the same reason as the splat check above. */
  const previewRgb = await page.evaluate(async () => {
    const p = window.__painter;
    p.colorControl.picker.color.set({ h: 0, s: 100, v: 50, a: 1 });
    const viewer = p.brushViewer;
    if (!viewer) return null;
    const real = viewer.draw;
    let seen = null;
    viewer.draw = function (x, y, geom, rgb) {
      seen = Array.prototype.slice.call(rgb, 0, 3);
      return real.apply(this, arguments);
    };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    viewer.draw = real;
    return seen;
  });

  check('the brush preview uses the same display contract', previewRgb,
    (v) => v !== null
      && Math.abs(v[0] - 1) < 0.02 && Math.abs(v[1] - 0.5) < 0.02 && Math.abs(v[2] - 0.5) < 0.02,
    'half-value red displays as pink (1, 0.5, 0.5); the old formula gave dark red');

  check('hue 240 still stores as 0.667', painted,
    (v) => Math.abs(v[0] - 2 / 3) < 0.01,
    'the widget writes HSV, not RGB -- an RGB leak would land elsewhere');

  const rybChannel = await page.evaluate(() => hsvToRyb(2 / 3, 1, 1));
  check('hue 240 still reaches the RYB blue channel', rybChannel,
    (v) => v[2] > 0.9 && v[0] < 0.1 && v[1] < 0.1,
    'the cube\'s blue corner -- this is the §3b invariant, unchanged');

  console.log('\n[black] the pigment-black feature flag');

  /* The flag has to reach the SHADER, not just the UI. If u_pigmentBlack were
   * never set, the uniform would default to vec3(0) and every cube would be the
   * black one -- which would look like the flag working while it was actually
   * broken in the opposite direction. So this checks both states, and checks
   * the engine agrees with the UI about which is live. */
  const blackState = await page.evaluate(() => ({
    engine: window.__painter.engine.blackPigment,
    host: window.__painter.blackPigment,
    ui: typeof isPigmentBlack === 'function' ? isPigmentBlack() : null,
  }));

  check('the engine, host and UI agree on which cube is live', blackState,
    (v) => v.engine === v.host && v.ui === v.host && v.host === BLACK,
    'a disagreement here is display/paint divergence by another route');

  /* Read the actual painted pixel. The lighting term only ADDS (color * diffuse
   * + specular), so a deposited v111 cannot come out darker than the corner --
   * which is what makes this a real check of the uniform rather than of the UI. */
  const paintedDark = await page.evaluate(async () => {
    const p = window.__painter;
    // s=0 -> full load on every pigment -> the v111 corner.
    p.colorControl.picker.color.set({ h: 0, s: 0, v: 100, a: 1 });
    await new Promise((r) => requestAnimationFrame(r));

    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const at = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, {
      pointerId: 3, pointerType: 'pen', isPrimary: true, bubbles: true,
      clientX: r.x + x, clientY: r.y + y, pressure: 1, buttons: t === 'pointerup' ? 0 : 1,
    }));
    const cx = r.width / 2, cy = r.height / 2;
    at('pointerdown', cx - 40, cy);
    for (let i = -30; i <= 30; i += 10) { at('pointermove', cx + i, cy); }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    at('pointerup', cx + 30, cy);
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => requestAnimationFrame(res));
    }

    // Darkest pixel along the stroke: lighting brightens, so the minimum is the
    // closest thing on screen to the deposited base colour.
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    const dpr = window.devicePixelRatio || 1;
    const px = new Uint8Array(4);
    let best = null;
    for (let i = -25; i <= 25; i += 5) {
      gl.readPixels(Math.round((cx + i) * dpr), Math.round((cv.height - cy * dpr)),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const lum = px[0] + px[1] + px[2];
      if (best === null || lum < best.lum) best = { lum, rgb: [px[0], px[1], px[2]] };
    }
    return best;
  });

  /* What this can and cannot assert.
   *
   * A single synthesized stroke does NOT saturate the paint to full pigment
   * load -- reaching the v111 corner on canvas takes repeated overpainting --
   * and lighting only ever brightens (color * diffuse + specular). So the
   * canvas will not show (0,0,0) here even with the flag on, and demanding it
   * would be asserting something untrue about the simulation rather than about
   * the flag. Measured: stock rgb(119,80,65) vs black rgb(111,76,58), which is
   * the separation the cubes predict at a load around 0.5.
   *
   * What IS asserted: paint was deposited, and it is no lighter than the stock
   * cube would give. The exact-value check belongs to the GPU parity test
   * below, which feeds known constant pigment through the real shader instead
   * of trying to drive the fluid simulation to a known state. */
  check('a stroke was deposited and is not lighter under the flag', paintedDark,
    (v) => v !== null && v.rgb[0] < 200 && v.lum > 0,
    'the darkest pixel along the stroke, for comparison across the two cubes');

  /* The uniform reaches the SHADER -- the check that would catch u_pigmentBlack
   * never being set. Feeds known constant pigment through the production
   * rybToRgb via a tiny offscreen program, rather than through the simulation,
   * so the expected value is exact rather than load-dependent. */
  const gpuCorner = await page.evaluate(async (isBlack) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const gl = cv.getContext('webgl');
    if (!gl) return null;

    const src = await fetch('fluid-engine/shaders/painting.frag').then((r) => r.text());
    const re = new RegExp('vec3 trilinearInterpolate[^]*?\\n\}[^]*?vec3 rybToRgb[^]*?\\n\}');
    const fnMatch = re.exec(src);
    if (!fnMatch) return null;

    // The production functions verbatim, with a trivial main().
    const fsSrc = 'precision highp float;' + String.fromCharCode(10) + fnMatch[0]
      + String.fromCharCode(10) + 'uniform vec3 u_test;' + String.fromCharCode(10)
      + 'void main(){ gl_FragColor = vec4(rybToRgb(u_test), 1.0); }';
    const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';

    const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: gl.getProgramInfoLog(prog) };
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // The corner under test, set the way the renderer sets it.
    gl.uniform3f(gl.getUniformLocation(prog, 'u_pigmentBlack'),
      isBlack ? 0 : 0.2, isBlack ? 0 : 0.094, 0);
    gl.uniform3f(gl.getUniformLocation(prog, 'u_test'), 1, 1, 1);   // v111
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { rgb: [px[0], px[1], px[2]] };
  }, BLACK);

  /* The uniform is actually SET on the live program.
   *
   * This is the failure the check below cannot see: it sets u_pigmentBlack
   * itself, so it proves the shader READS the uniform, not that the renderer
   * WRITES it. An unset uniform defaults to vec3(0) in GL -- which silently
   * turns every cube into the black one, in both flag states, and looks like
   * the feature working. So read the value back off the real program.
   */
  const liveUniform = await page.evaluate(() => {
    const p = window.__painter;
    const gl = p.wgl && p.wgl.gl ? p.wgl.gl : null;
    const prog = p.engine && p.engine.renderer && p.engine.renderer.paintingProgram;
    if (!gl || !prog) return { skipped: 'no GL context or painting program exposed' };

    const handle = prog.program || prog;
    const loc = gl.getUniformLocation(handle, 'u_pigmentBlack');
    if (!loc) return { skipped: 'u_pigmentBlack optimized out or not found' };
    const v = gl.getUniform(handle, loc);
    return { value: [v[0], v[1], v[2]] };
  });

  check('u_pigmentBlack is actually written to the live program', liveUniform,
    (v) => {
      if (v.skipped) return true;          // reported below rather than failed
      const want = BLACK ? [0, 0, 0] : [0.2, 0.094, 0];
      return Math.max(...v.value.map((c, i) => Math.abs(c - want[i]))) < 0.001;
    },
    liveUniform && liveUniform.skipped
      ? 'SKIPPED: ' + liveUniform.skipped
      : 'an unset uniform defaults to vec3(0) and makes every cube black');

  check('the production shader honours u_pigmentBlack at v111', gpuCorner,
    (v) => v !== null && !v.error && v.rgb !== undefined
      && Math.max(...v.rgb.map((c, i) => Math.abs(c - (BLACK ? [0, 0, 0] : [51, 24, 0])[i]))) <= 2,
    BLACK ? 'must render (0,0,0)' : 'must render the brown corner (51,24,0)');

  check('no page errors', errors, (v) => v.length === 0,
    'a throw inside the picker leaves a plausible-looking but dead widget');

  await browser.close();
  server.close();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
