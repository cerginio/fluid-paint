// ES6 class version of PaintingRenderer
//
// The painting render: turning the simulator's paintTexture into lit pixels.
// Lifted out of Paint.update() in Phase 4, where it sat between the simulation
// step above it and the UI chrome below it, so neither could move without the
// other.
//
// What this owns is every use of painting.vert/painting.frag -- the four screen
// variants (RYB/RGB x normal/resizing) and the two save variants -- plus the
// fullscreen blit that puts the result on screen. What it deliberately does not
// own is the canvas texture and the framebuffer it draws into: those are the
// host's, because the host is what decides where the painting lands (a screen
// here, an offscreen buffer in the save path, something else in a second host).
// They are passed per call rather than captured, which is what makes the same
// renderer serve all three.

// Lighting and surface parameters. These are engine constants, not app
// constants: they describe how wet paint reflects light, which is the engine's
// model of its own material, and no host would sensibly override them without
// also replacing painting.frag. They lived in paint-setup.js only because the
// draw call that used them lived in paint.js.
const NORMAL_SCALE = 7.0;
const ROUGHNESS = 0.075;
const F0 = 0.05;
const SPECULAR_SCALE = 0.5;
const DIFFUSE_SCALE = 0.15;
const LIGHT_DIRECTION = [0, 1, 1];

// The paper the paint sits on, cleared behind every painting draw.
const BACKGROUND_GRAY = 0.7;

// Width in pixels of the soft edge on a resize.
//
// Shared, and deliberately defined once. It reaches two places that have to
// agree: painting.frag's RESIZING variant, which draws the preview, and
// simulator.resize(), which feathers the paint texture when the resize is
// committed. If the two ever disagreed the painting would visibly change at
// the moment the user let go of the handle. Exposed as a static below so the
// host can pass the same number to the simulator.
const RESIZING_FEATHER_SIZE = 8;

// Which colour model the painting is composited in. RYB is David Li's
// subtractive pigment cube and the default; RGB is the additive comparison, and
// the only one worth naming here because RYB is what every branch falls back
// to. See docs -- the RYB path is protected and must not be "fixed" into RGB.
//
// This value MUST equal FluidEngine.COLOR_MODEL.RGB, which is the name hosts
// use (fluid-engine/index.js). It is duplicated rather than referenced only
// because this project has no module system and renderer.js is loaded before
// index.js, so the class does not exist yet at this line. The assertion at the
// bottom of index.js checks the two agree at startup -- Phase 9 added the enum
// after finding that a host had no public name for it at all, and a silent
// disagreement here would composite the wrong colour model with no error.
const ColorModelRGB = 1;

class PaintingRenderer {
  constructor(wgl, shaderSources) {
    this.wgl = wgl;

    // The six painting programs. All are painting.vert + painting.frag with a
    // different #define, so they are built together here rather than scattered
    // across a host's setup.
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

    this.outputProgram = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/output.frag'],
      { a_position: 0 }
    );

