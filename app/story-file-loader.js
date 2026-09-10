'use strict';

const STORY_FILE_MAX_BYTES = 25 * 1024 * 1024;
const STORY_FILE_MAX_TILES = 500000;

class StoryFileLoader {
  static async load(file) {
    if (!file || typeof file.text !== 'function') {
      throw new TypeError('Choose a local JSON file.');
    }
    if (file.size > STORY_FILE_MAX_BYTES) {
      throw new RangeError('This file exceeds the 25 MB local limit.');
    }
    let model;
    try {
      model = JSON.parse(await file.text());
    } catch (_) {
      throw new SyntaxError('This file is not valid JSON.');
    }
    return { model, summary: StoryFileLoader.summarize(model, file.name, file.size) };
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
    const points = [];
    const groups = new Set();

    model.layers.forEach((layer, layerIndex) => {
      if (!layer || !Array.isArray(layer.tiles)) return;
      tilesTotal += layer.tiles.length;
      if (tilesTotal > STORY_FILE_MAX_TILES) {
        throw new RangeError(`This story exceeds the ${STORY_FILE_MAX_TILES.toLocaleString()} tile limit.`);
      }
      if (!layer.visible) { invisibleLayers++; return; }
      if (layer.tileShape !== 'polyline' && layer.tileShape !== 'polygon') {
        if (layer.tiles.length) unsupportedLayers++;
        return;
      }
      layer.tiles.forEach((tile, tileIndex) => {
        const valid = tile && Number.isFinite(tile.x) && Number.isFinite(tile.y) &&
          typeof tile.c === 'string' && tile.v !== 0;
        if (!valid) { malformed++; return; }
        drawable++;
        points.push(tile);
        if (layer.tileShape === 'polyline') {
          polylinePoints++;
          groups.add(`${layerIndex}:${tile.f === undefined ? 'unassigned' : tile.f}:` +
            `${tile.g === undefined ? `tile-${tileIndex}` : tile.g}`);
        } else {
          polygonSpots++;
          groups.add(`${layerIndex}:${tile.f === undefined ? 'unassigned' : tile.f}:spot-${tileIndex}`);
        }
      });
    });

    if (!drawable) throw new TypeError('No supported visible strokes were found.');

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
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
      bounds: {
        left: Math.min(...xs), right: Math.max(...xs),
        top: Math.min(...ys), bottom: Math.max(...ys),
      },
      warnings,
    };
  }
}

StoryFileLoader.MAX_BYTES = STORY_FILE_MAX_BYTES;
StoryFileLoader.MAX_TILES = STORY_FILE_MAX_TILES;

if (typeof module !== 'undefined' && module.exports) module.exports = StoryFileLoader;
if (typeof globalThis !== 'undefined') globalThis.StoryFileLoader = StoryFileLoader;

