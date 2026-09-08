'use strict';

// ES6 class version of Paint
class Paint {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {WrappedGL} wgl
     * @param {Object} [options]
     * @param {HTMLElement} [options.container]  the element whose CSS box sizes
     *   the canvas (Phase 7). Omitting it keeps the pre-Phase-7 behaviour of
     *   sizing to the window, which is what the golden harness and any host
     *   that has not adopted the layout rely on.
     */
    constructor(canvas, wgl, options) {
        this.canvas = canvas;
        this.wgl = wgl;
        this.container = (options && options.container) || null;

        // Debug instrumentation flags, read once from ?debug= (see
        // debug/debug-flags.js). Read here and branched on at construction so a
        // disabled probe is structurally absent rather than a per-frame test.
        this.debug = parseDebugFlags();

        // Enable required extensions
        if (wgl.isWebGL2) {
            // float textures are core in WebGL 2; this enables rendering to them
            wgl.getExtension('EXT_color_buffer_float');
        } else {
            wgl.getExtension('OES_texture_float');
            // OES_texture_float_linear is deliberately NOT required -- all float
            // textures are NEAREST and interpolation is done in the shaders.
            // See docs/MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md
        }

        // Load both shader trees -- the engine's and the app chrome's -- and
        // merge them into one flat sources object. The keys are unchanged from
        // when there was a single tree; only the base paths know where the
        // files actually live. See shaderTrees() in common.js -- it is a
        // function, not a constant, because the engine now owns its own
        // manifest and this file is loaded before the engine (Phase 9).
        loadShaderTrees(shaderTrees(), (shaderSources) => {
            this._start(shaderSources);
        });
    }

