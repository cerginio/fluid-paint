/*
 * Proof that the player's single group/frame scale equals the source renderer's
 * tileFrameScale(), per TILECRAFT-SPOT-PARITY-SPEC.md section 3.2.1.
 *
 * `sourceTileFrameScale` below is a deliberate transcription of
 * `D:/work/js-games/ua-dream/tilecraft/render-core.js` -- getGroupedRanges()
 * plus tileFrameScale() -- NOT a call into the player. If the player drifts
 * from the source, these two disagree and this test fails. That is the whole
 * point: do not refactor one to call the other.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TilecraftStrokePlayer = require('../fluid-engine/tilecraft-stroke-player.js');

// ---- transcription of render-core.js -------------------------------------

function getDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getGroupedRanges(tiles) {
  const result = {};
  tiles.forEach((tile, i) => {
    const g = tile.g;
    if (!result[g]) {
      result[g] = { start: i, end: i, firstTile: tile, lastTile: tile, groupCount: 1 };
    } else {
      const gr = result[g];
      gr.end = i;
      gr.lastTile = tile;
      gr.dist = getDistance(tile, gr.firstTile);
      gr.groupCount++;
    }
  });
  return result;
}

function sourceTileFrameScale(tile, grouped, taskContext) {
  const gr = grouped[tile.g];
  if (!gr) return 1;
  if (tile.g && tile.gd > 0) gr.distRatio = tile.gd / gr.dist;
  if (gr.distRatio && gr.distRatio > 0 && gr.distRatio !== Infinity) {
    return Math.max(1 / gr.distRatio, 0.1);
  }
  if (!gr.distRatio && taskContext.framesScale && tile.g != taskContext.pointerId) {
    const rate = taskContext.framesScale[tile.f];
    if (rate < 1) return rate;
  }
  return 1;
}

// ---- the player's side ---------------------------------------------------

const player = new TilecraftStrokePlayer({
  beginStroke() {}, strokeTo() {}, endStroke() {},
});

function playerScales(layer, options = {}) {
  // _context() is the documented construction point for a playback context.
  const context = player._context({ layers: [layer] }, {
    paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
    ...options,
  });
  return (layer.tiles || []).map((tile) => player._tileFrameScale(tile, layer, context));
}

// ---- 1. parity on the real fixture --------------------------------------

const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'tilecraft-spot-parity.json'), 'utf8'));

// Expected per-layer group scales, measured from the source export and
// recorded in debug/fixtures/README.md.
const EXPECTED = {
  polygon: [1.8462, 1.7053],
  polyline: [1.8463],
  square: [1.7051],
  circle: [1.7056],
};

let checkedTiles = 0;
for (const layer of fixture.layers) {
  const drawable = layer.tiles.filter((tile) => tile && Number.isFinite(tile.x) &&
    Number.isFinite(tile.y) && typeof tile.c === 'string' && tile.v !== 0);
  // The source groups BEFORE filtering visibility; the fixture holds no
  // non-drawable tiles, so the two orders coincide here.
  assert.equal(drawable.length, layer.tiles.length,
    `${layer.tileShape}: fixture must hold only drawable tiles`);

  const grouped = getGroupedRanges(drawable);
  const taskContext = { framesScale: null, pointerId: undefined };
  const expectedScales = drawable.map((tile) => sourceTileFrameScale(tile, grouped, taskContext));
  const actualScales = playerScales(layer);

  actualScales.forEach((actual, i) => {
    assert.ok(Math.abs(actual - expectedScales[i]) < 1e-12,
      `${layer.tileShape} tile ${i}: player F ${actual} != source F ${expectedScales[i]}`);
    checkedTiles++;
  });

  // And the distinct values are the ones the specification names.
  const distinct = [...new Set(actualScales.map((value) => Number(value.toFixed(4))))].sort();
  assert.deepEqual(distinct, EXPECTED[layer.tileShape].slice().sort(),
    `${layer.tileShape}: group scales must be the measured reference values`);
}
assert.equal(checkedTiles, 255, 'every fixture tile is compared against the source');
console.log(`tilecraft group scale: PASS (${checkedTiles} tiles match render-core.js exactly)`);

// ---- 2. the four divergences the previous helper had --------------------

const base = { visible: true, tileShape: 'circle', gridSize: 10 };

// (a) the 0.1 lower bound exists. dist/gd = 1/100 would be 0.01 unclamped.
const clamped = playerScales({ ...base, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1, gd: 1000 },
  { x: 10, y: 0, c: '#ff0000', g: 1, gd: 1000 },
] });
assert.deepEqual(clamped, [0.1, 0.1],
  'the 0.1 lower bound is applied, as render-core.js does');

// (b) no `distance < 5000` guard: a wide group still scales.
const wide = playerScales({ ...base, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1, gd: 4000 },
  { x: 8000, y: 0, c: '#ff0000', g: 1, gd: 4000 },
] });
assert.deepEqual(wide, [2, 2],
  'a group wider than 5000 units still scales: the source has no such guard');

/*
 * (c) Source order matters: each tile with `gd` updates the mutable ratio,
 *     which then persists through following tiles without `gd`.
 */
