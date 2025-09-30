'use strict';

// ES6 class version of Paint
class Paint {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {WrappedGL} wgl
     */
    constructor(canvas, wgl) {
        this.canvas = canvas;
        this.wgl = wgl;

        // Enable required extensions
        wgl.getExtension('OES_texture_float');
        wgl.getExtension('OES_texture_float_linear');

        // Load shader sources then complete async setup
        WrappedGL.loadTextFiles(shaderFiles, (shaderSources) => {
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

        this.paintingProgram = wgl.createProgram(
            shaderSources['shaders/painting.vert'],
            shaderSources['shaders/painting.frag']
        );

        this.paintingProgramRGB = wgl.createProgram(
            shaderSources['shaders/painting.vert'],
            '#define RGB \n ' + shaderSources['shaders/painting.frag']
        );

        this.resizingPaintingProgram = wgl.createProgram(
            shaderSources['shaders/painting.vert'],
            '#define RESIZING \n ' + shaderSources['shaders/painting.frag']
        );

        this.resizingPaintingProgramRGB = wgl.createProgram(
            shaderSources['shaders/painting.vert'],
            '#define RESIZING \n #define RGB \n ' + shaderSources['shaders/painting.frag']
        );

        this.savePaintingProgram = wgl.createProgram(
            shaderSources['shaders/painting.vert'],
            '#define SAVE \n ' + shaderSources['shaders/painting.frag']
        );

        this.savePaintingProgramRGB = wgl.createProgram(
            shaderSources['shaders/painting.vert'],
            '#define SAVE \n #define RGB \n ' + shaderSources['shaders/painting.frag']
        );

        this.brushProgram = wgl.createProgram(
            shaderSources['shaders/brush.vert'],
            shaderSources['shaders/brush.frag'],
            { a_position: 0 }
        );

        this.panelProgram = wgl.createProgram(
            shaderSources['shaders/fullscreen.vert'],
            shaderSources['shaders/panel.frag'],
            { a_position: 0 }
        );

        this.blurProgram = wgl.createProgram(
            shaderSources['shaders/fullscreen.vert'],
            makeBlurShader(PANEL_BLUR_SAMPLES),
            { a_position: 0 }
        );

        this.outputProgram = wgl.createProgram(
            shaderSources['shaders/fullscreen.vert'],
            shaderSources['shaders/output.frag'],
            { a_position: 0 }
        );

        this.shadowProgram = wgl.createProgram(
            shaderSources['shaders/fullscreen.vert'],
            shaderSources['shaders/shadow.frag'],
            { a_position: 0 }
        );

        this.quadVertexBuffer = wgl.createBuffer();
        wgl.bufferData(
            this.quadVertexBuffer,
            wgl.ARRAY_BUFFER,
            new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
            wgl.STATIC_DRAW
        );

        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

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

        this.simulator = new Simulator(
            wgl,
            shaderSources,
            this.getPaintingResolutionWidth(),
            this.getPaintingResolutionHeight()
        );

        this.snapshots = [];
        for (let i = 0; i < HISTORY_SIZE; ++i) {
            // keep HISTORY_SIZE snapshots to avoid reallocating textures
            const texture = wgl.buildTexture(
                wgl.RGBA,
                wgl.FLOAT,
                this.getPaintingResolutionWidth(),
                this.getPaintingResolutionHeight(),
                null,
                wgl.CLAMP_TO_EDGE,
                wgl.CLAMP_TO_EDGE,
                wgl.LINEAR,
                wgl.LINEAR
            );

            wgl.framebufferTexture2D(
                this.framebuffer,
                wgl.FRAMEBUFFER,
                wgl.COLOR_ATTACHMENT0,
                wgl.TEXTURE_2D,
                texture,
                0
            );
            wgl.clear(
                wgl.createClearState().bindFramebuffer(this.framebuffer),
                wgl.COLOR_BUFFER_BIT
            );

            this.snapshots.push(
                new Snapshot(
                    texture,
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
        this.brushColorHSVA = [Math.random(), 1, 1, 0.8];
        this.colorModel = ColorModel.RYB;

        this.needsRedraw = true; // whether we need to redraw the painting

        this.brush = new Brush(wgl, shaderSources, MAX_BRISTLE_COUNT);

        this.fluiditySlider = new Slider(
            document.getElementById('fluidity-slider'),
            this.simulator.fluidity,
            0.6,
            0.9,
            (fluidity) => {
                this.simulator.fluidity = fluidity;
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
                this.brush.setBristleCount(bristleCount);
            }
        );

        this.brushSizeSlider = new Slider(
            document.getElementById('size-slider'),
            this.brushScale,
            MIN_BRUSH_SCALE,
            MAX_BRUSH_SCALE,
            (size) => {
                this.brushScale = size;
            }
        );

        this.qualityButtons = new Buttons(
            document.getElementById('qualities'),
            QUALITIES.map((q) => q.name),
            INITIAL_QUALITY,
            (index) => {
                this.saveSnapshot();
                this.resolutionScale = QUALITIES[index].resolutionScale;
                this.simulator.changeResolution(
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
                    this.colorModel = ColorModel.RYB;
                } else if (index === 1) {
                    this.colorModel = ColorModel.RGB;
                }
                this.needsRedraw = true;
            }
        );

        this.colorPicker = new ColorPicker(
            this,
            'brushColorHSVA',
            wgl,
            canvas,
            shaderSources,
            COLOR_PICKER_LEFT,
            0
        );

        // this.brushViewer = new BrushViewer(wgl, this.brushProgram, 0, 800, 200, 300);

        this.mainProjectionMatrix = makeOrthographicMatrix(
            new Float32Array(16),
            0.0,
            this.canvas.width,
            0,
            this.canvas.height,
            -5000.0,
            5000.0
        );

        this.onResize = () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;

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

            this.colorPicker.bottom = this.canvas.height - COLOR_PICKER_TOP;
            // this.brushViewer.bottom = this.canvas.height - 800;

            this.mainProjectionMatrix = makeOrthographicMatrix(
                new Float32Array(16),
                0.0,
                this.canvas.width,
                0,
                this.canvas.height,
                -5000.0,
                5000.0
            );

            this.canvasTexture = wgl.buildTexture(
                wgl.RGBA,
                wgl.UNSIGNED_BYTE,
                this.canvas.width,
                this.canvas.height,
                null,
                wgl.CLAMP_TO_EDGE,
                wgl.CLAMP_TO_EDGE,
                wgl.LINEAR,
                wgl.LINEAR
            );
            this.tempCanvasTexture = wgl.buildTexture(
                wgl.RGBA,
                wgl.UNSIGNED_BYTE,
                this.canvas.width,
                this.canvas.height,
                null,
                wgl.CLAMP_TO_EDGE,
                wgl.CLAMP_TO_EDGE,
                wgl.LINEAR,
                wgl.LINEAR
            );
            this.blurredCanvasTexture = wgl.buildTexture(
                wgl.RGBA,
                wgl.UNSIGNED_BYTE,
                this.canvas.width,
                this.canvas.height,
                null,
                wgl.CLAMP_TO_EDGE,
                wgl.CLAMP_TO_EDGE,
                wgl.LINEAR,
                wgl.LINEAR
            );

            this.needsRedraw = true;
        };

        this.onResize();
        window.addEventListener('resize', this.onResize);

        this.mouseX = 0;
        this.mouseY = 0;
        this.spaceDown = false;

        // ---- Pointer Events state & gesture hygiene ----
        this.activePointers = new Map(); // pointerId -> { x, y, type }
        this.primaryPointerId = null;
        // Prevent browser gestures (scroll/zoom) on the drawing surface
        this.canvas.style.touchAction = 'none';

        // ---- Unified Pointer Events (replaces mouse + touch) ----
        canvas.addEventListener('pointerdown', this.onPointerDown.bind(this), { passive: false });
        canvas.addEventListener('pointermove', this.onPointerMove.bind(this), { passive: false });
        canvas.addEventListener('pointerover', this.onPointerOver.bind(this), { passive: false });
        canvas.addEventListener('pointercancel', this.onPointerCancel.bind(this), { passive: false });
        // Up can occur off-canvas; use window as a robust backstop
        window.addEventListener('pointerup', this.onPointerUp.bind(this), { passive: false });

        // Wheel (brush size) – scoped to canvas
        canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });

        // Keyboard
        document.addEventListener('keydown', (event) => {
            if (event.keyCode === 32) {
                this.spaceDown = true;
            } else if (event.keyCode === 90) {
                this.undo();
            } else if (event.keyCode === 82) {
                this.redo();
            }
        });

        document.addEventListener('keyup', (event) => {
            if (event.keyCode === 32) {
                this.spaceDown = false;
            }
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

        this.refreshDoButtons && this.refreshDoButtons();

        const update = () => {
            this.update();
            requestAnimationFrame(update);
        };
        update();
    }

    getPaintingResolutionWidth() {
        return Math.ceil(this.paintingRectangle.width * this.resolutionScale);
    }

    getPaintingResolutionHeight() {
        return Math.ceil(this.paintingRectangle.height * this.resolutionScale);
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

        // update brush
        if (this.brushInitialized) {
            this.brush.update(
                this.brushX,
                this.brushY,
                BRUSH_HEIGHT * this.brushScale,
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
                (this.brush.bristleCount - MIN_BRISTLE_COUNT) /
                (MAX_BRISTLE_COUNT - MIN_BRISTLE_COUNT);
            const minAlpha = mix(THIN_MIN_ALPHA, THICK_MIN_ALPHA, bristleT);
            const maxAlpha = mix(THIN_MAX_ALPHA, THICK_MAX_ALPHA, bristleT);
            const alpha = mix(minAlpha, maxAlpha, alphaT);
            splatColor[3] = alpha;

            const splatVelocityScale =
                SPLAT_VELOCITY_SCALE * splatColor[3] * this.resolutionScale;

            // splat paint
            this.simulator.splat(
                this.brush,
                Z_THRESHOLD * this.brushScale,
                this.paintingRectangle,
                splatColor,
                splatRadius,
                splatVelocityScale
            );
        }

        this.save = () => {
            //we first render the painting to a WebGL texture
            var wgl = this.wgl;

            var saveWidth = this.paintingRectangle.width;
            var saveHeight = this.paintingRectangle.height;

            var saveTexture = wgl.buildTexture(wgl.RGBA, wgl.UNSIGNED_BYTE, saveWidth, saveHeight, null, wgl.CLAMP_TO_EDGE, wgl.CLAMP_TO_EDGE, wgl.NEAREST, wgl.NEAREST);

            var saveFramebuffer = wgl.createFramebuffer();
            wgl.framebufferTexture2D(saveFramebuffer, wgl.FRAMEBUFFER, wgl.COLOR_ATTACHMENT0, wgl.TEXTURE_2D, saveTexture, 0);

            var paintingProgram = this.colorModel === ColorModel.RYB ? this.savePaintingProgram : this.savePaintingProgramRGB;

            var saveDrawState = wgl.createDrawState()
                .bindFramebuffer(saveFramebuffer)
                .viewport(0, 0, saveWidth, saveHeight)
                .vertexAttribPointer(this.quadVertexBuffer, paintingProgram.getAttribLocation('a_position'), 2, wgl.FLOAT, false, 0, 0)
                .useProgram(paintingProgram)
                .uniform2f('u_paintingSize', this.paintingRectangle.width, this.paintingRectangle.height)
                .uniform2f('u_paintingResolution', this.simulator.resolutionWidth, this.simulator.resolutionHeight)
                .uniform2f('u_screenResolution', this.paintingRectangle.width, this.paintingRectangle.height)
                .uniform2f('u_paintingPosition', 0, 0)
                .uniformTexture('u_paintTexture', 0, wgl.TEXTURE_2D, this.simulator.paintTexture)

                .uniform1f('u_normalScale', NORMAL_SCALE / this.resolutionScale)
                .uniform1f('u_roughness', ROUGHNESS)
                .uniform1f('u_diffuseScale', DIFFUSE_SCALE)
                .uniform1f('u_specularScale', SPECULAR_SCALE)
                .uniform1f('u_F0', F0)
                .uniform3f('u_lightDirection', LIGHT_DIRECTION[0], LIGHT_DIRECTION[1], LIGHT_DIRECTION[2]);

            wgl.drawArrays(saveDrawState, wgl.TRIANGLE_STRIP, 0, 4);

            //then we read back this texture

            var savePixels = new Uint8Array(saveWidth * saveHeight * 4);
            wgl.readPixels(wgl.createReadState().bindFramebuffer(saveFramebuffer),
                0, 0, saveWidth, saveHeight, wgl.RGBA, wgl.UNSIGNED_BYTE, savePixels);


            wgl.deleteTexture(saveTexture);
            wgl.deleteFramebuffer(saveFramebuffer);


            //then we draw the pixels to a 2D canvas and then save from the canvas
            //is there a better way?

            var saveCanvas = document.createElement('canvas');
            saveCanvas.width = saveWidth;
            saveCanvas.height = saveHeight;
            var saveContext = saveCanvas.getContext('2d');

            var imageData = saveContext.createImageData(saveWidth, saveHeight);
            imageData.data.set(savePixels);
            saveContext.putImageData(imageData, 0, 0);

            // window.open(saveCanvas.toDataURL());
            _save(saveCanvas);

            function _save(canvas, filename = 'image.png') {
                canvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;           // triggers a download instead of navigation
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                }, 'image/png');
            };

        }

        const simulationUpdated = this.simulator.simulate();
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
            // draw painting into texture
            wgl.framebufferTexture2D(
                this.framebuffer,
                wgl.FRAMEBUFFER,
                wgl.COLOR_ATTACHMENT0,
                wgl.TEXTURE_2D,
                this.canvasTexture,
                0
            );
            const clearState = wgl
                .createClearState()
                .bindFramebuffer(this.framebuffer)
                .clearColor(BACKGROUND_GRAY, BACKGROUND_GRAY, BACKGROUND_GRAY, 1.0);
            wgl.clear(clearState, wgl.COLOR_BUFFER_BIT | wgl.DEPTH_BUFFER_BIT);

            let paintingProgram;
            if (this.colorModel === ColorModel.RYB) {
                paintingProgram =
                    this.interactionState === InteractionMode.RESIZING
                        ? this.resizingPaintingProgram
                        : this.paintingProgram;
            } else if (this.colorModel === ColorModel.RGB) {
                paintingProgram =
                    this.interactionState === InteractionMode.RESIZING
                        ? this.resizingPaintingProgramRGB
                        : this.paintingProgramRGB;
            }

            const paintingDrawState = wgl
                .createDrawState()
                .bindFramebuffer(this.framebuffer)
                .vertexAttribPointer(
                    this.quadVertexBuffer,
                    paintingProgram.getAttribLocation('a_position'),
                    2,
                    wgl.FLOAT,
                    false,
                    0,
                    0
                )
                .useProgram(paintingProgram)
                .uniform1f('u_featherSize', RESIZING_FEATHER_SIZE)
                .uniform1f('u_normalScale', NORMAL_SCALE / this.resolutionScale)
                .uniform1f('u_roughness', ROUGHNESS)
                .uniform1f('u_diffuseScale', DIFFUSE_SCALE)
                .uniform1f('u_specularScale', SPECULAR_SCALE)
                .uniform1f('u_F0', F0)
                .uniform3f(
                    'u_lightDirection',
                    LIGHT_DIRECTION[0],
                    LIGHT_DIRECTION[1],
                    LIGHT_DIRECTION[2]
                )
                .uniform2f('u_paintingPosition', this.paintingRectangle.left, this.paintingRectangle.bottom)
                .uniform2f('u_paintingResolution', this.simulator.resolutionWidth, this.simulator.resolutionHeight)
                .uniform2f('u_paintingSize', this.paintingRectangle.width, this.paintingRectangle.height)
                .uniform2f('u_screenResolution', this.canvas.width, this.canvas.height)
                .uniformTexture('u_paintTexture', 0, wgl.TEXTURE_2D, this.simulator.paintTexture)
                .viewport(
                    clippedPaintingRectangle.left,
                    clippedPaintingRectangle.bottom,
                    clippedPaintingRectangle.width,
                    clippedPaintingRectangle.height
                );

            wgl.drawArrays(paintingDrawState, wgl.TRIANGLE_STRIP, 0, 4);
        }

        // output painting to screen
        const outputDrawState = wgl
            .createDrawState()
            .viewport(0, 0, this.canvas.width, this.canvas.height)
            .useProgram(this.outputProgram)
            .uniformTexture('u_input', 0, wgl.TEXTURE_2D, this.canvasTexture)
            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0);
        wgl.drawArrays(outputDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        this.drawShadow(PAINTING_SHADOW_ALPHA, clippedPaintingRectangle); // draw painting shadow

        // draw brush to screen
        if (
            this.interactionState === InteractionMode.PAINTING ||
            (!this.colorPicker.isInUse() &&
                this.interactionState === InteractionMode.NONE &&
                this.desiredInteractionMode(this.mouseX, this.mouseY) === InteractionMode.PAINTING)
        ) {
            const brushDrawState = wgl
                .createDrawState()
                .bindFramebuffer(null)
                .viewport(0, 0, this.canvas.width, this.canvas.height)
                .vertexAttribPointer(
                    this.brush.brushTextureCoordinatesBuffer,
                    0,
                    2,
                    wgl.FLOAT,
                    wgl.FALSE,
                    0,
                    0
                )
                .useProgram(this.brushProgram)
                .bindIndexBuffer(this.brush.brushIndexBuffer)
                .uniform4f('u_color', 0.6, 0.6, 0.6, 1.0)
                .uniformMatrix4fv('u_projectionViewMatrix', false, this.mainProjectionMatrix)
                .enable(wgl.DEPTH_TEST)
                .enable(wgl.BLEND)
                .blendFunc(wgl.DST_COLOR, wgl.ZERO)
                .uniformTexture('u_positionsTexture', 0, wgl.TEXTURE_2D, this.brush.positionsTexture);

            wgl.drawElements(
                brushDrawState,
                wgl.LINES,
                (this.brush.indexCount * this.brush.bristleCount) / this.brush.maxBristleCount,
                wgl.UNSIGNED_SHORT,
                0
            );
        }

        // cursor logic
        let desiredCursor = '';
        if (this.colorPicker.isInUse()) {
            desiredCursor = 'pointer';
        } else if (this.colorPicker.overControl(this.mouseX, this.mouseY)) {
            desiredCursor = 'pointer';
        } else if (this.interactionState === InteractionMode.NONE) {
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

        if (this.canvas.style.cursor !== desiredCursor) {
            this.canvas.style.cursor = desiredCursor;
        }

        const panelBottom = this.canvas.height - PANEL_HEIGHT;

        if (this.needsRedraw) {
            // blur the canvas for the panel
            const BLUR_FEATHER = ((PANEL_BLUR_SAMPLES - 1) / 2) * PANEL_BLUR_STRIDE;

            const blurDrawState = wgl
                .createDrawState()
                .useProgram(this.blurProgram)
                .viewport(
                    0,
                    Utilities.clamp(panelBottom - BLUR_FEATHER, 0, this.canvas.height),
                    PANEL_WIDTH + BLUR_FEATHER,
                    PANEL_HEIGHT + BLUR_FEATHER
                )
                .bindFramebuffer(this.framebuffer)
                .uniform2f('u_resolution', this.canvas.width, this.canvas.height)
                .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0);

            wgl.framebufferTexture2D(
                this.framebuffer,
                wgl.FRAMEBUFFER,
                wgl.COLOR_ATTACHMENT0,
                wgl.TEXTURE_2D,
                this.tempCanvasTexture,
                0
            );
            blurDrawState
                .uniformTexture('u_input', 0, wgl.TEXTURE_2D, this.canvasTexture)
                .uniform2f('u_step', PANEL_BLUR_STRIDE, 0);
            wgl.drawArrays(blurDrawState, wgl.TRIANGLE_STRIP, 0, 4);

            wgl.framebufferTexture2D(
                this.framebuffer,
                wgl.FRAMEBUFFER,
                wgl.COLOR_ATTACHMENT0,
                wgl.TEXTURE_2D,
                this.blurredCanvasTexture,
                0
            );
            blurDrawState
                .uniformTexture('u_input', 0, wgl.TEXTURE_2D, this.tempCanvasTexture)
                .uniform2f('u_step', 0, PANEL_BLUR_STRIDE);
            wgl.drawArrays(blurDrawState, wgl.TRIANGLE_STRIP, 0, 4);
        }

        // draw panel to screen
        const panelDrawState = wgl
            .createDrawState()
            .viewport(0, panelBottom, PANEL_WIDTH, PANEL_HEIGHT)
            .uniformTexture('u_canvasTexture', 0, wgl.TEXTURE_2D, this.blurredCanvasTexture)
            .uniform2f('u_canvasResolution', this.canvas.width, this.canvas.height)
            .uniform2f('u_panelResolution', PANEL_WIDTH, PANEL_HEIGHT)
            .useProgram(this.panelProgram)
            .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0);
        wgl.drawArrays(panelDrawState, wgl.TRIANGLE_STRIP, 0, 4);

        this.drawShadow(
            PANEL_SHADOW_ALPHA,
            new Rectangle(0, panelBottom, PANEL_WIDTH, PANEL_HEIGHT)
        ); // shadow for panel

        this.needsRedraw = false;

        this.colorPicker.draw(this.colorModel === ColorModel.RGB);
        // this.brushViewer.draw(this.brushX, this.brushY, this.brush);
    }

    // what interaction mode would be triggered if we clicked with given mouse position
    desiredInteractionMode(mouseX, mouseY) {
        const mouseOverPanel = mouseX < PANEL_WIDTH && mouseY > this.canvas.height - PANEL_HEIGHT;

        if (mouseOverPanel) {
            return InteractionMode.NONE;
        } else if (
            this.spaceDown ||
            this.mouseX < this.paintingRectangle.left - RESIZING_RADIUS ||
            this.mouseX > this.paintingRectangle.left + this.paintingRectangle.width + RESIZING_RADIUS ||
            this.mouseY < this.paintingRectangle.bottom - RESIZING_RADIUS ||
            this.mouseY > this.paintingRectangle.bottom + this.paintingRectangle.height + RESIZING_RADIUS
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
    // Pointer Events (unified input)
    // ----------------------------
    onPointerDown(event) {
        if (event.preventDefault) event.preventDefault();

        // Only handle primary button for mouse; accept pen/touch
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        const position = Utilities.getMousePosition(event, this.canvas);
        const mouseX = position.x;
        const mouseY = this.canvas.height - position.y;

        // Track pointer and choose primary if none
        this.activePointers.set(event.pointerId, { x: mouseX, y: mouseY, type: event.pointerType });
        if (this.primaryPointerId === null) this.primaryPointerId = event.pointerId;

        // Keep receiving move/up even if pointer leaves the canvas
        this.canvas.setPointerCapture(event.pointerId);

        // Update tracked positions
        this.mouseX = mouseX;
        this.mouseY = mouseY;
        this.brushX = mouseX;
        this.brushY = mouseY;

        // Color picker first
        this.colorPicker.onMouseDown(mouseX, mouseY);
        if (this.colorPicker.isInUse()) return;

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

        // If a second touch lands while painting, switch to panning (mirrors old touch logic)
        if (event.pointerType !== 'mouse' &&
            this.interactionState === InteractionMode.PAINTING &&
            this.activePointers.size === 2) {
            this.interactionState = InteractionMode.PANNING;
        }

        // Initialize brush at first contact if needed
        if (!this.brushInitialized) {
            this.brush.initialize(
                this.brushX,
                this.brushY,
                BRUSH_HEIGHT * this.brushScale,
                this.brushScale
            );
            this.brushInitialized = true;
        }
    }

    onPointerMove(event) {
        if (event.preventDefault) event.preventDefault();

        const position = Utilities.getMousePosition(event, this.canvas);
        const mx = position.x;
        const my = this.canvas.height - position.y;

        // Update bookkeeping
        this.activePointers.set(event.pointerId, { x: mx, y: my, type: event.pointerType });

        // Determine which pointer drives interactions
        const drivingId = this.primaryPointerId ?? event.pointerId;

        // Update brush position for the driving pointer
        if (event.pointerId === drivingId) {
            this.brushX = mx;
            this.brushY = my;
        }

        if (!this.brushInitialized) {
            this.brush.initialize(
                this.brushX,
                this.brushY,
                BRUSH_HEIGHT * this.brushScale,
                this.brushScale
            );
            this.brushInitialized = true;
        }

        // Panning / resizing movement mirrors original logic
        if (this.interactionState === InteractionMode.PANNING && event.pointerId === drivingId) {
            const deltaX = mx - this.mouseX;
            const deltaY = my - this.mouseY;

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
        } else if (this.interactionState === InteractionMode.RESIZING && event.pointerId === drivingId) {
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

        // Forward to color picker
        this.colorPicker.onMouseMove(position.x, this.canvas.height - position.y);

        // Track last mouse only for the driving pointer
        if (event.pointerId === drivingId) {
            this.mouseX = mx;
            this.mouseY = my;
        }
    }

    onPointerUp(event) {
        if (event.preventDefault) event.preventDefault();

        // Treat color picker up using last known coords to be robust even if up is off-canvas
        this.colorPicker.onMouseUp(this.mouseX, this.mouseY);

        // Finalize resize like original onMouseUp
        if (this.interactionState === InteractionMode.RESIZING) {
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

            this.simulator.resize(
                this.getPaintingResolutionWidth(),
                this.getPaintingResolutionHeight(),
                offsetX,
                offsetY,
                RESIZING_FEATHER_SIZE
            );

            this.needsRedraw = true;
        }

        // Update bookkeeping AFTER resize handling
        this.activePointers.delete(event.pointerId);

        // Choose a new driving pointer if needed
        if (this.primaryPointerId === event.pointerId) {
            const next = this.activePointers.keys().next();
            this.primaryPointerId = next.done ? null : next.value;
            if (this.primaryPointerId !== null) {
                const p = this.activePointers.get(this.primaryPointerId);
                this.mouseX = p.x;
                this.mouseY = p.y;
            }
        }

        // If no pointers remain, reset interaction state
        if (this.activePointers.size === 0) {
            this.interactionState = InteractionMode.NONE;
        }
    }

    onPointerCancel(event) {
        if (event.preventDefault) event.preventDefault();
        // Treat like an up
        this.onPointerUp(event);
    }

    onPointerOver(event) {
        if (event.preventDefault) event.preventDefault();

        const position = Utilities.getMousePosition(event, this.canvas);
        const mouseX = position.x;
        const mouseY = this.canvas.height - position.y;

        this.brushX = mouseX;
        this.brushY = mouseY;

        this.brush.initialize(
            this.brushX,
            this.brushY,
            BRUSH_HEIGHT * this.brushScale,
            this.brushScale
        );
        this.brushInitialized = true;
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
    }

    // --- Editing & history ---
    clear() {
        this.simulator.clear();
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

        const snapshot = this.snapshots[this.snapshotIndex];

        // ensure snapshot texture matches current sim resolution
        if (
            snapshot.getTextureWidth() !== this.simulator.resolutionWidth ||
            snapshot.getTextureHeight() !== this.simulator.resolutionHeight
        ) {
            this.wgl.rebuildTexture(
                snapshot.texture,
                this.wgl.RGBA,
                this.wgl.FLOAT,
                this.simulator.resolutionWidth,
                this.simulator.resolutionHeight,
                null,
                this.wgl.CLAMP_TO_EDGE,
                this.wgl.CLAMP_TO_EDGE,
                this.wgl.LINEAR,
                this.wgl.LINEAR
            );
        }

        this.simulator.copyPaintTexture(snapshot.texture);

        snapshot.paintingWidth = this.paintingRectangle.width;
        snapshot.paintingHeight = this.paintingRectangle.height;
        snapshot.resolutionScale = this.resolutionScale;

        this.snapshotIndex += 1;
        this.refreshDoButtons();
    }

    applySnapshot(snapshot) {
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

        if (
            this.simulator.resolutionWidth !== this.getPaintingResolutionWidth() ||
            this.simulator.resolutionHeight !== this.getPaintingResolutionHeight()
        ) {
            this.simulator.changeResolution(
                this.getPaintingResolutionWidth(),
                this.getPaintingResolutionHeight()
            );
        }

        this.simulator.applyPaintTexture(snapshot.texture);
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
