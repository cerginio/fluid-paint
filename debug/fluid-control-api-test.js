'use strict';

const assert = require('node:assert/strict');
const { FluidControlApi, hexToPaintHsva } = require('../app/fluid-control-api.js');
const fs = require('node:fs');
const path = require('node:path');
const Paint = new Function('FluidControlApi', 'Utilities', 'MIN_BRUSH_SCALE', 'MAX_BRUSH_SCALE',
  'MAX_EXTERNAL_BRUSH_SCALE', 'MIN_BRISTLE_COUNT', 'MAX_BRISTLE_COUNT',
  fs.readFileSync(path.join(__dirname, '../paint.js'), 'utf8') + '\nreturn Paint;')(
  FluidControlApi, { clamp: (value, min, max) => Math.max(min, Math.min(max, value)) }, 5, 75, 112.5, 10, 160);

async function checkDefaults(controller) {
  const painter = Object.create(Paint.prototype);
  painter.engine = {
    fluidity: 0.7, bristleCount: 12,
    setSimulation({ fluidity }) { this.fluidity = fluidity; },
    setBrush({ bristleCount }) { this.bristleCount = bristleCount; },
  };
  painter.brushScale = 32;
  painter.brushColorHSVA = [0, 1, 1, 1];
  const slider = () => ({ div: { setAttribute() {} }, setValue(value) { this.value = value; } });
  for (const name of ['fluiditySlider', 'bristleCountSlider', 'brushSizeSlider', 'barSizeSlider']) painter[name] = slider();
  const api = new FluidControlApi(painter, controller);
  const defaults = { fluidity: 0.9, bristleCount: 40, brushSize: 75 };
  api.configureMode('fluid-rescript', { defaultsVersion: 1, defaults });
  assert.equal(painter.manualPaintingEnabled, false);
  assert.equal(painter.engine.bristleCount, 12, 'defaults wait for the loaded scene');
  api.activateTransfer('defaults-1');
  await assert.rejects(api.execute({ transferId: 'defaults-1', command: 'setPaintSize', value: 30 }), { code: 'MODE_OPENING' });
  assert.throws(() => api.completeOpening('old'), { code: 'STALE_TRANSFER' });
  assert.deepEqual(api.completeOpening('defaults-1'), { defaultsVersion: 1, appliedDefaults: defaults });
  assert.equal(painter.manualPaintingEnabled, true);
  assert.equal(painter.engine.fluidity, 0.9);
  assert.equal(painter.engine.bristleCount, 40);
  assert.equal(painter.brushScale, 75);
  assert.equal(painter.fluiditySlider.value, 0.9);
  assert.equal(painter.bristleCountSlider.value, Math.sqrt((40 - 10) / 150));
  assert.equal(painter.brushSizeSlider.value, 75);
  assert.equal(painter.barSizeSlider.value, 75);

  const before = () => ({ state: api.getState(), manual: painter.manualPaintingEnabled,
    pending: api.pendingDefaults, receipt: api.defaultsReceipt });
  const invalid = [
    { defaultsVersion: 1 }, { defaults }, { defaultsVersion: 2, defaults },
    { defaultsVersion: '1', defaults }, { defaultsVersion: null, defaults },
    ...[null, [], 'bad', { ...defaults, extra: 1 }, {}, Object.create({ ...defaults })]
      .map(value => ({ defaultsVersion: 1, defaults: value })),
  ];
  for (const [field, values] of Object.entries({
    fluidity: [0.099, 0.901, '0.9', null, NaN, Infinity],
    bristleCount: [9, 161, 40.5, '40', null, NaN, Infinity],
    brushSize: [4.99, 112.51, '75', null, NaN, Infinity],
  })) {
    for (const value of values) invalid.push({ defaultsVersion: 1, defaults: { ...defaults, [field]: value } });
    const missing = { ...defaults }; delete missing[field];
    invalid.push({ defaultsVersion: 1, defaults: missing });
  }
  for (const [index, options] of invalid.entries()) {
    const snapshot = before();
    assert.throws(() => api.configureMode('fluid-rescript', options));
    assert.deepEqual(before(), snapshot, 'invalid RPC preserves previous session and painter');
    if (index >= 5) assert.throws(() => painter.applyFluidDefaults(options.defaults));
    assert.deepEqual(before(), snapshot, 'invalid painter input is checked before any mutation');
  }
  const snapshot = before();
  assert.throws(() => api.configureMode('fluid-play', { defaultsVersion: 1, defaults }), { code: 'DEFAULTS_NOT_ALLOWED' });
  assert.deepEqual(before(), snapshot);

  let notifications = 0;
  api.subscribe(() => { notifications++; });
  painter.setPaintSize(80);
  assert.equal(api.getState().paintSize, 80);
  assert.equal(painter.brushSizeSlider.value, 80);
  assert.equal(painter.barSizeSlider.value, 80);
  assert.ok(notifications > 0);
  painter.engine.setSimulation({ fluidity: 0.4 });
  painter.engine.setBrush({ bristleCount: 60 });
  painter._notifyPaintParameters();
  assert.equal(api.getState().fluidity, 0.4);
  assert.equal(api.getState().bristleCount, 60);
  api.completeOpening('defaults-1');
  assert.equal(painter.engine.fluidity, 0.4, 'opening receipt is idempotent; later changes survive');
  assert.equal(painter.brushScale, 80);

  for (const values of [{ fluidity: 0.1, bristleCount: 10, brushSize: 5 },
    { fluidity: 0.9, bristleCount: 160, brushSize: 112.5 }]) {
    api.configureMode('fluid-rescript', { defaultsVersion: 1, defaults: values });
    api.activateTransfer('boundary');
    assert.deepEqual(api.completeOpening('boundary').appliedDefaults, values);
  }
  api.configureMode('fluid-rescript', { defaultsVersion: 1, defaults });
  api.activateTransfer('reentry');
  assert.deepEqual(api.completeOpening('reentry').appliedDefaults, defaults);

  const apply = painter.applyFluidDefaults;
  api.configureMode('fluid-rescript', { defaultsVersion: 1, defaults });
  api.activateTransfer('failure');
  painter.applyFluidDefaults = () => { throw new Error('GPU apply failed'); };
  assert.throws(() => api.completeOpening('failure'), /GPU apply failed/);
  assert.equal(painter.manualPaintingEnabled, false);
  assert.equal(api.defaultsReceipt, null);
  painter.applyFluidDefaults = () => ({ ...defaults, brushSize: 74 });
  assert.throws(() => api.completeOpening('failure'), { code: 'FLUID_DEFAULTS_NOT_APPLIED' });
  assert.equal(painter.manualPaintingEnabled, false);
  painter.applyFluidDefaults = apply;
  api.dispose();
  assert.equal(painter.paintParameterListeners.size, 0);
  console.log(`Fluid defaults API: ${invalid.length} invalid payloads, boundaries/lifecycle/real Paint adapter/state PASS`);
}

