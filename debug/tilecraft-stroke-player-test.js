const assert = require('node:assert/strict');
const TilecraftStrokePlayer = require('../fluid-engine/tilecraft-stroke-player.js');
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

assert.deepEqual(calls.map(([kind]) => kind), [
  'begin', 'to', 'to', 'to', 'end', // closed g=1 polyline
  'begin', 'end',                   // g=2 before b
  'begin', 'to', 'end',             // g=2 after b
  'begin', 'end',                   // polygon spot, after every polyline
]);
assert.equal(calls[0][1].timing, 'replay');
assert.deepEqual(calls[0][1].color.channels, [1, 0, 0]);
assert.equal(calls[0][1].brushSize, 8, 'polyline uses its largest tile scale');
assert.equal(calls[1][1].pressure, 1);
assert.deepEqual(calls[3][1], { x: 100, y: 200, pressure: 0.5 }, 'gz closes to first point');
assert.equal(calls.at(-2)[1].brushSize, 60, 'polygon tile size creates one spot');
assert.equal(calls.at(-2)[1].timing, 'live', 'polygon spot is an immediate live tap');
assert.ok(TilecraftStrokePlayer.rybToRgb(calls.at(-2)[1].color.channels)
  .every((value) => Number.isFinite(value)), 'RGB input is converted to finite RYB pigment loads');
assert.ok(Math.abs(calls.at(-2)[1].color.alpha - 0.1 * (128 / 255) * (128 / 255)) < 1e-12);
assert.deepEqual(stats, { layers: 2, strokes: 4, spots: 1, points: 8, skipped: 0 });
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#ffffff'), [0, 0, 0, 1], 'white is no RYB pigment');
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#000000'), [1, 1, 1, 1], 'black uses all pigments');
assert.deepEqual(TilecraftStrokePlayer.hexToPigment('#ff0000'), [1, 0, 0, 1], 'red is a cube corner');
assert.throws(() => TilecraftStrokePlayer.hexToPigment('#bad'), /#RRGGBB/);

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
assert.equal(scaledCalls[0].brushSize, 2.5,
  'width applies Tilecraft gd scale, 3000px canvas ratio, and map coordinate scale');

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
const framedOptions = { paintingRectangle: { left: 0, bottom: 0, width: 100, height: 100 } };
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
    ['begin', 'live'], ['end'],         // polygon: one live tap
  ]);
  assert.equal(frames, 6, 'each point target and spot waits the requested number of frames');
  assert.deepEqual(liveStats, { layers: 2, strokes: 2, spots: 1, points: 3, skipped: 0 });
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
  assert.deepEqual(planCalls, [['begin', 2, 0.5], ['to', 3], ['end']],
    'playPlan combines the fixed brush-size correction with its runtime thickness multiplier');
  assert.equal(TilecraftStrokePlayer.brushSizeCorrectionRate, 0.5,
    'story playback exposes its fixed brush-size correction rate');
  assert.equal(registry.pendingCount, 0);
  console.log('tilecraft plan navigation: PASS (frame ranges and no double paint)');

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
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
