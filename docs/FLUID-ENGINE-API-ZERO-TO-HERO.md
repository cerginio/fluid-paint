# FluidEngine API: Zero to Hero

This guide is the integration contract for agents and developers embedding
Fluid Paint into another product. It documents the API that exists on the
`fluid-engine-v2` branch today. It does not describe the aspirational API from
`FLUID-ENGINE-EXTRACTION-PLAN.md`.

The short version:

> Your application owns the browser, canvas layout, input, coordinate mapping,
> animation loop, history policy and file delivery. `FluidEngine` owns brush
> physics, fluid simulation, pigment deposition and rendering the wet paint.

## 1. Current integration status

`FluidEngine` is reusable, but it is not yet an npm package or an ES module. It
is a set of ordered browser scripts and GLSL files. The public facade is the
global `FluidEngine` class in `fluid-engine/index.js`.

There is no separate `api/` directory. The public API is the set of methods,
getters and static properties declared on `FluidEngine`.

The repository's normal `npm run build` produces the complete Fluid Paint
application in `dist/`; it does **not** produce a standalone engine bundle.
External hosts must either:

1. load the engine source files in the documented order; or
2. create their own bundle while preserving that order and ship the engine
   shader directory alongside it.

The reference integration is `examples/minimal/`. Start there when diagnosing
an embedding problem.

## 2. Architecture and ownership

```text
DOM / framework / business product
                 |
                 v
        host application code
  layout, input, coordinates, RAF, history
                 |
                 | FluidEngine public API
                 v
            FluidEngine facade
                 |
       +---------+----------+
       |         |          |
    Brush    Simulator   PaintingRenderer
       |         |          |
       +---------+----------+
                 |
              WebGL GPU
```

### The host owns

- the `<canvas>` and its CSS layout;
- canvas backing-store size and device-pixel-ratio policy;
- conversion from DOM coordinates to bottom-left-origin engine coordinates;
- the painting rectangle's position and size;
- quality selection and the resulting simulation resolution;
- pointer, pen, touch and gesture handling;
- the `requestAnimationFrame` loop and visibility handling;
- the screen render target texture and framebuffer;
- when to create snapshots and how undo/redo behaves;
- converting UI/display colours to pigment channels;
- converting exported RGBA bytes to PNG, JPEG, a server upload, etc.;
- WebGL context-loss UX and application-level cleanup.

### The engine owns

- bristle geometry and physical brush state;
- fluid velocity, pressure and pigment textures;
- deposition and stroke dynamics;
- fixed-step simulation timing;
- rendering pigment into lit wet-paint pixels;
- GPU-compatible snapshot allocation and paint restoration;
- capability reporting and render-target memory estimation;
- the list of shaders required by the engine.

### The hard boundary rule

Application code may use `FluidEngine` public methods, getters and documented
static properties. It must not access:

```js
engine.simulator
engine.brush
engine.renderer
engine.wgl
```

Those fields are currently reachable because this codebase has no module-level
encapsulation. Treat them as private implementation details. Debug probes in
this repository occasionally inspect them; production integrations must not.

## 3. Runtime requirements

The engine requires a browser with WebGL and renderable floating-point
textures. Depositing paint additionally requires alpha blending into either a
full-float or half-float texture.

Serve the integration over HTTP(S). Opening the page as `file://` is not a
supported deployment because shader loading uses browser requests.

Required JavaScript files, in order:

```html
<script src="/vendor/fluid-engine/gl/glsl3.js"></script>
<script src="/vendor/fluid-engine/gl/wrappedgl.js"></script>

<!-- Currently shared globals; still required by the engine. -->
<script src="/vendor/fluid-paint/utilities.js"></script>
<script src="/vendor/fluid-paint/rectangle.js"></script>

<script src="/vendor/fluid-engine/brush.js"></script>
<script src="/vendor/fluid-engine/simulation.js"></script>
<script src="/vendor/fluid-engine/renderer.js"></script>
<script src="/vendor/fluid-engine/index.js"></script>
```

Order is load-bearing. These files communicate through globals, not imports.

Also deploy the complete `fluid-engine/shaders/` directory without flattening
or renaming it. `FluidEngine.SHADER_FILES` is the authoritative manifest of
files to load.

