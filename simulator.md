runWebGLSelfTest(wgl.gl)
results:
```json
[
    {
        "feature": "WebGL version",
        "actual": "WebGL1",
        "expected": "WebGL1 or WebGL2",
        "status": "OK",
        "comment": "Qualcomm / Adreno (TM) 642L"
    },
    {
        "feature": "MAX_VERTEX_TEXTURE_IMAGE_UNITS",
        "actual": 16,
        "expected": ">= 1",
        "status": "OK",
        "comment": "Can sample bristle textures in vertex shader."
    },
    {
        "feature": "MAX_VARYING_VECTORS",
        "actual": 31,
        "expected": ">= 8",
        "status": "OK",
        "comment": "Low varyings may require simplifying splat varyings."
    },
    {
        "feature": "Fragment highp float",
        "actual": true,
        "expected": "true",
        "status": "OK",
        "comment": "OK."
    },
    {
        "feature": "OES_texture_float (or core in GL2)",
        "actual": true,
        "expected": "true",
        "status": "OK",
        "comment": "Float textures available."
    },
    {
        "feature": "OES_texture_float_linear",
        "actual": true,
        "expected": "nice to have",
        "status": "OK",
        "comment": "Float LINEAR filtering available."
    },
    {
        "feature": "OES_texture_half_float (or core in GL2)",
        "actual": true,
        "expected": "true",
        "status": "OK",
        "comment": "Half-float textures available."
    },
    {
        "feature": "OES_texture_half_float_linear",
        "actual": true,
        "expected": "nice to have",
        "status": "OK",
        "comment": "Half-float LINEAR filtering available."
    },
    {
        "feature": "WEBGL/EXT_color_buffer_float",
        "actual": true,
        "expected": "true (for RGBA32F render targets)",
        "status": "OK",
        "comment": "Can render to RGBA32F."
    },
    {
        "feature": "EXT_color_buffer_half_float",
        "actual": true,
        "expected": "true (for RGBA16F render targets)",
        "status": "OK",
        "comment": "Can render to RGBA16F."
    },
    {
        "feature": "FBO renderable: RGBA32F",
        "actual": true,
        "expected": "true (or skip if using 16F)",
        "status": "OK",
        "comment": "OK to use RGBA32F for physics."
    },
    {
        "feature": "FBO renderable: RGBA16F",
        "actual": true,
        "expected": "true (fallback)",
        "status": "OK",
        "comment": "Good fallback render target."
    },
    {
        "feature": "Vertex texture fetch (measured)",
        "actual": "64,128,192,255",
        "expected": "samples tex in VS → color ≈ 64,128,192",
        "status": "OK",
        "comment": "VTF works in practice."
    },
    {
        "feature": "Float texture LINEAR sampling (measured)",
        "actual": "255,0,0,255",
        "expected": "nice to have (we can use NEAREST)",
        "status": "OK",
        "comment": "Float LINEAR behaves."
    }
]
```


Awesome — thanks for running the self-test on the A52. With **WebGL1 + Adreno 642L** you’ve got:

* VTF works (16 units + measured OK)
* RGBA32F/16F are renderable
* Float/half-float + linear are present

…so the “all bristles slide to bottom-left” is **not** a missing-feature problem. It’s almost certainly in our app state / coordinate math. Below I’ll show:

1. exactly how `simulator.js` uses the bristle textures (so you can toggle things),
2. the 4 most likely logic bugs given your device caps, with **surgical tests/fixes**,
3. a quick “corner tap” debug you can paste and run to pinpoint it in one pass.

---

## 1) Where `simulator.js` touches bristles (and easy toggles)

`Simulator.splat(brush, …)` does **two** draws that read the brush’s **position/velocity textures** in the **vertex shader**:

### Paint splat → `this.paintTexture`

* **Program:** `splat.vert` + `splat.frag`
* **Uniforms (relevant):**

  ```js
  u_paintingDimensions = (rect.width, rect.height)
  u_paintingPosition   = (rect.left,  rect.bottom)  // IMPORTANT: bottom, not top
  u_splatRadius, u_splatColor
  u_positionsTexture           = brush.positionsTexture
  u_previousPositionsTexture   = brush.previousPositionsTexture
  u_zThreshold
  ```

### Velocity splat → `this.velocityTexture` (additive)

* **Program:** same vertex, `#define VELOCITY` fragment
* **Uniforms (extra):**

  ```js
  u_velocitiesTexture          = brush.velocitiesTexture
  u_previousVelocitiesTexture  = brush.previousVelocitiesTexture
  u_velocityScale
  ```

