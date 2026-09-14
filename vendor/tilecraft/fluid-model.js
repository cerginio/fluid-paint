(function (root) {
    "use strict";

    /*
     * A layer shape carries two independent facts, and playback needs them
     * separately:
     *
     *   TOPOLOGY  -- connected path, or independent spots?
     *   FOOTPRINT -- what shape is each individual mark? (the renderer's
     *                concern; see tilecraft-stroke-player.js)
     *
     * `square` is a PATH whose marks are square. Its tiles carry `g` groups and
     * `b` breaks exactly like polyline, and their spacing matches a polyline
     * layer at the same gridSize -- so it replays as strokes, not as one tap
     * per tile.
     *
     * `rectangle` is a tolerated alias for `square`: no observed Tilecraft
     * export writes it, so nothing may depend on it being present.
     */
    const FLUID_PATH_SHAPES = new Set(["polyline", "square", "rectangle"]);
    const FLUID_SPOT_SHAPES = new Set(["polygon", "circle"]);
    const SUPPORTED_FLUID_LAYER_SHAPES = new Set([...FLUID_PATH_SHAPES, ...FLUID_SPOT_SHAPES]);
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

    function validateFluidModelViewport({ width, height, padding = 24 } = {}) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
            width > 8192 || height > 8192 || !Number.isFinite(padding) || padding < 0 ||
            padding >= Math.min(width, height) / 2) {
            throw structuredFluidError("INVALID_MODEL_VIEWPORT",
                "Fluid model viewport must have finite dimensions up to 8192 and valid padding", {
                    width, height, padding
                });
        }
        return { width, height, padding };
    }

    function fluidFitBox(source, viewport) {
        const { width, height, padding } = validateFluidModelViewport(viewport);
        const sourceWidth = Math.max(1, source?.width);
        const sourceHeight = Math.max(1, source?.height);
        if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
            throw structuredFluidError("INVALID_MODEL", "Fluid fit source must have finite size");
        }
        const availableWidth = width - 2 * padding;
        const availableHeight = height - 2 * padding;
        const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
        return {
            scale,
            offsetX: padding + (availableWidth - sourceWidth * scale) / 2,
            offsetY: padding + (availableHeight - sourceHeight * scale) / 2,
            width: sourceWidth * scale,
            height: sourceHeight * scale,
        };
    }

    function transformFluidStoryModel(model, viewport) {
        const { width, height, padding } = validateFluidModelViewport(viewport);
        if (!model || !Array.isArray(model.layers) || !Array.isArray(model.frames)) {
            throw structuredFluidError("INVALID_MODEL", "A Fluid story model is required for fitting");
        }
        const points = [];
        for (const frame of model.frames) {
            for (const point of frame.points || []) {
                if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) points.push(point);
            }
        }
        for (const layer of model.layers) {
            for (const tile of layer.tiles || []) {
                if (Number.isFinite(tile?.x) && Number.isFinite(tile?.y)) points.push(tile);
            }
        }
        if (!points.length) throw structuredFluidError("INVALID_MODEL", "Fluid model has no drawable bounds");
        const left = Math.min(...points.map((point) => point.x));
        const top = Math.min(...points.map((point) => point.y));
        const right = Math.max(...points.map((point) => point.x));
        const bottom = Math.max(...points.map((point) => point.y));
        const sourceWidth = Math.max(1, right - left);
        const sourceHeight = Math.max(1, bottom - top);
        const { scale, offsetX, offsetY } = fluidFitBox(
            { width: sourceWidth, height: sourceHeight }, { width, height, padding });
        const transformPoint = (point) => ({
            ...point,
            x: offsetX + (point.x - left) * scale,
            y: offsetY + (point.y - top) * scale,
        });
        const scalePositive = (value) => Number.isFinite(value) && value > 0 ? value * scale : value;
        const transformed = structuredClone(model);
        transformed.layers = transformed.layers.map((layer) => ({
            ...layer,
            gridSize: scalePositive(layer.gridSize),
            ...(layer.polygonSize === undefined ? {} : { polygonSize: scalePositive(layer.polygonSize) }),
            tiles: (layer.tiles || []).map((tile) => ({
                ...transformPoint(tile),
                ...(tile.gd === undefined ? {} : { gd: scalePositive(tile.gd) }),
            })),
        }));
        transformed.frames = transformed.frames.map((frame) => ({
            ...frame,
            points: (frame.points || []).map(transformPoint),
            ...(Number.isFinite(frame.width) ? { width: frame.width * scale } : {}),
            ...(Number.isFinite(frame.height) ? { height: frame.height * scale } : {}),
        }));
        transformed.fit = {
            version: 1,
            width,
            height,
            padding,
            scale,
            sourceBounds: { left, top, right, bottom },
        };
        return transformed;
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
    root.transformFluidStoryModel = transformFluidStoryModel;
    root.fluidFitBox = fluidFitBox;
    root.validateFluidModelViewport = validateFluidModelViewport;
    // Exported so the host loader and the stroke player test the same shapes as
    // the compiler. A second hand-written literal is how `circle` came to be
    // accepted by one gate and rejected by another.
    root.FLUID_PATH_SHAPES = FLUID_PATH_SHAPES;
    root.FLUID_SPOT_SHAPES = FLUID_SPOT_SHAPES;
    root.SUPPORTED_FLUID_LAYER_SHAPES = SUPPORTED_FLUID_LAYER_SHAPES;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            buildFluidStoryModel,
            compileFluidStoryModel,
            transformFluidStoryModel,
            fluidFitBox,
            validateFluidModelViewport,
            FLUID_PATH_SHAPES,
            FLUID_SPOT_SHAPES,
            SUPPORTED_FLUID_LAYER_SHAPES,
        };
    }
})(typeof window !== "undefined" ? window : globalThis);