    // --- Private-ish init step that used to be an inner function ---
    _start(shaderSources) {
        const wgl = this.wgl;
        const canvas = this.canvas;

        const maxTextureSize = wgl.getParameter(wgl.MAX_TEXTURE_SIZE);
        this.maxPaintingWidth = Math.min(
            MAX_PAINTING_WIDTH,
            maxTextureSize / QUALITIES[QUALITIES.length - 1].resolutionScale
        );

        this.framebuffer = wgl.createFramebuffer();

        // The engine (Phase 5). Simulation, brush and painting render behind
        // one surface; this app owns no simulation state. Constructed after
        // the painting rectangle below, which sizes it.

        this.brushProgram = wgl.createProgram(
            shaderSources['shaders/brush.vert'],
            shaderSources['shaders/brush.frag'],
            { a_position: 0 }
        );

        // panelProgram and blurProgram are GONE (Phase 7).
        //
        // They drew the panel background and the frosted blur behind it INTO
        // the canvas, which is why the chrome could not be laid out: it was
        // pixels in the drawing surface, not boxes in the document. The panel
        // is now a real element and the blur is a CSS backdrop-filter, so both
        // programs, the makeBlurShader() generator, and the two full-canvas
        // RGBA scratch textures they ping-ponged through (tempCanvasTexture and
        // blurredCanvasTexture) are deleted rather than merely unused.
        //
        // shadowProgram STAYS, and that is not an oversight: it also draws the
        // PAINTING's drop shadow (see update()), which is part of presenting
        // the painting on its background, not part of the panel chrome. The
        // plan's "delete shadowProgram" was written before that second caller
        // was noticed; deleting it would have removed the painting's shadow
        // along with the panel's.
        this.shadowProgram = wgl.createProgram(
            shaderSources['shaders/fullscreen.vert'],
            shaderSources['shaders/shadow.frag'],
            { a_position: 0 }
        );

        this.interactionState =   InteractionMode.NONE;

        this.quadVertexBuffer = wgl.createBuffer();
        wgl.bufferData(
            this.quadVertexBuffer,
            wgl.ARRAY_BUFFER,
            new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
            wgl.STATIC_DRAW
        );

        // Debug instrumentation, each in its own module and constructed only
        // when its flag is on -- so a disabled feature compiles no program and
        // allocates nothing. Enabled by default; ?debug=-paintingRect turns it
        // off. See debug/debug-flags.js.
        this.paintingRectOverlay = this.debug.paintingRect
            ? new PaintingRectOverlay(wgl, shaderSources, this.quadVertexBuffer)
            : null;

        // The single owner of canvas sizing, devicePixelRatio, the Y-flip and
        // all three coordinate spaces. See viewport.js.
        //
        // devicePixelRatio is honoured, clamped to 2. It was previously never
        // read anywhere, so the backing store equalled CSS pixels and a DPR-3
        // phone drew the painting at a third of its real resolution. The clamp
        // is because simulation cost scales with the square of the ratio: an
        // uncapped DPR-3 device would ask for 9x the fill rate, which is not a
        // trade a paint simulation can absorb. ?dpr=1 forces the old behaviour.
        this.viewport = new Viewport(canvas, {
            pixelRatioEnabled: PaintState.pixelRatioEnabled,
            maxPixelRatio: PaintState.maxPixelRatio,
            container: this.container,
        });

        // position of painting on screen, and its dimensions (pixels)
        this.paintingRectangle = new Rectangle(
            INITIAL_PADDING,
            INITIAL_PADDING,
            Utilities.clamp(
                canvas.width - INITIAL_PADDING * 2,
                MIN_PAINTING_WIDTH,
                this.maxPaintingWidth
            ),
            Utilities.clamp(
                canvas.height - INITIAL_PADDING * 2,
                MIN_PAINTING_WIDTH,
                this.maxPaintingWidth
            )
        );

        // simulation resolution = painting resolution * resolution scale
        this.resolutionScale = QUALITIES[INITIAL_QUALITY].resolutionScale;

        // Drawn before the engine is constructed, and that ordering is
        // load-bearing under ?seed=. Brush's constructor fills a randoms
        // texture from Math.random(), so with the deterministic RNG installed
        // its bristles depend on how many draws came first. This one used to
        // happen before `new Brush(...)`; the engine now owns the Brush, so the
        // draw has to move up here to keep the sequence -- otherwise every
        // golden hash shifts for no reason anyone could see in the diff.
        this.brushColorHSVA = [Math.random(), 1, 1, 0.8];

        this.engine = new FluidEngine(wgl, shaderSources, {
            resolutionWidth: this.getPaintingResolutionWidth(),
            resolutionHeight: this.getPaintingResolutionHeight(),
            maxBristleCount: MAX_BRISTLE_COUNT,
        });

        // The undo ring. Depth is this app's decision, not the engine's -- the
        // engine only knows how to fill a snapshot and reload one. It does
        // allocate them, because the texture has to match the paint texture
        // type the capability probe chose, and a host that guessed gl.FLOAT
        // would break undo on exactly the devices the probe exists for.
        this.snapshots = [];
        for (let i = 0; i < HISTORY_SIZE; ++i) {
            this.snapshots.push(
                this.engine.createSnapshot(
                    this.paintingRectangle.width,
                    this.paintingRectangle.height,
                    this.resolutionScale
                )
            );
        }

        this.snapshotIndex = 0; // next snapshot index to save into
        this.undoing = false;
        this.maxRedoIndex = 0; // while undoing, the maximum snapshot index that can be applied

        this.brushInitialized = false; // whether we have a valid brush position
        this.brushX = 0;
        this.brushY = 0;
        this.brushScale = 50;
        // Pen pressure, as a MULTIPLIER rather than a computed height: brushScale
        // is changed independently by the size slider and the wheel, and a stored
        // height would silently keep the old size after either of those.
        this.brushPressure = 1;
        // Two-finger pinch state: the span and rectangle the gesture started
        // with, so a resize scales from its origin rather than compounding.
        this.pinchStartSpan = null;
        this.pinchStartRectangle = null;
        // FluidEngine.COLOR_MODEL, not the app's own enum (Phase 9 finding 2).
        // The value is handed straight to renderToTexture(), and the renderer's
        // test is an equality -- anything that is not exactly RGB falls silently
        // through to RYB. Reading the name from the engine that consumes it is
        // what makes that impossible to get wrong.
        this.colorModel = FluidEngine.COLOR_MODEL.RYB;

        this.needsRedraw = true; // whether we need to redraw the painting


        this.fluiditySlider = new Slider(
            document.getElementById('fluidity-slider'),
            this.engine.fluidity,
            0.6,
            0.9,
            (fluidity) => {
                this.engine.setSimulation({ fluidity });
            }
        );

        this.bristleCountSlider = new Slider(
            document.getElementById('bristles-slider'),
            1,
            0,
            1,
            (t) => {
                const BRISTLE_SLIDER_POWER = 2.0;
                t = Math.pow(t, BRISTLE_SLIDER_POWER);
                const bristleCount = Math.floor(
                    MIN_BRISTLE_COUNT + t * (MAX_BRISTLE_COUNT - MIN_BRISTLE_COUNT)
                );
                this.engine.setBrush({ bristleCount });
            }
        );

        this.brushSizeSlider = new Slider(
            document.getElementById('size-slider'),
            this.brushScale,
            MIN_BRUSH_SCALE,
            MAX_BRUSH_SCALE,
            (size) => {
                this.brushScale = size;
                // Push the compact bar's handle. The two sliders edit one
                // value, so whichever is not being dragged has to follow or
                // they disagree the moment the panel is collapsed or expanded.
                if (this.barSizeSlider) this.barSizeSlider.setValue(size);
            }
        );

        this.qualityButtons = new Buttons(
            document.getElementById('qualities'),
            QUALITIES.map((q) => q.name),
            INITIAL_QUALITY,
            (index) => {
                this.saveSnapshot();
                this.resolutionScale = QUALITIES[index].resolutionScale;
                this.engine.changeResolution(
                    this.getPaintingResolutionWidth(),
                    this.getPaintingResolutionHeight()
                );
                this.needsRedraw = true;
            }
        );

        this.modelButtons = new Buttons(
            document.getElementById('models'),
            ['Natural', 'Digital'],
            0,
            (index) => {
                if (index === 0) {
                    this.colorModel = FluidEngine.COLOR_MODEL.RYB;
                } else if (index === 1) {
                    this.colorModel = FluidEngine.COLOR_MODEL.RGB;
                }
                this.needsRedraw = true;
            }
        );

        /*
         * The colour editor (Phase 8). Real DOM in #color-picker-slot, replacing
         * the GL hue ring that used to be drawn into this canvas.
         *
         * It takes the same ACCESSOR the GL picker took -- `() => this.brush
         * ColorHSVA` -- and mutates that array in place, because several other
         * readers hold a reference to it (the splat colour, the brush preview,
         * the panel's hue stripe). Handing over the object, or replacing the
         * array, would silently orphan them.
         *
         * Null when the slot is absent: the no-support page has no panel, and a
         * second host may bring its own markup. Every call site below is guarded
         * rather than assuming the control exists.
         */
        const colorSlot = document.getElementById('color-picker-slot');
        this.colorControl = colorSlot
            ? new ColorControl({
                element: colorSlot,
                getHSVA: () => this.brushColorHSVA,
                onChange: () => {
                    // The compact bar's hue stripe shows the same hue, so it has
                    // to follow the wheel or the two disagree the moment the
                    // panel is collapsed -- the same rule the two size sliders
                    // follow.
                    if (this.toolPanel) this.toolPanel.setHue(this.brushColorHSVA[0]);
                    this.needsRedraw = true;
                },
            })
            : null;

        // Live bristle preview -- constructed only when its flag is on, so with
        // ?debug=-brushViewer nothing is allocated and the per-frame draw below
        // is skipped outright. Enabled by default.
        this.brushViewer = this.debug.brushViewer
            ? new BrushViewer(wgl, this.brushProgram, canvas.width - 250, 20, 250, 150)
            : null;

        this.rebuildProjectionMatrix();

        this.onResize = () => {
            this.viewport.resize();

            this.paintingRectangle.left = Utilities.clamp(
                this.paintingRectangle.left,
                -this.paintingRectangle.width,
                this.canvas.width
            );
            this.paintingRectangle.bottom = Utilities.clamp(
                this.paintingRectangle.bottom,
                -this.paintingRectangle.height,
                this.canvas.height
            );

            // The colour wheel needs neither a DPR scale nor positioning any
            // more (Phase 8). It was GL-drawn into the canvas, so it carried its
            // own `scale` to convert CSS-authored constants into backing-store
            // pixels, and had to be told where its slot was. It is a real
            // element now: CSS pixels are its native unit and the document lays
            // it out. It only has to re-measure, which its own ResizeObserver
            // does.
            if (this.brushViewer !== null) this.brushViewer.bottom = this.canvas.height - 150;

            this.rebuildProjectionMatrix();

            // Release the previous frame-sized texture before rebuilding it.
            // Without this every resize (a phone rotation, a desktop drag)
            // leaked a full-canvas RGBA texture for the lifetime of the
            // context.
            //
            // This was a list of three until Phase 7. tempCanvasTexture and
            // blurredCanvasTexture were the ping-pong pair the panel blur drew
            // through; the blur is a CSS backdrop-filter now, so two thirds of
            // this allocation is gone -- on a DPR-2 phone that is two fewer
            // full-screen RGBA textures rebuilt on every rotation.
            if (this.canvasTexture) {
                wgl.deleteTexture(this.canvasTexture);
                this.canvasTexture = null;
            }

            this.canvasTexture = wgl.buildTexture(
                wgl.RGBA,
                wgl.UNSIGNED_BYTE,
                this.canvas.width,
                this.canvas.height,
                null,
                wgl.CLAMP_TO_EDGE,
                wgl.CLAMP_TO_EDGE,
                wgl.NEAREST,
                wgl.NEAREST
            );

            // The dispatcher caches the canvas's bounding rect for a frame and
            // only drops that cache on scroll, resize and pointerdown. A layout
            // change moves the canvas without any of those -- opening the panel
            // shifts it by the panel's width -- and a stale rect offsets every
            // subsequent coordinate by exactly that much. Telling it here is
            // the alternative to a second local patch in the vendored file.
            if (this.pointerDispatcher) this.pointerDispatcher.invalidateRect();

            this.needsRedraw = true;
        };

        this.onResize();

        // The container's box drives resizes now, not the window's (Phase 7).
        // A ResizeObserver sees what the window event cannot: the panel opening
        // or a breakpoint reflowing the grid changes the canvas's size while
        // the window itself never moves. Viewport keeps a window listener
        // alongside it for the devicePixelRatio case, which is the reverse --
        // the ratio changes without the box changing.
        this.unobserveResize = this.viewport.observeResize(this.onResize);

        this.mouseX = 0;
        this.mouseY = 0;
        this.spaceDown = false;

        // Prevent browser gestures (scroll/zoom) on the drawing surface
        this.canvas.style.touchAction = 'none';

        // ---- Input: PointerDispatcher (Phase 6) ----
        //
        // The dispatcher owns pointer bookkeeping, gesture recognition and the
        // per-frame RAF flush that the hand-rolled activePointers map used to do.
        //
        // It reports CSS-relative, Y-DOWN coordinates scaled by its own reading
        // of the element's backing store. This app's screen space is Y-UP from
        // the bottom-left and owns the device pixel ratio in Viewport, so every
        // coordinate crosses through _toScreen() below and nothing downstream
        // sees a dispatcher coordinate directly. Adapting at the boundary is
        // what keeps the vendored file all but untouched: it carries exactly one
        // local patch, marked LOCAL PATCH in the file and recorded in
        // docs/UI-COMPONENTS.md.
        this.pointerDispatcher = new PointerDispatcher(canvas);

        this.pointerDispatcher
            .on('panstart', this.onGestureStart)
            .on('pan', this.onGesturePan)
            .on('panend', this.onGestureEnd)
            .on('cursormove', this.onGestureHover)
            .on('pan2', this.onGesturePan2)
            .on('pan2end', this.onGestureEnd)
            .on('pinch', this.onGesturePinch);

        // Wheel (brush size) – scoped to canvas
        canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        document.addEventListener('keydown', (e) => {
            if (e.repeat) return; // ignore auto-repeats if you want single-fire actions

            switch (e.code) {
                case 'Space':
                    this.spaceDown = true;
                    e.preventDefault(); // stop page scroll
                    break;

                case 'KeyZ':
                    this.undo();
                    break;

                case 'KeyY':
                    this.redo();
                    break;

                default:
                    break;
            }
        });

        document.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.spaceDown = false;
                e.preventDefault();
            }
        });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // --- Action buttons ---
        this.saveButton = document.getElementById('save-button');
        if (this.saveButton) {
            this.saveButton.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this.save && this.save();
            });
        }

        this.clearButton = document.getElementById('clear-button');
        if (this.clearButton) {
            this.clearButton.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this.clear();
            });
        }

        this.undoButton = document.getElementById('undo-button');
        if (this.undoButton) {
            this.undoButton.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this.undo();
            });
        }

        this.redoButton = document.getElementById('redo-button');
        if (this.redoButton) {
            this.redoButton.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                this.redo();
            });
        }

        // The floating panel: drag by the grip, tap the grip to collapse to the
        // compact bar. Replaces the old #panel-button, which could only toggle
        // a panel that was drawn at a fixed place in the canvas.
        const panelRoot = document.getElementById('ui');
        this.toolPanel = panelRoot
            ? new ToolPanel({
                root: panelRoot,
                grip: document.getElementById('panel-grip'),
                hueStripe: document.getElementById('bar-hue-stripe'),
                onHue: (hue) => {
                    // Hue only. Saturation, value and alpha are left alone, so
                    // the stripe cannot silently reset a colour the user mixed
                    // in the full picker.
                    this.brushColorHSVA[0] = hue;
                    this.needsRedraw = true;
                },
                onLayoutChange: () => this._syncPanelState(),
            })
            : null;

        if (this.toolPanel) this.toolPanel.setHue(this.brushColorHSVA[0]);

        // The compact bar's brush-size slider. It and the one in the expanded
        // body edit the SAME value, so each has to push the other's handle or
        // the two disagree the moment either is touched.
        const barSizeElement = document.getElementById('bar-size-slider');
        this.barSizeSlider = barSizeElement
            ? new Slider(
                barSizeElement,
                this.brushScale,
                MIN_BRUSH_SCALE,
                MAX_BRUSH_SCALE,
                (size) => {
                    this.brushScale = size;
                    if (this.brushSizeSlider) this.brushSizeSlider.setValue(size);
                }
            )
            : null;

        this._syncPanelState();

        this.refreshDoButtons && this.refreshDoButtons();

        const update = () => {
            this.update();
            requestAnimationFrame(update);
        };
        update();
    }

    /**
     * The resolution scale actually used, after clamping total render-target
     * memory to the budget.
     *
     * Everything resolution-dependent scales with the painting's AREA, so a
     * device pixel ratio of 2 costs four times as much, not twice. See
     * PaintState.maxRenderTargetBytes for why exceeding it loses the context
     * outright rather than merely running slowly.
     */
    getEffectiveResolutionScale() {
        const budget = PaintState.maxRenderTargetBytes;
        const area = this.paintingRectangle.width * this.paintingRectangle.height;
        if (!budget || area <= 0) return this.resolutionScale;

        // How many render targets the simulation holds is the engine's to know,
        // so the arithmetic lives there. Static, because this runs before the
        // engine exists -- its answer is what sizes the engine.
        const maxScale = FluidEngine.maxResolutionScaleForBudget(
            this.paintingRectangle.width,
            this.paintingRectangle.height,
            HISTORY_SIZE,
            budget
        );

        if (maxScale < this.resolutionScale) {
            // Report it once per distinct clamp: a painting quietly simulating
            // below the quality the UI claims is exactly the kind of thing that
            // should not be silent.
            const key = area.toFixed(0) + '@' + this.resolutionScale;
            if (this._scaleClampKey !== key) {
                this._scaleClampKey = key;
                console.warn(
                    '[viewport] simulation scale clamped to', maxScale.toFixed(3),
                    'from', this.resolutionScale,
                    '-- painting', Math.round(this.paintingRectangle.width) + 'x' +
                        Math.round(this.paintingRectangle.height),
                    'would need', (FluidEngine.estimateRenderTargetBytes(
                        this.paintingRectangle.width,
                        this.paintingRectangle.height,
                        this.resolutionScale,
                        HISTORY_SIZE
                    ) / 1048576).toFixed(0) + 'MB'
                );
            }
        }

        return Math.min(this.resolutionScale, maxScale);
    }

    getPaintingResolutionWidth() {
        return Math.ceil(this.paintingRectangle.width * this.getEffectiveResolutionScale());
    }

    getPaintingResolutionHeight() {
        return Math.ceil(this.paintingRectangle.height * this.getEffectiveResolutionScale());
    }

    drawShadow(alpha, rectangle) {
        const wgl = this.wgl;

        const shadowDrawState = wgl
            .createDrawState()
            .uniform2f('u_bottomLeft', rectangle.left, rectangle.bottom)
            .uniform2f('u_topRight', rectangle.getRight(), rectangle.getTop())
            .uniform1f('u_sigma', BOX_SHADOW_SIGMA)
            .uniform1f('u_alpha', alpha)
            .enable(wgl.BLEND)
            .blendFunc(wgl.ONE, wgl.ONE_MINUS_SRC_ALPHA)
            .useProgram(this.shadowProgram)
            .vertexAttribPointer(
                this.quadVertexBuffer,
                0,
                2,
                wgl.FLOAT,
                wgl.FALSE,
                0,
                0
            );

        const rectangles = [
            new Rectangle(
                rectangle.left - BOX_SHADOW_WIDTH,
                rectangle.bottom - BOX_SHADOW_WIDTH,
                rectangle.width + 2 * BOX_SHADOW_WIDTH,
                BOX_SHADOW_WIDTH
            ), // bottom
            new Rectangle(
                rectangle.left - BOX_SHADOW_WIDTH,
                rectangle.getTop(),
                rectangle.width + 2 * BOX_SHADOW_WIDTH,
                BOX_SHADOW_WIDTH
            ), // top
            new Rectangle(
                rectangle.left - BOX_SHADOW_WIDTH,
                rectangle.bottom,
                BOX_SHADOW_WIDTH,
                rectangle.height
            ), // left
            new Rectangle(
                rectangle.getRight(),
                rectangle.bottom,
                BOX_SHADOW_WIDTH,
                rectangle.height
            ), // right
        ];

        const screenRectangle = new Rectangle(0, 0, this.canvas.width, this.canvas.height);
        for (let i = 0; i < rectangles.length; ++i) {
            const rect = rectangles[i];
            rect.intersectRectangle(screenRectangle);

            if (rect.getArea() > 0) {
                shadowDrawState.viewport(rect.left, rect.bottom, rect.width, rect.height);
                this.wgl.drawArrays(shadowDrawState, this.wgl.TRIANGLE_STRIP, 0, 4);
            }
        }
    }


    update() {
        const wgl = this.wgl;

        this._syncBrushToPointer();

        // update brush
        //
        // brushHeight carries pen pressure (Phase 6). It is applied here rather
        // than at the input event because the bristles are advanced every frame
        // and only this call reaches them -- a height set on the event alone
        // would never be read. It defaults to the unscaled height, so a mouse,
        // a finger, and a pen at full pressure all behave exactly as before.
        if (this.brushInitialized) {
            this.engine.positionBrush(
                this.brushX,
                this.brushY,
                BRUSH_HEIGHT * this.brushScale * this.brushPressure,
                this.brushScale
            );
        }

        // splat into paint and velocity textures
        if (this.interactionState === InteractionMode.PAINTING) {
            const splatRadius = SPLAT_RADIUS * this.brushScale;
            const splatColor = hsvToRyb(
                this.brushColorHSVA[0],
                this.brushColorHSVA[1],
                this.brushColorHSVA[2]
            );
            const alphaT = this.brushColorHSVA[3];

            // scale alpha based on the number of bristles
            const bristleT =
                (this.engine.bristleCount - MIN_BRISTLE_COUNT) /
                (MAX_BRISTLE_COUNT - MIN_BRISTLE_COUNT);
            const minAlpha = mix(THIN_MIN_ALPHA, THICK_MIN_ALPHA, bristleT);
            const maxAlpha = mix(THIN_MAX_ALPHA, THICK_MAX_ALPHA, bristleT);
            const alpha = mix(minAlpha, maxAlpha, alphaT);
            splatColor[3] = alpha;

            const splatVelocityScale =
                SPLAT_VELOCITY_SCALE * splatColor[3] * this.resolutionScale;

            // Splat paint. The brush's coordinates are screen pixels, so the
            // painting rectangle is handed over in that same space -- the
            // engine transforms brush space to simulation space and knows
            // nothing about the screen.
            this.engine.splat(this.paintingRectangle, {
                zThreshold: Z_THRESHOLD * this.brushScale,
                color: splatColor,
                radius: splatRadius,
                velocityScale: splatVelocityScale,
            });
        }

        const simulationUpdated = this.engine.frame();
        if (simulationUpdated) this.needsRedraw = true;

        // the rectangle we end up drawing the painting into
        const clippedPaintingRectangle = (
            this.interactionState === InteractionMode.RESIZING
                ? this.newPaintingRectangle
                : this.paintingRectangle
        )
            .clone()
            .intersectRectangle(new Rectangle(0, 0, this.canvas.width, this.canvas.height));

        if (this.needsRedraw) {
            this.engine.renderToTexture({
                framebuffer: this.framebuffer,
                targetTexture: this.canvasTexture,
                paintingRectangle: this.paintingRectangle,
                clippedRectangle: clippedPaintingRectangle,
                targetWidth: this.canvas.width,
                targetHeight: this.canvas.height,
                resolutionScale: this.resolutionScale,
                colorModel: this.colorModel,
                resizing: this.interactionState === InteractionMode.RESIZING,
            });
        }

        // The painting is redrawn only when it changed, but it has to be
        // presented every frame -- the chrome below is drawn over it and is
        // not part of the painting texture.
        this.engine.present(this.canvasTexture, this.canvas.width, this.canvas.height);

        // --- everything below here is UI chrome, and belongs to the app ---

        this.drawShadow(PAINTING_SHADOW_ALPHA, clippedPaintingRectangle); // draw painting shadow

        // --- draw the paintingRectangle outline (preview-aware) ---
        if (this.paintingRectOverlay !== null) {
            // While resizing, show the preview rectangle; otherwise the current one
            this.paintingRectOverlay.draw(
                (this.interactionState === InteractionMode.RESIZING && this.newPaintingRectangle)
                    ? this.newPaintingRectangle
                    : this.paintingRectangle,
                this.canvas.width,
                this.canvas.height
            );
        }

        // draw brush to screen
        //
        // The `!colorPicker.isInUse()` term is GONE (Phase 8). It existed
        // because the GL picker was painted INTO this canvas, so a pointer
        // dragging its hue ring was, as far as the canvas knew, a pointer over
        // the painting -- and the brush cursor had to be suppressed by hand.
        // The wheel is a real element now, so the browser hit-tests it and the
        // pointer never reaches the canvas at all. Same trade Phase 7 made when
        // it deleted the panel's geometric hit test.
        if (
            this.interactionState === InteractionMode.PAINTING ||
            (this.interactionState === InteractionMode.NONE &&
                this.desiredInteractionMode(this.mouseX, this.mouseY) === InteractionMode.PAINTING)
        ) {
            // The bristle preview is chrome, but it is drawn from the engine's
            // own geometry, with this app's program and projection. That is the
            // one place chrome legitimately needs engine GL objects, so they
            // come through a single named accessor rather than four public
            // fields -- a second caller for these would be visible in review.
            const bristles = this.engine.getBristleGeometry();

            const brushDrawState = wgl
                .createDrawState()
                .bindFramebuffer(null)
                .viewport(0, 0, this.canvas.width, this.canvas.height)
                .vertexAttribPointer(
                    bristles.coordinatesBuffer,
                    0,
                    2,
                    wgl.FLOAT,
                    wgl.FALSE,
                    0,
                    0
                )
                .useProgram(this.brushProgram)
                .bindIndexBuffer(bristles.indexBuffer)
                .uniform4f('u_color', 0.6, 0.6, 0.6, 1.0)
                .uniformMatrix4fv('u_projectionViewMatrix', false, this.mainProjectionMatrix)
                .enable(wgl.DEPTH_TEST)
                .enable(wgl.BLEND)
                .blendFunc(wgl.DST_COLOR, wgl.ZERO)
                .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, bristles.positionsTexture);

            wgl.drawElements(
                brushDrawState,
                wgl.LINES,
                (bristles.indexCount * bristles.bristleCount) / bristles.maxBristleCount,
                wgl.UNSIGNED_SHORT,
                0
            );
        }

        // cursor logic
        // The two colour-picker branches are GONE (Phase 8): the wheel is an
        // element with its own CSS cursor, so the canvas no longer has to guess
        // whether the pointer is over it.
        let desiredCursor = '';
        if (this.interactionState === InteractionMode.NONE) {
            const desiredMode = this.desiredInteractionMode(this.mouseX, this.mouseY);
            if (desiredMode === InteractionMode.PAINTING) {
                desiredCursor = 'none';
            } else if (desiredMode === InteractionMode.RESIZING) {
                desiredCursor = cursorForResizingSide(this.getResizingSide(this.mouseX, this.mouseY));
            } else if (desiredMode === InteractionMode.PANNING) {
                desiredCursor = 'pointer';
            } else {
                desiredCursor = 'default';
            }
        } else {
            if (this.interactionState === InteractionMode.PAINTING) {
                desiredCursor = 'none';
            } else if (this.interactionState === InteractionMode.RESIZING) {
                desiredCursor = cursorForResizingSide(this.resizingSide);
            } else if (this.interactionState === InteractionMode.PANNING) {
                desiredCursor = 'pointer';
            }
        }
        if (!PaintState.showPanel) {
            desiredCursor = 'default';
        }

        if (this.canvas.style.cursor !== desiredCursor) {
            this.canvas.style.cursor = desiredCursor;
        }

        // The panel, its frosted blur and its drop shadow are no longer drawn
        // here at all (Phase 7): the panel is a DOM element laid out beside the
        // canvas, its blur is a CSS backdrop-filter, and its shadow is a CSS
        // box-shadow. What used to be ~50 lines of GL, two scratch textures and
        // two programs is now three declarations in app/layout.css.
        //
        // needsRedraw is cleared HERE rather than inside a `showPanel` branch.
        // It used to be cleared only when the panel was drawn, so hiding the
        // panel left the flag permanently set and the painting re-rendered
        // every frame instead of only when it changed -- the panel-hidden path
        // silently cost the most work. Clearing it next to the render that
        // consumed it is what makes that impossible to reintroduce.
        this.needsRedraw = false;

        // The colour picker's per-frame GL draw is GONE (Phase 8), along with
        // the `if (PaintState.showPanel)` that guarded it. iro.js renders itself
        // as DOM, so there is nothing to draw here and nothing to hide when the
        // panel collapses -- the element's own visibility handles that.
        //
        // This was the LAST chrome drawn into the canvas. What remains below is
        // the painting's own shadow and the debug overlays.
        if (this.brushViewer !== null) {
            const hsva = this.brushColorHSVA;
            const H = fixHueForPreview(hsva[0]);
            const rgb = hsvToRgb(H, hsva[1], hsva[2]);

            this.brushViewer.draw(this.brushX, this.brushY, this.engine.getBristleGeometry(), rgb);
        }
    }

    // Renders the painting to an offscreen texture and arms the save button
    // with a data URL. Hoisted out of update(): it closes over nothing but this,
    // and was previously reallocated every frame.
    save() {
        //reset attributes so nothing gets saved if we hit an error somewhere
        this.saveButton.removeAttribute('download');
        this.saveButton.setAttribute('href', '#');
        const saveWidth = this.paintingRectangle.width;
        const saveHeight = this.paintingRectangle.height;

        // The engine renders and reads back; the app only knows what to do with
        // the bytes afterwards.
        const savePixels = this.engine.exportPixels({
            width: saveWidth,
            height: saveHeight,
            resolutionScale: this.resolutionScale,
            colorModel: this.colorModel,
        });

        //then we draw the pixels to a 2D canvas and then save from the canvas
        //is there a better way?

        var saveCanvas = document.createElement('canvas');
        saveCanvas.width = saveWidth;
        saveCanvas.height = saveHeight;
        var saveContext = saveCanvas.getContext('2d');

        var imageData = saveContext.createImageData(saveWidth, saveHeight);
        imageData.data.set(savePixels);
        saveContext.putImageData(imageData, 0, 0);

        this.saveButton.setAttribute('download', 'painting.png');
        this.saveButton.setAttribute('href', saveCanvas.toDataURL());
    }

    // Screen-space orthographic projection for the bristle preview, rebuilt
    // whenever the canvas changes size. Single source of truth: it was
    // previously open-coded identically in the constructor and in onResize().
    //
    // The +/-5000 depth range is inherited from debugging the mobile bristle
    // collapse and is far wider than the bristles need (their z spans about
    // brushScale * BRISTLE_LENGTH). It is kept bit-for-bit here so this commit
    // stays a pure deduplication; narrowing it is a separate, testable change.
    rebuildProjectionMatrix() {
        this.mainProjectionMatrix = makeOrthographicMatrix(
            new Float32Array(16),
            0.0,
            this.canvas.width,
            0,
            this.canvas.height,
            -5000.0,
            5000.0
        );
    }

    /**
     * Mirror the panel's collapsed state into PaintState.showPanel.
     *
     * `showPanel` no longer means "is the panel element visible" -- the bar is
     * always visible now. It means "is the expanded BODY showing", and the only
     * thing that still turns on is whether the GL colour picker draws, since
     * the picker is drawn into the canvas over its slot and a hidden slot must
     * not leave a picker floating on the painting.
     *
     * Kept as a named method rather than an inline assignment because that
     * meaning is not obvious from the flag's name, and this is the one place to
     * explain it.
     */
    _syncPanelState() {
        PaintState.showPanel = this.toolPanel ? !this.toolPanel.isCollapsed() : true;
        // The picker no longer needs repositioning on a move or a collapse
        // (Phase 8): it is inside the panel, so it moves with it for free.
        this.needsRedraw = true;
    }

    /*
     * _positionColorPicker() is GONE (Phase 8), and its absence is the point.
     *
     * The picker used to be GL-drawn into the main canvas, so it had to be told
     * where its DOM slot was: read the slot's rect, subtract the canvas origin,
     * flip Y, subtract the box height. Phase 7 wrote that method so the picker
     * would at least FOLLOW the layout instead of sitting at a hardcoded
     * COLOR_PICKER_LEFT/TOP.
     *
     * The picker is now a real element inside the slot, so the document lays it
     * out and there is nothing to position. The whole method, both of its
     * coordinate conversions, and the two constants they used are deleted --
     * which is what "chrome becomes DOM" is supposed to buy, and is the same
     * trade Phase 7 made for the panel itself.
     */

    // what interaction mode would be triggered if we clicked with given mouse position
    desiredInteractionMode(mouseX, mouseY) {
        // The "is the pointer over the panel?" test is GONE (Phase 7).
        //
        // It existed because the panel was painted into the canvas, so the
        // canvas received presses that visually landed on chrome and had to
        // reject them geometrically -- against PANEL_WIDTH/PANEL_HEIGHT, two
        // constants that had to be kept in sync with the CSS by hand.
        //
        // The panel is a real element now, so the browser's own hit testing
        // stops those events before the canvas ever sees them. Keeping the test
        // would be worse than redundant: it would carve a dead rectangle out of
        // the CANVAS at whatever size the constants happened to say, and on the
        // phone-portrait drawer -- where the panel really does overlap the
        // canvas -- that rectangle would be in the wrong place and the wrong
        // size, blocking paint in the middle of the picture.
        const resizingRadius = this.viewport.cssLengthToScreen(RESIZING_RADIUS_CSS);

        if (
            this.spaceDown ||
            this.mouseX < this.paintingRectangle.left - resizingRadius ||
            this.mouseX > this.paintingRectangle.left + this.paintingRectangle.width + resizingRadius ||
            this.mouseY < this.paintingRectangle.bottom - resizingRadius ||
            this.mouseY > this.paintingRectangle.bottom + this.paintingRectangle.height + resizingRadius
        ) {
            return InteractionMode.PANNING;
        } else if (this.getResizingSide(mouseX, mouseY) !== ResizingSide.NONE) {
            return InteractionMode.RESIZING;
        } else {
            return InteractionMode.PAINTING;
        }
    }

    getResizingSide(mouseX, mouseY) {
        // the side we'd be resizing with the current mouse position
        // we can resize if our perpendicular distance to an edge is less than RESIZING_RADIUS
        //
        // The radius is authored in CSS pixels, but mouseX/mouseY are screen
        // pixels, so it has to be converted or the grab zone shrinks as the
        // device pixel ratio rises -- half as wide on a DPR-2 phone, which is
        // where a grab margin matters most.
        const RESIZING_RADIUS = this.viewport.cssLengthToScreen(RESIZING_RADIUS_CSS);
        if (
            Math.abs(mouseX - this.paintingRectangle.left) <= RESIZING_RADIUS &&
            Math.abs(mouseY - this.paintingRectangle.getTop()) <= RESIZING_RADIUS
        ) {
            return ResizingSide.TOP_LEFT;
        }
        if (
            Math.abs(mouseX - this.paintingRectangle.getRight()) <= RESIZING_RADIUS &&
            Math.abs(mouseY - this.paintingRectangle.getTop()) <= RESIZING_RADIUS
        ) {
            return ResizingSide.TOP_RIGHT;
        }
        if (
            Math.abs(mouseX - this.paintingRectangle.left) <= RESIZING_RADIUS &&
            Math.abs(mouseY - this.paintingRectangle.bottom) <= RESIZING_RADIUS
        ) {
            return ResizingSide.BOTTOM_LEFT;
        }
        if (
            Math.abs(mouseX - this.paintingRectangle.getRight()) <= RESIZING_RADIUS &&
            Math.abs(mouseY - this.paintingRectangle.bottom) <= RESIZING_RADIUS
        ) {
            return ResizingSide.BOTTOM_RIGHT;
        }

        if (mouseY > this.paintingRectangle.bottom && mouseY <= this.paintingRectangle.getTop()) {
            if (Math.abs(mouseX - this.paintingRectangle.left) <= RESIZING_RADIUS) {
                return ResizingSide.LEFT;
            } else if (
                Math.abs(mouseX - this.paintingRectangle.getRight()) <= RESIZING_RADIUS
            ) {
                return ResizingSide.RIGHT;
            }
        }

        if (mouseX > this.paintingRectangle.left && mouseX <= this.paintingRectangle.getRight()) {
            if (Math.abs(mouseY - this.paintingRectangle.bottom) <= RESIZING_RADIUS) {
                return ResizingSide.BOTTOM;
            } else if (
                Math.abs(mouseY - this.paintingRectangle.getTop()) <= RESIZING_RADIUS
            ) {
                return ResizingSide.TOP;
            }
        }

        return ResizingSide.NONE;
    }

    // ----------------------------
    // Input: PointerDispatcher gestures (Phase 6)
    // ----------------------------

    /**
     * Dispatcher coordinates -> this app's screen space.
     *
     * The dispatcher reports CSS-relative pixels with Y growing DOWNWARD from
     * the top-left, pre-scaled by its own reading of the canvas backing store.
     * Viewport owns the device pixel ratio and its screen space is Y-UP from
     * the bottom-left, so the scale is divided back out and Y is flipped here.
     *
     * Doing it in one place is deliberate: it is what keeps the vendored
     * dispatcher byte-identical to its tilecraft source, and it keeps
     * pixelRatio single-sourced in Viewport rather than re-derived from the DOM.
     */
    _toScreen(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width === 0 ? 1 : this.canvas.width / rect.width;
        const scaleY = rect.height === 0 ? 1 : this.canvas.height / rect.height;
        return this.viewport.cssToScreen(x / scaleX, y / scaleY);
    }

    /**
     * A dispatcher DELTA -> a screen-space delta.
     *
     * Deltas take the same scaling as a point but no origin, and the Y flip is
     * a sign change rather than a subtraction from the height. Running a delta
     * through _toScreen() would add the viewport height to it every frame.
     */
    _deltaToScreen(dx, dy) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = rect.width === 0 ? 1 : this.canvas.width / rect.width;
        const scaleY = rect.height === 0 ? 1 : this.canvas.height / rect.height;
        const ratio = this.viewport.pixelRatio;
        return { x: (dx / scaleX) * ratio, y: -(dy / scaleY) * ratio };
    }

    /**
     * Pointer pressure -> a brush-height multiplier. Closes the pen-pressure TODO.
     *
     * Only a pen is scaled. The Pointer Events spec reports a flat 0.5 for
     * devices with no pressure hardware, so multiplying unconditionally would
     * silently halve the brush for every mouse and finger user -- a visible
     * regression dressed as a feature. Some pens also report 0 on the very
     * first sample of a stroke, which would open the stroke with a zero-height
     * brush, so the floor keeps a light touch painting.
     */
    _pressureScale(pressure, pointerType) {
        if (pointerType !== 'pen' || typeof pressure !== 'number') return 1;
        return Utilities.clamp(pressure, MIN_PRESSURE_SCALE, 1);
    }

    /** Brush height for the current stroke, including pen pressure. */
    _brushHeight(pressure, pointerType) {
        return BRUSH_HEIGHT * this.brushScale * this._pressureScale(pressure, pointerType);
    }

    onGestureStart = (event) => {
        // Right-click collapses/expands the panel; it never starts a stroke.
        // It goes through the panel rather than setting showPanel directly, so
        // the flag stays a MIRROR of the panel's state -- setting it here too
        // would let the two disagree the first time the grip is tapped.
        if (event.pointerType === 'mouse' && event.button !== 0) {
            if (this.toolPanel) this.toolPanel.toggleCollapsed();
            return;
        }

        const position = this._toScreen(event.centerX, event.centerY);
        const mouseX = position.x;
        const mouseY = position.y;

        this.mouseX = mouseX;
        this.mouseY = mouseY;
        this.brushX = mouseX;
        this.brushY = mouseY;

        // The colour picker's three pointer forwards are GONE (Phase 8) -- this
        // one, the move, and the up. The GL picker was pixels in the canvas, so
        // every canvas pointer event had to be offered to it first, and the
        // early return below existed to stop a hue drag from also starting a
        // stroke. iro.js is a real element: the browser routes the event to it
        // and this handler never runs. That deletes a whole class of ordering
        // bug -- the canvas can no longer disagree with the picker about who
        // owns a pointer.
        const mode = this.desiredInteractionMode(mouseX, mouseY);

        if (mode === InteractionMode.PANNING) {
            this.interactionState = InteractionMode.PANNING;
        } else if (mode === InteractionMode.RESIZING) {
            this.saveSnapshot();
            this.interactionState = InteractionMode.RESIZING;
            this.resizingSide = this.getResizingSide(mouseX, mouseY);
            this.newPaintingRectangle = this.paintingRectangle.clone();
        } else if (mode === InteractionMode.PAINTING) {
            this.interactionState = InteractionMode.PAINTING;
            this.saveSnapshot();
        }

        // panstart carries no pressure -- it fires on pointerdown, before any
        // move sample. The first pan event supplies the real value.
        if (!this.brushInitialized) {
            this.engine.initializeBrush(
                this.brushX,
                this.brushY,
                this._brushHeight(1, event.pointerType),
                this.brushScale
            );
            this.brushInitialized = true;
        }
    };

    /**
     * Take the brush position from the dispatcher's LIVE pointer state, before
     * this frame's simulation step.
     *
     * The dispatcher defers pan to its own requestAnimationFrame. The render
     * loop's RAF is registered first (in _start), and RAF callbacks run in
     * registration order, so without this the brush would always be one frame
     * behind the pointer: every frame simulated the previous position and the
     * deferred pan only caught up afterwards. Brush.update() derives bristle
     * speed from the delta it is given, so a stale position does not merely lag
     * visually -- it changes how much paint is deposited.
     *
     * Reading the live position here restores the synchronous behaviour the
     * pre-Phase-6 pointermove handler had, while leaving gesture recognition
     * (which genuinely wants accumulated per-frame deltas) on the dispatcher.
     */
    _syncBrushToPointer() {
        if (this.interactionState !== InteractionMode.PAINTING) return;

        const pointers = this.pointerDispatcher && this.pointerDispatcher.pointers;
        if (!pointers || pointers.size !== 1) return;

        const pt = pointers.values().next().value;
        if (!pt) return;

        const position = this._toScreen(pt.x, pt.y);
        this.brushX = position.x;
        this.brushY = position.y;
    }

    onGesturePan = (event) => {
        const position = this._toScreen(event.centerX, event.centerY);
        const mx = position.x;
        const my = position.y;

        this.brushX = mx;
        this.brushY = my;

        if (!this.brushInitialized) {
            this.engine.initializeBrush(
                this.brushX,
                this.brushY,
                this._brushHeight(event.pressure, event.pointerType),
                this.brushScale
            );
            this.brushInitialized = true;
        }

        // Pen pressure reaches the stroke here: recorded per sample so it tracks
        // the pen through the stroke, not just at the moment of contact.
        this.brushPressure = this._pressureScale(event.pressure, event.pointerType);

        if (this.interactionState === InteractionMode.PANNING) {
            const delta = this._deltaToScreen(event.dx, event.dy);
            this._panPainting(delta.x, delta.y);
        } else if (this.interactionState === InteractionMode.RESIZING) {
            this._resizePaintingTo(mx, my);
        }

        this.mouseX = mx;
        this.mouseY = my;
    };

    /** Two-finger drag pans the canvas, whatever the one-finger mode was. */
    onGesturePan2 = (event) => {
        // A genuine pinch owns the gesture; panning the canvas underneath a
        // resize would fight it for the same rectangle.
        if (this.interactionState === InteractionMode.RESIZING) return;

        // A second finger landing mid-stroke ends the stroke rather than
        // smearing paint along the pan.
        if (this.interactionState === InteractionMode.PAINTING) {
            this.interactionState = InteractionMode.PANNING;
        }

        const delta = this._deltaToScreen(event.dx, event.dy);
        this._panPainting(delta.x, delta.y);

        const position = this._toScreen(event.centerX, event.centerY);
        this.mouseX = position.x;
        this.mouseY = position.y;
    };

    /**
     * Pinch scales the painting about its own centre.
     *
     * This is the touch counterpart to edge-drag resizing, not a replacement
     * for it: a pinch has a scale factor but no notion of WHICH edge is being
     * dragged, which is what getResizingSide() supplies for the mouse path and
     * for the resize cursor.
     */
    onGesturePinch = (event) => {
        // pinch and pan2 BOTH fire for every two-finger gesture, so a pure
        // two-finger drag has to be told apart from a real pinch or dragging the
        // canvas silently resizes the painting.
        //
        // The test is the span relative to where this gesture STARTED, not the
        // per-frame scale. Two fingers landing on the same frame make the first
        // frame's scale spike (measured ~1.19 for a span that never changed),
        // and a per-frame test acts on that spike before the gesture is really
        // under way. Total span change cannot spike: it starts at exactly 1.
        if (this.pinchStartSpan === null) this.pinchStartSpan = event.span;

        const totalScale = event.span / this.pinchStartSpan;
        if (Math.abs(totalScale - 1) < PINCH_SCALE_DEADZONE) return;

        if (this.interactionState !== InteractionMode.RESIZING) {
            this.saveSnapshot();
            this.interactionState = InteractionMode.RESIZING;
            this.resizingSide = ResizingSide.NONE;
            this.newPaintingRectangle = this.paintingRectangle.clone();
            // The rectangle the whole gesture scales FROM. Scaling the running
            // rectangle by a total ratio every frame would compound it.
            this.pinchStartRectangle = this.paintingRectangle.clone();
        }

        const start = this.pinchStartRectangle;
        const aspect = start.height / start.width;
        const centerX = start.left + start.width / 2;
        const centerY = start.bottom + start.height / 2;

        const width = Utilities.clamp(
            start.width * totalScale,
            MIN_PAINTING_WIDTH,
            this.maxPaintingWidth
        );
        const height = width * aspect;

        const rect = this.newPaintingRectangle;
        rect.width = width;
        rect.height = height;
        rect.left = centerX - width / 2;
        rect.bottom = centerY - height / 2;

        this.needsRedraw = true;
    };

    onGestureHover = (event) => {
        const position = this._toScreen(event.x, event.y);

        this.brushX = position.x;
        this.brushY = position.y;
        this.mouseX = position.x;
        this.mouseY = position.y;

        this.engine.initializeBrush(
            this.brushX,
            this.brushY,
            this._brushHeight(event.pressure, event.pointerType),
            this.brushScale
        );
        this.brushInitialized = true;
    };

    onGestureEnd = (event) => {
        // The next two-finger gesture measures its span from scratch.
        this.pinchStartSpan = null;
        this.pinchStartRectangle = null;

        if (this.interactionState === InteractionMode.RESIZING) {
            this._commitResize();
        }

        this.interactionState = InteractionMode.NONE;
    };

    /** Shared by one-finger PANNING and two-finger pan2. */
    _panPainting(deltaX, deltaY) {
        this.paintingRectangle.left += deltaX;
        this.paintingRectangle.bottom += deltaY;

        this.paintingRectangle.left = Utilities.clamp(
            this.paintingRectangle.left,
            -this.paintingRectangle.width,
            this.canvas.width
        );
        this.paintingRectangle.bottom = Utilities.clamp(
            this.paintingRectangle.bottom,
            -this.paintingRectangle.height,
            this.canvas.height
        );

        this.needsRedraw = true;
    }

    /** Edge/corner resize driven by the dragged pointer, per resizingSide. */
    _resizePaintingTo(mx, my) {
        if (
            this.resizingSide === ResizingSide.LEFT ||
            this.resizingSide === ResizingSide.TOP_LEFT ||
            this.resizingSide === ResizingSide.BOTTOM_LEFT
        ) {
            this.newPaintingRectangle.left = Utilities.clamp(
                mx,
                this.paintingRectangle.getRight() - this.maxPaintingWidth,
                this.paintingRectangle.getRight() - MIN_PAINTING_WIDTH
            );
            this.newPaintingRectangle.width =
                this.paintingRectangle.left +
                this.paintingRectangle.width -
                this.newPaintingRectangle.left;
        }
        if (
            this.resizingSide === ResizingSide.RIGHT ||
            this.resizingSide === ResizingSide.TOP_RIGHT ||
            this.resizingSide === ResizingSide.BOTTOM_RIGHT
        ) {
            this.newPaintingRectangle.width = Utilities.clamp(
                mx - this.paintingRectangle.left,
                MIN_PAINTING_WIDTH,
                this.maxPaintingWidth
            );
        }
        if (
            this.resizingSide === ResizingSide.BOTTOM ||
            this.resizingSide === ResizingSide.BOTTOM_LEFT ||
            this.resizingSide === ResizingSide.BOTTOM_RIGHT
        ) {
            this.newPaintingRectangle.bottom = Utilities.clamp(
                my,
                this.paintingRectangle.getTop() - this.maxPaintingWidth,
                this.paintingRectangle.getTop() - MIN_PAINTING_WIDTH
            );
            this.newPaintingRectangle.height =
                this.paintingRectangle.bottom +
                this.paintingRectangle.height -
                this.newPaintingRectangle.bottom;
        }
        if (
            this.resizingSide === ResizingSide.TOP ||
            this.resizingSide === ResizingSide.TOP_LEFT ||
            this.resizingSide === ResizingSide.TOP_RIGHT
        ) {
            this.newPaintingRectangle.height = Utilities.clamp(
                my - this.paintingRectangle.bottom,
                MIN_PAINTING_WIDTH,
                this.maxPaintingWidth
            );
        }
        this.needsRedraw = true;
    }

    /** Commit a resize on release: offsets follow the anchored edge. */
    _commitResize() {
        let offsetX = 0,
            offsetY = 0;

        if (
            this.resizingSide === ResizingSide.LEFT ||
            this.resizingSide === ResizingSide.TOP_LEFT ||
            this.resizingSide === ResizingSide.BOTTOM_LEFT
        ) {
            offsetX =
                (this.paintingRectangle.left - this.newPaintingRectangle.left) *
                this.resolutionScale;
        }

        if (
            this.resizingSide === ResizingSide.BOTTOM ||
            this.resizingSide === ResizingSide.BOTTOM_LEFT ||
            this.resizingSide === ResizingSide.BOTTOM_RIGHT
        ) {
            offsetY =
                (this.paintingRectangle.bottom - this.newPaintingRectangle.bottom) *
                this.resolutionScale;
        }

        this.paintingRectangle = this.newPaintingRectangle;

        // The feather width is the engine's -- it must match the width the
        // resize preview drew with, or the painting jumps on release.
        this.engine.resizePainting(
            this.getPaintingResolutionWidth(),
            this.getPaintingResolutionHeight(),
            offsetX,
            offsetY
        );

        this.needsRedraw = true;
    }

    onWheel(event) {
        event.preventDefault();

        const scrollDelta = event.deltaY < 0.0 ? -1.0 : 1.0;
        this.brushScale = Utilities.clamp(
            this.brushScale + scrollDelta * -5.0,
            MIN_BRUSH_SCALE,
            MAX_BRUSH_SCALE
        );
        this.brushSizeSlider.setValue(this.brushScale);
        if (this.barSizeSlider) this.barSizeSlider.setValue(this.brushScale);
    }

    // --- Editing & history ---
    clear() {
        this.engine.clear();
        this.needsRedraw = true;
    }

    saveSnapshot() {
        if (this.snapshotIndex === HISTORY_SIZE) {
            // rotate ring buffer when full
            const front = this.snapshots.shift();
            this.snapshots.push(front);
            this.snapshotIndex -= 1;
        }

        this.undoing = false;

        // The ring, its depth and when to rotate are this app's policy. Filling
        // the snapshot -- including re-allocating its texture if the simulation
        // resolution moved, at the paint texture type the probe chose -- is the
        // engine's, because only it knows those.
        this.engine.saveSnapshot(
            this.snapshots[this.snapshotIndex],
            this.paintingRectangle.width,
            this.paintingRectangle.height,
            this.resolutionScale
        );

        this.snapshotIndex += 1;
        this.refreshDoButtons();
    }

    applySnapshot(snapshot) {
        // The painting rectangle and the quality button are this app's state,
        // so it restores them; the engine restores the paint.
        this.paintingRectangle.width = snapshot.paintingWidth;
        this.paintingRectangle.height = snapshot.paintingHeight;

        if (this.resolutionScale !== snapshot.resolutionScale) {
            for (let i = 0; i < QUALITIES.length; ++i) {
                if (QUALITIES[i].resolutionScale === snapshot.resolutionScale) {
                    this.qualityButtons.setIndex(i);
                }
            }
            this.resolutionScale = snapshot.resolutionScale;
        }

        this.engine.restoreSnapshot(
            snapshot,
            this.getPaintingResolutionWidth(),
            this.getPaintingResolutionHeight()
        );
    }

    canUndo() {
        return this.snapshotIndex >= 1;
    }

    canRedo() {
        return this.undoing && this.snapshotIndex <= this.maxRedoIndex - 1;
    }

    undo() {
        if (!this.undoing) {
            this.saveSnapshot();
            this.undoing = true;
            this.snapshotIndex -= 1;
            this.maxRedoIndex = this.snapshotIndex;
        }

        if (this.canUndo()) {
            this.applySnapshot(this.snapshots[this.snapshotIndex - 1]);
            this.snapshotIndex -= 1;
        }

        this.refreshDoButtons();
        this.needsRedraw = true;
    }

    redo() {
        if (this.canRedo()) {
            this.applySnapshot(this.snapshots[this.snapshotIndex + 1]);
            this.snapshotIndex += 1;
        }

        this.refreshDoButtons();
        this.needsRedraw = true;
    }

    refreshDoButtons() {
        if (this.undoButton) {
            this.undoButton.className = this.canUndo()
                ? 'button do-button-active'
                : 'button do-button-inactive';
        }
        if (this.redoButton) {
            this.redoButton.className = this.canRedo()
                ? 'button do-button-active'
                : 'button do-button-inactive';
        }
    }
}
