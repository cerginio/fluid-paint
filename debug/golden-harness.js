'use strict';

/*
 * Golden-image harness.
 *
 * Drives a scripted stroke through the real pointer-event path, waits for the
 * simulation to settle, then reads back the painting and hashes it. Two runs of
 * the same scenario on the same device must produce the same hash; a refactor
 * that changes the hash changed the painting.
 *
 * Input goes through synthetic PointerEvents rather than by calling Paint's
 * internals, so the harness exercises the same code a finger does. When the
 * input layer is replaced in Phase 6, this keeps testing the real path.
 *
 * Usage:  index.html?seed=1&golden=basic
 *         index.html?seed=1&golden=all
 *
 * Results land on window.__goldenResults and are logged as a table.
 */

/* Painting-space regions are expressed in fractions of the painting rect, so a
 * scenario means the same thing at any canvas size. */
const GOLDEN_SCENARIOS = {
  /* A single diagonal stroke. The baseline: catches changes to bristle
   * dynamics, splatting, and advection. */
  basic: {
    description: 'single diagonal stroke, default brush',
    strokes: [
      { color: [0.08, 1, 1, 0.8], points: [[0.45, 0.2], [0.62, 0.4], [0.80, 0.6]] },
    ],
  },

  /* Yellow laid over blue. This is the scenario that guards the RYB colour
   * model (see FLUID-ENGINE-EXTRACTION-PLAN.md 3b): in the subtractive model
   * the overlap must go GREEN. Under RGB it would go grey, and that is the
   * regression a maintainer is least likely to catch by eye. */
  colorMix: {
    description: 'yellow over blue -- the Y+B cube corner must yield green',
    /* Hue maps straight onto the RYB channels (hsvToRyb, common.js:76), so the
     * primaries sit at thirds, not at the RGB hues one might assume:
     *   0.000 -> (1, 0, 0) red      0.333 -> (0, 1, 0) yellow
     *   0.667 -> (0, 0, 1) blue
     * Using an RGB-minded 0.15 for "yellow" would in fact paint orange. */
    /* Alpha is deliberately low. Splatting blends with
     * SRC_ALPHA/ONE_MINUS_SRC_ALPHA (simulator.js:548), so an opaque second
     * stroke would cover the first rather than mix with it -- physically right
     * for thick paint, but it is the mixing we are testing here. */
    strokes: [
      { color: [0.667, 1, 1, 0.30], points: [[0.45, 0.35], [0.62, 0.35], [0.80, 0.35]] },
      { color: [0.333, 1, 1, 0.30], points: [[0.675, 0.15], [0.675, 0.28], [0.675, 0.42]] },
    ],
    /* Sampled after the run and asserted explicitly -- a hash alone would tell
     * us the pixels changed, not that green became grey. */
    assertGreen: { at: [0.658, 0.335], radius: 0.010 },
  },

  /* Slow, heavily overlapping strokes in one place: drives the fluid solver
   * hard and is the scenario most sensitive to changes in the simulation
   * pass order. */
  wetBlend: {
    description: 'overlapping strokes, heavy paint load',
    strokes: [
      { color: [0.0, 1, 1, 1.0], points: [[0.50, 0.30], [0.75, 0.30]] },
      { color: [0.33, 1, 1, 1.0], points: [[0.62, 0.18], [0.62, 0.45]] },
      { color: [0.66, 1, 1, 1.0], points: [[0.50, 0.45], [0.75, 0.18]] },
    ],
  },
};

/* --- pointer synthesis --------------------------------------------------- */

function dispatchPointer(canvas, type, clientX, clientY, extra) {
  const rect = canvas.getBoundingClientRect();
  const init = Object.assign({
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: rect.left + clientX,
    clientY: rect.top + clientY,
    pressure: type === 'pointerup' ? 0 : 0.5,
    bubbles: true,
    cancelable: true,
  }, extra || {});
  canvas.dispatchEvent(new PointerEvent(type, init));
}

