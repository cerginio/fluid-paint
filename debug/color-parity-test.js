'use strict';

/*
 * Colour parity -- the numeric reference.
 *
 * DURABLE. Unlike the phase*-probe.js files, this is not a throwaway: it is the
 * regression guard for the contract in docs/COLOR-PICKER-PAINT-PARITY-SPEC.md.
 * Keep it. If the selection model is ever redesigned, update the expectations
 * here first and let this fail until the code follows.
 *
 * ---------------------------------------------------------------------------
 * THE CONTRACT
 * ---------------------------------------------------------------------------
 *
 * Every displayed colour must come from the same pigment triple the brush
 * deposits:
 *
 *     pigment    = hsvToRyb(h, s, v)          <- common.js, the paint path
 *     displayRgb = rybToRgbDisplay(pigment)   <- the shader's rybToRgb, in JS
 *
 * The bug this guards against was a SECOND, divergent display mapping
 * (`hueToPigmentLoad` plus a multiply by value) which agreed with the paint
 * only on the rim at s=1,v=1. Rim-only tests passed while the whole interior
 * of the disc lied about what the brush would deposit.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EXPECTATIONS ARE COMPUTED HERE
 * ---------------------------------------------------------------------------
 *
 * The expected values below come from an INDEPENDENT implementation in this
 * file -- its own HSV->pigment ramp and its own cube -- not from calling the
 * functions under test. A test that computes its expectation with the code it
 * is testing passes no matter what that code does; that is precisely how the
 * previous divergence survived a green suite.
 *
 * The cube corners are additionally checked against the production SHADER text,
 * so this file's copy cannot drift silently either.
 *
 *   node debug/color-parity-test.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// An independent implementation of the contract.
// ---------------------------------------------------------------------------

/* HSV -> RYB pigment loads. The sexagesimal HSV->RGB formula whose outputs are
 * REINTERPRETED as red/blue/yellow pigment loads -- David Li's trick. Written
 * out longhand here rather than imported, so a change to common.js cannot
 * quietly redefine what this file considers correct.
 *
 * Note the `m = v - c` white term: it is what makes a desaturated colour raise
 * ALL THREE loads toward 1. Read as ink that means "pile on every pigment",
 * which lands on the cube's v111 near-black brown. That is a real property of
 * this selection model, not a bug -- see the spec's compatibility policy. */
function refHsvToPigment(h, s, v) {
  const hDash = (((h % 1) + 1) % 1) * 6;
  const c = v * s;
  const x = c * (1 - Math.abs(hDash % 2 - 1));
  const i = Math.floor(hDash) % 6;
  const r = [c, x, 0, 0, x, c][i];
  const g = [x, c, c, x, 0, 0][i];
  const b = [0, 0, x, c, c, x][i];
  const m = v - c;
  return [r + m, g + m, b + m];
}

/* The eight corners, in the shader's own argument order
 * (v000,v100,v010,v001,v101,v011,v110,v111 -- NOT lexicographic).
 *
 * The axes are numerically RED, BLUE, YELLOW: (1,0,0) is red, (0,1,0) is slate
 * blue, (0,0,1) is yellow. The acronym does not read literally in the channel
 * order; do not swap channels to make it. */
const REF_CORNERS = [
  [1.0, 1.0, 1.0],      // v000  no pigment -- white paper, NOT absence of paint
  [1.0, 0.0, 0.0],      // v100  red
  [0.163, 0.373, 0.6],  // v010  blue
  [1.0, 1.0, 0.0],      // v001  yellow
  [1.0, 0.5, 0.0],      // v101  red + yellow  -> orange
  [0.0, 0.66, 0.2],     // v011  blue + yellow -> green
  [0.5, 0.0, 0.5],      // v110  red + blue    -> purple
  [0.0, 0.0, 0.0],      // v111  all three     -> TRUE BLACK (the default)
];

/* David Li's original corner, kept for the ?black=0 comparison below.
 *
 * His cube has no black anywhere -- this brown is its darkest reachable point,
 * and the lighting term only brightens -- so the default deepens it. That is
 * the ONLY difference between the two cubes. */
const REF_V111_DAVID_LI = [0.2, 0.094, 0.0];