For strict CSP deployments, allow shader fetches from the chosen asset origin.
The current source build does not require `eval`, but the consuming product
must test its final bundler/minifier and CSP combination.

## 4. Bootstrap from zero

### 4.1 Create and size the canvas

Use a container's CSS box, not `window.innerWidth`. Clamp DPR because GPU work
grows approximately with the square of the resolution scale.

```js
function resizeCanvas(canvas, container) {
  const rect = container.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
```

Canvas backing-store pixels are the simplest coordinate system for an external
host. In this guide, the painting rectangle, pointer positions and brush sizes
all use backing-store pixels with Y increasing upward.

### 4.2 Create WebGL and reject unsupported devices

```js
const wgl = WrappedGL.create(canvas);
if (!wgl) throw new Error('WebGL is unavailable.');

if (!wgl.hasFloatTextureSupport()) {
  throw new Error('Renderable floating-point textures are unavailable.');
}

const halfFloat = wgl.getHalfFloatType();
const canBlend =
  wgl.canBlendIntoTexture(wgl.FLOAT) ||
  (halfFloat !== null && wgl.canBlendIntoTexture(halfFloat));

if (!canBlend) {
  throw new Error('This GPU cannot blend paint into floating-point textures.');
}

if (wgl.isWebGL2) {
  wgl.getExtension('EXT_color_buffer_float');
} else {
  wgl.getExtension('OES_texture_float');
}
```

Do not use only `hasFloatTextureSupport()` as the final gate. A GPU can render
to a float texture yet fail the blended splat operation, producing a healthy
looking canvas on which no stroke deposits paint.

### 4.3 Load the engine shaders

The engine declares **which** files it needs. The host declares **where** they
are served from.

```js
const ENGINE_SHADER_BASE = '/vendor/fluid-engine/';

function loadEngineShaders() {
  return new Promise((resolve) => {
    WrappedGL.loadTextFiles(
      FluidEngine.SHADER_FILES,
      resolve,
      ENGINE_SHADER_BASE
    );
  });
}
```

### 4.4 Choose geometry, quality and memory budget

```js
const paintingRectangle = new Rectangle(
  24,                         // left
  24,                         // bottom
  Math.max(1, canvas.width - 48),
  Math.max(1, canvas.height - 48)
);

const requestedScale = 1.0;
const historyDepth = 10;
const memoryBudget = 512 * 1024 * 1024;

const affordableScale = FluidEngine.maxResolutionScaleForBudget(
  paintingRectangle.width,
  paintingRectangle.height,
  historyDepth,
  memoryBudget
);

const resolutionScale = Math.min(requestedScale, affordableScale);
const resolutionWidth = Math.ceil(paintingRectangle.width * resolutionScale);
const resolutionHeight = Math.ceil(paintingRectangle.height * resolutionScale);
```

`historyDepth` matters because each snapshot is another resolution-sized GPU
texture. Never budget only for the seven live simulation targets.

### 4.5 Construct the engine

```js
const shaderSources = await loadEngineShaders();

const engine = new FluidEngine(wgl, shaderSources, {
  resolutionWidth,
  resolutionHeight,
  maxBristleCount: 100,
  blackPigment: true
});

engine.setBrush({ bristleCount: 50 });

if (!engine.capabilities.canDepositPaint) {
  throw new Error('FluidEngine started, but this GPU cannot deposit paint.');
}
```

Constructor options:

| Option | Required | Meaning |
|---|---:|---|
| `resolutionWidth` | yes | Initial simulation width in texels. |
| `resolutionHeight` | yes | Initial simulation height in texels. |
| `maxBristleCount` | yes | Allocation ceiling; live count cannot exceed it. |
| `blackPigment` | no | `true` by default. `false` restores David Li's original dark-brown three-pigment corner. Fixed for the engine lifetime. |
| `random` | no | RNG function captured at construction. Supply a seeded RNG for deterministic replay/tests. |

There is currently no `ready()` method: shader loading happens before
construction. There is also no public `dispose()` method; see the lifecycle
limitations section before mounting/unmounting engines repeatedly.

## 5. Create the host-owned screen target

`renderToTexture()` does not render directly into the default framebuffer. The
host supplies an RGBA texture and framebuffer so the painting can be composed
with product-specific UI or effects.

