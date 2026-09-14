'use strict';

const assert = require('node:assert/strict');
const TilecraftStrokePlayer = require('../fluid-engine/tilecraft-stroke-player.js');
const { FluidControlApi, hexToPaintHsva } = require('../app/fluid-control-api.js');

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
  const pigment = hsvToChannels(customHsva);
  const expectedPigment = TilecraftStrokePlayer.hexToPigment(customHex).slice(0, 3);
  assert.ok(pigment.every((channel, index) => Math.abs(channel - expectedPigment[index]) < 1e-12),
    'custom RGB palette colour reaches the engine as the inverted pigment load');
  const renderedRgb = TilecraftStrokePlayer.rybToRgb(pigment);
  const requestedRgb = [0x3b, 0x82, 0xf6].map((channel) => channel / 255);
  const squaredError = (actual) => actual.reduce(
    (sum, channel, index) => sum + (channel - requestedRgb[index]) ** 2, 0);
  assert.ok(squaredError(renderedRgb) < squaredError(TilecraftStrokePlayer.rybToRgb(requestedRgb)),
    'inverted pigment is a closer display match than treating RGB channels as RYB');
  assert.deepEqual(hexToPaintHsva(customHex), customHsva);
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
  console.log('Fluid control API: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
