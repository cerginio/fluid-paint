'use strict';

const assert = require('node:assert/strict');
const {
  createFluidUiPresetApi,
  parseFluidUiConfig,
  resolveFluidUiConfig,
} = require('../app/ui/preset-api.js');

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

async function main() {
  const { ToolPanel } = require('../app/ui/panel.js');
  const layout = { _scheduleLayout() {}, _hostRegions: [] };
  const setLayout = (value) => ToolPanel.prototype.setHostLayout.call(layout, value);
  const regions = [{ left: 10, top: 10, right: 310, bottom: 66 }];
  setLayout({ version: 1, regions });
  regions[0].bottom = 999;
  assert.equal(layout._hostRegions[0].bottom, 66, 'layout owns its copied CSS bounds');
  for (const invalid of [null, { version: 2, regions: [] }, { version: 1, regions: [{ left: NaN }] },
    { version: 1, regions: [{ left: 2, top: 0, right: 1, bottom: 10 }] },
    { version: 1, regions: Array(3).fill({ left: 0, top: 0, right: 1, bottom: 1 }) }]) {
    throwsCode(() => setLayout(invalid), 'INVALID_UI_LAYOUT');
    assert.equal(layout._hostRegions[0].bottom, 66, 'invalid bounds never mutate active layout');
  }
  setLayout({ version: 1, regions: [] });
  assert.deepEqual(layout._hostRegions, [], 'close can clear exclusion bounds');
  assert.deepEqual(resolveFluidUiConfig().resolvedFeatures, [
    'color-picker', 'brush-size', 'colors-options', 'brush-options',
    'player', 'demo-r2', 'file-bg', 'file-play', 'state-bake',
  ]);
  assert.deepEqual(resolveFluidUiConfig({ mode: 'empty' }).resolvedFeatures, []);
  assert.deepEqual(resolveFluidUiConfig({ mode: 'preset', preset: 'draw-min' }).resolvedFeatures,
    ['color-picker', 'brush-size']);
  assert.deepEqual(resolveFluidUiConfig({
    mode: 'preset', preset: 'draw-min', features: ['state-bake', 'color-picker'],
  }).resolvedFeatures, ['color-picker', 'brush-size', 'state-bake']);
  assert.deepEqual(resolveFluidUiConfig({
    mode: 'preset', preset: 'draw-min', features: ['brush-options', 'state-bake'],
  }).resolvedFeatures, ['color-picker', 'brush-size', 'brush-options', 'state-bake']);
  throwsCode(() => resolveFluidUiConfig({ mode: 'features', features: [] }), 'UI_FEATURES_REQUIRED');
  throwsCode(() => resolveFluidUiConfig({ mode: 'features', features: ['bogus'] }), 'UNKNOWN_UI_FEATURE');
  throwsCode(() => resolveFluidUiConfig({ mode: 'features', features: ['demo-r2'] }), 'UI_FEATURE_DEPENDENCY');
  throwsCode(() => resolveFluidUiConfig({ mode: 'preset', preset: 'draw-min', features: ['demo-r2'] }), 'UI_FEATURE_DEPENDENCY');
  assert.deepEqual(resolveFluidUiConfig({ mode: 'features', features: ['demo-r2', 'player'] }).resolvedFeatures,
    ['player', 'demo-r2']);
  assert.equal(resolveFluidUiConfig({ mode: 'preset', preset: 'draw-min', features: ['demo-r2', 'player'] })
    .resolvedFeatures.includes('demo-r2'), true);
  throwsCode(() => parseFluidUiConfig('?uiPreset=draw-min'), 'UI_MODE_REQUIRED');
  throwsCode(() => parseFluidUiConfig('?uiMode=full&uiMode=empty'), 'MULTIPLE_UI_MODES');
  throwsCode(() => parseFluidUiConfig('?uiMode=features&uiFeatures=,,,'), 'UI_FEATURES_REQUIRED');

  const calls = [];
  const api = createFluidUiPresetApi({
    initialConfig: { mode: 'empty' },
    adapter: { apply(features) { calls.push([...features]); } },
  });
  assert.equal(api.getState().revision, 0);
  assert.deepEqual(calls, [[]]);
  await api.configure({ mode: 'preset', preset: 'draw-min' });
  assert.equal(api.getState().revision, 1);
  assert.deepEqual(calls.at(-1), ['color-picker', 'brush-size']);
  await api.configure({ mode: 'features', features: ['brush-size', 'color-picker'] });
  assert.equal(api.getState().revision, 2, 'declarative config change increments revision');
  assert.equal(calls.length, 2, 'same resolved features do not touch DOM');
  await api.configure({ mode: 'features', features: ['color-picker', 'brush-size'] });
  assert.equal(api.getState().revision, 2, 'same normalized config is idempotent');
  api.dispose();
  await assert.rejects(api.configure({ mode: 'full' }), (error) => error.code === 'UI_API_DISPOSED');

  console.log('Fluid UI Preset API tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