function hsvToChannels([h, s, v]) {
  const c = v * s;
  const section = h * 6;
  const x = c * (1 - Math.abs(section % 2 - 1));
  const i = Math.floor(section) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  const m = v - c;
  return rgb.map((channel) => channel + m);
}

(async () => {
  let controllerListener = null;
  const controller = {
    state: 'ready', speed: 8, thickness: 1,
    subscribe(listener) { controllerListener = listener; return () => { controllerListener = null; }; },
    _viewModel() {
      return {
        state: this.state,
        speed: this.speed,
        thickness: this.thickness,
        progress: { paintedOperations: 0 },
      };
    },
    play: async () => { controller.state = 'playing'; controllerListener?.(); return true; },
    pause: () => { controller.state = 'paused'; controllerListener?.(); return true; },
    restart: async () => true,
    setSpeed: async (value) => { controller.speed = value; controllerListener?.(); return true; },
    setThickness: async (value) => { controller.thickness = value; controllerListener?.(); return true; },
  };
  const calls = [];
  const painter = {
    adhocPaintColor: null,
    brushColorHSVA: [0, 1, 1, 1],
    brushScale: 50,
    manualPaintingEnabled: true,
    setManualPaintingEnabled(value) { this.manualPaintingEnabled = value; return true; },
    setPaintColor(value) { calls.push(['color', value]); this.adhocPaintColor = typeof value === 'string' ? value : null; return value; },
    setPaintSize(value) { calls.push(['size', value]); this.brushScale = value; return value; },
    async clear() { calls.push(['clear']); },
  };
  const api = new FluidControlApi(painter, controller);
  const play = api.configureMode('fluid-play');
  assert.deepEqual(play.wants, ['model']);
  assert.deepEqual(play.ui, { mode: 'empty' });
  assert.equal(painter.manualPaintingEnabled, true);
  assert.equal(api.getState().allowDrawing, true);
  assert.equal(api.getState().autoplay, true);
  assert.equal(api.getState().playbackSpeed, 1);
  api.activateTransfer('play-1');
  assert.equal(api.startAutoplay('play-1'), true);
  await new Promise(queueMicrotask);
  assert.equal(api.getState().status, 'playing');
  await api.execute({ transferId: 'play-1', command: 'setPlaybackThickness', value: 0.6 });
  assert.equal(api.getState().playbackThickness, 0.6);
  assert.equal(painter.brushScale, 50, 'playback thickness does not change the manual brush size');
  await api.execute({ transferId: 'play-1', command: 'setDrawingEnabled', value: false });
  assert.equal(api.getState().allowDrawing, false);
  assert.equal(painter.manualPaintingEnabled, false);
  await assert.rejects(api.execute({ transferId: 'play-1', command: 'clearPaint' }), { code: 'CONTROL_NOT_ALLOWED' });
  await assert.rejects(api.execute({ transferId: 'stale', command: 'pause' }), { code: 'STALE_TRANSFER' });

  const optedOut = api.configureMode('fluid-play', {
    allowDrawing: false, autoplay: false, playbackSpeed: 2,
  });
  assert.deepEqual(optedOut.ui, { mode: 'empty' });
  assert.equal(api.getState().allowDrawing, false);
  assert.equal(api.getState().autoplay, false);
  assert.equal(api.getState().playbackSpeed, 2);

  const customHex = '#3b82f6';
  const rescript = api.configureMode('fluid-rescript', { palette: ['white', 'black', customHex] });
  assert.deepEqual(rescript.wants, ['background']);
  assert.deepEqual(rescript.ui, {
    mode: 'preset',
    preset: 'draw-min',
    features: ['brush-options', 'state-bake'],
  });
  assert.equal(painter.manualPaintingEnabled, true);
  api.activateTransfer('rescript-1');
  await api.execute({ transferId: 'rescript-1', command: 'setPaintColor', value: 'black' });
  await api.execute({ transferId: 'rescript-1', command: 'setPaintColor', value: customHex });
  const customHsva = calls.at(-1)[1];
  assert.equal(customHsva, customHex, 'custom RGB palette colour is passed as exact display HEX');
  const requestedRgb = [0x3b, 0x82, 0xf6].map((channel) => channel / 255);
  assert.ok(hsvToChannels(hexToPaintHsva(customHex)).every(
    (channel, index) => Math.abs(channel - requestedRgb[index]) < 1e-12
  ), 'HEX helper reports display RGB, not Natural inverse pigment');
  await assert.rejects(api.execute({ transferId: 'rescript-1', command: 'setPaintColor', value: '#ffffff' }), {
    code: 'PAINT_COLOR_NOT_ALLOWED',
  });
  await api.execute({ transferId: 'rescript-1', command: 'setPaintSize', value: 70 });
  await api.execute({ transferId: 'rescript-1', command: 'clearPaint' });
  assert.deepEqual(calls.slice(-2), [['size', 70], ['clear']]);
  await assert.rejects(api.execute({ transferId: 'rescript-1', command: 'resetScene' }), {
    code: 'CONTROL_NOT_ALLOWED',
  });
  api.dispose();
  assert.equal(controllerListener, null);
  await checkDefaults(controller);
  console.log('Fluid control API: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
