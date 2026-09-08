'use strict';

/*
 * ryb.js -- the pigment colour space, in JavaScript, for the UI.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * The simulation is subtractive. A hue chosen by the user takes this path:
 *
 *     HSV --hsvToRyb()--> RYB --rybToRgb()--> what you see on the canvas
 *          (common.js)          (painting.frag)
 *
 * `hsvToRyb()` is the ordinary sexagesimal HSV->RGB formula whose three outputs
 * are then *reinterpreted* as Red/Yellow/Blue pigment loads. That is David Li's
 * trick and it is deliberate. The consequence is the part that bites: the pair
 * is NOT a round trip. Hue is not preserved from end to end.
 *
 *     picked 240deg (blue)   -> RYB (0,0,1) -> paints #ffff00, pure YELLOW
 *     picked  60deg (yellow) -> RYB (1,1,0) -> paints #800080, purple
 *     picked 120deg (green)  -> RYB (0,1,0) -> paints #2a5f99, slate blue
 *
 * Only red is a fixed point; the wheel sits about 120deg away from the pigment
 * for everything else. An RGB-native picker therefore does not merely look
 * slightly off -- it names the wrong colour. Phase 8 mounted iro.js, which is
 * RGB-native, and that is the mismatch this file closes.
 *
 * The old GL picker had this right. `app/shaders/picker.frag:52` reads:
 *
 *     vec3 hsvToRgb (vec3 hsv) { return rybToRgb(hsv2ryb(hsv)); }
 *
 * -- every swatch it drew went through the SAME two steps the paint takes, so
 * the ring showed pigment rather than light. That file is kept as the reference
 * for this one. The eight cube corners and the trilinear weights below are
 * transcribed from `picker.frag:17-43`, which are in turn identical to the
 * engine's `fluid-engine/shaders/painting.frag:34-48`. All three must agree;
 * see `assertMatchesShader()` at the bottom, which checks the corners against
 * the shader source rather than trusting that they still do.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS NOT
 * ---------------------------------------------------------------------------
 *
 * This is a RENDERING aid for the UI only. Nothing here is on the paint path --
 * `paint.js` still calls `hsvToRyb()` from `common.js` and hands the RYB triple
 * to `splat()` untouched. The golden hashes prove that: if any of this leaked
 * inward they would move. This file only answers the question "what colour
 * should this pixel of the WIDGET be", which the widget was previously
 * answering in the wrong colour space.
 *
 * It also does not change which hue the user picks. Hue stays the app's 0..1
 * `brushColorHSVA[0]`; only its on-screen swatch changes.
 */

/** The eight corners of David Li's RYB pigment cube.
 *  Transcribed from picker.frag:36-43 / painting.frag:38-46 -- the argument
 *  order there is v000,v100,v010,v001,v101,v011,v110,v111, which is NOT
 *  lexicographic, so they are named here rather than listed positionally. */
const RYB_CUBE = {
  v000: [1.0, 1.0, 1.0],       // no pigment -- white paper
  v100: [1.0, 0.0, 0.0],       // red
  v010: [0.163, 0.373, 0.6],   // blue  (the middle axis is blue in this order)
  v001: [1.0, 1.0, 0.0],       // yellow
  v101: [1.0, 0.5, 0.0],       // red + yellow  -> orange
  v011: [0.0, 0.66, 0.2],      // blue + yellow -> green
  v110: [0.5, 0.0, 0.5],       // red + blue    -> purple
  v111: [0.2, 0.094, 0.0],     // all three     -> near-black brown
};

/** Trilinear interpolation over the cube. Mirrors picker.frag:17-26 term for
 *  term; the weights are written in the same order so the two can be diffed. */
function trilinearInterpolate(p, c) {
  const x = p[0], y = p[1], z = p[2];
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] =
      c.v000[i] * (1 - x) * (1 - y) * (1 - z) +
      c.v100[i] * x * (1 - y) * (1 - z) +
      c.v010[i] * (1 - x) * y * (1 - z) +
      c.v001[i] * (1 - x) * (1 - y) * z +
      c.v101[i] * x * (1 - y) * z +
      c.v011[i] * (1 - x) * y * z +
      c.v110[i] * x * y * (1 - z) +
      c.v111[i] * x * y * z;
  }
  return out;
}

/**
 * RYB pigment loads -> displayable RGB. The JS twin of `rybToRgb()` in
 * painting.frag, including its `#ifdef RGB` branch.
 *
 * @param {number[]} ryb  three pigment loads, 0..1
 * @param {boolean}  additive  true for the Digital (RGB) model, which is the
 *   shader's `#ifdef RGB` path: `1.0 - ryb.yxz`. Note the SWIZZLE -- it is not
 *   a plain inversion, and dropping it is a silent channel swap.
 * @returns {number[]} rgb, 0..1, not yet clamped
 */
function rybToRgbDisplay(ryb, additive) {
  if (additive) {
    return [1 - ryb[1], 1 - ryb[0], 1 - ryb[2]];
  }
  return trilinearInterpolate(ryb, RYB_CUBE);
}