```js
const framebuffer = wgl.createFramebuffer();

function createScreenTexture(previousTexture = null) {
  if (previousTexture) wgl.deleteTexture(previousTexture);

  return wgl.buildTexture(
    wgl.RGBA,
    wgl.UNSIGNED_BYTE,
    canvas.width,
    canvas.height,
    null,
    wgl.CLAMP_TO_EDGE,
    wgl.CLAMP_TO_EDGE,
    wgl.LINEAR,
    wgl.LINEAR
  );
}

let screenTexture = createScreenTexture();
```

Rebuild this texture whenever the canvas backing-store size changes. Delete the
old texture first or every resize/orientation change leaks GPU memory.

## 6. Coordinate contract

The engine does not consume `PointerEvent.clientX/clientY` directly.

Use this conversion when engine coordinates are canvas backing-store pixels:

```js
function pointerToEngine(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: canvas.height - (event.clientY - rect.top) * scaleY
  };
}
```

The subtraction flips DOM's top-left, Y-down coordinates into the engine's
bottom-left, Y-up convention.

The following values must use one consistent coordinate space:

- stroke `x` and `y`;
- `brushSize`;
- optional `spacing`;
- `paintingRectangle.left/bottom/width/height`.

`resolutionScale` then maps painting pixels to simulation texels.

### 6.1 Bristle footprint

By default the brush's bristles fill a disc, so a tap deposits a round mark.
`beginStroke({ brushShape })` clamps that distribution into a regular polygon
instead:

```js
engine.beginStroke({
  // ...
  brushShape: { sides: 6, aspect: 1, rotation: 0 },
});
```

- `sides` is `3`..`8`. Anything lower, or `brushShape: null`, is the round
  default — that path is bit-identical to a brush with no footprint set.
- `aspect` is width / height, so `{ sides: 4, aspect: 3 }` is a wide rectangle.
- `rotation` orients the polygon, in radians.

The footprint is chosen per press. It is applied before the bristles are drawn
and persists for the whole stroke: it cannot change mid-stroke, because
deforming a settled brush would fight its own distance constraints. A
`beginStroke()` without `brushShape` restores the round default rather than
inheriting the previous press's shape.

`brushSize` keeps one meaning across every shape. The bristle radius is divided
by the shape's area fraction, so a triangle, a hexagon and a disc of the same
`brushSize` cover the same area — without that, a triangle would paint at about
half width.

**Expect softened corners.** The footprint sets where bristles start; between it
and the canvas sit the position-based-dynamics solver and the splat pass, which
sweeps each bristle segment into a capsule of radius `splatRadius`. Corners are
therefore convolved with a disc of that radius. The shape reads clearly at large
brush sizes and fades toward a circle as the brush shrinks or the side count
rises. Measured on SwiftShader (`npm run test:bristle-shape`), the n-th harmonic
of the deposit's radius profile is about `0.25` for a triangle, `0.12` for a
square, `0.056` for a hexagon and `0.018` for an octagon, against a round
baseline near `0.005`. An octagon is close to indistinguishable from a disc;
that is inherent to the splat model, not a tuning bug.

## 7. Colour contract

`beginStroke()` accepts an explicit pigment payload:

```js
const color = {
  space: 'pigment',
  channels: [rPigment, yPigment, bPigment],
  alpha: 0.04
};
```

Rules:

- `space` must be the literal string `'pigment'`;
- `channels` must contain exactly three finite values in `[0, 1]`;
- `alpha` must be a finite value in `[0, 1]`;
- the host converts picker/display colour before calling the engine;
- do not label an arbitrary display RGB triple as pigment merely to satisfy
  validation. It may look plausible for pure colours but mix incorrectly.

For an HSV picker matching the current application, the channel conversion is:

```js
function hsvToPigmentChannels(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const c = v * s;
  const hd = h * 6;
  const x = c * (1 - Math.abs((hd % 2) - 1));
  const i = Math.floor(hd);
  const r = [c, x, 0, 0, x, c][i];
  const y = [x, c, c, x, 0, 0][i];
  const b = [0, 0, x, c, c, x][i];
  const m = v - c;
  return [r + m, y + m, b + m];
}
```

