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
 *
 * ---------------------------------------------------------------------------
 * THE PARITY CONTRACT
 * ---------------------------------------------------------------------------
 *
 * Being a rendering aid does NOT license a second mapping. Every UI surface --
 * disc, handles, sliders, compact strip, brush preview -- must show the colour
 * the brush will actually deposit, which means exactly:
 *
 *     const pigment    = hsvToRyb(h, s, v);
 *     const displayRgb = rybToRgbDisplay(pigment, additive);
 *
 * `hsvToPigmentRgb()` below is precisely that composition. An earlier version
 * was not, and the widget consequently agreed with the paint only on the rim.
 * See that function's comment for the measured divergence, and
 * docs/COLOR-PICKER-PAINT-PARITY-SPEC.md for the full contract.
 * debug/color-parity-test.js is the durable guard; run it after touching this.
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE AXIS NAMES
 * ---------------------------------------------------------------------------
 *
 * The cube's axes are numerically RED, BLUE, YELLOW -- in that channel order.
 * `(1,0,0)` is red, `(0,1,0)` is slate blue, `(0,0,1)` is yellow. The acronym
 * "RYB" does not read literally off the channel indices. Do not swap channels
 * to make it; the shader does not, and the two must agree.
 *
 * `(0,0,0)` is white colour DATA, not absence of paint: a splat with nonzero
 * alpha and zero pigment deposits white paint. Colour and amount are separate.
 *
 * David Li's cube has no pure-black corner -- `(1,1,1)` is `(0.2, 0.094, 0)`,
 * its darkest reachable point, and the lighting term only brightens. So the
 * stock picker has no black to offer at all. The `?black=1` feature flag
 * deepens that one corner to `(0,0,0)`; see `setPigmentBlack()` below. It must
 * be set to match the value the ENGINE was constructed with.
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
 * The whole chain, HSV -> the colour the widget should show.
 *
 * This is EXACTLY the two steps the paint takes, and nothing else:
 *
 *     hsvToRyb(h, s, v)    -- common.js, the same call paint.js makes
 *     rybToRgbDisplay(...) -- the JS twin of the shader's rybToRgb
 *
 * Do not multiply the result by value, add white, or invert it afterward. Any
 * such step makes the widget describe a colour the brush will not deposit.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACED, AND WHY THE OLD REASONING WAS WRONG
 * ---------------------------------------------------------------------------
 *
 * An earlier version used a separate `hueToPigmentLoad(h, s)` ramp and then
 * multiplied the converted RGB by value, on the reasoning that display has "a
 * different job" from paint: rendering the whole s/v space, blank-paper and
 * black ends included. That reasoning conflated two questions -- what the
 * selection model OUGHT to be, and what it IS -- and answered the first while
 * the paint went on answering the second.
 *
 * The result agreed with the brush only on the rim at s=1,v=1, where the two
 * mappings coincide. Everywhere else it lied, and rim checks could not see it.
 * Measured at hue 0 (see debug/color-parity-test.js):
 *
 *     selection      old widget        actual paint
 *     s=0,   v=1     (255,255,255)     ( 51, 24,  0)   dark brown, not white
 *     s=1,   v=0     (  0,  0,  0)     (255,255,255)   white, not black
 *     s=1,   v=0.5   (128,  0,  0)     (255,128,128)   pink, not dark red
 *     s=0.5, v=1     (255,128,128)     (172, 38, 32)   dark red, not pink
 *
 * The third row is the reported "pink paint, dark-red bristles"; the first two
 * are the apparent black/white inversion.
 *
 * ---------------------------------------------------------------------------
 * THE CONSEQUENCES ARE INTENDED
 * ---------------------------------------------------------------------------
 *
 * `hsvToRyb()` is an additive formula whose outputs are reinterpreted as ink,
 * so desaturating raises ALL THREE loads toward 1 -- "pile on every pigment" --
 * which lands on the cube's v111 near-black brown. So, honestly:
 *
 *   - the disc's CENTRE at v=1 is dark brown, not white
 *   - the zero end of the value coordinate is WHITE, not black
 *
 * These are properties of the existing selection mapping, not display errors.
 * The compatibility policy preserves existing HSVA selections and the pigment
 * they deposit, so they stay. Do NOT restore a white centre or a black zero end
 * by painting an unrelated RGB overlay over the disc -- that reintroduces the
 * exact divergence this function exists to close. A conventional white-centre
 * picker is a separate selection-model redesign, not a rendering fix.
 *
 * See docs/COLOR-PICKER-PAINT-PARITY-SPEC.md.
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
 * Guard against the copies of the cube drifting apart.
 *
 * The corners above are duplicated from GLSL this file cannot import. A copy
 * that silently stops matching is exactly the failure that makes the widget lie
 * again, so this parses the numbers back out of the shader source and compares.
 * The probe calls it with the loaded shader text.
 *
 * The eighth corner is a special case. Since the black-pigment flag it is a
 * `u_pigmentBlack` UNIFORM in painting.frag rather than a literal, so there is
 * no number in the shader body to compare against. Its authoritative values
 * live in `fluid-engine/renderer.js` instead, and the caller passes that file's
 * text as `rendererSource` so the last corner can be checked too. Omitting it
 * checks the first seven and reports the eighth as unverified rather than
 * silently passing on it.
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