function refPigmentToRgb(p, additive) {
  // The shader's `#ifdef RGB` branch: `1.0 - ryb.yxz`. The SWIZZLE is part of
  // it -- dropping it is a silent channel swap that still looks plausible.
  if (additive) return [1 - p[1], 1 - p[0], 1 - p[2]];

  const x = p[0], y = p[1], z = p[2];
  const w = [
    (1 - x) * (1 - y) * (1 - z),
    x * (1 - y) * (1 - z),
    (1 - x) * y * (1 - z),
    (1 - x) * (1 - y) * z,
    x * (1 - y) * z,
    (1 - x) * y * z,
    x * y * (1 - z),
    x * y * z,
  ];
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    for (let k = 0; k < 8; k++) out[ch] += REF_CORNERS[k][ch] * w[k];
  }
  return out;
}

const ref8 = (h, s, v, additive) =>
  refPigmentToRgb(refHsvToPigment(h, s, v), additive)
    .map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));

// ---------------------------------------------------------------------------
// The code under test.
// ---------------------------------------------------------------------------

/* Loaded by evaluating the browser sources in a function scope. These files are
 * plain scripts with no module system -- index.html and gulpfile.js concatenate
 * them -- so this is how Node reaches them without a build step. */
function loadGlobals(files, names) {
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const decl = names.map((n) => n + ": typeof " + n + " !== 'undefined' ? " + n + " : undefined");
  return new Function(src + '\n;return {' + decl.join(',') + '};')();
}

const sut = loadGlobals(
  ['common.js', 'app/ui/ryb.js'],
  ['hsvToRyb', 'hsvToPigmentRgb', 'rybToRgbDisplay', 'cssRgb', 'assertMatchesShader'],
);

const to8 = (rgb) => rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

const results = [];
function check(name, pass, detail) {
  results.push({ name: name, pass: pass, detail: detail });
  if (!pass) console.log('  FAIL ' + name + (detail ? '  -- ' + detail : ''));
}
function group(title) { console.log('\n' + title); }

/** Max absolute per-channel difference, in 8-bit units. */
const maxErr = (a, b) => Math.max.apply(null, a.map((v, i) => Math.abs(v - b[i])));

// ---------------------------------------------------------------------------
// 1. The reported failures.
// ---------------------------------------------------------------------------

group('[reported] the five cases from the parity report, at hue 0');

/* The rows of the spec's table. The "was" column records what the divergent
 * mapping produced -- the thing that must not come back. It is deliberately not
 * asserted: the requirement is that display equals paint, not that it equals
 * some other specific wrong answer. */
/* Values are under the DEFAULT (black-corner) cube. Two rows moved when that
 * became the default -- they are the ones whose selection carries load on all
 * three pigments, which is exactly the reach of the corner. The rim, the zero
 * end and half-value red are identical under either cube. */
const REPORTED = [
  // s,   v,    expected,         was (the bug)
  [0,   1,   [0, 0, 0],        '(255,255,255) white centre; (51,24,0) under ?black=0'],
  [1,   0,   [255, 255, 255],  '(0,0,0) black at zero value'],
  [1,   0.5, [255, 128, 128],  '(128,0,0) dark red instead of pink'],
  [0.5, 1,   [159, 32, 32],    '(255,128,128) pink; (172,38,32) under ?black=0'],
  [1,   1,   [255, 0, 0],      '(255,0,0) -- the rim, which always agreed'],
];

for (const row of REPORTED) {
  const s = row[0], v = row[1], expected = row[2], was = row[3];

  // The independent reference must itself produce the documented number. This
  // catches a typo in the table above before it is blamed on the source.
  const refd = ref8(0, s, v, false);
  check('reference for s=' + s + ',v=' + v + ' is ' + expected,
    maxErr(refd, expected) === 0, 'reference gave ' + refd);

  const got = to8(sut.hsvToPigmentRgb(0, s, v, false));
  check('display at s=' + s + ',v=' + v + ' matches the paint',
    maxErr(got, expected) <= 1,
    'got ' + got + ', want ' + expected + '; previously ' + was);
}

// ---------------------------------------------------------------------------
// 2. The whole grid, both models.
// ---------------------------------------------------------------------------

group('[grid] hue every 15deg x s,v in {0,.25,.5,.75,1}, both models');