Despite its simple shape, these channels are interpreted as RYB pigment by the
default renderer. The artistic model lives in `painting.frag`; do not replace
it with additive RGB conversion if physical-looking mixing is required.

For arbitrary `#RRGGBB` business data, use or extract the conversion strategy
from `TilecraftStrokePlayer.hexToPigment()` instead of passing raw RGB.

Rendering supports:

```js
FluidEngine.COLOR_MODEL.RYB // natural/subtractive; recommended default
FluidEngine.COLOR_MODEL.RGB // digital/additive comparison
```

The stroke payload still requires `space: 'pigment'` in both render modes.

## 8. Interactive/live strokes

Use `timing: 'live'` for mouse, touch or pen interaction.

```js
let pointerDown = false;
let latestPoint = null;
let needsRedraw = true;

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  latestPoint = pointerToEngine(event, canvas);

  // Browsers often report pressure=0.5 for devices without pressure hardware.
  // Apply pressure only to pens unless the product explicitly wants otherwise.
  const pressure = event.pointerType === 'pen'
    ? Math.max(0.15, Math.min(1, event.pressure))
    : 1;

  engine.beginStroke({
    timing: 'live',
    x: latestPoint.x,
    y: latestPoint.y,
    pressure,
    brushSize: 50,
    paintingRectangle,
    color: {
      space: 'pigment',
      channels: hsvToPigmentChannels(0.6, 1, 1),
      alpha: 0.04
    },
    resolutionScale
  });

  pointerDown = true;
  needsRedraw = true;
});

canvas.addEventListener('pointermove', (event) => {
  latestPoint = pointerToEngine(event, canvas);
  if (!engine.strokeActive) return;

  const pressure = event.pointerType === 'pen'
    ? Math.max(0.15, Math.min(1, event.pressure))
    : 1;

  // Cheap O(1) mailbox update. advance() performs the physical work.
  engine.strokeTo({ ...latestPoint, pressure });
  needsRedraw = true;
});

function finishStroke(event) {
  if (!engine.strokeActive) return;

  if (event.type === 'pointerup') {
    const finalPoint = pointerToEngine(event, canvas);
    engine.strokeTo(finalPoint);
  }

  engine.endStroke();
  pointerDown = false;
  needsRedraw = true;
}

canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', finishStroke);
canvas.addEventListener('lostpointercapture', finishStroke);
```

Important state rules:

- never call `beginStroke()` while another stroke is active;
- call `endStroke()` for pointer-up, cancel and lost-capture paths;
- `setBrush()`, `changeResolution()`, `resizePainting()`, `clear()`, snapshot
  restore and low-level primitives are rejected during a named stroke;
- `endStroke()` flushes the final point, so send the pointer-up coordinate first;
- a live tap deposits paint even if it begins and ends before the next RAF.

### The live animation loop

```js
function frame(nowMs) {
  const nowSeconds = nowMs / 1000;

  const target = latestPoint
    ? {
        x: latestPoint.x,
        y: latestPoint.y,
        height: 2 * 50,
        scale: 50
      }
    : undefined;

  const result = engine.advance(nowSeconds, target);
  if (result.simulationUpdated) needsRedraw = true;

  const clippedRectangle = paintingRectangle
    .clone()
    .intersectRectangle(new Rectangle(0, 0, canvas.width, canvas.height));

  if (needsRedraw) {
    engine.renderToTexture({
      framebuffer,
      targetTexture: screenTexture,
      paintingRectangle,
      clippedRectangle,
      targetWidth: canvas.width,
      targetHeight: canvas.height,
      resolutionScale,
      colorModel: FluidEngine.COLOR_MODEL.RYB,
      resizing: false
    });
    needsRedraw = false;
  }

  // Present every RAF. The default framebuffer is not persistent.
  engine.present(screenTexture, canvas.width, canvas.height);
  requestAnimationFrame(frame);
}

engine.resetClock(performance.now() / 1000);
requestAnimationFrame(frame);
```

`advance()` uses a fixed 60 Hz simulation clock and executes at most five steps
per call. Old excess time is dropped to prevent a suspended tab from creating a
long catch-up stall.

Its result currently contains:

```ts
{
  steps: number;
  stamps: number;
  droppedSeconds: number;
  simulatedSeconds: number;
  totalDroppedSeconds: number;
  accumulator: number;
  simulationUpdated: boolean;
}
```

Reset the clock after tab suspension:

```js
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    engine.resetClock(performance.now() / 1000);
  }
});
```

## 9. Deterministic/offline replay

Use `timing: 'replay'` for imported paths, server-provided vector stories,
repeatable tests and non-interactive generation.

```js
engine.beginStroke({
  timing: 'replay',
  x: points[0].x,
  y: points[0].y,
  pressure: 1,
  brushSize: 40,
  paintingRectangle,
  color,
  resolutionScale,
  spacing: 6
});

for (const point of points.slice(1)) {
  engine.strokeTo({ x: point.x, y: point.y, pressure: 1 });
}

engine.endStroke();
needsRedraw = true;
```

Replay mode settles the brush on begin and resamples paths by arc length. The
unused spacing remainder carries across `strokeTo()` calls, so splitting the
same path into different input segments does not change its samples.

Do not call `advance()` while a replay stroke is active.

For repeatability across engine instances, pass a seeded `random` function to
the constructor. Changing `Math.random` after construction has no effect.

## 10. Brush and simulation settings

```js
engine.setBrush({ bristleCount: 60 });
engine.setSimulation({ fluidity: 0.75 });

console.log(engine.bristleCount);
console.log(engine.maxBristleCount);
console.log(engine.fluidity);
console.log(engine.resolutionWidth, engine.resolutionHeight);
```

Use named parameter objects. Future engine parameters can then be additive
without breaking call sites.

`maxBristleCount` is fixed at construction because it controls GPU allocation.
`bristleCount` is the active count and is changed through `setBrush()`.

## 11. Resize and quality changes

There are two different operations. Do not conflate them.

### Canvas/container resize

A browser layout change does not inherently resize the painting or simulation.
The host should:

1. resize the canvas backing store;
2. delete and rebuild its screen texture;
3. update presentation placement according to product UX;
4. mark the screen dirty.

This preserves paint.

### Simulation quality change

When the painting dimensions stay the same but quality changes:

```js
resolutionScale = nextScale;
engine.changeResolution(
  Math.ceil(paintingRectangle.width * resolutionScale),
  Math.ceil(paintingRectangle.height * resolutionScale)
);
needsRedraw = true;
```

`changeResolution()` resamples the painting to a new simulation resolution.

### Painting resize

When the product actually changes the painting's dimensions, calculate the new
simulation dimensions and offsets, then call:

```js
engine.resizePainting(newResolutionWidth, newResolutionHeight, offsetX, offsetY);
```

Offsets are simulation texels. The engine owns edge feathering. The host owns
the preview rectangle, handles and commit policy.

End an active stroke before any resize operation.

## 12. Snapshots and undo/redo

The engine provides snapshot primitives; the host owns history semantics.

```js
const snapshot = engine.createSnapshot(
  paintingRectangle.width,
  paintingRectangle.height,
  resolutionScale
);

engine.saveSnapshot(
  snapshot,
  paintingRectangle.width,
  paintingRectangle.height,
  resolutionScale
);
```

To restore:

```js
paintingRectangle.width = snapshot.paintingWidth;
paintingRectangle.height = snapshot.paintingHeight;
resolutionScale = snapshot.resolutionScale;

engine.restoreSnapshot(
  snapshot,
  Math.ceil(snapshot.paintingWidth * snapshot.resolutionScale),
  Math.ceil(snapshot.paintingHeight * snapshot.resolutionScale)
);

needsRedraw = true;
```

Snapshot handles are opaque except for the documented metadata:

- `paintingWidth`;
- `paintingHeight`;
- `resolutionScale`.

Do not read, replace or bind `snapshot.texture` in application code.

The engine does not decide:

- how many undo levels exist;
- when a stroke becomes one undo action;
- whether redo is invalidated after a new stroke;
- whether history persists across documents or sessions.

## 13. Clear and export

### Clear

```js
if (engine.strokeActive) engine.endStroke();
engine.clear();
needsRedraw = true;
```

`clear()` discards pigment. It does not promise to reset every velocity field;
subsequent simulation frames settle remaining motion.

