'use strict';

/*
 * Phase B: prove the bristle footprint is really polygonal on the GPU.
 *
 * A single tap is painted per shape, the painted pixels are read back, and the
 * deposit's radius is measured as a function of angle around its centroid. A
 * regular n-gon's radius profile has exactly n minima (the edge midpoints), so
 * the check is a Fourier test: the n-th harmonic of that profile must dominate
 * for an n-gon and must be near zero for the round default.
 *
 * This is the test the shader edit actually needs. The other GPU suites only
 * prove nothing regressed; none of them would notice a footprint that silently
 * stayed round.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
require('./browser-lock').acquireBrowserLock('bristle shape GPU check');

const root = path.resolve(__dirname, '..');
const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html',
  '.vert': 'text/plain', '.frag': 'text/plain', '.json': 'application/json' };
const server = http.createServer((request, response) => {
  const file = path.join(root, decodeURIComponent(request.url.split('?')[0]));
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  });
});

// Amplitude of the n-th harmonic of the radius-vs-angle profile, normalized by
// the mean radius so it is a shape measure and not a size measure.
function harmonic(profile, n) {
  let re = 0, im = 0, mean = 0, count = 0;
  for (let i = 0; i < profile.length; i++) {
    const r = profile[i];
    if (!isFinite(r) || r <= 0) continue;
    const theta = (i / profile.length) * 2 * Math.PI;
    re += r * Math.cos(n * theta);
    im += r * Math.sin(n * theta);
    mean += r; count++;
  }
  if (!count || mean <= 0) return 0;
  return Math.hypot(re, im) / (mean / count) / count * 2;
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1',
  ] });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 650 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html?seed=20260914&debug=none&diag=0`);
    await page.waitForFunction(() => window.__painter?.engine, { timeout: 30000 });

    for (const shape of [null, { sides: 3 }, { sides: 4 }, { sides: 5 }, { sides: 6 }, { sides: 8 },
      { sides: 4, aspect: 3 }]) {
      const measurement = await page.evaluate(async (brushShape) => {
        const painter = window.__painter;
        painter.update = () => {};
        const engine = painter.engine;
        if (engine.strokeActive) engine.endStroke();
        engine.clear();

        const rectangle = painter.paintingRectangle;
        // One big tap in the middle: the footprint only reads when brushSize is
        // large relative to splatRadius, which is the documented limitation.
        const x = rectangle.left + rectangle.width / 2;
        const y = rectangle.bottom + rectangle.height / 2;
        engine.beginStroke({
          timing: 'live', x, y, pressure: 1, brushSize: 220,
          paintingRectangle: rectangle,
          color: { space: 'pigment', channels: [1, 1, 1], alpha: 1 },
          ...(brushShape ? { brushShape } : {}),
        });
        engine.endStroke();
        // advance() takes a monotonic absolute clock, and each shape starts a
        // fresh one so the taps do not share a timeline.
        engine.resetClock(0);
        for (let i = 1; i <= 12; i++) engine.advance(i / 60);

        // readPaintTexture() is the engine's own regression seam. Alpha lives
        // in the 4th channel; collapse to a plain array so it crosses the
        // Playwright bridge as JSON.
        const { width, height, pixels } = engine.readPaintTexture();
        const alpha = new Array(width * height);
        for (let i = 0; i < width * height; i++) {
          alpha[i] = Math.round(Math.min(1, Math.max(0, pixels[i * 4 + 3])) * 255);
        }
        return { width, height, data: alpha };
      }, shape);

      // Radius profile around the centroid of the deposited alpha.
      const { width, height, data } = measurement;
      let cx = 0, cy = 0, total = 0;
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          const a = data[j * width + i];
          if (a > 0) { cx += i * a; cy += j * a; total += a; }
        }
      }
      assert.ok(total > 0, `shape ${JSON.stringify(shape)} deposited no paint`);
      cx /= total; cy /= total;

      const BINS = 180;
      const profile = new Array(BINS).fill(0);
      for (let j = 0; j < height; j++) {
        for (let i = 0; i < width; i++) {
          if (data[j * width + i] <= 8) continue; // ignore the faint fringe
          const dx = i - cx, dy = j - cy;
          const r = Math.hypot(dx, dy);
          let theta = Math.atan2(dy, dx);
          if (theta < 0) theta += 2 * Math.PI;
          const bin = Math.min(BINS - 1, Math.floor(theta / (2 * Math.PI) * BINS));
          profile[bin] = Math.max(profile[bin], r); // outer edge in this direction
        }
      }

      const sides = shape ? shape.sides : 0;
      const aspect = shape && shape.aspect ? shape.aspect : 1;
      const meanRadius = profile.reduce((s, v) => s + v, 0) / BINS;
      const record = {
        shape: shape ? `${sides}-gon${aspect !== 1 ? ` aspect=${aspect}` : ''}` : 'round',
        meanRadius: Number(meanRadius.toFixed(2)),
        h2: Number(harmonic(profile, 2).toFixed(4)),
        h3: Number(harmonic(profile, 3).toFixed(4)),
        h4: Number(harmonic(profile, 4).toFixed(4)),
        h5: Number(harmonic(profile, 5).toFixed(4)),
        h6: Number(harmonic(profile, 6).toFixed(4)),
        h8: Number(harmonic(profile, 8).toFixed(4)),
      };
      results.push(record);
      console.log(JSON.stringify(record));
    }
    assert.deepEqual(errors, []);

    const by = (name) => results.find((r) => r.shape === name);
    const round = by('round');

    // The round default must have no strong low-order harmonic.
    for (const n of [3, 4, 5, 6]) {
      assert.ok(round[`h${n}`] < 0.05,
        `round footprint has a strong ${n}-fold harmonic (${round[`h${n}`]})`);
    }

    /*
     * Each polygon's own harmonic must dominate the round baseline.
     *
     * The bound falls with side count because it has to: a regular n-gon
     * inscribed in a disc departs from it by 1 - cos(PI/n), which is 50% for a
     * triangle but only 7.6% for an octagon -- and splatRadius rounds the
     * corners on top of that. Measured amplitudes are roughly
     *   3: 0.25   4: 0.12   5: 0.077   6: 0.056   8: 0.018
     * so these thresholds sit just under each, and a footprint that silently
     * reverted to round (baseline ~0.005) still fails every one of them.
     */
    const minimumHarmonic = { 3: 0.15, 4: 0.08, 5: 0.05, 6: 0.035, 8: 0.012 };
    for (const n of [3, 4, 5, 6, 8]) {
      const polygon = by(`${n}-gon`);
      assert.ok(polygon[`h${n}`] > round[`h${n}`] * 3 && polygon[`h${n}`] > minimumHarmonic[n],
        `${n}-gon does not show a dominant ${n}-fold harmonic: ` + JSON.stringify(polygon));
    }

    // Aspect must stretch the footprint: a 3:1 square is strongly 2-fold.
    const stretched = by('4-gon aspect=3');
    assert.ok(stretched.h2 > by('4-gon').h2 * 3,
      'aspect did not elongate the footprint: ' + JSON.stringify(stretched));

    // brushSize must keep one meaning: area normalization means every shape
    // deposits a similar mean radius. Generous bound -- this catches a shape
    // painting at half size, not small differences from corner rounding.
    for (const record of results) {
      if (record.shape.includes('aspect')) continue;
      const ratio = record.meanRadius / round.meanRadius;
      assert.ok(ratio > 0.75 && ratio < 1.33,
        `${record.shape} mean radius ${record.meanRadius} is far from round ${round.meanRadius}`);
    }

    console.log('bristle shape: PASS (polygonal footprints, aspect, and size parity)');
  } finally {
    await browser.close();
    server.close();
  }
})();