const SATS = [0, 0.25, 0.5, 0.75, 1];
const VALS = [0, 0.25, 0.5, 0.75, 1];

for (const additive of [false, true]) {
  const model = additive ? 'Digital' : 'Natural';
  let worst = 0;
  let worstAt = null;

  for (let deg = 0; deg < 360; deg += 15) {
    const h = deg / 360;
    for (const s of SATS) {
      for (const v of VALS) {
        const err = maxErr(to8(sut.hsvToPigmentRgb(h, s, v, additive)), ref8(h, s, v, additive));
        if (err > worst) { worst = err; worstAt = 'h=' + deg + ' s=' + s + ' v=' + v; }
      }
    }
  }

  const n = 24 * SATS.length * VALS.length;
  check(model + ': all ' + n + ' grid points within 1/255',
    worst <= 1, 'worst error ' + worst + ' at ' + worstAt);
}

// ---------------------------------------------------------------------------
// 3. Digital endpoints.
// ---------------------------------------------------------------------------

group('[digital] the mode branch and its swizzle');

/* A Natural-only suite cannot see a missing channel swap. These three
 * endpoints are where it shows. */
const DIGITAL = [
  [0, 0, 1, [0, 0, 0], 'full load on every channel inverts to black'],
  [0, 1, 0, [255, 255, 255], 'zero load inverts to white'],
  [0, 1, 0.5, [255, 128, 255], 'the swizzle: green keeps the half, not red'],
];

for (const row of DIGITAL) {
  const h = row[0], s = row[1], v = row[2], expected = row[3], why = row[4];

  const refd = ref8(h, s, v, true);
  check('reference for digital s=' + s + ',v=' + v + ' is ' + expected,
    maxErr(refd, expected) === 0, 'reference gave ' + refd);

  const got = to8(sut.hsvToPigmentRgb(h, s, v, true));
  check('digital s=' + s + ',v=' + v + ' is ' + expected,
    maxErr(got, expected) <= 1, 'got ' + got + ' -- ' + why);
}

// A plain inversion agrees with the swizzle wherever the first two pigment
// channels are equal, so assert the two are distinguishable at this point.
{
  const p = refHsvToPigment(0, 1, 0.5);
  const swizzled = [1 - p[1], 1 - p[0], 1 - p[2]];
  const plain = [1 - p[0], 1 - p[1], 1 - p[2]];
  check('the swizzle is observable at this test point',
    maxErr(to8(swizzled), to8(plain)) > 2,
    'if this fails the digital test above cannot detect a dropped swizzle');
}

// ---------------------------------------------------------------------------
// 4. Composition and the cube copies.
// ---------------------------------------------------------------------------

group('[composition] display is exactly rybToRgbDisplay(hsvToRyb(...))');

/* The contract is a composition of the two EXISTING functions, not a third
 * mapping that happens to agree numerically. Asserting it directly means a
 * future re-divergence fails here even at points the grid happens to miss. */
{
  let worst = 0;
  for (const additive of [false, true]) {
    for (let deg = 0; deg < 360; deg += 15) {
      for (const s of SATS) {
        for (const v of VALS) {
          const h = deg / 360;
          const composed = sut.rybToRgbDisplay(sut.hsvToRyb(h, s, v), additive);
          const direct = sut.hsvToPigmentRgb(h, s, v, additive);
          worst = Math.max(worst, maxErr(to8(direct), to8(composed)));
        }
      }
    }
  }
  check('display == rybToRgbDisplay(hsvToRyb(h,s,v))', worst === 0,
    'worst deviation ' + worst + '/255 -- a second mapping has appeared');
}

group('[cube] the JS corners still match the production shaders');

/* painting.frag's v111 is the u_pigmentBlack uniform since the black-pigment
 * flag, so its value is checked against renderer.js -- where both the default
 * and the true-black corner are declared -- rather than against a literal. */
const rendererSrc = fs.readFileSync(path.join(ROOT, 'fluid-engine/renderer.js'), 'utf8');

for (const shader of ['fluid-engine/shaders/painting.frag', 'app/shaders/picker.frag']) {
  const full = path.join(ROOT, shader);
  if (!fs.existsSync(full)) { check(shader + ' exists', false, 'not found'); continue; }
  const verdict = sut.assertMatchesShader(fs.readFileSync(full, 'utf8'), rendererSrc);
  check('JS cube matches ' + path.basename(shader), verdict.ok === true, verdict.reason);
}

