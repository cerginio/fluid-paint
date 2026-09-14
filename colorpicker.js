// ES6 class version of ColorPicker

const WIDTH = 300;
const HEIGHT = 200;

// coordinates are all relative to [left, bottom]
const ALPHA_SLIDER_X = 220;
const ALPHA_SLIDER_Y = 10;
const ALPHA_SLIDER_WIDTH = 20;
const ALPHA_SLIDER_HEIGHT = 180;

// center of the hue circle
const CIRCLE_X = 100;
const CIRCLE_Y = 100;

const INNER_RADIUS = 75;
const OUTER_RADIUS = 90;

// dimensions of the inner saturation/brightness square
const SQUARE_WIDTH = INNER_RADIUS * Math.sqrt(2);

class ColorPicker {
  /**
   * @param {function(): number[]} getHSVA - returns the HSVA array to edit
   * @param {Object} wgl - wrapper around WebGL utilities
   * @param {HTMLCanvasElement} canvas - target canvas
   * @param {Object} shaderSources - shader source map
   * @param {number} left - x offset of picker origin
   * @param {number} bottom - y offset of picker origin
   */
  constructor(getHSVA, wgl, canvas, shaderSources, left, bottom) {
    this.wgl = wgl;
    this.canvas = canvas;

    // How the picker reaches the colour it edits. Previously this was an object
    // plus the *name* of a property on it, so the picker could reach into any
    // field of its owner and the coupling was invisible to a reader of either
    // file. A single accessor names exactly what is shared.
    //
    // It returns the live array and the picker mutates it in place, which is
    // what the owner's other readers already assume -- a setter that replaced
    // the array would silently break anything holding a reference to it.
    this.getHSVA = getHSVA;

    this.left = left;
    this.bottom = bottom;

    // Every constant in this file (radii, slider box, WIDTH/HEIGHT) is authored
    // in CSS pixels, while left/bottom and the incoming mouse coordinates are
    // screen pixels. Rather than convert a dozen constants, the picker carries
    // one scale: sizes are multiplied by it on the way out to GL, and mouse
    // coordinates are divided by it on the way in. Set by Paint from the
    // viewport; 1 reproduces the old behaviour exactly.
    this.scale = 1;

    // whether we're currently manipulating the hue or the saturation/lightness/alpha
    this.huePressed = false;
    this.saturationLightnessPressed = false;
    this.alphaPressed = false;

    this.pickerProgram = wgl.createProgram(
      shaderSources["shaders/picker.vert"],
      shaderSources["shaders/picker.frag"],
      { a_position: 0 }
    );

    this.pickerProgramRGB = wgl.createProgram(
      shaderSources["shaders/picker.vert"],
      "#define RGB \n " + shaderSources["shaders/picker.frag"],
      { a_position: 0 }
    );

    this.quadVertexBuffer = wgl.createBuffer();
    wgl.bufferData(
      this.quadVertexBuffer,
      wgl.ARRAY_BUFFER,
      new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
      wgl.STATIC_DRAW
    );
  }

  draw(rgbModel) {
    const wgl = this.wgl;
    const hsva = this.getHSVA();

    const pickerDrawState = wgl
      .createDrawState()
      .bindFramebuffer(null)
      .viewport(0, 0, this.canvas.width, this.canvas.height)
      .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)
      .useProgram(rgbModel ? this.pickerProgramRGB : this.pickerProgram)
      .uniform2f("u_resolution", WIDTH * this.scale, HEIGHT * this.scale)
      .uniform1f("u_innerRadius", INNER_RADIUS * this.scale)
      .uniform1f("u_outerRadius", OUTER_RADIUS * this.scale)
      .uniform1f("u_squareWidth", SQUARE_WIDTH * this.scale)
      .uniform2f("u_circlePosition", CIRCLE_X * this.scale, CIRCLE_Y * this.scale)
      .uniform2f("u_alphaSliderPosition", ALPHA_SLIDER_X * this.scale, ALPHA_SLIDER_Y * this.scale)
      .uniform2f("u_alphaSliderDimensions", ALPHA_SLIDER_WIDTH * this.scale, ALPHA_SLIDER_HEIGHT * this.scale)
      .uniform4f("u_currentHSVA", hsva[0], hsva[1], hsva[2], hsva[3])
      .uniform2f("u_screenResolution", this.canvas.width, this.canvas.height)
      .uniform2f("u_position", this.left, this.bottom)
      .uniform2f("u_dimensions", WIDTH * this.scale, HEIGHT * this.scale)
      // premultiplied alpha
      .enable(wgl.BLEND)
      .blendFunc(wgl.ONE, wgl.ONE_MINUS_SRC_ALPHA);