/**
 * The pure-hue pigment LOAD for a hue, scaled by saturation.
 *
 * This is the sexagesimal ramp WITHOUT the `m = v - c` white term that
 * `hsvToRyb()` adds. That term is the whole reason a naive
 * `rybToRgbDisplay(hsvToRyb(...))` renders the wheel wrong at its edges, and
 * the reason is worth stating plainly, because it is the opposite of the RGB
 * intuition:
 *
 *   In a SUBTRACTIVE space the channels are how much INK is on the paper.
 *   Zero is not black, it is BLANK PAPER -- the cube's v000 corner is white.
 *   Full load on all three is v111, a near-black brown.
 *
 * `hsvToRyb()` is an additive formula, so it raises all three channels toward
 * 1 as a colour desaturates. Read as ink that means "pile on every pigment",
 * which lands on v111. Hence the two bugs this fixes:
 *
 *   - towards the wheel's CENTRE (s -> 0) it went BLACK instead of white
 *   - the value slider ran BACKWARDS: v=0 gave white (no ink), v=1 the colour
 *
 * The right model is the one a painter would describe: saturation is HOW MUCH
 * pigment (0 = none = paper), and value darkens the mixed result toward black.
 * So saturation scales the load, and value multiplies the resulting colour.
 *
 * @param {number} h  hue, 0..1
 * @param {number} s  saturation, 0..1
 * @returns {number[]} R/Y/B pigment loads, 0..1
 */
function hueToPigmentLoad(h, s) {
  const hDash = ((h % 1) + 1) % 1 * 6;   // guard against a negative hue
  const x = 1 - Math.abs(hDash % 2 - 1);
  const i = Math.floor(hDash) % 6;

  // The six sectors of the ramp, as (R, Y, B) loads at full saturation.
  const ramp = [
    [1, x, 0], [x, 1, 0], [0, 1, x],
    [0, x, 1], [x, 0, 1], [1, 0, x],
  ][i];

  return [ramp[0] * s, ramp[1] * s, ramp[2] * s];
}

/**
 * The whole chain, HSV -> the colour the widget should show.
 *
 * NOT `rybToRgbDisplay(hsvToRyb(h, s, v))`. That composition looks right and is
 * wrong away from full saturation and value -- see `hueToPigmentLoad()` above
 * for why, and for the two visible bugs it caused.
 *
 * This deliberately does NOT call `hsvToRyb()`. That function is the paint
 * path's, and it is correct there: `paint.js` hands its output to `splat()` as
 * the pigment to deposit, and the user only ever picks a colour whose s and v
 * are already baked into the choice. Display has a different job -- rendering
 * the whole s/v space, including its blank-paper and black ends -- so it needs
 * its own mapping rather than a reinterpretation of that one.
 *
 * At s=1, v=1 the two agree exactly, which is what keeps the wheel's rim
 * showing the same colours the brush deposits.
 *
 * @param {number} h  hue, 0..1
 * @param {number} s  saturation, 0..1
 * @param {number} v  value, 0..1
 * @param {boolean} additive  the Digital/Natural toggle
 * @returns {number[]} rgb, 0..1
 */
function hsvToPigmentRgb(h, s, v, additive) {
  const rgb = rybToRgbDisplay(hueToPigmentLoad(h, s), additive);
  // Value darkens the MIXED result. Doing it to the load instead would mean
  // "less ink", which is lighter -- the inversion this whole function fixes.
  return [rgb[0] * v, rgb[1] * v, rgb[2] * v];
}

/** 0..1 rgb -> a CSS rgb() string, clamped and rounded. The cube can return a
 *  channel a hair outside 0..1, and one out-of-range channel silently drops the
 *  whole CSS declaration rather than erroring. */
function cssRgb(rgb) {
  const r = Math.round(Math.max(0, Math.min(1, rgb[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, rgb[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, rgb[2])) * 255);
  return 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

/** Convenience: the pigment CSS colour for an HSV triple, all 0..1. */
function cssPigment(h, s, v, additive) {
  return cssRgb(hsvToPigmentRgb(h, s, v, additive));
}

/**
 * Guard against the copies of the cube drifting apart.
 *
 * The corners above are duplicated from GLSL this file cannot import. A copy
 * that silently stops matching is exactly the failure that makes the widget lie
 * again, so this parses the numbers back out of the shader source and compares.
 * The probe calls it with the loaded shader text.
 *
 * @param {string} shaderSource  the text of painting.frag or picker.frag
 * @returns {{ok: boolean, reason?: string}}
 */
function assertMatchesShader(shaderSource) {
  const body = /rybToRgb\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(shaderSource);
  if (!body) return { ok: false, reason: 'no rybToRgb() found in shader source' };

  // Every vec3(...) literal in the function body, in source order. The first
  // argument to trilinearInterpolate is `ryb` itself, not a literal, so these
  // are exactly the eight corners in the shader's own order.
  const found = [];
  const vec3 = /vec3\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g;
  let m;
  while ((m = vec3.exec(body[1])) !== null) {
    found.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
  }

  const expected = [
    RYB_CUBE.v000, RYB_CUBE.v100, RYB_CUBE.v010, RYB_CUBE.v001,
    RYB_CUBE.v101, RYB_CUBE.v011, RYB_CUBE.v110, RYB_CUBE.v111,
  ];

  if (found.length !== expected.length) {
    return {
      ok: false,
      reason: 'shader has ' + found.length + ' corners, JS has ' + expected.length,
    };
  }
  for (let i = 0; i < expected.length; i++) {
    for (let c = 0; c < 3; c++) {
      if (Math.abs(found[i][c] - expected[i][c]) > 1e-6) {
        return {
          ok: false,
          reason: 'corner ' + i + ' channel ' + c +
            ': shader ' + found[i][c] + ', JS ' + expected[i][c],
        };
      }
    }
  }
  return { ok: true };
}