👉 The **vertex shader** computes a quad’s screen position by sampling `positions/previousPositions`. If anything goes wrong with **(a)** the texel you read, **(b)** the mapping from “paint space” to framebuffer, or **(c)** stale scissor/viewport, your quads end up at `(0,0)` → bottom-left.

### Quick toggles (paste into `simulator.js`)

Add a tiny debug config at top:

```js
const DEBUG = {
  skipPaintSplat: false,
  skipVelocitySplat: false,
  forceCenterSplat: false // bypass VTF math in vertex shader (see shader change below)
};
```

Wrap each pass:

```js
if (!DEBUG.skipPaintSplat) { /* paint splat draw call */ }
if (!DEBUG.skipVelocitySplat) { /* velocity splat draw call */ }
```

And at the **top** of `shaders/splat.vert` add a bypass block you can compile in:

```glsl
#ifdef FORCE_CENTER_SPLAT
  // Put the quad in the center of the painting rect ignoring positions textures
  vec2 center = u_paintingPosition + 0.5 * u_paintingDimensions;
  vec2 finalPosition = center + a_splatCoordinates.zw * u_splatRadius;
  v_previousPosition = center;
  v_position = center;
  v_quadPosition = finalPosition;
  v_coordinates = a_splatCoordinates.zw;
  gl_Position = vec4(-1.0 + 2.0 * (finalPosition - u_paintingPosition) / u_paintingDimensions, 0.0, 1.0);
  return;
#endif
```

When creating programs:

```js
const vPrefix = DEBUG.forceCenterSplat ? '#define FORCE_CENTER_SPLAT\n' : '';
this.splatProgram = wgl.createProgram(vPrefix + shader['shaders/splat.vert'], shader['shaders/splat.frag']);
this.velocitySplatProgram = wgl.createProgram(vPrefix + '#define VELOCITY\n' + shader['shaders/splat.vert'],
                                              '#define VELOCITY\n' + shader['shaders/splat.frag']);
```

* If **forceCenterSplat=true** makes the “bottom-left” go away, the error is in **mapping** (uniforms / viewport / scissor), not the fluid core.

---

## 2) Likeliest logic bugs (with precise tests + one-line fixes)

### A) **Randoms sampled at texel edges** (seed jitter shifts on the last row/column)

In your `setbristles.frag` you have:

```glsl
vec2 coordinates = gl_FragCoord.xy / u_resolution; // ✗ edge sampling
vec4 randoms = texture2D(u_randomsTexture, coordinates);
```

**Fix:**

```glsl
vec2 coordinates = (gl_FragCoord.xy + 0.5) / u_resolution; // ✓ texel center
```

Why it matters: on mobile drivers, edge clamping/interp can bias seeds, and with bases being updated each frame, you can see consistent “pull” at extremes.

#### Also set:

```js
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // before any texImage2D of randoms
```

---

### B) **Viewport/scissor mismatch for offscreen passes**

If any pass writes with a stale viewport/scissor, only a small **lower-left** of the target texture gets data; everything else stays 0 → later reads place quads at (0,0).

**Test:** Add this **once at the start of *every* FBO pass** (init, project, constraints, splats):

```js
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
gl.viewport(0, 0, targetWidth, targetHeight);
gl.disable(gl.SCISSOR_TEST); // or set gl.scissor(0,0,targetWidth,targetHeight)
gl.disable(gl.DEPTH_TEST);
gl.disable(gl.BLEND);
```

Then, in the **splat** draws, if you scissor to the painting rect, always call:

```js
gl.enable(gl.SCISSOR_TEST);
gl.scissor(rect.left, rect.bottom, rect.width, rect.height);
```

Do **not** rely on a previous scissor; set it every time.

---

### C) **Painting rectangle Y origin flipped (top vs bottom)**

On mobile it’s very common to accidentally send `rect.top` where the shader expects **bottom-origin** coordinates. Your uniforms are named for bottom origin:

```
u_paintingPosition = (left, bottom)
u_paintingDimensions = (width, height)
```

**Test quickly:**

* Temporarily set `u_paintingPosition.y = 0` and `u_paintingDimensions.y = canvas.height`.
  If that “fixes” corner taps, your current `rect.bottom` is using CSS top-origin space.

**Fix robust pointer → drawing-buffer conversion:**