// Passing no renderer source must REPORT the unverified corner, not pass anyway.
{
  const v = sut.assertMatchesShader(
    fs.readFileSync(path.join(ROOT, 'fluid-engine/shaders/painting.frag'), 'utf8'));
  check('the uniform corner is not silently skipped', v.ok === false,
    'omitting renderer.js must fail rather than check only seven corners');
}

// This file's own copy of the corners must match the shader too, or the
// "independent" reference above is independent of the wrong thing.
{
  const src = fs.readFileSync(path.join(ROOT, 'fluid-engine/shaders/painting.frag'), 'utf8');
  const body = /rybToRgb\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  const found = [];
  const vec3 = /vec3\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g;
  let m;
  while (body && (m = vec3.exec(body[1])) !== null) {
    found.push([+m[1], +m[2], +m[3]]);
  }
  /* Seven literals now; the eighth is the u_pigmentBlack uniform, whose default
   * is declared in renderer.js. Check the prefix against the shader and the
   * last corner against the renderer, so this file's copy is still pinned to
   * production on all eight. */
  const prefix = found.length === REF_CORNERS.length - 1 && found.every(
    (c, i) => c.every((ch, j) => Math.abs(ch - REF_CORNERS[i][j]) < 1e-6));
  check('this test own corners match painting.frag', prefix,
    'shader had ' + found.length + ' literal corners, expected 7 plus the uniform');

  /* Both corners, each against the constant that declares it. REF_CORNERS[7]
   * is the black one (this file's default); REF_V111_DAVID_LI is the original.
   * Checking both means neither can drift without this failing. */
  const readConst = (name) => {
    const m2 = new RegExp(name + '\\s*=\\s*\\[\\s*([-\\d.]+)\\s*,\\s*([-\\d.]+)\\s*,\\s*([-\\d.]+)\\s*\\]')
      .exec(rendererSrc);
    return m2 ? [+m2[1], +m2[2], +m2[3]] : null;
  };
  for (const pair of [
    ['PIGMENT_CORNER_BLACK', REF_CORNERS[7]],
    ['PIGMENT_CORNER_DAVID_LI', REF_V111_DAVID_LI],
  ]) {
    const got = readConst(pair[0]);
    check('this test v111 matches renderer.js ' + pair[0],
      got !== null && got.every((ch, j) => Math.abs(ch - pair[1][j]) < 1e-6),
      got ? 'renderer has ' + got : 'not found');
  }
}

// ---------------------------------------------------------------------------
// 5. Properties the spec calls out explicitly.
// ---------------------------------------------------------------------------

group('[properties] the compatibility policy consequences');

/* These are NOT display errors. The spec's chosen policy preserves existing
 * HSVA selections and their deposited pigment; a dark centre and a white
 * zero-value end are what that policy implies. They are asserted so that
 * "fixing" them with an unrelated RGB overlay fails loudly. */
check('the disc centre at v=1 is the v111 corner, not white',
  maxErr(to8(sut.hsvToPigmentRgb(0, 0, 1, false)), [0, 0, 0]) <= 1,
  'a white centre means an unrelated RGB overlay was painted over the disc');

check('the zero end of value is white paper, not black',
  maxErr(to8(sut.hsvToPigmentRgb(0, 1, 0, false)), [255, 255, 255]) <= 1,
  'zero pigment load is blank paper; black would mean the old overlay is back');

check('hue 0 at full saturation and value is still pure red',
  maxErr(to8(sut.hsvToPigmentRgb(0, 1, 1, false)), [255, 0, 0]) <= 1,
  'the rim is the one place the old mapping was right; it must not move');

/* Value must not behave as an RGB brightness multiply. If someone reinstates
 * `rgb * v`, half value is exactly half of full value on every channel. */
{
  const full = sut.hsvToPigmentRgb(0, 1, 1, false);
  const half = sut.hsvToPigmentRgb(0, 1, 0.5, false);
  const scaled = full.map((c) => c * 0.5);
  check('value is not an RGB brightness multiply',
    maxErr(to8(half), to8(scaled)) > 2,
    'half-value equals half the RGB of full value -- the `* v` bug is back');
}