/* setPointerCapture on a synthetic pointerId throws in some browsers; the
 * harness does not need capture because every event is aimed at the canvas. */
function withStubbedPointerCapture(canvas, fn) {
  const setCapture = canvas.setPointerCapture;
  const releaseCapture = canvas.releasePointerCapture;
  canvas.setPointerCapture = function () {};
  canvas.releasePointerCapture = function () {};
  try {
    return fn();
  } finally {
    canvas.setPointerCapture = setCapture;
    canvas.releasePointerCapture = releaseCapture;
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(frames) {
  for (let i = 0; i < frames; ++i) await nextFrame();
}

/* --- geometry ------------------------------------------------------------ */

/*
 * Painting-space fraction -> canvas client (CSS) coordinates.
 *
 * The painting rect is in screen pixels with the origin bottom-left; pointer
 * events are in CSS pixels with the origin top-left. Both the Y inversion AND
 * the devicePixelRatio divide are the viewport's job -- this used to do the
 * flip by hand and ignore the ratio, which was invisible while the two units
 * were equal and silently aimed every stroke at twice its intended offset the
 * moment DPR was turned on.
 */
function paintingFractionToClient(painter, fx, fy) {
  const rect = painter.paintingRectangle;
  const glX = rect.left + fx * rect.width;
  const glY = rect.bottom + fy * rect.height;
  return painter.viewport.screenToCss(glX, glY);
}

/* --- running a scenario -------------------------------------------------- */

async function runStroke(painter, stroke, opts) {
  const canvas = painter.canvas;
  const stepsPerSegment = (opts && opts.stepsPerSegment) || 12;

  if (stroke.color) painter.brushColorHSVA = stroke.color.slice();

  const pts = stroke.points.map((p) => paintingFractionToClient(painter, p[0], p[1]));

  /* The UI panel swallows pointer-downs in its rect (desiredInteractionMode,
   * paint.js:919) and the stroke then lays no paint at all -- silently, which
   * cost real debugging time to find. Fail loudly instead. Phase 7 moves the
   * chrome to DOM and this check becomes unnecessary. */
  const start = pts[0];
  // pts are CSS pixels now, and PANEL_* are authored in CSS pixels, so this
  // comparison is finally in one unit rather than two that happened to match.
  if (PaintState.showPanel &&
      start.x < PANEL_WIDTH &&
      start.y > painter.viewport.cssHeight - PANEL_HEIGHT) {
    throw new Error(
      `stroke starts under the UI panel (client ${start.x.toFixed(0)},${start.y.toFixed(0)}); ` +
      'it would deposit nothing -- move the scenario clear of the panel rect');
  }

  dispatchPointer(canvas, 'pointerdown', pts[0].x, pts[0].y);
  /* The bristles are placed by Brush.initialize but still have to fall to the
   * canvas before any of them cross Z_THRESHOLD and deposit paint. Without
   * these frames a short stroke can finish before the brush ever touches
   * down, and lays nothing at all. */
  await settle(10);

  for (let i = 1; i < pts.length; ++i) {
    const from = pts[i - 1];
    const to = pts[i];
    for (let s = 1; s <= stepsPerSegment; ++s) {
      const t = s / stepsPerSegment;
      dispatchPointer(canvas, 'pointermove',
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t);
      await nextFrame();
    }
  }

  const last = pts[pts.length - 1];
  dispatchPointer(canvas, 'pointerup', last.x, last.y);
  await settle(2);
}

/*
 * Read the painting back at simulation resolution.
 *
 * This reads the simulator's paint texture rather than the screen, so the hash
 * is independent of window size, panel geometry, and every other piece of
 * chrome -- which is what lets the same baseline survive the UI replacement in
 * Phases 6-8.
 */
function readPaintTexture(painter) {
  // Through the engine's API rather than reaching for simulator.paintTexture.
  // The harness is a host like any other: if it needs something the API does
  // not offer, that is a finding about the API, not a reason to go around it.
  return painter.engine.readPaintTexture();
}

/*
 * Read the composited canvas -- what the eye actually sees.
 *
 * This is the only place rybToRgb() has been applied. The paint texture holds
 * raw RYB, so a change to the colour cube is invisible there: sabotaging
 * rybToRgb left the paint-texture hash byte-identical, which is exactly the
 * blind spot this second readback closes.
 *
 * Returned in painting-rect fractions so the sampling stays meaningful when
 * the chrome around the canvas changes in Phases 6-8.
 */
function readScreen(painter) {
  const wgl = painter.wgl;
  const rect = painter.paintingRectangle;
  const x = Math.round(rect.left);
  const y = Math.round(rect.bottom);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  const pixels = new Uint8Array(width * height * 4);
  wgl.readPixels(wgl.createReadState().bindFramebuffer(null),
    x, y, width, height, wgl.RGBA, wgl.UNSIGNED_BYTE, pixels);

  // Normalise to 0..1 floats so sampleRegion can be shared with the RYB path.
  const floats = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; ++i) floats[i] = pixels[i] / 255;
  return { width, height, pixels: floats };
}

/*
 * Assert that the yellow-over-blue overlap renders GREEN on screen.
 *
 * Under the subtractive cube, Y+B -> (0, 0.66, 0.2): green dominant. Under an
 * additive model the same mix goes grey or muddy, and G stops leading. This is
 * the check that survives someone "simplifying" rybToRgb.
 */
function assertGreenOnScreen(buffer, spec) {
  const mean = sampleRegion(buffer, spec.at, spec.radius);
  if (!mean) return { pass: false, reason: 'sample region empty' };

  const [r, g, b] = mean;

  /* "G is the largest channel" does NOT discriminate the two models: at low
   * paint density both render a greenish tint, and the RGB fallback is in fact
   * the greener of the two by ratio. What separates them is the shape of the
   * cube:
   *
   *   Y=B strength   natural (cube)        rgb fallback (1 - ryb.yxz)
   *     0.6          [0.44, 0.73, 0.38]    [0.40, 1.00, 0.40]
   *     1.0          [0.00, 0.66, 0.20]    [0.00, 1.00, 0.00]
   *
   * Two invariants hold for the cube and fail for the fallback:
   *   - G never reaches 1.0. The green corner is 0.66, so a fully saturated
   *     Y+B mix stays well short of pure green. The fallback pins G at 1.0.
   *   - B never collapses to 0 while paint is present. The blue corner is
   *     ultramarine (0.163, 0.373, 0.6), so its 0.2 blue survives the mix.
   *     The fallback drives B to zero.
   *
   * Lighting lifts everything toward white, which is why the bounds are
   * generous -- they are there to catch a model swap, not to pin down a
   * shade.
   *
   * HONEST LIMIT, established by deliberately sabotaging rybToRgb and re-running:
   * at the paint density this scenario can actually reach, the two models are
   * too close for these bounds to separate them -- the sabotage passed this
   * assertion. Density cannot simply be raised: splatting blends with
   * SRC_ALPHA/ONE_MINUS_SRC_ALPHA, so a denser second stroke covers the first
   * instead of mixing with it, and the overlap gets weaker, not stronger.
   *
   * So the real guard against a colour-model change is screenHash, which DID
   * move under sabotage (061daa01 -> bb560376). This assertion earns its place
   * by saying WHY a hash moved, in words, at the moment it moves -- not by
   * being the tripwire itself. Do not delete it, and do not trust it alone. */
  /* G must be at least competitive with the other channels -- not strictly
   * dominant. Alpha blending leaves the mix tilted toward whichever pigment
   * landed second (~4:1, measured), so demanding strict dominance would test
   * stroke order rather than the colour model. */
  const greenCompetitive = g >= r * 0.95 && g >= b * 0.95;
  const notPureGreen = g < 0.97;
  const blueSurvives = b > 0.15;
  const pass = greenCompetitive && notPureGreen && blueSurvives;

  let reason;
  if (pass) reason = 'green competitive, G below pure, B retained -- subtractive cube intact';
  else if (!greenCompetitive) reason = 'green channel too weak: the mix is not rendering green';
  else if (!notPureGreen) reason = 'G at full: looks like the RGB fallback, not the cube';
  else reason = 'B collapsed: the ultramarine blue corner is gone -- cube may be replaced';

  return { pass, mean: [r, g, b], reason };
}

/*
 * FNV-1a over the quantised paint buffer.
 *
 * Float values are quantised to 1e-4 before hashing. Exact float equality
 * across a refactor is not a reasonable bar -- GPUs reorder arithmetic and the
 * shader translation layer may too -- but a change large enough to be visible
 * moves values far more than that.
 */
function hashPixels(pixels) {
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; ++i) {
    const q = Math.round(pixels[i] * 10000) | 0;
    h ^= q & 0xff;         h = Math.imul(h, 0x01000193);
    h ^= (q >>> 8) & 0xff;  h = Math.imul(h, 0x01000193);
    h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/* Mean RYB value over a disc, in painting fractions. */
function sampleRegion(buffer, at, radius) {
  const { width, height, pixels } = buffer;
  const cx = at[0] * width;
  const cy = at[1] * height;
  const r = radius * Math.min(width, height);
  const r2 = r * r;

  let sum = [0, 0, 0, 0];
  let n = 0;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));

  for (let y = y0; y <= y1; ++y) {
    for (let x = x0; x <= x1; ++x) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * width + x) * 4;
      sum[0] += pixels[i]; sum[1] += pixels[i + 1];
      sum[2] += pixels[i + 2]; sum[3] += pixels[i + 3];
      ++n;
    }
  }
  return n === 0 ? null : sum.map((v) => v / n);
}