    wgl.drawArrays(pickerDrawState, wgl.TRIANGLE_STRIP, 0, 4);
  }

  overControl(x, y) {
    return this.overHue(x, y) || this.overSaturationLightness(x, y) || this.overAlpha(x, y);
  }

  // x and y are relative to the canvas
  overHue(x, y) {
    x = (x - this.left) / this.scale;
    y = (y - this.bottom) / this.scale;

    const xDist = x - CIRCLE_X;
    const yDist = y - CIRCLE_Y;
    const distance = Math.sqrt(xDist * xDist + yDist * yDist);

    return distance < OUTER_RADIUS && distance > INNER_RADIUS;
  }

  // x and y are relative to the canvas
  overSaturationLightness(x, y) {
    x = (x - this.left) / this.scale;
    y = (y - this.bottom) / this.scale;

    const xDist = x - CIRCLE_X;
    const yDist = y - CIRCLE_Y;

    return Math.abs(xDist) <= SQUARE_WIDTH / 2 && Math.abs(yDist) <= SQUARE_WIDTH / 2;
  }

  // x and y are relative to the canvas
  overAlpha(x, y) {
    x = (x - this.left) / this.scale;
    y = (y - this.bottom) / this.scale;

    return (
      x >= ALPHA_SLIDER_X &&
      x <= ALPHA_SLIDER_X + ALPHA_SLIDER_WIDTH &&
      y >= ALPHA_SLIDER_Y &&
      y <= ALPHA_SLIDER_Y + ALPHA_SLIDER_HEIGHT
    );
  }

  // x and y are relative to the canvas
  onMouseDown(x, y) {
    if (this.overHue(x, y)) {
      this.huePressed = true;
    } else if (this.overSaturationLightness(x, y)) {
      this.saturationLightnessPressed = true;
    } else if (this.overAlpha(x, y)) {
      this.alphaPressed = true;
    }

    this.onMouseMove(x, y);
  }

  isInUse() {
    return this.huePressed || this.saturationLightnessPressed || this.alphaPressed;
  }

  onMouseUp() {
    this.huePressed = false;
    this.saturationLightnessPressed = false;
    this.alphaPressed = false;
  }

  onMouseMove(mouseX, mouseY) {
    // make relative to the picker
    let x = (mouseX - this.left) / this.scale;
    let y = (mouseY - this.bottom) / this.scale;

    if (!(this.huePressed || this.saturationLightnessPressed || this.alphaPressed)) {
      return;
    }

    const hsva = this.getHSVA();

    if (this.huePressed) {
      let angle = Math.atan2(y - CIRCLE_Y, x - CIRCLE_X);
      if (angle < 0) angle += 2.0 * Math.PI; // [-PI, PI] -> [0, 2 * PI]
      // hue
      hsva[0] = angle / (2.0 * Math.PI);
    } else if (this.saturationLightnessPressed) {
      // saturation
      hsva[1] = (x - (CIRCLE_X - SQUARE_WIDTH / 2)) / SQUARE_WIDTH;
      hsva[1] = Utilities.clamp(hsva[1], 0.0, 1.0);

      // brightness
      hsva[2] = (y - (CIRCLE_Y - SQUARE_WIDTH / 2)) / SQUARE_WIDTH;
      hsva[2] = Utilities.clamp(hsva[2], 0.0, 1.0);
    } else if (this.alphaPressed) {
      // alpha
      hsva[3] = Utilities.clamp((y - ALPHA_SLIDER_Y) / ALPHA_SLIDER_HEIGHT, 0, 1);
    }
  }
}

// If you use modules:
// export default ColorPicker;
