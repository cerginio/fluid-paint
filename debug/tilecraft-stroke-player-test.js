const assert = require('node:assert/strict');

/* Tilecraft thicknessScale.ofCanvas(EXPORT_BASE): the constant every export
 * consumer (PDF, PNG, three, Fluid) narrows polyline width by. */
const EXPORT_STROKE_RATIO = 1500 / Math.hypot(3000, 1875);
const TilecraftStrokePlayer = require('../fluid-engine/tilecraft-stroke-player.js');

for (const [operations, seconds] of [
  [1, 5 / 3], [10, 2.87], [50, 5], [100, 6.35],
  [1000, 14.03], [10000, 31.02], [40000, 50],
]) {
  assert.ok(Math.abs(TilecraftStrokePlayer.targetPlaySeconds(operations) - seconds) < 0.01,
    `target duration anchor for ${operations} operations`);
}
const UnpaintedRangeRegistry = require('../app/unpainted-range-registry.js');

const calls = [];
const engine = {
  beginStroke(options) { calls.push(['begin', options]); },
  strokeTo(options) { calls.push(['to', options]); },
  endStroke() { calls.push(['end']); },
};
const story = {
  layers: [
    { visible: true, tileShape: 'polygon', gridSize: 10, scale: 2, opacity: 128,
      tiles: [{ x: 5, y: 5, c: '#0000ff80', s: 3 }] },
    { visible: true, tileShape: 'polyline', gridSize: 4, tiles: [
      { x: 0, y: 0, c: '#ff0000', g: 1, s: 1 },
      { x: 10, y: 0, c: '#ff0000', g: 1, s: 2 },
      { x: 10, y: 10, c: '#ff0000', g: 1, s: 1, gz: 1 },
      { x: 30, y: 0, c: '#00ff00', g: 2, s: 1 },
      { x: 40, y: 0, c: '#00ff00', g: 2, s: 1, b: 1 },
      { x: 50, y: 0, c: '#00ff00', g: 2, s: 1 },
    ] },
    { visible: false, tileShape: 'polyline', gridSize: 1,
      tiles: [{ x: 1, y: 1, c: '#ffffff' }] },
  ],
};
const stats = new TilecraftStrokePlayer(engine).replay(story, {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  resolutionScale: 2,
  alpha: 0.1,
  mapPoint: (tile) => ({ x: tile.x + 100, y: 200 - tile.y }),
});
const sourceOrderedPlan = new TilecraftStrokePlayer(engine).compile(story, {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  spotPaintLoad: 1,
});
assert.equal(sourceOrderedPlan.operations[0].layerIndex, 0,
  'a spot layer before a path layer remains first in the paint stack');
assert.equal(sourceOrderedPlan.operations.at(-1).layerIndex, 1,
  'the later path layer remains above the spot layer');

/*
 * The single polygon spot deposits `spotPaintLoad` contacts (8 by default),
 * each one its own begin/end pair: a live beginStroke() is one stationary
 * splat, and that press count is the paint-load lever. Derived from the
 * player's own default rather than spelled out, so re-calibrating the load
 * does not require re-typing this sequence.
 */
const SPOT_LOAD = new TilecraftStrokePlayer({
  beginStroke() {}, strokeTo() {}, endStroke() {},
}).compile(
  { layers: [{ visible: true, tileShape: 'circle', gridSize: 10,
    tiles: [{ x: 1, y: 1, c: '#ff0000', f: 1 }] }] },
  { paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 } }
).operations[0].paintLoad;
assert.deepEqual(calls.map(([kind]) => kind), [
  ...Array.from({ length: SPOT_LOAD }, () => ['begin', 'end']).flat(),
  'begin', 'to', 'to', 'to', 'end', // closed g=1 polyline
  'begin', 'end',                   // g=2 before b
  'begin', 'to', 'end',             // g=2 after b
]);
assert.equal(calls.filter(([kind]) => kind === 'begin').length, 3 + SPOT_LOAD,
  'three polyline strokes plus the contacts of one stamp');
const polylineCalls = calls.slice(2 * SPOT_LOAD);
assert.equal(polylineCalls[0][1].timing, 'replay');
assert.deepEqual(polylineCalls[0][1].color.channels, [1, 0, 0]);
/* Polyline width = gridSize * s * F * strokeRatio * coordinateScale. The
 * strokeRatio is Tilecraft's thicknessScale.ofCanvas(EXPORT_BASE) -- a
 * CONSTANT 1500/hypot(3000,1875), the same value render.js multiplies into
 * gridScaledSize for every export consumer. It is deliberately not a function
 * of the Fluid canvas: a canvas-dependent width would be the hidden per-canvas
 * factor the spot-parity spec forbids. gridSize 4 * s 2 = 8 before narrowing. */
assert.ok(Math.abs(polylineCalls[0][1].brushSize - 8 * EXPORT_STROKE_RATIO) < 1e-9,
  'polyline uses its largest tile scale, narrowed by the export stroke ratio');
assert.equal(polylineCalls[1][1].pressure, 1);
assert.deepEqual(polylineCalls[3][1], { x: 100, y: 200, pressure: 0.5 }, 'gz closes to first point');
/* gridSize 10 * scale 2 * s 3 = 60 across, so the RADIUS is 30. This layer
 * declares no usable `polygonSize`, so it is drawn as the circle render.js
 * falls back to -- and it must NOT pick up the polyline branch's export
 * stroke ratio, which the source applies inside connectPoints() only. */
assert.equal(calls[0][1].brushSize, 30, 'polygon tile size creates one spot');
assert.equal(calls[0][1].timing, 'live', 'polygon spot is an immediate live tap');
assert.ok(TilecraftStrokePlayer.rybToRgb(calls[0][1].color.channels)
  .every((value) => Number.isFinite(value)), 'RGB input is converted to finite RYB pigment loads');
assert.ok(Math.abs(calls[0][1].color.alpha - 0.1 * (128 / 255) * (128 / 255)) < 1e-12);
/*
 * A stamp's contacts share size, shape and colour but NOT position: they
 * scatter inside the mark. Restacking them on one point would only redraw the
 * same ring of bristle dots, because neighbouring splats sit ~8.7 splat
 * diameters apart at every brush size.
 */
