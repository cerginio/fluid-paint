'use strict';

/*
 * ryb.js -- the pigment colour space, in JavaScript, for the UI.
 *
 * The simulation is subtractive (David Li's RYB pigment cube): a picked hue's
 * RGB->RYB->RGB round trip is NOT identity, so an RGB-native widget (iro.js)
 * names the wrong colour unless corrected here. Full contract, the measured
 * divergence and why: docs/COLOR-PICKER-PAINT-PARITY-SPEC.md.
 * debug/color-parity-test.js is the durable guard; run it after touching this.
 *
 * This is a RENDERING aid only -- `paint.js` still calls `hsvToRyb()` from
 * common.js and hands the RYB triple to `splat()` untouched. Every UI surface
 * (disc, handles, sliders, strip, brush preview) must go through
 * `hsvToPigmentRgb()` below rather than inventing its own mapping.
 *
 * AXIS NAMES: the cube's channels are RED, BLUE, YELLOW in that order --
 * `(0,1,0)` is slate blue, not green. Do not swap channels to match the
 * acronym; the shader does not, and the corners below must stay byte-identical
 * to `fluid-engine/shaders/painting.frag:34-48` (see `assertMatchesShader()`).
 *
 * `(0,0,0)` is white colour DATA, not absence of paint -- alpha carries amount.
 * The cube has no pure-black corner; `?black=1` deepens `(1,1,1)` to `(0,0,0)`
 * via `setPigmentBlack()` and must match the value the ENGINE was built with.
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

/* The same cube with its all-three-pigments corner deepened to true black.
 * THIS IS THE DEFAULT -- see `activeCube` below.
 *
 * David Li's cube above has no black anywhere: v111 is its darkest point and
 * the lighting term only brightens, so a picker built on it cannot offer a
 * black at all. The corner is swapped at BOTH boundaries -- painting.frag
 * takes it as the u_pigmentBlack uniform, and setPigmentBlack() points the UI
 * at the matching value. The two must agree, or the widget goes back to
 * describing a colour the brush will not deposit, which is the whole failure
 * this file exists to prevent. */
const RYB_CUBE_BLACK = Object.assign({}, RYB_CUBE, { v111: [0.0, 0.0, 0.0] });

/* Which cube the UI is drawing.
 *
 * Defaults to the black-corner cube, matching FluidEngine's own default, so a
 * host that never calls setPigmentBlack() still gets a widget that agrees with
 * its paint. Getting these two defaults out of step is display/paint
 * divergence by another route -- the probe asserts they match. */
let activeCube = RYB_CUBE_BLACK;

/**
 * Point the UI's conversion at David Li's original cube, or back at the
 * black-corner default.
 *
 * Call this before anything renders, with the SAME value the engine was
 * constructed with. The engine fixes its corner at construction, so flipping
 * this alone would desynchronize display from paint.
 *
 * @param {boolean} enabled  true (the default) for the true-black corner
 */
function setPigmentBlack(enabled) {
  activeCube = enabled ? RYB_CUBE_BLACK : RYB_CUBE;
}

/** True while the true-black corner is active. */
function isPigmentBlack() {
  return activeCube === RYB_CUBE_BLACK;
}

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
  return trilinearInterpolate(ryb, activeCube);
}

/**
 * The whole chain, HSV -> the colour the widget should show: exactly the two
 * steps the paint takes (`hsvToRyb` then `rybToRgbDisplay`), nothing else. Do
 * not multiply by value, add white, or invert afterward -- that makes the
 * widget describe a colour the brush will not deposit.
 *
 * Because `hsvToRyb()` is additive outputs reinterpreted as ink, desaturating
 * piles on all three pigments and lands near the cube's dark-brown corner: the
 * disc's centre (v=1) is dark brown, not white, and value=0 is white, not
 * black. These are properties of the selection mapping, not display bugs --
 * do NOT paint a white-centre/black-zero overlay back on top to "fix" them;
 * that reintroduces the exact divergence this function closes. A conventional
 * white-centre picker is a separate selection-model redesign, not a rendering
 * fix. See docs/COLOR-PICKER-PAINT-PARITY-SPEC.md.
 *
 * @param {number} h  hue, 0..1
 * @param {number} s  saturation, 0..1
 * @param {number} v  value, 0..1
 * @param {boolean} additive  the Digital/Natural toggle
 * @returns {number[]} rgb, 0..1
 */
function hsvToPigmentRgb(h, s, v, additive) {
  return rybToRgbDisplay(hsvToRyb(h, s, v), additive);
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
 * Guards against the corners above (duplicated from GLSL this file cannot
 * import) silently drifting from the shader -- parses the numbers back out of
 * the shader source and compares. The probe calls it with the loaded shader
 * text.
 *
 * The eighth corner (black pigment) is a `u_pigmentBlack` UNIFORM in
 * painting.frag, not a literal, so it has no number in the shader body to
 * compare -- its authoritative value lives in `fluid-engine/renderer.js`
 * instead, passed as `rendererSource`. Omitting it checks the first seven and
 * reports the eighth as unverified rather than silently passing on it.
 *
 * @param {string} shaderSource  the text of painting.frag or picker.frag
 * @param {string} [rendererSource]  the text of fluid-engine/renderer.js
 * @returns {{ok: boolean, reason?: string}}
 */
function assertMatchesShader(shaderSource, rendererSource) {
  const body = /rybToRgb\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(shaderSource);
  if (!body) return { ok: false, reason: 'no rybToRgb() found in shader source' };

  // Every vec3(...) literal in the function body, in source order. The first
  // argument to trilinearInterpolate is `ryb` itself, not a literal, so these
  // are the corners in the shader's own order -- all eight in picker.frag,
  // seven in painting.frag where the last one became a uniform.
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

  /* The uniform case: seven literals plus u_pigmentBlack in the last slot. The
   * corner still has to be verified -- it just lives in JS now -- so pull both
   * of the renderer's declared values and require that they match this file's
   * two cubes. A drift there is the same failure as a drifted literal. */
  if (found.length === expected.length - 1 && /u_pigmentBlack/.test(body[1])) {
    if (rendererSource === undefined) {
      return {
        ok: false,
        reason: 'v111 is the u_pigmentBlack uniform; pass renderer.js source to verify it',
      };
    }
    const readCorner = (name) => {
      const decl = new RegExp(name + '\\s*=\\s*\\[\\s*([-\\d.]+)\\s*,\\s*([-\\d.]+)\\s*,\\s*([-\\d.]+)\\s*\\]')
        .exec(rendererSource);
      return decl ? [parseFloat(decl[1]), parseFloat(decl[2]), parseFloat(decl[3])] : null;
    };
    const pairs = [
      ['PIGMENT_CORNER_DAVID_LI', RYB_CUBE.v111],
      ['PIGMENT_CORNER_BLACK', RYB_CUBE_BLACK.v111],
    ];
    for (const [name, want] of pairs) {
      const got = readCorner(name);
      if (!got) return { ok: false, reason: 'no ' + name + ' found in renderer source' };
      for (let c = 0; c < 3; c++) {
        if (Math.abs(got[c] - want[c]) > 1e-6) {
          return {
            ok: false,
            reason: name + ' channel ' + c + ': renderer ' + got[c] + ', JS ' + want[c],
          };
        }
      }
    }
    // The remaining seven are compared below against the same-length prefix.
    expected.length = found.length;
  }

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