### Export RGBA pixels

```js
const width = Math.round(paintingRectangle.width);
const height = Math.round(paintingRectangle.height);

const pixels = engine.exportPixels({
  width,
  height,
  resolutionScale,
  colorModel: FluidEngine.COLOR_MODEL.RYB
});
```

`pixels` is an RGBA byte array. Encoding and delivery belong to the host:

```js
const exportCanvas = document.createElement('canvas');
exportCanvas.width = width;
exportCanvas.height = height;

const context = exportCanvas.getContext('2d');
const image = context.createImageData(width, height);
image.data.set(pixels);
context.putImageData(image, 0, 0);

exportCanvas.toBlob((blob) => {
  // Download, upload, place into product media storage, etc.
}, 'image/png');
```

For regression tests, `readPaintTexture()` returns raw pre-lighting pigment
state:

```ts
{
  width: number;
  height: number;
  pixels: Float32Array;
}
```

This method is useful for tests and diagnostics, not ordinary product export.

## 14. Capability API

`engine.capabilities` is frozen and contains:

| Property | Meaning |
|---|---|
| `webglVersion` | `1` or `2`. |
| `floatLinear` | Whether `OES_texture_float_linear` is available. Not required by the current nearest-filter simulation. |
| `floatBlend` | Whether `EXT_float_blend` is exposed. |
| `maxTextureSize` | GPU `MAX_TEXTURE_SIZE`. |
| `paintTextureType` | Texture type selected by the simulator. Treat as diagnostic data. |
| `canDepositPaint` | The critical product gate: whether splats can actually blend into the chosen texture path. |

Products should show an explicit unsupported-device state when
`canDepositPaint` is false. Do not leave users with a canvas that silently
ignores input.

## 15. Optional Tilecraft/business-data adapter

`fluid-engine/tilecraft-stroke-player.js` is an integration adapter, not part of
the simulation core. It converts Tilecraft story JSON, `#RRGGBB` colours, layer
rules and source coordinates into the public Stroke API.

```html
<script src="/vendor/fluid-engine/tilecraft-stroke-player.js"></script>
```

```js
const player = new TilecraftStrokePlayer(engine);

const stats = player.replay(storyModel, {
  paintingRectangle,
  resolutionScale,
  canvasSize: { width: canvas.width, height: canvas.height },
  coordinateScale: fitScale,
  mapPoint(tile, layer) {
    return mapBusinessPointToPainting(tile.x, tile.y, layer);
  }
});
```

Use `replay()` for synchronous deterministic rendering. Use `play()` for
animated playback; the host's RAF must continue calling `engine.advance()`.
See `docs/TILECRAFT-STORY-PLAYBACK.md` for its detailed timing options.

For a different business schema, create a peer adapter such as
`InvoiceStrokePlayer`, `MapStrokePlayer` or `LogoStrokePlayer`. The adapter may
know the business model and call public `FluidEngine` methods; it must not read
`engine.simulator`, `engine.brush` or `engine.renderer`.

## 16. Public API reference

### Static properties and methods

```ts
FluidEngine.SHADER_FILES: readonly string[]
FluidEngine.COLOR_MODEL: { RYB: 0; RGB: 1 }

FluidEngine.estimateRenderTargetBytes(
  paintingWidth: number,
  paintingHeight: number,
  resolutionScale: number,
  historyDepth: number
): number

FluidEngine.maxResolutionScaleForBudget(
  paintingWidth: number,
  paintingHeight: number,
  historyDepth: number,
  budgetBytes: number
): number
```

### Construction and state

```ts
new FluidEngine(wgl, shaderSources, options)

engine.capabilities
engine.resolutionWidth: number
engine.resolutionHeight: number
engine.fluidity: number
engine.bristleCount: number
engine.maxBristleCount: number
engine.strokeActive: boolean

engine.setSimulation({ fluidity? }): void
engine.setBrush({ bristleCount? }): void
```

### Named stroke API