const stampBegins = calls.slice(0, 2 * SPOT_LOAD).filter(([kind]) => kind === 'begin').map(([, o]) => o);
assert.equal(stampBegins.length, SPOT_LOAD, 'one contact per unit of paint load');
for (const begin of stampBegins) {
  assert.deepEqual(
    [begin.brushSize, begin.timing, begin.color.alpha],
    [stampBegins[0].brushSize, 'live', stampBegins[0].color.alpha],
    'load and scatter change coverage, never the mark\'s size or alpha');
}
/*
 * Scatter is OFF by default, so every contact is on the tile. The shader
 * redraws the bristle layout per press, so the contacts already interleave;
 * offsetting them measured WORSE (coverage 70% -> 51%, spill 404 -> 2133).
 */
for (const begin of stampBegins) {
  assert.deepEqual([begin.x, begin.y], [105, 195],
    'contacts stay on the tile: the mark must not drift or grow');
}
assert.deepEqual(stats,
  { layers: 2, strokes: 3 + SPOT_LOAD, spots: SPOT_LOAD, points: 7 + SPOT_LOAD,
    skipped: 0, minimumRadiusClamped: 0 });
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#ffffff'), [0, 0, 0, 1], 'white is no RYB pigment');
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#000000'), [1, 1, 1, 1], 'black uses all pigments');
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#ff0000'), [1, 0, 0, 1], 'red is a cube corner');
assert.throws(() => TilecraftStrokePlayer.hexToPigment('#bad'), /#RRGGBB/);
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#ff0000', true, 'digital'), [1, 0, 1, 1]);
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#00ff00', true, 'digital'), [0, 1, 1, 1]);
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#0000ff80', true, 'digital'), [1, 1, 0, 128 / 255]);
assert.deepEqual(TilecraftStrokePlayer.hexToEncodedRgb('#3b82f680'),
  [1 - 0x82 / 255, 1 - 0x3b / 255, 1 - 0xf6 / 255, 128 / 255],
  'encoded RGB material preserves requested display HEX for RGB renderer hosts');
const triangle = { layers: [{ visible: true, tileShape: 'polygon', polygonSize: 3,
  gridSize: 12, opacity: 128, tiles: [{ x: 10, y: 10, c: '#ff0000', a: 64, sa: Math.PI / 6 }] }] };
const trianglePlayer = new TilecraftStrokePlayer(engine);
const triangleOptions = { paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  colorModel: 'digital', alpha: 0.02 };
const trianglePlan = trianglePlayer.compile(triangle, triangleOptions);
assert.equal(trianglePlan.operations[0].brushShape.sides, 3);
assert.ok(Math.abs(trianglePlan.operations[0].brushSize -
  12 * 0.665 * Math.sqrt(3 * Math.sin(2 * Math.PI / 3) / (2 * Math.PI))) < 1e-12,
  'polygon spot width follows the source radius and shader area normalization');
assert.ok(Math.abs(trianglePlan.operations[0].brushShape.rotation - Math.PI / 2 + Math.PI / 6) < 1e-12);
assert.deepEqual(trianglePlan.operations[0].color.channels, [1, 0, 1]);
assert.ok(Math.abs(trianglePlan.operations[0].color.alpha - 0.02 * 128 / 255 * 64 / 255) < 1e-12);
const triangleCalls = [];
new TilecraftStrokePlayer({ beginStroke(options) { triangleCalls.push(options); },
  strokeTo() {}, endStroke() {} }).replay(triangle, triangleOptions);
assert.deepEqual(triangleCalls[0].brushShape, trianglePlan.operations[0].brushShape);
assert.deepEqual(triangleCalls[0].color, trianglePlan.operations[0].color);
let encodedRgbCalls = 0;
const injectedPlan = trianglePlayer.compile(triangle, { ...triangleOptions, canvasColorFormat: 'encoded-rgb',
  encodeRgb: (rgb) => { encodedRgbCalls++; assert.deepEqual(rgb, [1, 0, 0]); return [0.2, 0.3, 0.4]; } });
assert.equal(encodedRgbCalls, 1, 'encoded host uses its shared adapter');
assert.deepEqual(injectedPlan.operations[0].color.channels, [0.2, 0.3, 0.4]);
const encodedPlan = trianglePlayer.compile(triangle, { ...triangleOptions, canvasColorFormat: 'encoded-rgb' });
assert.deepEqual(encodedPlan.operations[0].color.channels, [1, 0, 1],
  'encoded RGB opt-in keeps red exact under the fixed RGB renderer');
for (const sides of [3, 4, 6, 8]) {
  const shape = TilecraftStrokePlayer.brushShape('polygon', { polygonSize: sides });
  assert.equal(shape.sides, sides);
  assert.ok(Number.isFinite(shape.rotation));
}
const doubleTriangle = { layers: [{ ...triangle.layers[0], mod: 2 }] };
const doublePlan = trianglePlayer.compile(doubleTriangle, triangleOptions);
assert.equal(doublePlan.operations.length, 2, 'mod 2 retains both polygon orientations');
assert.equal(doublePlan.operations[0].brushShape.sides, 3);
assert.ok(Math.abs(doublePlan.operations[0].brushShape.rotation -
  doublePlan.operations[1].brushShape.rotation) > 1);

const scaledCalls = [];
new TilecraftStrokePlayer({
  beginStroke(options) { scaledCalls.push(options); },
  strokeTo() {}, endStroke() {},
}).replay({ layers: [{ visible: true, tileShape: 'polyline', gridSize: 10, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 7, gd: 40, s: 1 },
  { x: 20, y: 0, c: '#ff0000', g: 7, s: 2 },
] }] }, {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  canvasSize: { width: 1500, height: 900 },
  coordinateScale: 0.5,
});
/* gridSize 10 * s 1 * F * coordinateScale 0.5, then the export stroke ratio.
 * F is the SHARED tileFrameScale: dist/gd = 20/40 -> distRatio 2 -> max(1/2,
 * 0.1) = 0.5... but the group's own `dist` is measured across the whole
 * source group, which is what makes this 1.0 rather than the old helper's
 * value. The pre-narrowing width is therefore 5, not the 2.5 the previous
 * `_groupScale()` produced -- the deliberate polyline shift section 3.2.1 of
 * the spot-parity spec signs off on. The ratio no longer depends on
 * `canvasSize`: thicknessScale gives every export consumer the same constant,
 * so passing a 1500x900 canvas here must not change the width. */
