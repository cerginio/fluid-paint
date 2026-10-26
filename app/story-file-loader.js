'use strict';

const STORY_FILE_MAX_BYTES = 25 * 1024 * 1024;
const STORY_FILE_MAX_TILES = 500000;

// Preflight must accept exactly what the compiler accepts and count what the
// player will actually draw, so both shape sets come from Tilecraft's
// fluid-model when it is loaded. The fallbacks keep this module usable
// standalone (tests, workers) and must stay in step with
// vendor/tilecraft/fluid-model.js.
const STORY_FILE_PATH_SHAPES = (typeof globalThis !== 'undefined' && globalThis.FLUID_PATH_SHAPES) ||
  new Set(['polyline']);
// `slash` was missing here while the vendored copy carried it, so a slash
// layer was counted as unsupported and silently dropped whenever this module
// ran before fluid-model.js (tests, workers).
const STORY_FILE_SPOT_SHAPES = (typeof globalThis !== 'undefined' && globalThis.FLUID_SPOT_SHAPES) ||
  new Set(['polygon', 'circle', 'slash', 'square', 'rectangle']);
const STORY_FILE_SUPPORTED_SHAPES = (typeof globalThis !== 'undefined' && globalThis.SUPPORTED_FLUID_LAYER_SHAPES) ||
  new Set([...STORY_FILE_PATH_SHAPES, ...STORY_FILE_SPOT_SHAPES]);

class StoryFileLoader {
  static async load(file) {
    if (!file || typeof file.text !== 'function') {
      throw new TypeError('Choose a local JSON file.');
    }
    if (file.size > STORY_FILE_MAX_BYTES) {
      throw new RangeError('This file exceeds the 25 MB local limit.');
    }
    return StoryFileLoader.parse(await file.text(), file.name, file.size);
  }

  static parse(text, fileName = 'story.json', byteSize = 0) {
    if (byteSize > STORY_FILE_MAX_BYTES) {
      throw new RangeError('This story exceeds the 25 MB limit.');
    }
    let model;
    try {
      model = JSON.parse(text);
    } catch (_) {
      throw new SyntaxError('This file is not valid JSON.');
    }
    return { model, summary: StoryFileLoader.summarize(model, fileName, byteSize) };
  }

  static summarize(model, fileName = 'story.json', byteSize = 0) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      throw new TypeError('The Story Model root must be an object.');
    }
    if (!Array.isArray(model.layers)) {
      throw new TypeError('This JSON has no Tilecraft layers array.');
    }

    let tilesTotal = 0;
    let drawable = 0;
    let polylinePoints = 0;
    let polygonSpots = 0;
    let malformed = 0;
    let unsupportedLayers = 0;
    let invisibleLayers = 0;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    const groups = new Set();

    model.layers.forEach((layer, layerIndex) => {
      if (!layer || !Array.isArray(layer.tiles)) return;
      tilesTotal += layer.tiles.length;
      if (tilesTotal > STORY_FILE_MAX_TILES) {
        throw new RangeError(`This story exceeds the ${STORY_FILE_MAX_TILES.toLocaleString()} tile limit.`);
      }
      if (!layer.visible) { invisibleLayers++; return; }
      if (!STORY_FILE_SUPPORTED_SHAPES.has(layer.tileShape)) {
        if (layer.tiles.length) unsupportedLayers++;
        return;
      }
      layer.tiles.forEach((tile, tileIndex) => {
        const valid = tile && Number.isFinite(tile.x) && Number.isFinite(tile.y) &&
          typeof tile.c === 'string' && tile.v !== 0;
        if (!valid) { malformed++; return; }
        drawable++;
        left = Math.min(left, tile.x);
        right = Math.max(right, tile.x);
        top = Math.min(top, tile.y);
        bottom = Math.max(bottom, tile.y);
        // Count by TOPOLOGY, not by name, and use the same sets the compiler
        // uses: only `polyline` is a path. A `square` tile is one independent
        // stamp, so it counts as a spot and gets its own navigable group --
        // the preflight count must equal the number of operations the player
        // will actually compile.
        if (STORY_FILE_PATH_SHAPES.has(layer.tileShape)) {
          polylinePoints++;
          groups.add(`${layerIndex}:${tile.f === undefined ? 'unassigned' : tile.f}:` +
            `${tile.g === undefined ? `tile-${tileIndex}` : tile.g}`);
        } else {
          // `polygonSpots` keeps its published name from the player spec; it
          // counts every spot shape, circle included.
          polygonSpots++;
          groups.add(`${layerIndex}:${tile.f === undefined ? 'unassigned' : tile.f}:` +
            `${tile.g === undefined ? `spot-${tileIndex}` : tile.g}`);
        }
      });
    });

    if (!drawable) throw new TypeError('No supported visible strokes were found.');

    const warnings = [];
    if (unsupportedLayers) warnings.push({
      code: 'unsupported-layers', count: unsupportedLayers,
      message: `${unsupportedLayers} unsupported layer${unsupportedLayers === 1 ? '' : 's'} will be skipped.`,
    });
    if (invisibleLayers) warnings.push({
      code: 'invisible-layers', count: invisibleLayers,
      message: `${invisibleLayers} invisible layer${invisibleLayers === 1 ? '' : 's'} will be skipped.`,
    });
    if (malformed) warnings.push({
      code: 'malformed-tiles', count: malformed,
      message: `${malformed} malformed tile${malformed === 1 ? '' : 's'} will be skipped.`,
    });

    return {
      fileName,
      byteSize,
      layersTotal: model.layers.length,
      layersVisible: model.layers.filter((layer) => layer && layer.visible).length,
      framesTotal: Array.isArray(model.frames) ? model.frames.length : 0,
      tilesTotal,
      drawableItems: drawable,
      polylinePoints,
      polygonSpots,
      logicalGroups: groups.size,
      skippedItems: malformed,
      unsupportedLayers,
      bounds: { left, right, top, bottom },
      warnings,
    };
  }
}

StoryFileLoader.MAX_BYTES = STORY_FILE_MAX_BYTES;
StoryFileLoader.MAX_TILES = STORY_FILE_MAX_TILES;

if (typeof module !== 'undefined' && module.exports) module.exports = StoryFileLoader;
if (typeof globalThis !== 'undefined') globalThis.StoryFileLoader = StoryFileLoader;

