(function (root) {
    "use strict";

    const SUPPORTED_FLUID_LAYER_SHAPES = new Set(["polyline", "polygon"]);
    const TILE_FIELDS = ["x", "y", "c", "f", "g", "b", "gd", "gz", "s", "v"];
    const LAYER_FIELDS = ["id", "tag", "visible", "tileShape", "gridSize", "polygonSize", "scale", "opacity", "mod"];

    function pickDefined(source, fields) {
        return Object.fromEntries(fields
            .filter((field) => source?.[field] !== undefined && source?.[field] !== null)
            .map((field) => [field, source[field]]));
    }

    function structuredFluidError(code, message, details = {}) {
        return Object.assign(new Error(message), { code, details });
    }

    function assertFluidTile(tile, layerId) {
        if (!Number.isFinite(tile?.x) || !Number.isFinite(tile?.y)) {
            throw structuredFluidError("INVALID_COORDINATE", "Fluid tile coordinates must be finite numbers", {
                layerId,
                x: tile?.x,
                y: tile?.y
            });
        }
        if (typeof tile.c !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(tile.c)) {
            throw structuredFluidError("INVALID_COLOR", "Fluid tile color must be #RRGGBB or #RRGGBBAA", {
                layerId,
                color: tile?.c
            });
        }
    }

    function buildFluidStoryModel({
        storyModel,
        frameId = null,
        allFrames = false,
        normalizeGeometry = null
    } = {}) {
        if (!storyModel || !Array.isArray(storyModel.layers) || !Array.isArray(storyModel.frames)) {
            throw structuredFluidError("INVALID_MODEL", "A story model with layers and frames is required");
        }

        const selectedFrames = storyModel.frames
            .filter((frame) => !frame.hid)
            .filter((frame) => allFrames || frameId == null || frame.id == frameId);
        if (!selectedFrames.length) {
            throw structuredFluidError("FRAME_NOT_FOUND", `No visible frame matches ${String(frameId)}`);
        }
        const frameIds = new Set(selectedFrames.map((frame) => frame.id));
        const unsupportedLayers = [];
        const layers = [];

        storyModel.layers.forEach((sourceLayer, layerIndex) => {
            if (!sourceLayer?.visible) return;
            const layerId = sourceLayer.id ?? sourceLayer.tag ?? layerIndex;
            if (!SUPPORTED_FLUID_LAYER_SHAPES.has(sourceLayer.tileShape)) {
                unsupportedLayers.push({
                    layerId,
                    type: sourceLayer.tileShape ?? "unknown",
                    reason: "unsupported-visible-layer"
                });
                return;
            }

            const sourceTiles = (sourceLayer.tiles || []).filter((tile) => frameIds.has(tile.f));
            const outputTiles = [];
            for (const frame of selectedFrames) {
                const frameTiles = sourceTiles.filter((tile) => tile.f == frame.id);
                const normalizedTiles = typeof normalizeGeometry === "function"
                    ? normalizeGeometry({ framePoints: frame.points, tiles: frameTiles, borderOffset: 0 }).tiles
                    : frameTiles.map((tile) => ({ ...tile }));
                for (const tile of normalizedTiles) {
                    assertFluidTile(tile, layerId);
                    outputTiles.push(pickDefined(tile, TILE_FIELDS));
                }
            }

            layers.push({
                ...pickDefined(sourceLayer, LAYER_FIELDS),
                visible: true,
                tiles: outputTiles
            });
        });

        const frames = selectedFrames.map((frame) => {
            if (typeof normalizeGeometry !== "function") return structuredClone(frame);
            const normalized = normalizeGeometry({ framePoints: frame.points, tiles: [], borderOffset: 0 });
            return {
                ...structuredClone(frame),
                points: normalized.framePoints,
                width: normalized.width,
                height: normalized.height
            };
        });

        return {
            model: {
                version: 1,
                layers,
                frames,
                background: storyModel.background ?? null,
                backgroundIdx: storyModel.backgroundIdx ?? null
            },
            metadata: { unsupportedLayers }
        };
    }

    function compileFluidStoryModel(model) {
        if (!model || model.version !== 1 || !Array.isArray(model.layers) || !Array.isArray(model.frames)) {
            throw structuredFluidError("INVALID_MODEL", "Unsupported Fluid story model");
        }
        for (const layer of model.layers) {
            if (!SUPPORTED_FLUID_LAYER_SHAPES.has(layer.tileShape)) {
                throw structuredFluidError("UNSUPPORTED_LAYER", `Unsupported layer shape: ${String(layer.tileShape)}`);
            }
            for (const tile of layer.tiles || []) assertFluidTile(tile, layer.id ?? layer.tag);
        }
        return model;
    }

    root.buildFluidStoryModel = buildFluidStoryModel;
    root.compileFluidStoryModel = compileFluidStoryModel;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { buildFluidStoryModel, compileFluidStoryModel };
    }
})(typeof window !== "undefined" ? window : globalThis);

