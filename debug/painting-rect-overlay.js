'use strict';

/*
 * Painting-rectangle outline overlay.
 *
 * Draws a border around the painting rectangle, and — while a resize drag is in
 * progress — around the previewed new rectangle instead, so the drag has visual
 * feedback. Enabled by default; see debug/debug-flags.js for why the flag
 * exists (decomposition and a declared seam, not a visibility switch).
 *
 * This owns everything the feature needs: its GL program, its appearance, and
 * its draw call. Paint holds one nullable reference and delegates. When the
 * flag is off the module is never constructed, so nothing here is compiled or
 * allocated and there is no per-frame branch beyond the single null check that
 * dispatches it.
 *
 * Extracted from Paint in Phase 1 (FLUID-ENGINE-EXTRACTION-PLAN.md §3a).
 */

const PAINTING_RECT_THICKNESS = 2.0;          // pixels
const PAINTING_RECT_COLOR_HEX = '#0ea5e9';    // sky blue
const PAINTING_RECT_COLOR_ALPHA = 1;

class PaintingRectOverlay {
  /**
   * @param {WrappedGL} wgl
   * @param {Object} shaderSources  the loaded shader text, keyed by path
   * @param {WebGLBuffer} quadVertexBuffer  fullscreen triangle-strip quad
   */
  constructor(wgl, shaderSources, quadVertexBuffer) {
    this.wgl = wgl;
    this.quadVertexBuffer = quadVertexBuffer;

    // A fullscreen pass that keeps only the border of a given rectangle. It
    // works in gl_FragCoord pixel space, so thickness is in real pixels.
    this.program = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/rectborder.frag'],
      { a_position: 0 }
    );

    this.thickness = PAINTING_RECT_THICKNESS;
    this.color = hexToRgba01(PAINTING_RECT_COLOR_HEX, PAINTING_RECT_COLOR_ALPHA);
  }

  /**
   * @param {Rectangle} rectangle  the rectangle to outline — the caller passes
   *   the resize preview while a resize is in progress, the live one otherwise
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  draw(rectangle, canvasWidth, canvasHeight) {
    const wgl = this.wgl;

    const drawState = wgl
      .createDrawState()
      .viewport(0, 0, canvasWidth, canvasHeight)
      .useProgram(this.program)
      .enable(wgl.BLEND)
      .blendFunc(wgl.ONE, wgl.ONE_MINUS_SRC_ALPHA)
      .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)
      .uniform2f('u_bottomLeft', rectangle.left, rectangle.bottom)
      .uniform2f('u_topRight', rectangle.getRight(), rectangle.getTop())
      .uniform1f('u_thickness', this.thickness)
      .uniform4f('u_color', this.color[0], this.color[1], this.color[2], this.color[3]);

    wgl.drawArrays(drawState, wgl.TRIANGLE_STRIP, 0, 4);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PaintingRectOverlay };
}