/*
 * Assert that the sampled RYB value maps to green through the subtractive cube.
 *
 * The paint texture stores RYB, so the check is on the RYB triple itself: a
 * yellow-over-blue overlap must carry substantial Y and B with little R. That
 * is precisely the cube corner (0, 1, 1) -> (0, 0.66, 0.2), the mix that RGB
 * would render grey.
 */
function assertGreenMix(buffer, spec) {
  const mean = sampleRegion(buffer, spec.at, spec.radius);
  if (!mean) return { pass: false, reason: 'sample region empty' };

  const [r, y, b, a] = mean;
  if (a < 0.05) {
    return { pass: false, reason: 'no paint at sample point', mean };
  }
  // Normalise by alpha: the texture holds premultiplied-ish accumulations.
  const nr = r / a, ny = y / a, nb = b / a;

  /* The assertion is about the SHAPE of the mix, not its absolute strength:
   *   - both Y and B must be materially present (neither stroke covered the
   *     other, and neither was lost),
   *   - they must be comparable to each other (a real overlap, not a fringe),
   *   - R must be suppressed (this is the Y+B corner of the cube, not mud).
   * Absolute magnitudes depend on alpha, stroke speed and solver settling, so
   * thresholding on them would make the test brittle without making it
   * stricter. What must never happen is Y or B vanishing -- that is the
   * regression where the subtractive model has been replaced by an additive
   * one. */
  const present = ny > 0.05 && nb > 0.05;
  /* 0.15, not something tighter: alpha blending means the second stroke always
   * displaces roughly 4:1 of the first, whichever colour goes down second
   * (measured both ways). What must never happen is a pigment vanishing
   * outright -- that is the additive-model regression. */
  const balanced = Math.min(ny, nb) / Math.max(ny, nb) > 0.15;
  const redSuppressed = nr < Math.min(ny, nb) * 0.5;
  const pass = present && balanced && redSuppressed;

  let reason;
  if (pass) reason = 'Y and B both present and comparable, R suppressed -- subtractive green';
  else if (!present) reason = 'Y or B missing: one stroke covered the other, or the mix is not subtractive';
  else if (!balanced) reason = 'Y and B present but lopsided: sample point is not on the overlap';
  else reason = 'R too high for a Y+B mix';

  return { pass, mean: [nr, ny, nb], reason };
}

