'use strict';

// The zoom-out autofocus cue: four small corner angles around the focus point.
// It is screen-space GL rather than DOM so its stroke remains crisp and exactly
// follows the canvas at every device pixel ratio.
class FocusOverlay {
  constructor(wgl, shaderSources, quadVertexBuffer) {
    this.wgl = wgl;
    this.quadVertexBuffer = quadVertexBuffer;
    this.program = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/focus.frag'],
      { a_position: 0 }
    );
  }

  draw(focus, canvasWidth, canvasHeight) {
    const wgl = this.wgl;
    const state = wgl
      .createDrawState()
      .viewport(0, 0, canvasWidth, canvasHeight)
      .useProgram(this.program)
      .enable(wgl.BLEND)
      .blendFunc(wgl.ONE, wgl.ONE_MINUS_SRC_ALPHA)
      .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)
      .uniform2f('u_focus', focus.x, focus.y)
      .uniform4f('u_color', 1, 1, 1, 0.9);
    wgl.drawArrays(state, wgl.TRIANGLE_STRIP, 0, 4);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FocusOverlay };
}