```ts
engine.beginStroke({
  x: number,
  y: number,
  pressure?: number,              // default 1; range 0..1
  brushSize: number,              // > 0
  paintingRectangle: {
    left: number,
    bottom: number,
    width: number,                // > 0
    height: number                // > 0
  },
  color: {
    space: 'pigment',
    channels: [number, number, number],
    alpha: number
  },
  resolutionScale?: number,       // default 1; > 0
  spacing?: number,               // default derived from brushSize; > 0
  timing?: 'live' | 'replay',     // default 'replay'
  brushShape?: {                  // default null = round
    sides: number,                // 3..8
    aspect?: number,              // default 1; width / height, > 0
    rotation?: number             // default 0; radians
  } | null
}): { steps: number, simulationUpdated: boolean }

engine.strokeTo({ x, y, pressure? }): {
  steps: number,
  simulationUpdated: boolean
}

engine.endStroke(): {
  steps: number,
  simulationUpdated: boolean
}

engine.advance(nowSeconds, optionalBrushTarget): TimingStats
engine.resetClock(nowSeconds): void
```

### Painting and persistence

```ts
engine.changeResolution(width, height): void
engine.resizePainting(width, height, offsetX, offsetY): void
engine.clear(): void

engine.createSnapshot(paintingWidth, paintingHeight, resolutionScale): PaintSnapshot
engine.saveSnapshot(snapshot, paintingWidth, paintingHeight, resolutionScale): void
engine.restoreSnapshot(snapshot, resolutionWidth, resolutionHeight): void
```

### Rendering and diagnostics

```ts
engine.renderToTexture(options): void
engine.present(texture, targetWidth, targetHeight): void
engine.exportPixels({ width, height, resolutionScale, colorModel }): Uint8Array
engine.readPaintTexture(): { width, height, pixels: Float32Array }
engine.getBristleGeometry(): object
```

`getBristleGeometry()` exposes GPU resources for the optional brush preview.
It is a narrow escape hatch, not a general extension API. Avoid it unless the
product genuinely draws the engine's live bristles itself.

### Legacy low-level primitives

The facade also exposes `positionBrush()`, `initializeBrush()`, `splat()` and
`frame()`. They remain for older callers and specialized debugging. New
integrations should use the named stroke API, which owns initialization,
settling, spacing, pressure, deposition and timing as one invariant.

## 17. Errors and recovery

Stroke contract errors use `error.name === 'StrokeStateError'`. Examples:

- invalid or missing pigment payload;
- coordinates, pressure or dimensions outside their valid domain;
- starting a second stroke;
- calling a guarded operation during a stroke;
- calling `strokeTo()` or `endStroke()` without an active stroke;
- passing a non-monotonic clock to `advance()`.

Treat programming/contract errors as integration defects and report them
loudly. Do not silently retry with guessed parameters.

WebGL context loss currently has no high-level engine event or automatic
recovery contract. The host should listen for `webglcontextlost`, prevent the
browser's default handling when appropriate, stop issuing GL work, and rebuild
the engine/resources on `webglcontextrestored`. Persist important business data
outside GPU-only snapshots if it must survive context loss or navigation.

## 18. Lifecycle and production limitations

External agents must account for these current limitations:

1. **No standalone package.** There is no npm export, ESM entry point or
   versioned distribution artifact for the engine alone.
2. **No public `dispose()`.** Repeatedly mounting and abandoning engines can
   retain programs, buffers, textures and framebuffers. Prefer one engine per
   page/session until disposal is implemented.
3. **No `ready()` promise.** Load shaders first, then construct.
4. **No engine-owned canvas sizing.** The host owns DPR and resize policy.
5. **No context-loss events.** The host owns loss detection and rebuild UX.
6. **Reachable internals are not public.** JavaScript visibility does not make
   `simulator`, `brush`, `renderer` or their textures supported API.
7. **Render calls expose WrappedGL objects.** This is currently an integration
   API, not a renderer-independent SDK.
8. **Snapshots are GPU resources, not durable files.** They are unsuitable as
   database records or cross-session document storage.

If a business integration requires mount/unmount lifecycle, persistent editable
documents, worker execution, npm packaging or renderer substitution, add that
capability deliberately to the facade rather than reaching into internals.

## 19. Business customization map

Use this map to decide where a requested feature belongs.