assert.ok(Math.abs(scaledCalls[0].brushSize - 5 * EXPORT_STROKE_RATIO) < 1e-9,
  'width applies Tilecraft gd scale, the export stroke ratio, and map coordinate scale');

// A tapered Tilecraft path must not be painted at its thick end.  FluidEngine
// strokes have one immutable brushSize, so the player used to take the segment
// maximum: an onset ramp (s 0.05 -> 5) was drawn entirely at the widest tile,
// which is the blob seen on small frames, where fit scale magnifies it.
const taperCalls = [];
new TilecraftStrokePlayer({
  beginStroke(options) { taperCalls.push(options); },
  strokeTo() {}, endStroke() {},
}).replay({ layers: [{ visible: true, tileShape: 'polyline', gridSize: 10, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 3, s: 0.05 },
  { x: 10, y: 0, c: '#ff0000', g: 3, s: 0.5 },
  { x: 20, y: 0, c: '#ff0000', g: 3, s: 5 },
] }] }, {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  canvasSize: { width: 3000, height: 3000 },
  coordinateScale: 1,
});
assert.ok(taperCalls.length > 1,
  'a path whose width ramps beyond the split ratio becomes several strokes');
assert.ok(taperCalls[0].brushSize < taperCalls[taperCalls.length - 1].brushSize,
  'the thin end of a taper keeps a thinner brush than the thick end');
assert.ok(taperCalls[0].brushSize < 5,
  'the thin end is not painted at the segment maximum (which would be 50)');

// Runs stay contiguous: each split repeats its boundary tile so the pieces
// overlap and read as one stroke rather than visible dashes.
const contiguous = [];
new TilecraftStrokePlayer({
  beginStroke(options) { contiguous.push([{ x: options.x, y: options.y }]); },
  strokeTo(options) { contiguous[contiguous.length - 1].push({ x: options.x, y: options.y }); },
  endStroke() {},
}).replay({ layers: [{ visible: true, tileShape: 'polyline', gridSize: 10, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 4, s: 0.1 },
  { x: 10, y: 0, c: '#ff0000', g: 4, s: 1 },
  { x: 20, y: 0, c: '#ff0000', g: 4, s: 10 },
] }] }, {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  canvasSize: { width: 3000, height: 3000 },
  coordinateScale: 1,
});
for (let i = 1; i < contiguous.length; i++) {
  const previousEnd = contiguous[i - 1][contiguous[i - 1].length - 1];
  const currentStart = contiguous[i][0];
  assert.deepEqual(currentStart, previousEnd,
    'a split run starts where the previous run ended, so the stroke stays joined');
}

// An `s` step within the split ratio stays a single stroke: splitting every
// pressure wobble would shatter ordinary strokes for no visual gain.
const singleCalls = [];
new TilecraftStrokePlayer({
  beginStroke(options) { singleCalls.push(options); },
  strokeTo() {}, endStroke() {},
}).replay({ layers: [{ visible: true, tileShape: 'polyline', gridSize: 10, tiles: [
  { x: 0, y: 0, c: '#ff0000', g: 5, s: 1 },
  { x: 10, y: 0, c: '#ff0000', g: 5, s: 1.5 },
] }] }, {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  canvasSize: { width: 3000, height: 3000 },
  coordinateScale: 1,
});
assert.equal(singleCalls.length, 1,
  'a width change within the split ratio stays one stroke');
console.log('tilecraft taper: PASS (width split keeps thin ends thin and runs joined)');

const framedStory = { layers: [
  { visible: true, tileShape: 'polyline', tiles: [
    { x: 20, y: 0, c: '#ff0000', g: 20, f: 2 },
    { x: 21, y: 0, c: '#ff0000', g: 20, f: 2 },
    { x: 10, y: 0, c: '#ff0000', g: 10, f: 1 },
    { x: 11, y: 0, c: '#ff0000', g: 10, f: 1 },
  ] },
  { visible: true, tileShape: 'polyline', tiles: [
    { x: 12, y: 0, c: '#00ff00', g: 11, f: 1 },
    { x: 13, y: 0, c: '#00ff00', g: 11, f: 1 },
    { x: 22, y: 0, c: '#00ff00', g: 21, f: 2 },
    { x: 23, y: 0, c: '#00ff00', g: 21, f: 2 },
  ] },
  { visible: true, tileShape: 'polygon', tiles: [
    { x: 14, y: 0, c: '#0000ff', f: 1 },
    { x: 24, y: 0, c: '#0000ff', f: 2 },
    { x: 99, y: 0, c: '#0000ff' },
  ] },
] };
const framedCalls = [];
const framedPlayer = new TilecraftStrokePlayer({
  beginStroke(options) { framedCalls.push(options.x); },
  strokeTo(options) { framedCalls.push(options.x); },
  endStroke() {},
});
// spotPaintLoad: 1 keeps this about ORDER. A stamp's repeated contacts land on
// the same point, so the default load would pad this sequence with duplicates
// and say nothing more about ordering. Paint load is asserted on its own below.
const framedOptions = {
  paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 },
  spotPaintLoad: 1,
};
framedPlayer.replay(framedStory, framedOptions);
assert.deepEqual(framedCalls, [20, 21, 22, 23, 24, 10, 11, 12, 13, 14, 99],
  'replay groups every layer by frame, keeps polyline before polygon, and puts unassigned last');
const framedPlan = framedPlayer.compile(framedStory, framedOptions);
assert.deepEqual(framedPlan.operations.map((operation) => operation.point.x), framedCalls,
  'compiled playback uses the same frame-major order as replay');
assert.deepEqual(framedPlan.frameRanges.map(({ key, start, end }) => [key, start, end]), [
  ['frame:2', 0, 5], ['frame:1', 5, 10], ['frame:unassigned', 10, 11],
], 'each frame has one contiguous navigation range');