const perTile = playerScales({ ...base, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1 },
  { x: 100, y: 0, c: '#ff0000', g: 1, gd: 50 },
  { x: 200, y: 0, c: '#ff0000', g: 1, gd: 400 },
] });
assert.deepEqual(perTile, [1, 4, 0.5],
  'each tile sees the group ratio in effect at its source position');
const variablePath = { ...base, tileShape: 'polyline', tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1 },
  { x: 100, y: 0, c: '#ff0000', g: 1, gd: 50 },
  { x: 200, y: 0, c: '#ff0000', g: 1, gd: 400 },
] };
const pathPlan = player.compile({ layers: [variablePath] },
  { paintingRectangle: { left: 0, bottom: 0, width: 300, height: 100 } });
const exportRatio = 1500 / Math.hypot(3000, 1875);
assert.deepEqual(pathPlan.operations.map((operation) => operation.pathRadius),
  [1, 4, 0.5].map((scale) => 0.5 * 10 * scale * exportRatio),
  'continuous path radii follow each tile gd and use half the Tilecraft line width');

// A middle tile with no `gd` still scales, which is the common export shape.
const endsOnly = playerScales({ ...base, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1, gd: 100 },
  { x: 100, y: 0, c: '#ff0000', g: 1 },
  { x: 200, y: 0, c: '#ff0000', g: 1, gd: 100 },
] });
assert.deepEqual(endsOnly, [2, 2, 2],
  'gd on the first and last tile only still scales the whole group');

// (d) `dist` is measured across the whole source group, so a `b` break in the
//     middle does not shorten it.
const broken = { ...base, tileShape: 'polyline', tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1, gd: 100 },
  { x: 50, y: 0, c: '#ff0000', g: 1, b: 1, gd: 100 },
  { x: 200, y: 0, c: '#ff0000', g: 1, gd: 100 },
] };
assert.deepEqual(playerScales(broken), [2, 2, 2],
  'dist spans the whole group (200/100 = 2), not the b-separated run');

console.log('tilecraft group scale: PASS (0.1 bound, no 5000 guard, ordered gd, whole-group dist)');

// ---- 3. framesScale fallback at the source threshold -------------------

// The source uses `rate < 1`; the previous helper used `rate < 0.9`, which let
// frames scaled between 0.9 and 1 paint at full width.
const frameScaled = playerScales(
  { ...base, tiles: [{ x: 0, y: 0, c: '#ff0000', g: 7, f: 3 }] },
  { framesScale: { 3: 0.95 } });
assert.deepEqual(frameScaled, [0.95],
  'framesScale applies below 1, not only below 0.9');

const frameFull = playerScales(
  { ...base, tiles: [{ x: 0, y: 0, c: '#ff0000', g: 7, f: 3 }] },
  { framesScale: { 3: 1 } });
