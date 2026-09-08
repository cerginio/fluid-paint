'use strict';

/*
 * Phase 9 probe -- prove reuse.
 *
 * The phase's claim is that `examples/minimal/` is a SECOND HOST for
 * FluidEngine: a bare canvas, three controls, none of the app's chrome, and a
 * working painting. The goldens cannot check any of that -- they drive
 * index.html, and a second host that never loaded would leave all 12 hashes
 * byte-identical. The only thing that fails if the boundary is fake is this
 * page, and nothing tests this page.
 *
 * So the probe drives it. What it checks, and why each one is a real risk:
 *
 *   1. the page boots at all, with only the ENGINE shader tree loaded. If any
 *      engine file reached for an app/ shader, this is where it shows.
 *   2. it reports no page errors. A missing global (Utilities, Rectangle,
 *      ColorModel) throws inside a constructor and would otherwise just leave a
 *      grey canvas that looks like an empty painting.
 *   3. a drag deposits paint. This is the whole phase in one check.
 *   4. the paint is the RIGHT COLOUR -- the hue slider's hue, converted through
 *      hsvToRyb at the boundary. Handing RGB to the simulator paints something
 *      plausible and wrong (§3b), which check 3 alone would happily pass.
 *   5. Clear empties it, and a second stroke refills it. Proves clear() is
 *      wired and that check 3 was not a one-off.
 *   6. changing fluidity through setSimulation() reaches the simulation.
 *   7. the host holds NO reference to engine.simulator/.brush/.renderer. This
 *      is the Phase 5 boundary check, applied to the host that was written to
 *      test it -- an example that reaches past the API teaches the opposite of
 *      what it is for.
 *   8. the canvas is sized from its CONTAINER, not the window.
 *   9. the main app still works, unchanged. Phase 9 adds files; it must not
 *      have touched the app, and a shared-global collision would show here.
 *
 * Per the debug/ convention this is a throwaway: delete it after use, and write
 * it back if examples/minimal is rewritten. Expected values are in
 * docs/HANDOFF.md so a later session can tell a regression from a change.
 *
 *   node debug/phase9-probe.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acquireBrowserLock } = require('./browser-lock');

acquireBrowserLock('phase9 probe');

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

// Let the host's RAF loop run N frames. Everything here is frame-driven -- the
// brush advances, the fluid steps, the texture is rendered -- so a check that
// reads state without waiting reads the state before the stroke happened.
const settle = (page, frames) => page.evaluate((n) => new Promise((resolve) => {
  let i = 0;
  const tick = () => (++i < n ? requestAnimationFrame(tick) : resolve());
  requestAnimationFrame(tick);
}), frames);

/*
 * Sum the paint texture, through the engine's own public readback.
 *
 * A SUM rather than a painted-texel count, deliberately: the handoff records
 * the count varying 76080 / 99735 / 77917 over identical code, because a
 * time-driven stroke does not deposit a fixed number of texels. The sum answers
 * only "did anything land", which is the question these checks actually ask.
 */
const paintSum = (page) => page.evaluate(() => {
  const t = window.__minimalHost.engine.readPaintTexture();
  let s = 0;
  for (let i = 0; i < t.pixels.length; ++i) s += t.pixels[i];
  return s;
});

/*
 * The mean RYB of the texels that actually carry paint.
 *
 * Alpha-weighted and alpha-gated: the paint texture is mostly empty, so a plain
 * mean over every texel is dominated by nothing and every hue looks the same.
 * Only texels above a small alpha contribute, which is what makes the returned
 * triple a statement about the PIGMENT rather than about the coverage.
 */
const paintMeanRYB = (page) => page.evaluate(() => {
  const t = window.__minimalHost.engine.readPaintTexture();
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < t.pixels.length; i += 4) {
    const a = t.pixels[i + 3];
    if (a <= 0.01) continue;
    r += t.pixels[i]; g += t.pixels[i + 1]; b += t.pixels[i + 2];
    n += 1;
  }
  if (n === 0) return null;
  return [r / n, g / n, b / n, n];
});