| Requirement | Correct owner |
|---|---|
| Branding, toolbar, onboarding, paywall | Host app |
| Mouse/touch/pen gestures | Host app |
| Zoom, pan, rotation and responsive layout | Host app / viewport |
| Account, document and cloud storage | Host app/backend |
| Undo depth and autosave frequency | Host app |
| PNG/JPEG/WebP encoding and upload | Host app |
| Mapping CRM/map/story/design data to strokes | Adapter layer |
| New named brush setting | `FluidEngine` facade plus `Brush` implementation |
| New fluid pass, drying or granulation | Engine simulation |
| New material/lighting model | Engine renderer |
| Debug UI | Host app; consume only documented diagnostics |

Business-specific concepts must not enter `Simulator`, `Brush` or
`PaintingRenderer`. Translate them into generic strokes/settings in an adapter.

## 20. Integration checklist

Before declaring an embedding production-ready, verify all of the following:

- [ ] Engine scripts load in the required order.
- [ ] All files in `FluidEngine.SHADER_FILES` return HTTP 200.
- [ ] The page is served over HTTP(S), not `file://`.
- [ ] Float rendering and float/half-float blending are both checked.
- [ ] `engine.capabilities.canDepositPaint` gates startup.
- [ ] Canvas backing-store sizing uses its container and a bounded DPR.
- [ ] Pointer coordinates are scaled to backing pixels and Y-flipped once.
- [ ] Stroke coordinates, brush size, spacing and painting rectangle use the
      same units.
- [ ] The colour payload contains real pigment coordinates.
- [ ] Interactive input uses `timing: 'live'` and calls `advance()` from RAF.
- [ ] Pointer cancel/lost capture always ends the active stroke.
- [ ] Visibility restoration calls `resetClock()`.
- [ ] `renderToTexture()` is dirty-driven but `present()` runs every frame.
- [ ] Old host textures are deleted on resize.
- [ ] Resolution and history depth are bounded by a GPU-memory budget.
- [ ] Undo/redo never restores during an active stroke.
- [ ] Product state that must survive context loss is not stored only on GPU.
- [ ] Production code never reads `engine.simulator/brush/renderer/wgl`.
- [ ] Chromium and at least one real WebKit/iOS device are tested.
- [ ] `npm run lint:shaders`, `npm run test:color`, `npm run test:timing`,
      `npm run test:tilecraft` and relevant GPU tests pass after engine changes.

## 21. Common failure signatures

### The canvas renders, but strokes deposit nothing

Check `canDepositPaint`, float blending support, shader responses, colour
payload validation and console errors from the first brush update.

### Strokes are offset or mirrored

The host likely passed CSS pixels instead of backing-store pixels, omitted the
Y flip, or applied the flip twice.

### The same gesture paints more heavily on high-DPR screens

`brushSize` or `spacing` is in CSS pixels while `x/y` and the painting rectangle
are in backing-store pixels. Put them in one coordinate space.

### The canvas flickers when idle

`present()` is being skipped when `needsRedraw` is false. Cache the rendered
painting texture, but blit it to the default framebuffer every RAF.

### Mobile rotation eventually produces a black canvas

Old screen textures may be leaking, or simulation scale/history depth exceeds
the device's practical GPU-memory budget.

### Yellow and blue mix to grey

Display RGB was sent as pigment channels, or the product selected
`FluidEngine.COLOR_MODEL.RGB` instead of `RYB`.

## 22. Source of truth

When documentation and implementation disagree, stop and inspect these files:

- `fluid-engine/index.js` — public facade and validation;
- `fluid-engine/renderer.js` — rendering contract;
- `examples/minimal/minimal.js` — smallest independent host;
- `docs/STROKE-TIMING-CONTRACT.md` — timing invariants;
- `docs/API-FINDINGS.md` — historical API boundary failures;
- `docs/TILECRAFT-STORY-PLAYBACK.md` — programmatic story playback;
- `docs/COLOR-PICKER-PAINT-PARITY-SPEC.md` — display/pigment colour boundary.

The implementation is the final authority. If an external host needs an
undocumented internal field, that is an API design request—not permission to
couple the product to the field.

## 23. Licence

The repository is MIT licensed. Preserve the copyright and permission notice in
copies or substantial portions of the software. Vendored UI libraries may have
their own licences; for example, `lib/iro.js` is MPL-2.0. An engine-only host
that does not ship those UI files does not need them for runtime.

