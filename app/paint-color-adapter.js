'use strict';

// Контракт застосунку: docs/PATCH-PALETTE-AND-SHADER-BUNDLE-SPEC.md §3.1–3.3.
// space:'pigment' містить закодований RGB; використовувати лише з COLOR_MODEL.RGB.
const PaintColorAdapter = Object.freeze({
  encodeRgb(rgb) {
    if (!Array.isArray(rgb) || rgb.length !== 3 ||
        rgb.some((c) => typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1)) {
      throw new TypeError('RGB must contain three finite channels in [0, 1].');
    }
    return [1 - rgb[1], 1 - rgb[0], 1 - rgb[2]];
  },

  paletteRgb(h, s, v, paletteMode) {
    if (paletteMode !== 'natural' && paletteMode !== 'digital') {
      throw new TypeError('Unknown palette mode: ' + paletteMode);
    }
    if ([h, s, v].some((c) => typeof c !== 'number' || !Number.isFinite(c)) ||
        s < 0 || s > 1 || v < 0 || v > 1) {
      throw new TypeError('HSV requires finite hue and saturation/value in [0, 1].');
    }
    return hsvToPigmentRgb(h, s, v, paletteMode === 'digital');
  },

  hexRgb(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) {
      throw new TypeError('HEX must be #RRGGBB.');
    }
    return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  },

  strokeColor(rgb, alpha) {
    if (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new TypeError('Alpha must be finite and in [0, 1].');
    }
    return { space: 'pigment', channels: this.encodeRgb(rgb), alpha };
  },
});
