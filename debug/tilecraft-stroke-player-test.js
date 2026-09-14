const assert = require('node:assert/strict');
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
  assert.deepEqual(planCalls, [['begin', 2, 0.5], ['to', 3], ['end']],
    'playPlan combines the fixed brush-size correction with its runtime thickness multiplier');
  assert.equal(TilecraftStrokePlayer.brushSizeCorrectionRate, 0.5,
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
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