async function stroke(page, dx, dy) {
  const c = await page.evaluate(() => {
    const r = document.querySelector('#canvas-cell canvas').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });

  await page.mouse.move(c.x - dx / 2, c.y - dy / 2);
  await page.mouse.down();
  // Many small steps rather than one jump: Brush.update() derives bristle SPEED
  // from the delta it is handed, so a single large step is a different stroke,
  // not a faster one. See the handoff's point 2 on stroke dynamics.
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 20 });
  await page.mouse.up();

  // Settle: the bristles have to fall and cross Z_THRESHOLD before anything is
  // deposited, and the fluid keeps moving after the pointer stops.
  await settle(page, 30);
}

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
    // ---------------------------------------------------------------------
    console.log('\n[minimal host] boots on the engine tree alone');
    // ---------------------------------------------------------------------
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();

    // Collect BOTH page errors and failed requests. A 404 on a shader is not a
    // page error -- loadTextFiles stores the 404 body as the source and the
    // compile fails later with a message that does not name the file.
    const pageErrors = [];
    const failedRequests = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

    await page.goto(`http://127.0.0.1:${port}/examples/minimal/index.html`, { waitUntil: 'load' });

    let booted = true;
    try {
      await page.waitForFunction(() => window.__minimalHost && window.__minimalHost.engine, null, { timeout: 20000 });
    } catch (e) {
      booted = false;
    }

    check('the second host boots', booted, (v) => v === true,
      'new FluidEngine(...) succeeded with only the engine shader tree loaded');

    if (!booted) {
      // Nothing below can mean anything if the page did not start, and reporting
      // 8 more failures would bury the one that matters.
      console.log('\n  status text: ' + await page.evaluate(() => {
        const el = document.getElementById('status');
        return el ? el.textContent : '(no #status)';
      }));
      throw new Error('minimal host did not boot; see errors above');
    }

    check('no page errors', pageErrors, (v) => v.length === 0,
      'a missing global throws inside a constructor and leaves a plausible grey canvas');

    check('no failed requests', failedRequests, (v) => v.length === 0,
      'a 404 shader is stored as its own source and fails later without naming the file');

    // ---------------------------------------------------------------------
    console.log('\n[minimal host] the API deposits paint');
    // ---------------------------------------------------------------------
    const before = await paintSum(page);
    check('starts empty', before, (v) => v === 0, 'nothing painted before the first stroke');

    await stroke(page, 220, 60);
    const after = await paintSum(page);

    check('a drag deposits paint', [before, after], ([b, a]) => a > b,
      'initializeBrush -> positionBrush -> splat -> frame, all through FluidEngine');

    // ---------------------------------------------------------------------
    console.log('\n[minimal host] the paint is the colour the host asked for');
    // ---------------------------------------------------------------------
    /*
     * The RYB check, and it is the one that catches a whole class of silent
     * wrongness. The host converts hue through hsvToRyb at the boundary; the
     * simulation stores raw RYB. So a stroke at hue 0.667 -- which the handoff
     * records as the BLUE corner of the cube -- must come back blue-dominant in
     * the paint texture's third channel.
     *
     * If the host ever handed RGB straight in, or if the conversion were
     * dropped as a "simplification", paint would still land and the check above
     * would still pass. Only this one would move.
     */
    await page.evaluate(() => {
      window.__minimalHost.engine.clear();
      const hue = document.getElementById('hue');
      hue.value = '0.667';
      hue.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 5);

    await stroke(page, 200, 0);
    const blue = await paintMeanRYB(page);

    check('a blue stroke is blue-dominant in RYB', blue && blue.slice(0, 3).map((v) => Math.round(v * 1000) / 1000),
      (v) => v !== null && v[2] > v[0] && v[2] > v[1],
      'hue 0.667 is the RYB cube\'s blue corner; RGB handed in raw would not land here');

    await page.evaluate(() => {
      window.__minimalHost.engine.clear();
      const hue = document.getElementById('hue');
      hue.value = '0.333';
      hue.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(page, 5);

    await stroke(page, 200, 0);
    const yellow = await paintMeanRYB(page);

    check('a yellow stroke is yellow-dominant in RYB', yellow && yellow.slice(0, 3).map((v) => Math.round(v * 1000) / 1000),
      (v) => v !== null && v[1] > v[0] && v[1] > v[2],
      'hue 0.333 is the yellow corner -- the second channel, not the green of RGB');

    // The two must actually DIFFER, or both checks above could be passing on
    // whatever one fixed colour the host happens to paint everything in.
    check('the two hues paint differently', [blue && blue[2], yellow && yellow[1]],
      () => blue !== null && yellow !== null &&
            Math.abs(blue[2] - yellow[2]) > 0.01,
      'the hue control reaches the pigment, rather than both being one colour');

    // ---------------------------------------------------------------------
    console.log('\n[minimal host] the three controls reach the engine');
    // ---------------------------------------------------------------------
    await page.evaluate(() => document.getElementById('clear').click());
    await settle(page, 3);
    const cleared = await paintSum(page);
    check('Clear empties the painting', cleared, (v) => v === 0, 'engine.clear() is wired');

    await stroke(page, 180, 40);
    const refilled = await paintSum(page);
    check('a stroke after Clear paints again', refilled, (v) => v > 0,
      'the clear did not leave the engine in a state that cannot paint');

    const fluidity = await page.evaluate(() => {
      const el = document.getElementById('fluidity');
      const initial = window.__minimalHost.engine.fluidity;
      // The slider initialises FROM the engine; check that, then move it.
      const matchedAtStart = Math.abs(parseFloat(el.value) - initial) < 1e-6;
      el.value = '0.85';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { matchedAtStart, initial, now: window.__minimalHost.engine.fluidity };
    });

    check('the fluidity slider starts at the engine\'s value', fluidity.matchedAtStart,
      (v) => v === true, 'engine.fluidity exists so a control cannot disagree with the simulation');

    check('setSimulation({fluidity}) reaches the simulation', [fluidity.initial, fluidity.now],
      ([, now]) => Math.abs(now - 0.85) < 1e-6, 'read back through the public getter');

    const brushSize = await page.evaluate(() => {
      const el = document.getElementById('size');
      el.value = '20';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return window.__minimalHost.brushScale;
    });
    check('the size slider reaches the host', brushSize, (v) => v === 20,
      'host state, not engine state -- the engine takes it per call');

    // ---------------------------------------------------------------------
    console.log('\n[minimal host] the Phase 5 boundary holds in the example too');
    // ---------------------------------------------------------------------
    /*
     * The static half of the check is the grep in minimal.js's header. This is
     * the RUNTIME half: the host object must hold no reference to the engine's
     * internals, however it got one. An example that reaches past the API is
     * worse than no example -- it is a licence, in the file whose whole job is
     * to show the boundary being respected.
     */
    const reachThrough = await page.evaluate(() => {
      const host = window.__minimalHost;
      const engine = host.engine;
      const found = [];
      for (const key of Object.keys(host)) {
        const v = host[key];
        if (v === undefined || v === null) continue;
        if (v === engine.simulator) found.push(`${key} === engine.simulator`);
        if (v === engine.brush) found.push(`${key} === engine.brush`);
        if (v === engine.renderer) found.push(`${key} === engine.renderer`);
      }
      return found;
    });
    check('the host holds no engine internals', reachThrough, (v) => v.length === 0,
      'no simulator/brush/renderer reference on the host object');

    // ---------------------------------------------------------------------
    console.log('\n[minimal host] the canvas is sized by its container');
    // ---------------------------------------------------------------------
    const sizing = await page.evaluate(() => {
      const cell = document.getElementById('canvas-cell').getBoundingClientRect();
      const canvas = document.querySelector('#canvas-cell canvas');
      const r = canvas.getBoundingClientRect();
      return {
        cell: { w: Math.round(cell.width), h: Math.round(cell.height) },
        css: { w: Math.round(r.width), h: Math.round(r.height) },
        window: { w: window.innerWidth, h: window.innerHeight },
      };
    });

    check('the canvas fills its cell', [sizing.css, sizing.cell],
      ([c, cell]) => Math.abs(c.w - cell.w) <= 1 && Math.abs(c.h - cell.h) <= 1,
      'measured against the container');

    check('the cell is SHORTER than the window', [sizing.cell.h, sizing.window.h],
      ([cell, win]) => cell < win,
      'the control bar takes real height -- so "fills the cell" is not trivially "fills the window"');

    await context.close();

    // ---------------------------------------------------------------------
    console.log('\n[main app] still works, unchanged');
    // ---------------------------------------------------------------------
    /*
     * Phase 9 only ADDS files, so the app should be untouched -- but this
     * project has no module system and every file is a global. A new script
     * that redeclared a shared name would break the app while the example ran
     * fine, and nothing else here would notice.
     */
    const appContext = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
    const appPage = await appContext.newPage();
    const appErrors = [];
    appPage.on('pageerror', (e) => appErrors.push(e.message));
    await appPage.goto(`http://127.0.0.1:${port}/index.html?debug=-textureProbe`, { waitUntil: 'load' });

    let appBooted = true;
    try {
      await appPage.waitForFunction(() => window.__painter && window.__painter.engine, null, { timeout: 20000 });
    } catch (e) {
      appBooted = false;
    }

    check('the main app still boots', appBooted, (v) => v === true, 'Phase 9 added files, it did not move any');
    check('the main app has no page errors', appErrors, (v) => v.length === 0, 'no global collided');

    await appContext.close();
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
