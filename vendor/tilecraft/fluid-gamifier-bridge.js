(function (root) {
    "use strict";

    const FLUID_PROTOCOL_VERSION = "fluid-paint-v1";
    const DEFAULT_PNG_LIMIT = 25 * 1024 * 1024;
    const DEFAULT_JSON_LIMIT = 5 * 1024 * 1024;

    function fluidError(code, message, details = {}) {
        return Object.assign(new Error(message), { code, details });
    }

    function assertExactOrigin(origin) {
        if (!origin || origin === "*") throw fluidError("INVALID_ORIGIN", "An exact Fluid origin is required");
        return new URL(origin).origin;
    }

    function assertModelViewport({ width, height, padding = 24 } = {}) {
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
            width > 8192 || height > 8192 || !Number.isFinite(padding) || padding < 0 ||
            padding >= Math.min(width, height) / 2) {
            throw fluidError("INVALID_MODEL_VIEWPORT", "Fluid model viewport is invalid", {
                width, height, padding
            });
        }
        return { width, height, padding };
    }

    class FluidGamifierBridge {
        constructor({
            createMessageApi,
            iframe,
            fluidOrigin,
            exportModel,
            renderBackground,
            onSceneReady = () => {},
            onSceneFailed = () => {},
            onUiStateChanged = () => {},
            onModeStateChanged = () => {},
            pngLimitBytes = DEFAULT_PNG_LIMIT,
            jsonLimitBytes = DEFAULT_JSON_LIMIT,
        }) {
            this.createMessageApi = createMessageApi;
            this.iframe = iframe;
            this.fluidOrigin = assertExactOrigin(fluidOrigin);
            this.exportModel = exportModel;
            this.renderBackground = renderBackground;
            this.onSceneReady = onSceneReady;
            this.onSceneFailed = onSceneFailed;
            this.onUiStateChanged = onUiStateChanged;
            this.onModeStateChanged = onModeStateChanged;
            this.pngLimitBytes = pngLimitBytes;
            this.jsonLimitBytes = jsonLimitBytes;
            this.api = null;
            this.currentTransferId = null;
            this.pendingExports = new Map();
            this.offExportStream = null;
        }

        async connect(timeoutMs = 8000) {
            this.dispose();
            const api = this.createMessageApi({
                channel: "tilecraft-fluid-gamifier",
                role: "story-editor",
                targetOrigin: this.fluidOrigin,
                allowedOrigins: [this.fluidOrigin],
                adoptSessionId: false,
                protocolVersion: FLUID_PROTOCOL_VERSION,
                maxIncomingBytes: this.pngLimitBytes,
                acceptStreamOpen(info) {
                    return info.kind === "fluid-export" && info.mime === "image/png" &&
                        info.size <= DEFAULT_PNG_LIMIT || {
                        accepted: false,
                        code: "STREAM_REFUSED",
                        message: "TileCraft accepts only bounded Fluid PNG exports"
                    };
                },
            });
            this.api = api;
            api.addPeer("fluid-player", this.iframe.contentWindow, { origin: this.fluidOrigin });
            api.expose("api.fluid.requestScene", (request) => this._handleRequestScene(request));
            api.expose("api.fluid.sceneReady", (payload) => this._handleSceneReady(payload));
            api.expose("api.fluid.sceneFailed", (payload) => this._handleSceneFailed(payload));
            api.expose("api.fluid.uiStateChanged", (payload) => {
                if (payload?.transferId !== this.currentTransferId) return { stale: true };
                this.onUiStateChanged(payload);
                return { accepted: true };
            });
            api.expose("api.fluid.modeStateChanged", (payload) => {
                if (payload?.transferId !== this.currentTransferId) return { stale: true };
                this.onModeStateChanged(payload);
                return { accepted: true };
            });
            this.offExportStream = api.on("stream:assembled", (stream) => this._handleExportStream(stream));
            await api.waitReady("fluid-player", timeoutMs);
            return true;
        }

        async openMode(options) {
            if (!this.api) throw fluidError("NOT_CONNECTED", "Fluid bridge is not connected");
            const result = await this.api.call("fluid-player", "api.fluid.openMode", options, { timeoutMs: 12000 });
            this.currentTransferId = result.transferId;
            return result;
        }

        control(command, value) {
            if (!this.api || !this.currentTransferId) throw fluidError("SCENE_NOT_READY", "No active Fluid scene");
            return this.api.call("fluid-player", "api.fluid.control", {
                transferId: this.currentTransferId,
                command,
                value,
            });
        }

        configureUi(config) {
            if (!this.api || !this.currentTransferId) throw fluidError("SCENE_NOT_READY", "No active Fluid scene");
            return this.api.call("fluid-player", "api.fluid.configureUi", { transferId: this.currentTransferId, config });
        }

        getUiState() {
            if (!this.api || !this.currentTransferId) throw fluidError("SCENE_NOT_READY", "No active Fluid scene");
            return this.api.call("fluid-player", "api.fluid.getUiState", { transferId: this.currentTransferId });
        }

        getModeState() {
            if (!this.api || !this.currentTransferId) throw fluidError("SCENE_NOT_READY", "No active Fluid scene");
            return this.api.call("fluid-player", "api.fluid.getModeState", { transferId: this.currentTransferId });
        }

        requestExport({ exportId = crypto.randomUUID(), name = "fluid-play.png" } = {}) {
            if (!this.api || !this.currentTransferId) throw fluidError("SCENE_NOT_READY", "No active Fluid scene");
            const transferId = this.currentTransferId;
            if (this.pendingExports.has(exportId)) throw fluidError("DUPLICATE_EXPORT_ID", "exportId is already pending");
            const result = new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    this.pendingExports.delete(exportId);
                    reject(fluidError("EXPORT_TIMEOUT", "Fluid PNG export timed out"));
                }, 20000);
                this.pendingExports.set(exportId, { transferId, resolve, reject, timeoutId });
            });
            this.api.call("fluid-player", "api.fluid.requestExport", {
                exportId, transferId, name,
            }, { timeoutMs: 20000 }).catch((error) => {
                const pending = this.pendingExports.get(exportId);
                if (!pending) return;
                clearTimeout(pending.timeoutId);
                this.pendingExports.delete(exportId);
                pending.reject(error);
            });
            return result;
        }

        _handleExportStream(stream) {
            if (stream?.kind !== "fluid-export") return;
            const exportId = stream.meta?.exportId;
            const pending = this.pendingExports.get(exportId);
            if (!pending) return;
            clearTimeout(pending.timeoutId);
            this.pendingExports.delete(exportId);
            if (stream.meta?.transferId !== pending.transferId || pending.transferId !== this.currentTransferId) {
                pending.reject(fluidError("STALE_EXPORT", "Fluid export does not belong to the active scene"));
                return;
            }
            const bytes = new Uint8Array(stream.data);
            const signature = [137, 80, 78, 71, 13, 10, 26, 10];
            if (stream.mime !== "image/png" || signature.some((value, index) => bytes[index] !== value)) {
                pending.reject(fluidError("INVALID_EXPORT", "Fluid export is not a valid PNG stream"));
                return;
            }
            pending.resolve({
                exportId,
                transferId: pending.transferId,
                name: stream.name || "fluid-play.png",
                blob: new Blob([stream.data], { type: "image/png" }),
                width: stream.meta?.width ?? null,
                height: stream.meta?.height ?? null,
            });
        }

        _handleRequestScene(request = {}) {
            const transferId = String(request.transferId || "");
            if (!transferId) throw fluidError("INVALID_TRANSFER_ID", "transferId is required");
            if (request.backgroundMode !== "reference") {
                throw fluidError("UNSUPPORTED_BACKGROUND_MODE", "Only reference background mode is supported");
            }
            const wants = Array.isArray(request.wants) ? [...new Set(request.wants)] : [];
            if (!wants.length || wants.some((kind) => kind !== "model" && kind !== "background")) {
                throw fluidError("INVALID_WANTS", "wants must contain model and/or background");
            }
            if (wants.includes("model")) {
                assertModelViewport(request.modelViewport);
            }
            this.currentTransferId = transferId;
            Promise.resolve().then(() => this._sendScene({ ...request, transferId, wants }))
                .catch((error) => this._notifyTransferFailure(transferId, error));
            return { accepted: true, transferId, wants };
        }

        async _sendScene(request) {
            const sendModel = async () => {
                const result = await this.exportModel({
                    frameId: request.frameId,
                    allFrames: false,
                    modelViewport: request.modelViewport,
                });
                await this.api.sendJSON("fluid-player", result.model, {
                    kind: "tilecraft-model",
                    name: `story-${request.frameId}.json`,
                    maxBytes: this.jsonLimitBytes,
                    readyTimeoutMs: 8000,
                    meta: {
                        transferId: request.transferId,
                        frameId: request.frameId,
                        modelVersion: result.model.version,
                        backgroundMode: request.backgroundMode,
                        unsupportedLayers: result.metadata.unsupportedLayers,
                    },
                });
            };
            const sendBackground = async () => {
                const rendered = await this.renderBackground(request.frameId);
                const blob = rendered instanceof Blob ? rendered : rendered?.blob;
                if (!(blob instanceof Blob)) throw fluidError("INVALID_BACKGROUND", "Background renderer must return a Blob");
                await this.api.sendBlob("fluid-player", blob, {
                    kind: "background",
                    mime: "image/png",
                    name: `frame-${request.frameId}.png`,
                    maxBytes: this.pngLimitBytes,
                    readyTimeoutMs: 8000,
                    meta: {
                        transferId: request.transferId,
                        frameId: request.frameId,
                        backgroundMode: request.backgroundMode,
                        sourceWidth: rendered?.width ?? null,
                        sourceHeight: rendered?.height ?? null,
                    },
                });
            };
            const jobs = {
                model: sendModel,
                background: sendBackground,
            };
            const order = request.streamOrder === "background-first"
                ? [...request.wants].sort((a) => a === "background" ? -1 : 1)
                : request.wants;
            for (const kind of order) {
                if (request.transferId !== this.currentTransferId) return;
                await jobs[kind]();
            }
        }

        async _notifyTransferFailure(transferId, error) {
            if (!this.api) return;
            let deliveredToChild = false;
            try {
                await this.api.call("fluid-player", "api.fluid.transferFailed", {
                    transferId,
                    code: error?.code || "SCENE_TRANSFER_FAILED",
                    message: String(error?.message || error),
                });
                // The child reports the same failure back through sceneFailed.
                // Do not invoke the parent callback a second time after that
                // acknowledged RPC path succeeds.
                deliveredToChild = true;
            } catch {
                // The child may already be gone; local failure reporting still runs.
            }
            if (!deliveredToChild) {
                this.onSceneFailed({ transferId, code: error?.code || "SCENE_TRANSFER_FAILED", message: String(error?.message || error) });
            }
        }

        _handleSceneReady(payload = {}) {
            if (payload.transferId !== this.currentTransferId) return { stale: true };
            this.onSceneReady(payload);
            return { accepted: true };
        }

        _handleSceneFailed(payload = {}) {
            if (payload.transferId !== this.currentTransferId) return { stale: true };
            this.onSceneFailed(payload);
            return { accepted: true };
        }

        dispose() {
            this.offExportStream?.();
            this.offExportStream = null;
            for (const pending of this.pendingExports.values()) {
                clearTimeout(pending.timeoutId);
                pending.reject(fluidError("EXPORT_CANCELLED", "Fluid session closed during export"));
            }
            this.pendingExports.clear();
            this.api?.dispose();
            this.api = null;
            this.currentTransferId = null;
        }
    }

    class FluidSceneClient {
        constructor({ api, controller, compileModel, decodeBackground, onSceneReady = () => {} }) {
            this.api = api;
            this.controller = controller;
            this.compileModel = compileModel;
            this.decodeBackground = decodeBackground;
            this.onSceneReady = onSceneReady;
            this.currentTransferId = null;
            this.pending = new Map();
            this.offAssembled = api.on("stream:assembled", (stream) =>
                this._handleAsset(stream).catch((error) => this._fail(stream.meta?.transferId, error))
            );
            this.unexposeTransferFailed = api.expose("api.fluid.transferFailed", (payload) => {
                this._fail(payload?.transferId, fluidError(payload?.code || "SCENE_TRANSFER_FAILED", payload?.message || "Scene transfer failed"));
                return { accepted: true };
            });
        }

        async requestScene({
            frameId,
            wants = ["model", "background"],
            backgroundMode = "reference",
            streamOrder,
            modelViewport,
        } = {}) {
            const transferId = crypto.randomUUID();
            this.currentTransferId = transferId;
            for (const [id, slot] of this.pending) {
                if (id === transferId) continue;
                slot.background?.close?.();
                this.pending.delete(id);
            }
            this.pending.set(transferId, {
                wants: new Set(wants),
                model: null,
                background: null,
                activated: false,
                failed: false,
                modelViewport: modelViewport ? { ...modelViewport } : null,
            });
            try {
                await this.api.call("editor", "api.fluid.requestScene", {
                    transferId,
                    frameId,
                    backgroundMode,
                    wants,
                    streamOrder,
                    modelViewport,
                }, { timeoutMs: 8000 });
            } catch (error) {
                await this._fail(transferId, error);
                throw error;
            }
            return transferId;
        }

        async _handleAsset(stream) {
            const transferId = stream.meta?.transferId;
            if (!transferId || transferId !== this.currentTransferId) return;
            const slot = this.pending.get(transferId);
            if (!slot || slot.failed || slot.activated) return;

            if (stream.kind === "tilecraft-model") {
                const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(stream.data)));
                const compiled = await this.compileModel(parsed);
                if (transferId !== this.currentTransferId) return;
                slot.model = compiled;
            } else if (stream.kind === "background") {
                const blob = new Blob([stream.data], { type: stream.mime || "image/png" });
                const bitmap = await this.decodeBackground(blob, stream.name, stream.meta);
                if (transferId !== this.currentTransferId) {
                    bitmap?.close?.();
                    return;
                }
                slot.background?.close?.();
                slot.background = bitmap;
            } else {
                return;
            }
            await this._activateIfComplete(transferId, slot);
        }

        async _activateIfComplete(transferId, slot) {
            if (slot.activated || slot.failed || transferId !== this.currentTransferId) return;
            if (slot.wants.has("model") && !slot.model) return;
            if (slot.wants.has("background") && !slot.background) return;
            if (slot.modelViewport && typeof this.controller.getModelViewport === "function") {
                const current = this.controller.getModelViewport(slot.modelViewport.padding);
                if (current.width !== slot.modelViewport.width || current.height !== slot.modelViewport.height) {
                    throw fluidError("STALE_MODEL_VIEWPORT", "Fluid painting viewport changed during model transfer", {
                        requested: slot.modelViewport,
                        current,
                    });
                }
            }
            slot.activated = true;
            if (typeof this.controller.loadScene === "function") {
                await this.controller.loadScene({ model: slot.model, background: slot.background, transferId });
            } else {
                if (slot.model) await this.controller.loadModel(slot.model);
                if (slot.background) await this.controller.setBackgroundImage(slot.background);
            }
            if (transferId !== this.currentTransferId) {
                slot.background?.close?.();
                this.pending.delete(transferId);
                return;
            }
            await this.api.call("editor", "api.fluid.sceneReady", { transferId });
            this.onSceneReady({ transferId });
            this.pending.delete(transferId);
        }

        async _fail(transferId, error) {
            if (!transferId || transferId !== this.currentTransferId) return;
            const slot = this.pending.get(transferId);
            if (slot?.failed) return;
            if (slot) {
                slot.failed = true;
                slot.background?.close?.();
                this.pending.delete(transferId);
            }
            try {
                await this.api.call("editor", "api.fluid.sceneFailed", {
                    transferId,
                    code: error?.code || "SCENE_FAILED",
                    message: String(error?.message || error),
                });
            } catch {
                // Connection failures are already represented by the local error.
            }
        }

        dispose() {
            this.offAssembled?.();
            this.unexposeTransferFailed?.();
            for (const slot of this.pending.values()) slot.background?.close?.();
            this.pending.clear();
            this.currentTransferId = null;
        }
    }

    async function createFluidEmbeddedClient({
        createMessageApi,
        editorOrigin,
        controller,
        compileModel = root.compileFluidStoryModel,
        decodeBackground = (blob) => createImageBitmap(blob),
        uiApi = null,
        controlApi = null,
        timeoutMs = 8000,
    }) {
        const exactEditorOrigin = assertExactOrigin(editorOrigin);
        const api = createMessageApi({
            channel: "tilecraft-fluid-gamifier",
            role: "fluid-player",
            targetOrigin: exactEditorOrigin,
            allowedOrigins: [exactEditorOrigin],
            adoptSessionId: true,
            reAdoptSessionOnHello: true,
            protocolVersion: FLUID_PROTOCOL_VERSION,
            preferBinary: "arraybuffer",
            maxIncomingBytes: DEFAULT_PNG_LIMIT,
            acceptStreamOpen(info) {
                const allowed = info.kind === "tilecraft-model"
                    ? info.mime === "application/json" && info.size <= DEFAULT_JSON_LIMIT
                    : info.kind === "background" && info.mime === "image/png" && info.size <= DEFAULT_PNG_LIMIT;
                return allowed || {
                    accepted: false,
                    code: "STREAM_REFUSED",
                    message: "Fluid client refused stream kind, MIME, or size"
                };
            },
        });
        api.addParentPeer("editor", { origin: exactEditorOrigin });
        const client = new FluidSceneClient({
            api,
            controller,
            compileModel,
            decodeBackground,
            onSceneReady({ transferId }) {
                controlApi?.startAutoplay?.(transferId);
            },
        });
        const requireActiveTransfer = (payload = {}) => {
            if (!client.currentTransferId || payload.transferId !== client.currentTransferId) {
                throw fluidError("STALE_TRANSFER", "The request does not belong to the active Fluid scene", {
                    expected: client.currentTransferId,
                    received: payload.transferId || null,
                });
            }
        };
        const unexpose = [];
        if (uiApi) {
            unexpose.push(api.expose("api.fluid.configureUi", async (payload = {}) => {
                requireActiveTransfer(payload);
                const state = await uiApi.configure(payload.config);
                await api.call("editor", "api.fluid.uiStateChanged", { transferId: payload.transferId, state });
                return { accepted: true, transferId: payload.transferId, state };
            }));
            unexpose.push(api.expose("api.fluid.getUiState", (payload = {}) => {
                requireActiveTransfer(payload);
                return { transferId: payload.transferId, state: uiApi.getState() };
            }));
        }
        if (controlApi) {
            unexpose.push(api.expose("api.fluid.openMode", async (payload = {}) => {
                const definition = controlApi.configureMode(payload.mode, {
                    palette: payload.palette,
                    reducedMotion: payload.reducedMotion,
                    allowDrawing: payload.allowDrawing,
                    autoplay: payload.autoplay,
                    playbackSpeed: payload.playbackSpeed,
                });
                if (uiApi) await uiApi.configure(definition.ui);
                const transferId = await client.requestScene({
                    frameId: payload.frameId,
                    wants: [...definition.wants],
                    backgroundMode: "reference",
                    modelViewport: definition.wants.includes("model") &&
                        typeof controller.getModelViewport === "function"
                        ? controller.getModelViewport(24)
                        : undefined,
                });
                controlApi.activateTransfer(transferId);
                return { accepted: true, transferId, mode: payload.mode, uiState: uiApi?.getState() || null };
            }));
            unexpose.push(api.expose("api.fluid.control", (payload) => controlApi.execute(payload)));
            unexpose.push(api.expose("api.fluid.getModeState", (payload = {}) => {
                requireActiveTransfer(payload);
                return { transferId: payload.transferId, state: controlApi.getState() };
            }));
            unexpose.push(api.expose("api.fluid.requestExport", async (payload = {}) => {
                requireActiveTransfer(payload);
                const exportId = String(payload.exportId || "");
                if (!exportId) throw fluidError("INVALID_EXPORT_ID", "exportId is required");
                const blob = await controlApi.painter.exportPngBlob();
                if (!(blob instanceof Blob) || blob.type !== "image/png") {
                    throw fluidError("INVALID_EXPORT", "Fluid renderer did not produce a PNG blob");
                }
                await api.sendBlob("editor", blob, {
                    kind: "fluid-export",
                    mime: "image/png",
                    name: String(payload.name || "fluid-play.png"),
                    maxBytes: DEFAULT_PNG_LIMIT,
                    readyTimeoutMs: 8000,
                    meta: {
                        exportId,
                        transferId: payload.transferId,
                        width: controlApi.painter.paintingRectangle?.width ?? null,
                        height: controlApi.painter.paintingRectangle?.height ?? null,
                    },
                });
                return { accepted: true, exportId, transferId: payload.transferId };
            }));
        }
        const unsubscribeMode = controlApi?.subscribe((state) => {
            if (!state.transferId) return;
            api.call("editor", "api.fluid.modeStateChanged", { transferId: state.transferId, state }).catch(() => {});
        });
        await api.waitReady("editor", timeoutMs);
        return {
            api,
            client,
            dispose() {
                client.dispose();
                unsubscribeMode?.();
                unexpose.forEach((off) => off?.());
                controlApi?.dispose?.();
                api.dispose();
            }
        };
    }

    root.FluidGamifierBridge = FluidGamifierBridge;
    root.FluidSceneClient = FluidSceneClient;
    root.createFluidEmbeddedClient = createFluidEmbeddedClient;
    root.FLUID_PROTOCOL_VERSION = FLUID_PROTOCOL_VERSION;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = { FluidGamifierBridge, FluidSceneClient, createFluidEmbeddedClient };
    }
})(typeof window !== "undefined" ? window : globalThis);