assert.deepEqual(frameFull, [1], 'a frame at exactly 1 is left alone');

// A group still being drawn must not be scaled: its gd is not known yet.
const inProgress = playerScales(
  { ...base, tiles: [{ x: 0, y: 0, c: '#ff0000', g: 7, f: 3 }] },
  { framesScale: { 3: 0.5 }, pointerId: 7 });
assert.deepEqual(inProgress, [1], 'the in-progress group keeps scale 1');

// useScaling: false switches the whole mechanism off.
const unscaled = playerScales(
  { ...base, tiles: [{ x: 0, y: 0, c: '#ff0000', g: 1, gd: 10 },
    { x: 100, y: 0, c: '#ff0000', g: 1, gd: 10 }] },
  { useScaling: false });
assert.deepEqual(unscaled, [1, 1], 'useScaling: false disables group scaling');

console.log('tilecraft group scale: PASS (framesScale threshold, in-progress group, useScaling)');

// ---- 4. spots receive F at all, which was the reported defect -----------

const spotLayer = { visible: true, tileShape: 'circle', gridSize: 15, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 1, gd: 100, f: 1 },
  { x: 200, y: 0, c: '#ff0000', g: 1, gd: 100, f: 1 },
] };
const spotPlan = player.compile({ layers: [spotLayer] },
  { paintingRectangle: { left: 0, bottom: 0, width: 400, height: 400 } });
assert.equal(spotPlan.operations.length, 2, 'two circle stamps');
// radius = grid * s * F * C * 0.5, and F = dist/gd = 200/100 = 2 for the whole
// group. Before this change every stamp took F = 1, which is the reported
// defect: spots came out at half the size the source draws them.
for (const operation of spotPlan.operations) {
  assert.ok(Math.abs(operation.brushSize - 15 * 2 * 0.5) < 1e-9,
    'F = 2 reaches the stamp radius (it used to be hard-coded 1)');
}
console.log('tilecraft group scale: PASS (stamps receive the group scale)');

// ---- 5. the one-pixel radius floor is reported, not silent --------------

/*
 * `Math.max(1, ...)` cannot quietly rewrite the geometry: on a small enough
 * canvas it compresses every size ratio in a layer, flattening the taper the
 * source renderer draws. The plan must say so.
 */
const fitBounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
for (const layer of fixture.layers) {
  for (const tile of layer.tiles) {
    fitBounds.left = Math.min(fitBounds.left, tile.x);
    fitBounds.right = Math.max(fitBounds.right, tile.x);
    fitBounds.top = Math.min(fitBounds.top, tile.y);
    fitBounds.bottom = Math.max(fitBounds.bottom, tile.y);
  }
}
function planAt(size) {
  const scale = Math.min(size / (fitBounds.right - fitBounds.left),
    size / (fitBounds.bottom - fitBounds.top));
  return player.compile(fixture, {
    paintingRectangle: { left: 0, bottom: 0, width: size, height: size },
    canvasSize: { width: size, height: size },
    coordinateScale: scale,
    mapPoint: (tile) => ({
      x: (tile.x - fitBounds.left) * scale,
      y: (fitBounds.bottom - tile.y) * scale,
    }),
  });
}

const smallPlan = planAt(1000);
assert.ok(smallPlan.minimumRadiusClamped > 0,
  'a 1000px canvas does hit the floor, and the plan reports it');
assert.ok(smallPlan.smallestRequestedRadius < 1,
  'and names the smallest radius that was actually requested');

const largePlan = planAt(4000);
assert.equal(largePlan.minimumRadiusClamped, 0, 'a 4000px canvas needs no clamping');
assert.equal(largePlan.smallestRequestedRadius, undefined,
  'with nothing clamped there is no smallest-requested value to report');

// Operation counts do not depend on canvas size: the floor changes sizes, not
// how many marks there are.
assert.equal(smallPlan.operations.length, largePlan.operations.length,
  'the radius floor never adds or drops an operation');

console.log('tilecraft group scale: PASS (minimum-radius clamp is counted and reported)');