group('[black] the pigment-black feature flag');

/* The flag deepens the cube's all-three-pigments corner to true black, so a
 * picker has a black to offer at all. Expectations here come from this file's
 * own cube with the corner swapped -- still independent of the code under
 * test. */
{
  const withBlackCorner = (p, additive) => {
    if (additive) return [1 - p[1], 1 - p[0], 1 - p[2]];
    const saved = REF_CORNERS[7];
    REF_CORNERS[7] = [0, 0, 0];
    const out = refPigmentToRgb(p, additive);
    REF_CORNERS[7] = saved;
    return out;
  };
  const refBlack8 = (h, s, v, additive) =>
    withBlackCorner(refHsvToPigment(h, s, v), additive)
      .map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));

  const sutBlack = loadGlobals(
    ['common.js', 'app/ui/ryb.js'],
    ['hsvToPigmentRgb', 'setPigmentBlack', 'isPigmentBlack'],
  );

  check('the UI defaults to the black-corner cube', sutBlack.isPigmentBlack() === true,
    'must match FluidEngine default, or display and paint disagree out of the box');

  sutBlack.setPigmentBlack(false);
  check('setPigmentBlack(false) restores David Li cube',
    sutBlack.isPigmentBlack() === false);
  check('and that cube gives the original brown corner',
    maxErr(to8(sutBlack.hsvToPigmentRgb(0, 0, 1, false)), [51, 24, 0]) <= 1,
    'the ?black=0 escape hatch must still reach the original model');

  sutBlack.setPigmentBlack(true);

  check('with the flag, s=0,v=1 is TRUE BLACK',
    maxErr(to8(sutBlack.hsvToPigmentRgb(0, 0, 1, false)), [0, 0, 0]) <= 1,
    'this is the whole point of the flag: a black to pick');

  /* The corner is reached only through the x*y*z term, so anything with a zero
   * pigment channel must be untouched. This is what bounds the blast radius. */
  const UNAFFECTED = [
    [0, 1, 1, 'pure red'],
    [60 / 360, 1, 1, 'pure yellow-selection'],
    [120 / 360, 1, 1, 'pure green-selection'],
    [240 / 360, 1, 1, 'pure blue-selection'],
    [0, 1, 0.5, 'half-value red (the reported case)'],
    [0, 1, 0, 'zero value -- white paper'],
  ];
  for (const row of UNAFFECTED) {
    const h = row[0], sa = row[1], v = row[2], why = row[3];
    sutBlack.setPigmentBlack(false);
    const stock = to8(sutBlack.hsvToPigmentRgb(h, sa, v, false));
    sutBlack.setPigmentBlack(true);
    const black = to8(sutBlack.hsvToPigmentRgb(h, sa, v, false));
    check('the flag leaves ' + why + ' bit-identical',
      maxErr(stock, black) === 0,
      'stock ' + stock + ' vs black ' + black + ' -- blast radius escaped x*y*z');
  }

  // And the whole grid still agrees with the independent reference.
  sutBlack.setPigmentBlack(true);
  let worst = 0;
  let worstAt = null;
  for (const additive of [false, true]) {
    for (let deg = 0; deg < 360; deg += 15) {
      for (const sa of SATS) {
        for (const v of VALS) {
          const h = deg / 360;
          const e = maxErr(to8(sutBlack.hsvToPigmentRgb(h, sa, v, additive)),
            refBlack8(h, sa, v, additive));
          if (e > worst) { worst = e; worstAt = 'h=' + deg + ' s=' + sa + ' v=' + v; }
        }
      }
    }
  }
  check('black cube: all 1200 grid points within 1/255', worst <= 1,
    'worst error ' + worst + ' at ' + worstAt);

  sutBlack.setPigmentBlack(false);
}

group('[css] string formatting');

check('cssRgb clamps and rounds to a valid declaration',
  sut.cssRgb([1.02, 0.5, -0.01]) === 'rgb(255, 128, 0)',
  'got ' + sut.cssRgb([1.02, 0.5, -0.01]));

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.pass).length;
console.log('\n' + passed + '/' + results.length + ' checks passed');
process.exit(passed === results.length ? 0 : 1);