    // A unit quad. Every draw here is a fullscreen-style triangle strip, so the
    // renderer owns its own buffer rather than borrowing the host's -- one less
    // thing a second host has to supply.
    this.quadVertexBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.quadVertexBuffer,
      wgl.ARRAY_BUFFER,
      new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
      wgl.STATIC_DRAW
    );
  }

  // Pick the screen program for a colour model and whether a resize preview is
  // in progress.
  _screenProgram(colorModel, resizing) {
    if (colorModel === ColorModelRGB) {
      return resizing ? this.resizingPaintingProgramRGB : this.paintingProgramRGB;
    }
    return resizing ? this.resizingPaintingProgram : this.paintingProgram;
  }

  // Everything painting.frag needs that does not depend on where the result is
  // going. Shared by the screen and save paths so the two cannot drift apart --
  // they were separately open-coded before, one of them missing u_featherSize.
  _applyMaterialUniforms(drawState, resolutionScale) {
    return drawState
      .uniform1f('u_featherSize', RESIZING_FEATHER_SIZE)
      .uniform1f('u_normalScale', NORMAL_SCALE / resolutionScale)
      .uniform1f('u_roughness', ROUGHNESS)
      .uniform1f('u_diffuseScale', DIFFUSE_SCALE)
      .uniform1f('u_specularScale', SPECULAR_SCALE)
      .uniform1f('u_F0', F0)
      .uniform3f(
        'u_lightDirection',
        LIGHT_DIRECTION[0],
        LIGHT_DIRECTION[1],
        LIGHT_DIRECTION[2]
      );
  }

  /**
   * Render the painting into a host-owned texture.
   *
   * @param {Object}    options
   * @param {Simulator} options.simulator          source of paintTexture and resolution
   * @param {Object}    options.framebuffer        host framebuffer to render through
   * @param {Object}    options.targetTexture      host texture to attach and draw into
   * @param {Rectangle} options.paintingRectangle  the painting's rect, in target pixels
   * @param {Rectangle} options.clippedRectangle   that rect clipped to the target
   * @param {number}    options.targetWidth
   * @param {number}    options.targetHeight
   * @param {number}    options.resolutionScale
   * @param {number}    options.colorModel         ColorModel.RYB or .RGB
   * @param {boolean}   options.resizing           draw the resize preview variant
   */
  renderToTexture({
    simulator,
    framebuffer,
    targetTexture,
    paintingRectangle,
    clippedRectangle,
    targetWidth,
    targetHeight,
    resolutionScale,
    colorModel,
    resizing,
  }) {
    const wgl = this.wgl;

    wgl.framebufferTexture2D(
      framebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      targetTexture,
      0
    );
    const clearState = wgl
      .createClearState()
      .bindFramebuffer(framebuffer)
      .clearColor(BACKGROUND_GRAY, BACKGROUND_GRAY, BACKGROUND_GRAY, 1.0);
    wgl.clear(clearState, wgl.COLOR_BUFFER_BIT | wgl.DEPTH_BUFFER_BIT);

    const paintingProgram = this._screenProgram(colorModel, resizing);

    let paintingDrawState = wgl
      .createDrawState()
      .bindFramebuffer(framebuffer)
      .vertexAttribPointer(
        this.quadVertexBuffer,
        paintingProgram.getAttribLocation('a_position'),
        2,
        wgl.FLOAT,
        false,
        0,
        0
      )
      .useProgram(paintingProgram);

    paintingDrawState = this._applyMaterialUniforms(paintingDrawState, resolutionScale)
      .uniform2f('u_paintingPosition', paintingRectangle.left, paintingRectangle.bottom)
      .uniform2f('u_paintingResolution', simulator.resolutionWidth, simulator.resolutionHeight)
      .uniform2f('u_paintingSize', paintingRectangle.width, paintingRectangle.height)
      .uniform2f('u_screenResolution', targetWidth, targetHeight)
      .uniformTexture('u_paintTexture', 0, wgl.TEXTURE_2D, simulator.paintTexture)
      .viewport(
        clippedRectangle.left,
        clippedRectangle.bottom,
        clippedRectangle.width,
        clippedRectangle.height
      );

    wgl.drawArrays(paintingDrawState, wgl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Blit an already-rendered painting texture to the default framebuffer.
   *
   * Separate from renderToTexture because the host redraws the painting only
   * when something changed, but must present every frame -- the chrome drawn
   * over it is not in the painting texture.
   *
   * @param {Object} texture       the host texture holding the rendered painting
   * @param {number} targetWidth
   * @param {number} targetHeight
   */
  present(texture, targetWidth, targetHeight) {
    const wgl = this.wgl;

    const outputDrawState = wgl
      .createDrawState()
      .viewport(0, 0, targetWidth, targetHeight)
      .useProgram(this.outputProgram)
      .uniformTexture('u_input', 0, wgl.TEXTURE_2D, texture)
      .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0);

    wgl.drawArrays(outputDrawState, wgl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Render the painting at its own resolution and read it back as RGBA bytes.
   *
   * The SAVE variant of painting.frag, which composites over an opaque white
   * ground rather than the screen's grey. Allocates and frees its own target,
   * since it runs once per save and never at frame rate.
   *
   * @returns {Uint8Array} width * height * 4 bytes, bottom-up as GL reads them
   */
  renderToPixels({ simulator, width, height, resolutionScale, colorModel }) {
    const wgl = this.wgl;

    const saveTexture = wgl.buildTexture(
      wgl.RGBA,
      wgl.UNSIGNED_BYTE,
      width,
      height,
      null,
      wgl.CLAMP_TO_EDGE,
      wgl.CLAMP_TO_EDGE,
      wgl.NEAREST,
      wgl.NEAREST
    );

    const saveFramebuffer = wgl.createFramebuffer();
    wgl.framebufferTexture2D(
      saveFramebuffer,
      wgl.FRAMEBUFFER,
      wgl.COLOR_ATTACHMENT0,
      wgl.TEXTURE_2D,
      saveTexture,
      0
    );

    const paintingProgram =
      colorModel === ColorModelRGB ? this.savePaintingProgramRGB : this.savePaintingProgram;

    let saveDrawState = wgl
      .createDrawState()
      .bindFramebuffer(saveFramebuffer)
      .viewport(0, 0, width, height)
      .vertexAttribPointer(
        this.quadVertexBuffer,
        paintingProgram.getAttribLocation('a_position'),
        2,
        wgl.FLOAT,
        false,
        0,
        0
      )
      .useProgram(paintingProgram);

    saveDrawState = this._applyMaterialUniforms(saveDrawState, resolutionScale)
      .uniform2f('u_paintingSize', width, height)
      .uniform2f('u_paintingResolution', simulator.resolutionWidth, simulator.resolutionHeight)
      .uniform2f('u_screenResolution', width, height)
      .uniform2f('u_paintingPosition', 0, 0)
      .uniformTexture('u_paintTexture', 0, wgl.TEXTURE_2D, simulator.paintTexture);

    wgl.drawArrays(saveDrawState, wgl.TRIANGLE_STRIP, 0, 4);

    const savePixels = new Uint8Array(width * height * 4);
    wgl.readPixels(
      wgl.createReadState().bindFramebuffer(saveFramebuffer),
      0,
      0,
      width,
      height,
      wgl.RGBA,
      wgl.UNSIGNED_BYTE,
      savePixels
    );

    wgl.deleteTexture(saveTexture);
    wgl.deleteFramebuffer(saveFramebuffer);

    return savePixels;
  }
}

// The one place the resize feather width is defined. See the constant above.
PaintingRenderer.RESIZING_FEATHER_SIZE = RESIZING_FEATHER_SIZE;