const colorStory = { layers: [
  { visible: true, tileShape: 'polyline', tiles: [
    { x: 0, y: 0, c: '#ff0000', g: 1, f: 1 },
    { x: 1, y: 0, c: '#00ff00', g: 1, f: 1 },
    { x: 4, y: 0, c: '#0000ff', g: 2, f: 1 },
    { x: 5, y: 0, c: '#0000ff', g: 2, f: 1 },
  ] },
  { visible: true, tileShape: 'polyline', tiles: [
    { x: 2, y: 0, c: '#ff0000', g: 3, f: 1 },
    { x: 3, y: 0, c: '#ff0000', g: 3, f: 1 },
  ] },
  { visible: true, tileShape: 'polygon', tiles: [
    { x: 6, y: 0, c: '#0000ff', f: 1 },
  ] },
] };
const colorCalls = [];
const colorPlayer = new TilecraftStrokePlayer({
  beginStroke(options) { colorCalls.push(['begin', options.x, options.color.channels]); },
  strokeTo(options) { colorCalls.push(['to', options.x]); },
  endStroke() {},
});
colorPlayer.replay(colorStory, framedOptions);
assert.deepEqual(colorCalls.map((call) => call[1]), [0, 1, 4, 5, 2, 3, 6],
  'canonical group colours do not reorder the original within-frame paint stack');
assert.deepEqual(colorCalls.slice(0, 2).map((call) => call[0]), ['begin', 'to'],
  'a colour change inside one group does not split its stroke');
assert.deepEqual(colorCalls[0][2], [1, 0, 0],
  'the first tile colour is used for the whole multi-colour group');
const colorPlan = colorPlayer.compile(colorStory, framedOptions);
assert.deepEqual(colorPlan.operations.map((operation) => operation.point.x), [0, 1, 4, 5, 2, 3, 6],
  'compiled playback preserves the same within-frame paint stack');
assert.deepEqual(colorPlan.operations[1].color.channels, [1, 0, 0],
  'compiled multi-color group also keeps its first tile color');
console.log('tilecraft stroke player: PASS (frame grouping with stable paint stacking)');

