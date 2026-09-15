'use strict';

/*
 * Brush-center marker overlay.
 *
 * Draws a small diamond at the brush's live target position -- the point the
 * pointer is actually over, not the (physically simulated) bristle bases,
 * which drift under gravity/damping. At a large brush size the bristle
 * silhouette alone does not pin down where the stroke's geometric center is,
 * which makes overlapping strokes by eye unreliable; this marker exists to
 * fix that one point precisely.
 *
 * The fill is always the brush's own pigment -- that is the one thing this
 * marker exists to show. Its ring is the background colour's complement, read
 * live from the already-rendered painting under the cursor, so the diamond's
 * silhouette stays legible even where the pigment happens to sit close to the
 * ground colour.
 *
 * Drawn in screen pixels (via Viewport.worldToScreen), the same space
 * rectborder.frag already draws in, so the marker keeps a constant apparent
 * size regardless of zoom or brush scale.
 */

const BRUSH_CENTER_RADIUS = 6.0; // screen pixels, half-diagonal

class BrushCenterMarker {
  /**
   * @param {WrappedGL} wgl
   * @param {Object} shaderSources  the loaded shader text, keyed by path
   * @param {WebGLBuffer} quadVertexBuffer  fullscreen triangle-strip quad
   */
  constructor(wgl, shaderSources, quadVertexBuffer) {
    this.wgl = wgl;
    this.quadVertexBuffer = quadVertexBuffer;

    this.program = wgl.createProgram(
      shaderSources['shaders/fullscreen.vert'],
      shaderSources['shaders/brushcenter.frag'],
      { a_position: 0 }
    );
  }

  /**
   * @param {number} screenX  marker center, in screen pixels
   * @param {number} screenY
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   * @param {WebGLTexture} canvasTexture  the presented painting, sampled to
   *   decide the ring colour
   * @param {number[]} pigmentColor  the brush's displayed pigment, [r,g,b] 0..1
   */
  draw(screenX, screenY, canvasWidth, canvasHeight, canvasTexture, pigmentColor) {
    const wgl = this.wgl;

    const drawState = wgl
      .createDrawState()
      .viewport(0, 0, canvasWidth, canvasHeight)
      .useProgram(this.program)
      .enable(wgl.BLEND)
      .blendFunc(wgl.ONE, wgl.ONE_MINUS_SRC_ALPHA)
      .vertexAttribPointer(this.quadVertexBuffer, 0, 2, wgl.FLOAT, wgl.FALSE, 0, 0)
      .uniform2f('u_center', screenX, screenY)
      .uniform1f('u_radius', BRUSH_CENTER_RADIUS)
      .uniform2f('u_canvasResolution', canvasWidth, canvasHeight)
      .uniform3f('u_pigmentColor', pigmentColor[0], pigmentColor[1], pigmentColor[2])
      .uniformTexture('u_canvasTexture', 0, wgl.TEXTURE_2D, canvasTexture);

    wgl.drawArrays(drawState, wgl.TRIANGLE_STRIP, 0, 4);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BrushCenterMarker };
}
