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

    class FluidGamifierBridge {
        constructor({
            createMessageApi,
            iframe,
            fluidOrigin,
            exportModel,
            renderBackground,
            onSceneReady = () => {},
            onSceneFailed = () => {},
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
            this.pngLimitBytes = pngLimitBytes;
            this.jsonLimitBytes = jsonLimitBytes;
            this.api = null;
            this.currentTransferId = null;
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
                maxIncomingBytes: this.jsonLimitBytes,
            });
            this.api = api;
            api.addPeer("fluid-player", this.iframe.contentWindow, { origin: this.fluidOrigin });
            api.expose("api.fluid.requestScene", (request) => this._handleRequestScene(request));
            api.expose("api.fluid.sceneReady", (payload) => this._handleSceneReady(payload));
            api.expose("api.fluid.sceneFailed", (payload) => this._handleSceneFailed(payload));
            await api.waitReady("fluid-player", timeoutMs);
            return true;
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
            this.currentTransferId = transferId;
            Promise.resolve().then(() => this._sendScene({ ...request, transferId, wants }))
                .catch((error) => this._notifyTransferFailure(transferId, error));
            return { accepted: true, transferId, wants };
        }

        async _sendScene(request) {
            const sendModel = async () => {
                const result = await this.exportModel({ frameId: request.frameId, allFrames: false });
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
            try {
                await this.api.call("fluid-player", "api.fluid.transferFailed", {
                    transferId,
                    code: error?.code || "SCENE_TRANSFER_FAILED",
                    message: String(error?.message || error),
                });
            } catch {
                // The child may already be gone; local failure reporting still runs.
            }
            this.onSceneFailed({ transferId, code: error?.code || "SCENE_TRANSFER_FAILED", message: String(error?.message || error) });
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
            this.api?.dispose();
            this.api = null;
            this.currentTransferId = null;
        }
    }

    class FluidSceneClient {
        constructor({ api, controller, compileModel, decodeBackground }) {
            this.api = api;
            this.controller = controller;
            this.compileModel = compileModel;
            this.decodeBackground = decodeBackground;
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

        async requestScene({ frameId, wants = ["model", "background"], backgroundMode = "reference", streamOrder } = {}) {
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
            });
            try {
                await this.api.call("editor", "api.fluid.requestScene", {
                    transferId,
                    frameId,
                    backgroundMode,
                    wants,
                    streamOrder,
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
        const client = new FluidSceneClient({ api, controller, compileModel, decodeBackground });
        await api.waitReady("editor", timeoutMs);
        return {
            api,
            client,
            dispose() {
                client.dispose();
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