(async () => {
  const liveCalls = [];
  const liveEngine = {
    beginStroke(options) { liveCalls.push(['begin', options.timing]); },
    strokeTo() { liveCalls.push(['to']); },
    endStroke() { liveCalls.push(['end']); },
  };
  let frames = 0;
  const liveStats = await new TilecraftStrokePlayer(liveEngine).play({
    layers: [
      { visible: true, tileShape: 'polyline', gridSize: 2, tiles: [
        { x: 0, y: 0, c: '#ff0000', g: 1 },
        { x: 1, y: 0, c: '#ff0000', g: 1 },
      ] },
      { visible: true, tileShape: 'polygon', gridSize: 2,
        tiles: [{ x: 2, y: 2, c: '#00ff00' }] },
    ],
  }, {
    paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 },
    framesPerStep: 2,
    waitFrame: async () => { frames++; },
  });
  assert.deepEqual(liveCalls, [
    ['begin', 'live'], ['to'], ['end'], // polyline: one target per frame
    // polygon: one live tap per unit of the default spotPaintLoad. A live
    // begin is one stationary splat, so the press count is what sets a
    // stamp's coverage.
    ...Array.from({ length: SPOT_LOAD }, () => [['begin', 'live'], ['end']]).flat(),
  ]);
  assert.equal(frames, 6, 'each point target and spot waits the requested number of frames');
  /* This story's polyline is narrower than one engine pixel once the export
   * stroke ratio applies, so the radius floor rewrites it and REPORTS doing
   * so. That report is the point of the diagnostic: a silent clamp is what
   * would hide a collapsed width. */
  assert.deepEqual(liveStats,
    { layers: 2, strokes: 1 + SPOT_LOAD, spots: SPOT_LOAD, points: 2 + SPOT_LOAD,
      skipped: 0, minimumRadiusClamped: 2,
      smallestRequestedRadius: 2 * EXPORT_STROKE_RATIO });

  // The contacts are a coverage knob, not extra frames: a stamp still waits
  // once, so paint load does not slow playback down fivefold.
  const pacedCalls = [];
  let pacedFrames = 0;
  await new TilecraftStrokePlayer({
    beginStroke() { pacedCalls.push('begin'); }, strokeTo() {}, endStroke() {},
  }).play({ layers: [
    { visible: true, tileShape: 'circle', gridSize: 2,
      tiles: [{ x: 2, y: 2, c: '#00ff00' }, { x: 4, y: 4, c: '#00ff00' }] },
  ] }, {
    paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 },
    framesPerStep: 1,
    waitFrame: async () => { pacedFrames++; },
  });
  assert.equal(pacedCalls.length, 2 * SPOT_LOAD,
    'two stamps deposit one contact per unit of paint load each');
  assert.equal(pacedFrames, 2, 'but each stamp still costs exactly one frame');
  console.log('tilecraft live player: PASS (RAF-fed polyline then spots)');

  const framedLiveCalls = [];
  await new TilecraftStrokePlayer({
    beginStroke(options) { framedLiveCalls.push(options.x); },
    strokeTo(options) { framedLiveCalls.push(options.x); },
    endStroke() {},
  }).play(framedStory, {
    ...framedOptions,
    waitFrame: async () => {},
  });
  assert.deepEqual(framedLiveCalls, framedCalls,
    'live playback uses the same frame-major order as replay and compile');

  const fastCalls = [];
  let fastFrames = 0, fastTicks = 0, clockResets = 0;
  await new TilecraftStrokePlayer({
    beginStroke() { fastCalls.push('begin'); },
    strokeTo() { fastCalls.push('to'); },
    endStroke() { fastCalls.push('end'); },
  }).play({ layers: [{ visible: true, tileShape: 'polyline', gridSize: 2, tiles: [
    { x: 0, y: 0, c: '#ff0000', g: 1 },
    { x: 1, y: 0, c: '#ff0000', g: 1 },
    { x: 2, y: 0, c: '#ff0000', g: 1 },
  ] }] }, {
    paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 },
    ticksPerFrame: 2,
    advanceTick: () => { fastTicks++; },
    resetAdvanceClock: () => { clockResets++; },
    waitFrame: async () => { fastFrames++; },
  });
  assert.deepEqual(fastCalls, ['begin', 'to', 'to', 'end']);
  assert.equal(fastTicks, 2, 'fast mode advances one complete tick for every retained point');
  assert.equal(fastFrames, 1, 'two ticks share one displayed frame at 2x speed');
  assert.equal(clockResets, 1, 'synthetic playback time is returned to the host clock');
  console.log('tilecraft fast player: PASS (ticks retained at accelerated display rate)');

  const planCalls = [];
  const planEngine = {
    beginStroke(options) { planCalls.push(['begin', options.x, options.brushSize]); },
    strokeTo(options) { planCalls.push(['to', options.x]); },
    endStroke() { planCalls.push(['end']); },
  };
  const planPlayer = new TilecraftStrokePlayer(planEngine);
  const plan = planPlayer.compile({ layers: [{ visible: true, tileShape: 'polyline', gridSize: 2, tiles: [
    { x: 0, y: 0, c: '#ff0000', g: 10, f: 1 },
    { x: 1, y: 0, c: '#ff0000', g: 10, f: 1 },
    { x: 2, y: 0, c: '#00ff00', g: 20, f: 2 },
    { x: 3, y: 0, c: '#00ff00', g: 20, f: 2 },
  ] }] }, {
    paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 },
  });
  assert.equal(plan.operations.length, 4);
  assert.deepEqual(plan.groupRanges.map(({ start, end }) => [start, end]), [[0, 2], [2, 4]]);
  assert.deepEqual(plan.frameRanges.map(({ start, end }) => [start, end]), [[0, 2], [2, 4]]);

  const loopPlan = { frameRanges: [
    { start: 0, end: 2, key: 'frame:1', label: 'Frame 1' },
    { start: 2, end: 4, key: 'frame:2', label: 'Frame 2' },
    { start: 4, end: 6, key: 'frame:3', label: 'Frame 3' },
    { start: 6, end: 8, key: 'frame:4', label: 'Frame 4' },
  ] };
  const loopRegistry = new UnpaintedRangeRegistry(8);
  assert.equal(loopRegistry.nextFrameBoundary(0, loopPlan), 2);
  assert.equal(loopRegistry.nextFrameBoundary(2, loopPlan), 4);
  assert.equal(loopRegistry.nextFrameBoundary(4, loopPlan), 6);
  assert.equal(loopRegistry.nextFrameBoundary(6, loopPlan), 0,
    'forward frame navigation wraps 1-2-3-4-1');
  assert.equal(loopRegistry.nextFrameBoundary(8, loopPlan), 0);
  assert.equal(loopRegistry.previousPendingFrame(4, loopPlan).start, 2);
  assert.equal(loopRegistry.previousPendingFrame(2, loopPlan).start, 0);
  assert.equal(loopRegistry.previousPendingFrame(0, loopPlan).start, 6,
    'backward frame navigation wraps 3-2-1-4');
  assert.equal(loopRegistry.previousPendingFrame(8, loopPlan).start, 6);

  const registry = new UnpaintedRangeRegistry(plan.operations.length);
  registry.markPainted(0, 2);
  registry.markJump(2, 4, 'frame-jump');
  assert.equal(registry.previousPendingFrame(4, plan).start, 2,
    'backward frame navigation selects only an earlier unpainted range');
  assert.equal(registry.previousPendingFrame(2, plan), null,
    'already painted frame is never offered for backward replay');

  await planPlayer.playPlan(plan, {
    startIndex: 0,
    registry,
    ticksPerFrame: 2,
    brushSizeMultiplier: 0.5,
    advanceTick() {},
    waitFrame: async () => {},
  });
  /* gridSize 2 narrows to 0.85 under the export stroke ratio, so the radius
   * floor rewrites it to 1; the 0.5 runtime multiplier then applies to the
   * CLAMPED radius, giving 0.5. The multiplier is a playback thickness knob
   * and deliberately sits outside the floor -- clamping after it would let a
   * thin-playback setting silently paint at full width. */
  assert.deepEqual(planCalls, [['begin', 2, 0.5], ['to', 3], ['end']],
    'playPlan combines the fixed brush-size correction with its runtime thickness multiplier');
  assert.equal(TilecraftStrokePlayer.brushSizeCorrectionRate, 1,
    'story playback exposes its fixed brush-size correction rate');
  assert.equal(registry.pendingCount, 0);
  console.log('tilecraft plan navigation: PASS (frame ranges and no double paint)');

  let virtualNow = 0;
  let timelineStrokeActive = false;
  const timelinePlayer = new TilecraftStrokePlayer({
    get strokeActive() { return timelineStrokeActive; },
    beginStroke() { timelineStrokeActive = true; },
    strokeTo() {},
    endStroke() { timelineStrokeActive = false; },
  });
  const timelinePlan = timelinePlayer.compile({
    layers: [{
      visible: true,
      tileShape: 'polygon',
      gridSize: 2,
      tiles: Array.from({ length: 50 }, (_, index) => ({
        x: index, y: 0, c: '#ff0000', f: 1,
      })),
    }],
  }, { paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 } });
  const timelineRegistry = new UnpaintedRangeRegistry(50);
  const timelineResult = await timelinePlayer.playPlan(timelinePlan, {
    registry: timelineRegistry,
    targetDuration: 5,
    now: () => virtualNow,
    waitFrame: async () => { virtualNow += 1000 / 60; },
  });
  assert.equal(timelineResult.stats.points, 50, 'deadline scheduler preserves every operation');
  assert.equal(timelineRegistry.pendingCount, 0);
  assert.ok(virtualNow >= 5000 && virtualNow <= 5000 + 1000 / 60 + 0.001,
    '50-operation virtual playback completes within one RAF of five seconds');
  assert.ok(timelineResult.stats.maxCatchUpBatch <= 32, 'deadline catch-up stays bounded');
  console.log('tilecraft deadline player: PASS (50 operations in five virtual seconds)');

  let largeNow = 0;
  let largeStrokeActive = false;
  const largePlayer = new TilecraftStrokePlayer({
    get strokeActive() { return largeStrokeActive; },
    beginStroke() { largeStrokeActive = true; },
    strokeTo() {},
    endStroke() { largeStrokeActive = false; },
  });
  const largePlan = {
    operations: Array.from({ length: 40000 }, (_, index) => ({
      index,
      kind: 'polygon-spot',
      frameKey: 'frame:1',
      groupKey: `spot:${index}`,
      point: { x: 0, y: 0 },
      pressure: 1,
      brushSize: 1,
      color: { space: 'pigment', channels: [1, 0, 0], alpha: 1 },
      paintingRectangle: { left: 0, bottom: 0, width: 1, height: 1 },
      resolutionScale: 1,
    })),
    groupRanges: [], frameRanges: [], layers: 1, skipped: 0,
  };
  const largeRegistry = new UnpaintedRangeRegistry(40000);
  const largeResult = await largePlayer.playPlan(largePlan, {
    registry: largeRegistry,
    targetDuration: 50,
    now: () => largeNow,
    waitFrame: async () => { largeNow += 1000 / 60; },
  });
  assert.equal(largeResult.stats.points, 40000);
  assert.equal(largeRegistry.pendingCount, 0);
  assert.ok(largeNow >= 50000 && largeNow <= 50000 + 1000 / 60 + 0.001);
  assert.ok(largeResult.stats.maxCatchUpBatch <= 32);
  assert.equal(TilecraftStrokePlayer.targetPlaySeconds(40000) / 0.5, 100);
  assert.equal(TilecraftStrokePlayer.targetPlaySeconds(40000) / 2, 25);
  console.log('tilecraft deadline player: PASS (40,000 operations retained in 50 virtual seconds)');

  const abortCalls = [];
  const abortController = new AbortController();
  const abortPlayer = new TilecraftStrokePlayer({
    beginStroke() { abortCalls.push('begin'); },
    strokeTo() { abortCalls.push('to'); },
    endStroke() { abortCalls.push('end'); },
  });
  const abortPlan = abortPlayer.compile({ layers: [{ visible: true, tileShape: 'polyline', tiles: [
    { x: 0, y: 0, c: '#ff0000', g: 1 },
    { x: 1, y: 0, c: '#ff0000', g: 1 },
  ] }] }, { paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 } });
  await assert.rejects(abortPlayer.playPlan(abortPlan, {
    signal: abortController.signal,
    waitFrame: async () => { abortController.abort(); },
  }), (error) => error.name === 'AbortError');
  assert.equal(abortCalls.at(-1), 'end', 'abort always closes the active engine stroke');
  console.log('tilecraft plan cancellation: PASS (AbortSignal closes stroke)');

  // Phase A: circle and square layers are drawable, not skipped content.
  const shapeBegins = [];
  const shapeEngine = {
    beginStroke(options) { shapeBegins.push(options.brushShape ?? null); },
    strokeTo() {}, endStroke() {}, strokeActive: false,
  };
  // spotPaintLoad: 1 keeps these assertions about FOOTPRINT and topology. The
  // default load repeats each stamp's identical press, which would multiply
  // every expectation here without testing anything new; coverage is asserted
  // where paint load is the subject.
  const shapeOptions = {
    paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 },
    spotPaintLoad: 1,
  };

  // circle is a SPOT shape: one operation per tile.
  const spotPlan = new TilecraftStrokePlayer(shapeEngine).compile({ layers: [
    { visible: true, tileShape: 'circle', gridSize: 10,
      tiles: [{ x: 1, y: 1, c: '#ff0000', f: 1 }, { x: 2, y: 2, c: '#ff0000', f: 1 }] },
  ] }, shapeOptions);
  assert.equal(spotPlan.operations.length, 2, 'circle tiles are independent spots');
  assert.deepEqual(spotPlan.operations.map((o) => o.kind), ['polygon-spot', 'polygon-spot']);
  assert.deepEqual(spotPlan.operations.map((o) => o.brushShape), [null, null],
    'circle keeps the round footprint');
  assert.ok(spotPlan.operations.every((o) => o.randomizeBristles === true),
    'imported spots vary their bristle layout by default');
  const legacySpotPlan = new TilecraftStrokePlayer(shapeEngine).compile({ layers: [
    { visible: true, tileShape: 'circle', gridSize: 10,
      tiles: [{ x: 1, y: 1, c: '#ff0000', f: 1 }] },
  ] }, { ...shapeOptions, spotBristleVariation: false });
  assert.equal(legacySpotPlan.operations[0].randomizeBristles, false,
    'the previous layout remains available through the spot variation flag');

  /*
   * square is a SPOT shape: render.js draws one `fillRect` per tile from the
   * per-tile loop, and reaches `connectPoints()` only for `polyline`. Its
   * tiles carry `g`/`b` like a polyline's, but `getGroupedRanges()` builds
   * groups for every layer regardless of shape, so that says nothing about
   * topology -- see the classification comment in the player.
   */
  const squarePlan = new TilecraftStrokePlayer(shapeEngine).compile({ layers: [
    { visible: true, tileShape: 'square', gridSize: 10, tiles: [
      { x: 0, y: 0, c: '#00ff00', f: 1, g: 1 },
      { x: 1, y: 0, c: '#00ff00', f: 1, g: 1 },
      { x: 2, y: 0, c: '#00ff00', f: 1, g: 1 },
    ] },
  ] }, shapeOptions);
  assert.deepEqual(squarePlan.operations.map((o) => o.kind),
    ['polygon-spot', 'polygon-spot', 'polygon-spot'],
    'a square layer replays as three independent stamps, not one connected path');
  assert.equal(squarePlan.groupRanges.length, 1, 'the three squares retain their one source group');
  assert.ok(squarePlan.operations.every((o) => o.segmentStart === undefined),
    'a stamp carries no path segment bookkeeping');
  assert.deepEqual(squarePlan.operations.map((o) => o.brushShape),
    [{ sides: 4, aspect: 1, rotation: 0 }, { sides: 4, aspect: 1, rotation: 0 },
      { sides: 4, aspect: 1, rotation: 0 }],
    'square keeps an AXIS-ALIGNED footprint: render.js uses fillRect, not a diamond');

  /*
   * The painted half-side must land on the source's 0.5 * G * s * F. The 4-gon
   * shader puts a vertex at the brush radius and divides by sqrt(2/PI), so the
   * radius carries the reciprocal of that -- 0.56419, not 0.5.
   */
  const squareHalfSide = Math.cos(Math.PI / 4) / Math.sqrt(4 * Math.sin(Math.PI / 2) / (2 * Math.PI));
  assert.ok(Math.abs(squarePlan.operations[0].brushSize - 10 * 0.5 / squareHalfSide) < 1e-9,
    'a square brushSize solves back to the fillRect half-side');
  assert.ok(Math.abs(squarePlan.operations[0].brushSize - 5.6418958) < 1e-6,
    'and that factor is 0.56419, not 0.5');

  // replay() must route the same shapes as compile() -- they are separate paths.
  shapeBegins.length = 0;
  new TilecraftStrokePlayer(shapeEngine).replay({ layers: [
    { visible: true, tileShape: 'square', gridSize: 10, tiles: [
      { x: 0, y: 0, c: '#00ff00', f: 1, g: 1 }, { x: 1, y: 0, c: '#00ff00', f: 1, g: 1 }] },
    { visible: true, tileShape: 'circle', gridSize: 10, tiles: [{ x: 5, y: 5, c: '#ff0000', f: 1 }] },
  ] }, shapeOptions);
  assert.deepEqual(shapeBegins,
    [{ sides: 4, aspect: 1, rotation: 0 }, { sides: 4, aspect: 1, rotation: 0 }, null],
    'replay(): one begin per square stamp, one round begin for the circle spot');

  // A shape the schema does not define must still be skipped, not guessed at.
  const unknownPlan = new TilecraftStrokePlayer(shapeEngine).compile(
    { layers: [{ visible: true, tileShape: 'star', gridSize: 10,
      tiles: [{ x: 1, y: 1, c: '#ff0000' }] }] }, shapeOptions);
  assert.equal(unknownPlan.operations.length, 0, 'unknown shapes are still skipped');

  // brushShape must be a fresh object per call: plan operations are frozen, and
  // an aliased table entry would let one frozen op leak into another.
  assert.notEqual(TilecraftStrokePlayer.brushShape('square'),
    TilecraftStrokePlayer.brushShape('square'));
  console.log('tilecraft spot shapes: PASS (circle and square stamps, unknown shapes skipped)');

  /*
   * Paint load. Size and coverage are independent: a stamp repeats an
   * identical press, so raising the load must not change brushSize, alpha or
   * position, and must stay inside ONE plan operation so the registry's
   * no-double-deposit guarantee still holds under frame navigation.
   */
  const loadStory = { layers: [
    { visible: true, tileShape: 'circle', gridSize: 10, opacity: 125,
      tiles: [{ x: 1, y: 1, c: '#ff0000', f: 1 }] },
  ] };
  const loadRectangle = { paintingRectangle: { left: 0, bottom: 0, width: 10, height: 10 } };

  const defaultPlan = new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(loadStory, loadRectangle);
  assert.equal(defaultPlan.operations.length, 1, 'paint load never adds operations');
  // 8 contacts, with the host's 160-bristle spot layout, is the measured knee
  // of the coverage curve (96.6% of a square, 94.0% of the worst-case
  // polygon-3). The previous 5 covered only 56%, which painted hollow
  // rosettes. If this number changes, re-measure rather than re-fitting it.
  assert.equal(defaultPlan.operations[0].paintLoad, 8, 'the default load is frozen into the plan');

  const heavyPlan = new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(loadStory, { ...loadRectangle, spotPaintLoad: 9 });
  assert.equal(heavyPlan.operations.length, 1, 'a heavier load is still one operation');
  assert.equal(heavyPlan.operations[0].paintLoad, 9);
  assert.equal(heavyPlan.operations[0].brushSize, defaultPlan.operations[0].brushSize,
    'paint load does not change the stamp radius');
  assert.equal(heavyPlan.operations[0].color.alpha, defaultPlan.operations[0].color.alpha,
    'paint load does not change the stamp alpha, so layer.opacity still rules');

  // layer.opacity must survive the load: a 125/255 layer stays lighter than an
  // opaque one at the SAME load. This is acceptance criterion 5.
  const opaquePlan = new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile({ layers: [{ ...loadStory.layers[0], opacity: 255 }] }, loadRectangle);
  assert.ok(opaquePlan.operations[0].color.alpha > heavyPlan.operations[0].color.alpha,
    'a semi-transparent layer stays lighter than an opaque one whatever the load');

  // playPlan() deposits the frozen load, all under one operation index.
  const loadCalls = [];
  const loadRegistry = new UnpaintedRangeRegistry(heavyPlan.operations.length);
  const loadResult = await new TilecraftStrokePlayer({
    beginStroke(options) { loadCalls.push(['begin', options.x, options.brushSize, options.randomizeBristles]); },
    strokeTo() { loadCalls.push(['to']); },
    endStroke() { loadCalls.push(['end']); },
    strokeActive: false,
  }).playPlan(heavyPlan, {
    registry: loadRegistry,
    waitFrame: async () => {},
  });
  assert.equal(loadCalls.filter(([kind]) => kind === 'begin').length, 9,
    'playPlan deposits the plan\'s nine contacts');
  assert.ok(loadCalls.every(([kind]) => kind !== 'to'),
    'a stamp never calls strokeTo: a live strokeTo would only move the target');
  const loadBegins = loadCalls.filter(([kind]) => kind === 'begin');
  assert.ok(loadBegins.every(([, , , randomize]) => randomize === true),
    'every spot contact asks for a fresh bristle layout');
  assert.equal(new Set(loadBegins.map(([, x, size]) => `${x}:${size}`)).size, 1,
    'contacts repeat the same press: the shader re-randomises the bristles, ' +
    'so they interleave without an offset that would grow the mark');

  // Scatter stays available for a host that wants it, and then it must stay
  // inside the mark rather than enlarging it.
  const scatteredPlan = new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(loadStory, { ...loadRectangle, spotPaintLoad: 5, spotScatter: 0.25 });
  assert.equal(scatteredPlan.operations[0].scatter, 0.25, 'scatter is frozen into the plan');
  assert.equal(defaultPlan.operations[0].scatter, 0, 'but it is off by default');
  const scatterCalls = [];
  await new TilecraftStrokePlayer({
    beginStroke(options) { scatterCalls.push(options); },
    strokeTo() {}, endStroke() {}, strokeActive: false,
  }).playPlan(scatteredPlan, { waitFrame: async () => {} });
  const radius = scatteredPlan.operations[0].brushSize;
  const origin = scatteredPlan.operations[0].point;
  assert.equal(scatterCalls.length, 5, 'five scattered contacts');
  assert.deepEqual([scatterCalls[0].x, scatterCalls[0].y], [origin.x, origin.y],
    'the first contact is always centred, so a mark never drifts off its tile');
  assert.equal(new Set(scatterCalls.map((o) => `${o.x}:${o.y}`)).size, 5,
    'the rest land apart when scatter is requested');
  for (const call of scatterCalls) {
    assert.ok(Math.hypot(call.x - origin.x, call.y - origin.y) <= 0.25 * radius + 1e-9,
      'and every one stays within the requested scatter disc');
  }
  assert.throws(() => new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(loadStory, { ...loadRectangle, spotScatter: 1.5 }),
  /fraction of the radius/, 'a scatter beyond the radius is rejected');
  assert.equal(loadRegistry.pendingCount, 0, 'the one operation is marked painted exactly once');
  assert.ok(loadResult.completed, 'and the run completes');

  assert.throws(() => new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(loadStory, { ...loadRectangle, spotPaintLoad: 0 }),
  /positive integer/, 'a zero load is rejected rather than painting nothing');
  assert.throws(() => new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(loadStory, { ...loadRectangle, spotPaintLoad: 2.5 }),
  /positive integer/, 'a fractional contact count is rejected');

  // A GPU-capable engine can still replay the older bristle path on request.
  // The chosen mode and paint load are frozen with the plan for navigation.
  const pathStory = { layers: [{ visible: true, tileShape: 'polyline', gridSize: 8,
    tiles: [{ x: 1, y: 1, c: '#ff0000', g: 1 },
      { x: 8, y: 1, c: '#ff0000', g: 1 }] }] };
  const pathCalls = [];
  const pathEngine = {
    beginStroke() { pathCalls.push('begin'); },
    strokeTo() { pathCalls.push('to'); },
    endStroke() { pathCalls.push('end'); },
    paintPathSegment(options) { pathCalls.push(['gpu', options.paintLoad, options.overlapWith]); },
    strokeActive: false,
  };
  const pathPlayer = new TilecraftStrokePlayer(pathEngine);
  const autoPath = pathPlayer.compile(pathStory, loadRectangle);
  assert.equal(autoPath.operations[0].analyticPath, true,
    'the default keeps the current GPU mode on a capable engine');
  assert.equal(autoPath.operations[0].pathJoinCorrection, true,
    'GPU join correction is enabled by default');
  const brushPath = pathPlayer.compile(pathStory, {
    ...loadRectangle, canvasSize: { width: 1900, height: 1000 }, pathMode: 'bristle',
  });
  assert.equal(brushPath.operations[0].analyticPath, false);
  assert.ok(Math.abs(brushPath.operations[0].brushSize - 8 * 1900 / 3000) < 1e-9,
    'explicit bristle mode restores the old canvas-dependent polyline width');
  assert.ok(brushPath.operations[0].brushSize > autoPath.operations[0].brushSize,
    'the old width is not silently narrowed by the new export ratio');
  const groupedPath = { layers: [{ visible: true, tileShape: 'polyline', gridSize: 8,
    tiles: [{ x: 0, y: 1, c: '#ff0000', g: 1 },
      { x: 7, y: 1, c: '#ff0000', g: 1, gd: 5 },
      { x: 14, y: 1, c: '#ff0000', g: 1, gd: 10 }] }] };
  const legacyGroupPath = pathPlayer.compile(groupedPath,
    { ...loadRectangle, pathMode: 'bristle' });
  assert.ok(Math.abs(legacyGroupPath.operations[0].brushSize - 8 * (14 / 5)) < 1e-9,
    'explicit bristle mode also restores the prior group scale');
  pathCalls.length = 0;
  await pathPlayer.playPlan(brushPath, { waitFrame: async () => {} });
  assert.ok(pathCalls.includes('begin') && pathCalls.includes('to'));
  assert.ok(!pathCalls.some((call) => Array.isArray(call) && call[0] === 'gpu'));
  const gpuPath = pathPlayer.compile(pathStory,
    { ...loadRectangle, pathMode: 'gpu', pathPaintLoad: 3 });
  pathCalls.length = 0;
  await pathPlayer.playPlan(gpuPath, { waitFrame: async () => {} });
  assert.ok(pathCalls.some((call) => Array.isArray(call) && call[0] === 'gpu' && call[1] === 3));
  assert.ok(!pathCalls.includes('begin'));
  assert.equal(pathCalls.filter((call) => Array.isArray(call))[1][2]?.from.x,
    gpuPath.operations[0].point.x, 'the default GPU path corrects its first join');
  const legacyGpuPath = pathPlayer.compile(pathStory,
    { ...loadRectangle, pathMode: 'gpu', pathJoinCorrection: false });
  pathCalls.length = 0;
  await pathPlayer.playPlan(legacyGpuPath, { waitFrame: async () => {} });
  assert.ok(pathCalls.every((call) => !Array.isArray(call) || !call[2]),
    'pathJoinCorrection=false preserves the previous overlap');
  const correctedPath = pathPlayer.compile(groupedPath,
    { ...loadRectangle, pathMode: 'gpu', pathJoinCorrection: true });
  pathCalls.length = 0;
  await pathPlayer.playPlan(correctedPath, { waitFrame: async () => {} });
  const correctedDraws = pathCalls.filter((call) => Array.isArray(call));
  assert.equal(correctedDraws.length, 3);
  assert.equal(correctedDraws[0][2], null, 'first point paints normally');
  assert.deepEqual(correctedDraws[1][2].from, correctedPath.operations[0].point,
    'first leg subtracts the starting disc');
  assert.deepEqual(correctedDraws[1][2].to, correctedPath.operations[0].point);
  assert.deepEqual(correctedDraws[2][2].from, correctedPath.operations[0].point,
    'next leg subtracts the prior capsule');
  assert.throws(() => pathPlayer.compile(pathStory,
    { ...loadRectangle, pathJoinCorrection: 1 }), /boolean/);
  assert.throws(() => pathPlayer.compile(pathStory,
    { ...loadRectangle, pathMode: 'unknown' }), /pathMode/);
  assert.throws(() => new TilecraftStrokePlayer({
    beginStroke() {}, strokeTo() {}, endStroke() {},
  }).compile(pathStory, { ...loadRectangle, pathMode: 'gpu' }), /paintPathSegment/);

  console.log('tilecraft spot paint load: PASS (coverage without geometry, alpha or extra operations)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