```js
function pointerToCanvas(ev, canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (canvas.width  / rect.width);
  const yTop = (ev.clientY - rect.top)  * (canvas.height / rect.height);
  const y = canvas.height - yTop; // convert to bottom-origin
  return { x, y };
}
```

Make sure the **painting rect** you compute uses drawing-buffer units (not CSS) and **bottom-origin y** when feeding `u_paintingPosition`.

---

### D) **Sampler binding order / stale sampler integers**

Mobile is strict. Re-set sampler **every draw**:

```js
gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, brush.positionsTexture);
gl.uniform1i(u_positionsTexture, 0);

gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, brush.previousPositionsTexture);
gl.uniform1i(u_previousPositionsTexture, 1);

gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, brush.velocitiesTexture);
gl.uniform1i(u_velocitiesTexture, 2);

gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, brush.previousVelocitiesTexture);
gl.uniform1i(u_previousVelocitiesTexture, 3);
```

If you swap programs, **re-assign** these; don’t assume they persist.

---

## 3) One-shot “corner tap” debug (paste in your app)

Add this draw overlay at the **end of your frame** to render the painting rect outline and the *mapped* tap point that the splat path uses.

```js
function drawDebugPaintingRect(gl, rect) {
  // rect in drawing-buffer pixels; bottom-origin
  const x0 = rect.left, y0 = rect.bottom;
  const x1 = x0 + rect.width, y1 = y0 + rect.height;

  const ndc = new Float32Array([
    -1 + 2*x0/gl.canvas.width, -1 + 2*y0/gl.canvas.height,
    -1 + 2*x1/gl.canvas.width, -1 + 2*y0/gl.canvas.height,
    -1 + 2*x1/gl.canvas.width, -1 + 2*y1/gl.canvas.height,
    -1 + 2*x0/gl.canvas.width, -1 + 2*y1/gl.canvas.height,
    -1 + 2*x0/gl.canvas.width, -1 + 2*y0/gl.canvas.height
  ]);

  const vs = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }`;
  const fs = `precision mediump float; void main(){ gl_FragColor=vec4(1,0,0,1); }`;
  const v = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(v,vs); gl.compileShader(v);
  const f = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(f,fs); gl.compileShader(f);
  const p = gl.createProgram(); gl.attachShader(p,v); gl.attachShader(p,f); gl.linkProgram(p);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b); gl.bufferData(gl.ARRAY_BUFFER,ndc,gl.STREAM_DRAW);

  const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  gl.useProgram(p);
  const loc = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINE_STRIP, 0, 5);

  // cleanup
  gl.deleteBuffer(b); gl.deleteProgram(p); gl.deleteShader(v); gl.deleteShader(f);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
}
```

At the end of your render loop:

```js
drawDebugPaintingRect(gl, paintingRectangle);
```

Now tap all four corners:

* If the **red rectangle** doesn’t actually cover the paintable area or sits in the wrong corner, your `paintingRectangle` (left/bottom/width/height) is wrong or top-origin.
* If the red rect is right but splats still appear at bottom-left, check **viewport/scissor** or **sampler assignment**.

---

## 4) Quick “turn off parts” plan (fast triage order)

1. **Set `u_gravity = 0`** → if still bottom-left, gravity isn’t it.
2. **DEBUG.skipVelocitySplat = true** → if unchanged, velocity splat isn’t the culprit.
3. **DEBUG.forceCenterSplat = true** → if this fixes the issue, map/uniform/viewport/scissor are at fault.
4. Add `+0.5` in `setbristles.frag` when sampling `u_randomsTexture` and set `UNPACK_ALIGNMENT=1`.
5. Ensure **before every FBO draw**: `viewport(0,0,texW,texH)`, scissor disabled (or set explicitly).
6. Re-bind **all** brush samplers for each `splat` draw.

---

### Why I’m confident this will catch it

* Hardware is fine (your test shows everything needed works).
* The symptom (“falls to bottom-left” on mobile) is **identical** to:

  * a stale scissor/viewport (only LL tile written),
  * a top-origin `rect.bottom` mistake,
  * or reading edge texels in init that bias seeds.

Do the three concrete changes first:

1. `setbristles.frag`: `coordinates = (gl_FragCoord.xy + 0.5) / u_resolution;`
2. Before **every** offscreen pass: reset viewport/scissor as shown.
3. Verify bottom-origin painting rect and pointer mapping.

Then run your corner-tap test again. If anything still looks off, flip `DEBUG.forceCenterSplat` ON and tell me what you see; we’ll zero in on the exact line to change.