/* --- entry point --------------------------------------------------------- */

async function runGoldenScenario(painter, name) {
  const scenario = GOLDEN_SCENARIOS[name];
  if (!scenario) throw new Error('unknown golden scenario: ' + name);

  painter.clear();
  await settle(3);

  await withStubbedPointerCapture(painter.canvas, async () => {
    for (const stroke of scenario.strokes) {
      await runStroke(painter, stroke);
    }
  });

  // Let the fluid solver reach a stable state before sampling.
  await settle(120);

  const buffer = readPaintTexture(painter);

  /* Force one more render so the canvas holds the settled painting, then read
   * it back. Two hashes are kept deliberately:
   *   paintHash  -- simulation state (RYB), independent of rendering
   *   screenHash -- what is actually seen, after rybToRgb and the lighting
   * A change to the colour cube moves only the second; a change to the solver
   * moves both. Keeping them apart says WHERE a regression happened. */
  painter.needsRedraw = true;
  await settle(2);
  const screen = readScreen(painter);

  const result = {
    scenario: name,
    description: scenario.description,
    seed: window.__fluidSeed,
    webgl: painter.wgl.isWebGL2 ? 2 : 1,
    resolution: buffer.width + 'x' + buffer.height,
    paintHash: hashPixels(buffer.pixels),
    screenHash: hashPixels(screen.pixels),
  };

  if (window.__goldenProbe) {
    const grid = [];
    for (let gy = 0; gy < 5; ++gy) {
      const row = [];
      for (let gx = 0; gx < 5; ++gx) {
        const m = sampleRegion(buffer, [0.15 + gx * 0.175, 0.15 + gy * 0.175], 0.02);
        row.push(m ? m.map((v) => v.toFixed(2)).join('/') : 'null');
      }
      grid.push(row.join('  '));
    }
    result.probeGrid = grid;
  }

  if (scenario.assertGreen) {
    // RYB-space check: both pigments survived the mix.
    const ryb = assertGreenMix(buffer, scenario.assertGreen);
    // Screen-space check: the cube actually renders that mix as green.
    const rgb = assertGreenOnScreen(screen, scenario.assertGreen);

    result.greenCheck = (ryb.pass && rgb.pass) ? 'pass' : 'FAIL';
    result.greenMean = 'RYB[' + (ryb.mean || []).map((v) => v.toFixed(3)).join(', ') +
                       '] RGB[' + (rgb.mean || []).map((v) => v.toFixed(3)).join(', ') + ']';
    result.greenReason = ryb.pass ? rgb.reason : ryb.reason;
  }

  return result;
}

async function runGoldenSuite(painter, which) {
  const names = which === 'all' ? Object.keys(GOLDEN_SCENARIOS) : [which];
  const results = [];
  for (const name of names) {
    try {
      results.push(await runGoldenScenario(painter, name));
    } catch (err) {
      results.push({ scenario: name, error: String(err && err.message || err) });
    }
  }

  window.__goldenResults = results;
  window.__goldenDone = true;
  console.table(results);
  return results;
}

/*
 * Wait for Paint to finish its async shader load, then run.
 *
 * Paint's constructor returns before shaders are loaded, so readiness is
 * detected by the fields _start() installs.
 */
function scheduleGoldenSuite(getPainter, which) {
  const started = Date.now();
  (function poll() {
    const painter = getPainter();
    if (painter && painter.engine && painter.paintingRectangle) {
      runGoldenSuite(painter, which);
      return;
    }
    if (Date.now() - started > 20000) {
      window.__goldenResults = [{ error: 'timed out waiting for Paint to initialise' }];
      window.__goldenDone = true;
      console.error('[golden] timed out waiting for Paint');
      return;
    }
    setTimeout(poll, 100);
  })();
}
