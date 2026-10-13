'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = ['common.js', 'app/ui/ryb.js', 'app/paint-color-adapter.js']
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const { adapter, palette, black } = new Function(source +
  '\nreturn {adapter:PaintColorAdapter,palette:hsvToPigmentRgb,black:setPigmentBlack};')();

test('RGB encoding preserves channel order, endpoints and input', () => {
  for (const rgb of [[1, 1, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [.17, .43, .79]]) {
    const before = [...rgb];
    const channels = adapter.encodeRgb(rgb);
    assert.deepEqual(channels, [1 - rgb[1], 1 - rgb[0], 1 - rgb[2]]);
    assert.ok([1 - channels[1], 1 - channels[0], 1 - channels[2]]
      .every((c, i) => Math.abs(c - rgb[i]) < 1e-15));
    assert.deepEqual(rgb, before);
    assert.notEqual(channels, rgb);
  }
});

test('both existing palettes and black-corner policies round-trip on the full HSV grid', () => {
  for (const enabled of [false, true]) {
    black(enabled);
    for (const mode of ['natural', 'digital']) {
      for (let hue = 0; hue < 24; hue++) {
        for (const s of [0, .25, .5, .75, 1]) for (const v of [0, .25, .5, .75, 1]) {
          const rgb = adapter.paletteRgb(hue / 24, s, v, mode);
          assert.deepEqual(rgb, palette(hue / 24, s, v, mode === 'digital'));
          const encoded = adapter.encodeRgb(rgb);
          assert.ok([1 - encoded[1], 1 - encoded[0], 1 - encoded[2]]
            .every((c, i) => Math.abs(c - rgb[i]) < 1e-15));
        }
      }
    }
  }
  black(true);
});

test('direct HEX remains exact without passing through Natural', () => {
  for (const hex of ['#000000', '#ffffff', '#123456', '#Ff0080']) {
    const expected = [1, 3, 5].map((i) => Number('0x' + hex.slice(i, i + 2)) / 255);
    assert.deepEqual(adapter.hexRgb(hex), expected);
    assert.deepEqual(adapter.strokeColor(adapter.hexRgb(hex), .37), {
      space: 'pigment', channels: [1 - expected[1], 1 - expected[0], 1 - expected[2]], alpha: .37,
    });
  }
});

test('payload owns its channels; palette changes cannot mutate a saved color', () => {
  const rgb = [.1, .2, .3];
  const payload = adapter.strokeColor(rgb, 0);
  rgb[0] = 1;
  adapter.paletteRgb(.5, .7, .9, 'digital');
  assert.deepEqual(payload, { space: 'pigment', channels: [.8, .9, .7], alpha: 0 });
  assert.equal(adapter.strokeColor([0, 0, 0], 1).alpha, 1);
});

test('invalid inputs fail explicitly rather than silently clamp or repair', () => {
  for (const rgb of [null, [0, 1], [0, 1, 2], [NaN, 0, 0], [Infinity, 0, 0], ['0', 0, 0], [-.1, 0, 0]]) {
    assert.throws(() => adapter.encodeRgb(rgb), TypeError);
  }
  for (const hex of ['123456', '#fff', '#zz0000', '#12345678', null]) {
    assert.throws(() => adapter.hexRgb(hex), TypeError);
  }
  for (const alpha of [-1, 2, NaN, Infinity, undefined, '1']) {
    assert.throws(() => adapter.strokeColor([0, 0, 0], alpha), TypeError);
  }
  assert.throws(() => adapter.paletteRgb(0, 1, 1, 'rgb'), TypeError);
  for (const hsv of [[NaN, 1, 1], [0, -1, 1], [0, 1, 2]]) {
    assert.throws(() => adapter.paletteRgb(...hsv, 'natural'), TypeError);
  }
});

test('adapter loads in source and phase B production producers use it', () => {
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /src="app\/paint-color-adapter.js"/);
  assert.match(fs.readFileSync(path.join(root, 'gulpfile.js'), 'utf8'), /'app\/paint-color-adapter.js'/);
  assert.match(fs.readFileSync(path.join(root, 'paint.js'), 'utf8'), /PaintColorAdapter\.strokeColor/);
  assert.match(fs.readFileSync(path.join(root, 'app/story-playback-controller.js'), 'utf8'),
    /canvasColorFormat: 'encoded-rgb'/);
  assert.match(fs.readFileSync(path.join(root, 'fluid-engine/tilecraft-stroke-player.js'), 'utf8'),
    /hexToEncodedRgb/);
});
