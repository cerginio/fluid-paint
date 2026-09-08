# Fluid Engine Extraction Plan

Status: Phases 0-7 complete -- see HANDOFF.md
Branch: `fluid-engine-v1` (from df884cc on webgl2_migration)
Decisions taken: keep the david.li UI working as the reference harness; fix the
coordinate/DPR problem as part of the move; build extension *points* but only
one implementation behind each; replace the hand-rolled UI with a modular
responsive HTML layout built on proven components.

---

## 1. Why this is being done

The simulation core is already clean. `Simulator` and `Brush` touch no DOM and
no UI state. What blocks reuse is `paint.js` (1396 lines), which fuses four
unrelated concerns into one class:

| Concern | Current home | Belongs in |
|---|---|---|
| Fluid + PBD simulation | `Simulator`, `Brush` | engine |
| Painting render (lighting, normals, RYB/RGB) | `Paint.update()` | engine |
| UI chrome (panel, blur, shadow, picker, viewer) | `Paint.update()` | host app |
| Input, gestures, undo/redo, save | `Paint.onPointer*` | host app |

The engine and the chrome are interleaved inside a single `update()` body, so
neither can be moved without the other.

## 2. The real cause of "everything shifts with screen resolution"

This is not mysterious. Three distinct coordinate systems coexist and none of
them is named in the code:

1. **Screen pixels** — `canvas.width/height`, pinned to `window.innerWidth/Height`
   (paint.js:298)
2. **Painting pixels** — `paintingRectangle`, the painting's rect on screen
3. **Simulation texels** — `paintingRectangle.width * resolutionScale`
   (paint.js:470)

Concrete defects that follow from having no single owner of the mapping
(status after Phases 1-2):

- ~~**`devicePixelRatio` is never read.**~~ **Fixed in Phase 2.** Honoured and
  clamped to 2, via `Viewport`.
- ~~**The Y-flip is open-coded in four places.**~~ **Fixed in Phase 2.** All
  four now go through `viewport.eventToScreen`; none is left.
- ~~**`onResize` rebuilds three textures without deleting the old ones.**~~
  **Fixed in Phase 1.** Measured: 18 leaked over 6 resizes before, 0 after.
- ~~**The orthographic matrix is built twice.**~~ **Fixed in Phase 1.** One
  `rebuildProjectionMatrix()`; the constructor's copy was in fact dead.
- **Found while fixing the above, still open:** nothing clamps the *total*
  memory of the resolution-dependent render targets, only each dimension.
  Phase 2 added a 1 GB budget as a guard, but the real ceiling is unmeasured on
  hardware — see Phase 2 below.
- **`Simulator.splat()` takes a screen-space `paintingRectangle`** and does the
  screen-to-simulation transform itself (simulator.js:525-531). The engine
  currently knows about the screen. This must be severed or the engine is not
  UI-independent.

Fixing this is not a side effect of the refactor. It is the main deliverable:
one module owns every transform, and the rest of the code cannot express a
coordinate bug.

## 3. Incidental defect found while reading

`Paint.update()` reassigns `this.save = () => {...}` on every frame
(paint.js:585) — a ~60-line closure allocated 60 times a second, in the hot
loop, for a value that never changes. Hoist it in Phase 1.

## 3a. Debugging instrumentation — decomposed, not removed

A number of parameters and properties in `Paint` originated in attempts to fix
what turned out to be the mobile shader bug (see
`MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md`) rather than as deliberate design.

**These are not deleted, and — amended during Phase 1 — they are not switched
off either.** The author's decision: every debug feature stays **on by
default**. What is wrong with them today is not that they run, and not that
they exist; it is that they are *entangled with* `Paint`, which makes them a
drag on extracting the engine and defining its API.

So the goal of the flag work is **architectural decomposition, not visibility
control**:

- each feature moves out of `Paint` into its own module, reached through one
  seam;
- each gets a flag so it *can* be switched off, and so the engine has a
  declared surface for it;
- the flag **defaults to on**, so the default configuration looks and behaves
  exactly as it does today.

The practical consequence for Phase 1: the golden images must **not** move for
any of these commits, which restores the original Phase 1 rule. A moved hash
means the decomposition changed behaviour and the commit is wrong — not that
the feature was load-bearing.

The off path still has to be real: a flag that is off must be structurally
absent (no compiled programs, no allocated textures, no per-frame branches), so
that turning a feature off later is a supported operation rather than a
discovery.

| Item | Location | Disposition |
|---|---|---|
| Painting-rect outline | `debug/painting-rect-overlay.js` | **Done** — extracted, flag `debug.paintingRect`, default on |
| Ortho near/far ±5000 probe | `rebuildProjectionMatrix()` | **Left at ±5000 — unresolved, see note below.** Deduplicated in Phase 1; the value is untouched |
| `debug.js` per-frame texture readback | `index.html` seam + brush.js:535 | **Done** — flag `debug.textureProbe`, default on. Was a 256×256 readPixels + 4 getParameter per frame while painting |
| `debug2.js` (751 lines) | — | **Not loaded by any page** — dead in the build. Decide: fold into the debug module, or delete |
| `brushviewer.js` live bristle preview | `brushviewer.js` | **Done** — flag `debug.brushViewer`, default on. Already its own module; allocates no GPU resources of its own |
| Texture self-test, GPU profiles, shader lint | `debug/` | Keep; already flag-gated via `?selftest=1` / `?gpu=` |

**The ±5000 depth range could not be resolved against the golden images.** The
matrix feeds exactly one draw — the bristle overlay, which renders only while a
stroke is in progress and only to the screen, never to the paint texture. The
golden scenarios capture after the stroke ends, so the overlay is absent from
both hashes. Verified by sabotage: narrowing the range to ±1 moved nothing, and
so did ±0.0001, which must clip every bristle. A baseline that cannot fail is
not evidence, so the value stays at ±5000 and the question is still open.
Answering it needs either a golden scenario that captures mid-stroke or manual
device verification.

Commented-out dead alternatives (e.g. paint.js:115) are genuinely deleted — a
comment is not a feature flag.

### Flag design

One namespaced object, one source of truth, readable from the URL so a phone can
enable a probe without a rebuild:

```js
engine.debug = { paintingRect: false, brushViewer: false, depthRange: false }
// ?debug=paintingRect,brushViewer
```

Debug drawing lives in `fluid-engine/debug/` and is imported by the engine, not
scattered through `update()`. It must be **structurally absent when off** — no
GL programs compiled, no textures allocated, no per-frame branches in the hot
loop. A flag that costs frames when disabled will get deleted by whoever profiles
next, which puts us back here.

The existing `?diag=1` panel is the precedent and stays as-is.

**Method.** The work happens in Phase 1, one item per commit, each verified
against the Phase 0 golden images with the flag off. The rule is that nothing
changes state on the belief that it is unused — it changes when the golden
images prove it. This matters precisely because the mobile bug taught that
visual state can depend on things that look inert.

`colorModel` (RYB/RGB) is **not** sediment — see §3b. It is the most valuable
thing in the codebase after the simulation itself.

## 3b. The RYB colour space — protected, load-bearing

David Li's original colour model is **subtractive** — it models pigment, not
light. The whole of it is `rybToRgb()` in `shaders/painting.frag:34-47`: eight
corners of a cube, trilinearly interpolated.

| RYB corner | RGB output | Pigment |
|---|---|---|
| `(0,0,0)` | `(1, 1, 1)` | bare paper |
| `(1,0,0)` R | `(1, 0, 0)` | red |
| `(0,1,0)` Y | `(1, 1, 0)` | yellow |
| `(0,0,1)` B | `(0.163, 0.373, 0.6)` | **ultramarine, not pure blue** |
| `(1,1,0)` R+Y | `(1, 0.5, 0)` | orange |
| `(0,1,1)` Y+B | `(0, 0.66, 0.2)` | **green** |
| `(1,0,1)` R+B | `(0.5, 0, 0.5)` | purple |
| `(1,1,1)` R+Y+B | `(0.2, 0.094, 0)` | muddy brown |

Two of these corners are the entire point:

- **Yellow + blue = green.** In additive RGB, yellow plus blue is grey. This is
  the single mix that separates "paint" from "light" to anyone who has held a
  brush, and it is why the app feels physical.
- **All three = muddy brown**, not black. Real pigments do not cancel to zero;
  they go to mud. The corner value encodes that honestly.

The blue corner being ultramarine rather than `(0,0,1)` is the same instinct:
these are the colours of actual paint, not of the RGB primaries.

The implementation deserves note. There is no branching, no lookup table, no
per-channel special-casing — one trilinear interpolation across a cube whose
corners *are* the model. Fast enough for a per-pixel fragment shader in 2013.

### Consequences for this work

**The RYB path is protected.** It is not simplified, not replaced by a library,
not "corrected" toward a standard colour space. Any change to those eight
constants is a change to the artistic character of the product and is out of
scope here.

`#define RGB` is the cheap alternative — `1.0 - ryb.yxz`, an inversion with a
channel swizzle. It is a fallback, not a peer. RYB stays the default.

Where it surfaces in the plan:

- Engine API: `setColorModel('natural' | 'rgb')`, with `'natural'` the default.
  The name is kept honest — the user's own word for it, and more accurate than
  "RYB" for what it does.
- The HSVA -> RYB conversion (`hsvToRyb` in common.js:76) moves to the app
  boundary when iro.js arrives, but the function is copied, not rewritten.
- Golden images must cover a mix that exercises the Y+B corner. If a refactor
  ever turns green into grey, that test is what catches it.

Note for whoever reads `common.js`: `hsvToRgb` and `hsvToRyb` are currently
**byte-identical in behaviour** — both are plain HSV->RGB. The RYB
interpretation happens entirely in the shader; the JS function just names the
channels differently for the shader's benefit. This is confusing and should be
commented, not "fixed".

---

## 4. Target shape

```
fluid-engine/
  index.js            FluidEngine — the only public entry point
  viewport.js         Viewport — owns screen <-> painting <-> simulation + DPR
  simulation.js       Simulator (moved, screen-space arguments removed)
  brush.js            Brush (moved as-is)
  renderer.js         Painting render extracted from Paint.update()
  resources.js        Shader loading, program cache, texture lifetime
  gl/                 wrappedgl.js, glsl3.js (moved as-is)
  shaders/            moved as-is
  constants.js        Simulation + render constants only, no UI constants

app/
  index.html          Responsive layout — CSS grid/flex, not canvas-drawn chrome
  layout.css          Breakpoints: phone portrait / phone landscape / tablet / desktop
  ui/
    sliders.js        SlidersComponent (scoped fork — see §5a)
    color.js          iro.js colour wheel + palette
    input.js          PointerDispatcher -> engine commands
    panels.js         Collapsible tool panels
  history.js          Undo/redo — host policy, uses engine snapshots
  save.js             Pixel export -> PNG
  main.js             Wires the engine to the UI
```

The split rule: if removing the DOM would break it, it is not engine.

### The UI stops being drawn in WebGL

Today the panel, colour picker, sliders, shadows and brush viewer are all
rendered by the engine's own GL passes — `panelProgram`, `blurProgram`,
`shadowProgram`, `rectOutlineProgram`, plus `colorpicker.js`, `slider.js`,
`buttons.js` and `brushviewer.js`. That is why UI and simulation cannot be
separated today, and it is also why the layout cannot be responsive: the panel
geometry is hard-coded in pixels (`PANEL_WIDTH 300`, `PANEL_HEIGHT 580`,
`COLOR_PICKER_TOP 523`) against a canvas pinned to the window.

After this work the canvas draws the painting and nothing else. Chrome becomes
real DOM, laid out by CSS, which is what makes it responsive and customisable
per host. The blur/shadow GL passes are deleted along with the canvas-drawn
panel; a CSS `backdrop-filter` replaces the blur.

## 5. The API

Constructor takes a canvas and nothing else is required.

```js
const engine = new FluidEngine(canvas, { quality: 'medium' });
await engine.ready();
```

### Commands — the imperative surface

```js
engine.beginStroke({ x, y, pressure })   // screen coords; engine maps them
engine.moveStroke({ x, y, pressure })
engine.endStroke()

engine.setBrush({ scale, bristleCount, color, alpha })
engine.setSimulation({ fluidity, quality })   // named params, not magic numbers
engine.setPaintingRect({ left, bottom, width, height })
engine.resizePainting(rect, { feather })

engine.clear()
engine.snapshot()            // -> opaque handle
engine.restore(handle)
engine.exportPixels()        // -> { width, height, data } — host owns encoding

engine.frame()               // advance one step; host owns requestAnimationFrame
engine.resize()              // re-read canvas size + DPR
engine.dispose()             // release every GL resource
```

The host keeps the RAF loop and undo/redo policy. The engine keeps no history
stack — it only knows how to produce and reload a snapshot. History depth is a
product decision, not an engine one.

### Events — the observation surface

```js
engine.on('frame', ({ simulated, redrawn }) => {})
engine.on('lost', () => {})       // WebGL context loss
engine.on('error', (err) => {})
```

### Capabilities — the honesty surface

```js
engine.capabilities
// { webglVersion, floatLinear, halfFloat, maxPaintingWidth, maxTextureSize }
```

This is what the existing diag panel already computes; it becomes public rather
than being re-derived by each host.

### Extension points (structure only, one implementation each)

- `Renderer` is an interface with a single built-in `PaintingRenderer`. A future
  material/lighting model plugs in here without touching `FluidEngine`.
- `Simulator.simulate()` gets a named pass list rather than a fixed sequence, so
  a future pass (pigment mixing, drying, granulation) is an insertion rather
  than a rewrite of the method body.
- `setSimulation()` takes a named parameter object. New parameters are additive
  and never break the call signature.

No plugin registry, no serialization format, no brush plugin API yet. Those get
designed when the second real case exists.

## 5a. The UI components

Sourced from `D:\work\js-games\ua-dream\tilecraft`. Each was inspected; they are
not equally ready, and the differences are real work.

### `lib/pointer-dispatcher.js` (808 lines) — take as-is

Substantially better than what `paint.js` does by hand. 23 event types, proper
multi-pointer gestures (pan / pan2 / pinch / rotate2 / rotate3), per-frame RAF
flush with accumulated deltas, velocity smoothing for inertia, hold/tap/swipe
recognition, and a cached element rect invalidated on scroll and resize.

It carries `pressure` on `pan` and `cursormove`, which is what closes the
`// TODO: x pen pressure` at paint.js:1082 — stylus pressure becomes a real
feature rather than a comment.

Its gesture vocabulary maps directly onto the interaction modes that `paint.js`
currently hand-rolls: `pan` -> painting stroke, `pan2` -> canvas pan,
`pinch` -> zoom / painting resize. The `RESIZING_RADIUS` edge-hit-testing at
paint.js:938 can go away entirely.

No changes needed. It is self-contained and takes an element in its constructor.

### `lib/iro.js` (1850 lines) — take as-is

iro.js v5.5.2, MPL 2.0, UMD build with Preact bundled in. Self-contained,
mounts into a supplied element. Replaces `colorpicker.js` and its GL passes.

One integration note: the engine works in HSVA and converts to RYB via
`hsvToRyb()`. iro.js emits HSV/RGB, so the host converts at the boundary — the
existing `hsvToRyb` stays, it just moves to the app side.

Licence: MPL 2.0 is file-level copyleft. Keeping `iro.js` as an unmodified
vendored file satisfies it. **Do not edit it in place**; if behaviour must
change, wrap it.

### `components.js` -> `SlidersComponent` (418 lines) — needs a scoped fork

This one is **not** reusable as it stands, and the work should be planned rather
than discovered:

- `initAndSetupTheSliders()` and `getInput()` call
  `document.querySelectorAll('.c-range-slider input')` — document-global. Two
  instances on one page would fight over the same DOM, and the component cannot
  be mounted into a panel.
- The file ends with executing demo code (`dummySlidersComponent`, and top-level
  `let scale, dt = 0`) that runs on import and would leak globals into the app.
- `ColorDropdown` and `makeDraggable` in the same file are not needed here.

Fork it as `app/ui/sliders.js`: take a root element in the constructor, scope
every query to it, drop the demo tail and the two unused exports. Roughly 140
lines of the 418 are actually wanted. `components.css` (268 lines) comes along —
the vertical-range styling with full vendor-prefix coverage is the valuable
part and is worth keeping intact.

### What gets deleted from the current UI

`colorpicker.js`, `slider.js`, `buttons.js`, `brushviewer.js`, and the
`panelProgram` / `blurProgram` / `shadowProgram` / `rectOutlineProgram` GL
paths, plus their shaders. `brushviewer.js` is not deleted — it renders a live
GL preview of the bristles, has no DOM equivalent, and is exactly the kind of
tool the mobile bug made valuable. It moves into `fluid-engine/debug/` behind
`debug.brushViewer` per §3a.

## 6. Phases

Phases 0-5 each end with the david.li UI still running and visually identical on
desktop, the A56, and the tablet — golden images enforce this.

From Phase 6 the UI is deliberately being replaced, so "identical" no longer
applies to chrome. What golden images still guard from that point on is the
**painting itself**: the same scripted stroke must produce the same pixels
inside the painting rect, regardless of what surrounds it. That invariant holds
to the end.

Any phase can be the stopping point. Phases 0-5 leave a reusable engine with the
old UI; 6-8 replace the UI; 9-10 close it out.

### Phase 0 — Safety net
- Golden-image harness: fixed seed, scripted stroke, hash the framebuffer.
  Run on WebGL 2 and `?webgl=1`. This is what makes "identical" checkable
  instead of a matter of opinion.
- **One scripted stroke must lay yellow over blue** so the Y+B cube corner is
  covered (§3b). If a refactor ever turns that green into grey, this is the
  test that catches it — and it is the failure a maintainer is least likely to
  notice by eye.
- Record baselines from the current build before any code moves.
- Extend `?selftest=1` to cover it.

**Risk if skipped:** every later phase becomes a judgement call by eye. Do not skip.

### Phase 1 — Cheap fixes and debug demotion
- Hoist `this.save` out of `update()`.
- Delete textures in `onResize` before rebuilding.
- Build the ortho matrix in one place.
- Introduce the `engine.debug` flag object and `?debug=` parsing.
- Move each item in §3a behind its flag, **one per commit**, each checked
  against the golden images with the flag off.

No behavioural change intended in the default configuration; golden images must
not move. If one does, that item was load-bearing and the commit is reverted —
which is exactly the information we want.

### Phase 2 — Viewport module — **DONE**, except device verification
- `viewport.js` owns canvas sizing, `devicePixelRatio`, the Y-flip and all
  three coordinate spaces (`eventToScreen`, `cssToScreen`, `screenToCss`,
  `cssLengthToScreen`, `screenToPainting`, `paintingToSimulation`,
  `screenToSimulation`).
- All four open-coded Y-flips are gone. The CSS-authored UI metrics
  (`PANEL_*`, `COLOR_PICKER_*`, `RESIZING_RADIUS_CSS`, and the colour picker's
  own geometry via its `scale`) go through the viewport.
- **DPR is on**, clamped to 2. `?dpr=1` restores the old behaviour, `?dpr=N`
  raises the cap.
- The golden harness gained a **DPR axis** (dpr1, dpr2 — 12 entries). Without
  it the phase's headline change would have had no coverage, since at ratio 1
  the new code is equivalent to the old by construction.

**What this uncovered.** An unbounded memory defect that predates DPR.
`maxPaintingWidth` clamps each *dimension* against `MAX_TEXTURE_SIZE`, but
nothing clamped total memory, and the app holds 22 float RGBA render targets at
the painting resolution (7 simulator buffers + `HISTORY_SIZE` = 15 undo
snapshots, 16 bytes a texel). A 1280×800 window at ratio 2 asks for 2969 MB and
the driver drops the context — a black canvas, not a slow one. A 2560×1440
window at quality High asks for 2.6 GB *today, with no DPR at all*.

`getEffectiveResolutionScale()` now clamps to `PaintState.maxRenderTargetBytes`
(1 GB) and warns once per distinct clamp. The budget covers **all** targets
including the undo history: the painting keeps its size, undo keeps its depth,
and simulation fidelity is what degrades — the one of the three that degrades
gracefully. 1 GB leaves the pre-DPR path untouched (712 MB at 1280×800).

**Remaining:** manual device verification on real hardware before Phase 3.
SwiftShader's memory limits are not a phone's, and the clamp's chosen ceiling
is the thing most in need of a real measurement.

### Phase 3 — Move the engine, unchanged — **DONE**
- `Simulator` (now `simulation.js`), `Brush`, `wrappedgl`, `glsl3` and the
  shader tree live in `fluid-engine/`, inside the repo. The empty
  `fluid-engine/` beside the repo was a placeholder, not the destination.
- **The shader manifest keys did not change.** `loadTextFiles()` takes a
  `basePath` that is prepended to fetch but is not part of the result key, so
  `SHADER_BASE_PATH` is the only thing that knows where the tree lives.
  Relocating the shaders is a one-string change, not a rename of ~24 keys.
- **There was no `constants.js` to split.** The plan assumed a shared constants
  module; the constants actually live in `paint-setup.js` (app) and as file-local
  `const`s inside `brush.js` and `simulation.js` (engine). Checked
  mechanically with comments stripped: **zero** `paint-setup.js` constants are
  referenced by engine code, and **zero** engine constants by app code. The
  separation this bullet asked for already held.
- The screen dependency is severed: `splat()` takes a `brushRectangle` — the
  painting expressed in the brush's own coordinate space — and no longer names
  the screen. The app passes its screen-space rectangle because its brush lives
  in screen pixels, which is the app's business.
- Still no public API — `paint.js` uses the moved modules directly.

**What is NOT done here.** The UI shaders (`panel`, `picker`, `shadow`,
`rectborder`) moved into `fluid-engine/shaders/` with the rest. They are chrome,
not engine, but separating them is the renderer extraction in Phase 4 — doing it
during a move would mix a relocation with a redesign, and the golden images
could not tell the two apart.

### Phase 4 — Extract the renderer — DONE

- The painting draw is lifted out of `Paint.update()` into
  `fluid-engine/renderer.js` as `PaintingRenderer`. What stays behind in
  `update()` is exactly the UI chrome, marked by a comment where the boundary
  falls. `paint.js` went 1480 -> 1363 lines.
- The renderer owns all six `painting.vert`/`painting.frag` programs (four
  screen, two SAVE), the `output.frag` blit, and its own quad buffer. It does
  **not** own the target texture or framebuffer — those are per-call arguments,
  which is what lets `renderToTexture()` serve the screen and
  `renderToPixels()` serve the save path from one implementation.
- The lighting constants (`NORMAL_SCALE`, `ROUGHNESS`, `F0`, `SPECULAR_SCALE`,
  `DIFFUSE_SCALE`, `LIGHT_DIRECTION`, `BACKGROUND_GRAY`) moved out of
  `paint-setup.js` into the renderer. They describe how the engine's paint
  reflects light; they lived in the app only because the draw call did.
- **`RESIZING_FEATHER_SIZE` is shared, and now defined once.** It reaches both
  `painting.frag`'s preview and `simulator.resize()`, which must agree or the
  painting visibly jumps when a resize handle is released. It lives in the
  renderer and is exposed as `PaintingRenderer.RESIZING_FEATHER_SIZE` for the
  host to pass to the simulator.
- The screen and save paths had separately open-coded the same material
  uniforms and **had already drifted** — only one of them set `u_featherSize`.
  `_applyMaterialUniforms()` makes that class of drift impossible.
- The chrome shaders split out of the engine tree into `app/shaders/`:
  `panel.frag`, `picker.vert`/`picker.frag`, `shadow.frag`, `rectborder.frag`.
  `fullscreen.vert` deliberately stays engine-side and is used by both — the
  app hosts the engine, so app -> engine is the right direction for that arrow.
- Two trees need two base paths, since `loadTextFiles` applies one prefix to
  every name. `SHADER_TREES` in `common.js` pairs each manifest with its path
  and `loadShaderTrees()` merges the results into the one flat `shaderSources`
  object every lookup already expects. **The ~24 keys are still unchanged**,
  exactly as in Phase 3.
- Still no public API — `paint.js` constructs `PaintingRenderer` directly.
  That is Phase 5.

### Phase 5 — The FluidEngine facade — DONE (extension points deferred)

- `fluid-engine/index.js` holds `FluidEngine`, composing `Simulator`, `Brush`
  and `PaintingRenderer`. `paint.js` owns no simulation state: it has zero
  references to `this.simulator`, `this.brush` or `this.renderer`.
- **There is no `engine.simulator` property**, deliberately. A host that needs
  something the API does not offer is a finding about the API, not a reason to
  reach past it. The golden harness was the first test of that rule — it read
  `painter.simulator.paintTexture` and now calls `engine.readPaintTexture()`.
- **Undo is split where the plan asked.** The ring buffer, its depth and the
  rotation policy stay in the app. Filling and reloading a snapshot is the
  engine's, *including allocating it* — only the engine knows the paint texture
  type the capability probe chose, and a host that allocated `gl.FLOAT` itself
  would break undo on exactly the devices that fallback exists for.
- **The bristle overlay** was the case flagged as fighting the facade. It is
  chrome drawn from engine GL objects, so it gets one named
  `getBristleGeometry()` rather than four public fields. `BrushViewer` takes
  that geometry too, instead of the `Brush`.
- `ColorPicker` no longer takes an object plus a property *name*; it takes a
  `getHSVA` accessor. Phase 8 deletes the file, but the name-based reach-in was
  invisible from both sides and worth closing first.
- **Capabilities are public**, per the honesty surface. The `?diag=1` panel
  deliberately does **not** use them: it runs on the raw context before `Paint`
  exists, so it still reports when startup fails — the case it exists for.
- The render-target budget arithmetic moved to the engine as two **statics**.
  Static because the host must ask before the engine exists: the answer is what
  sizes the engine. `BYTES_PER_TEXEL` and `SIMULATION_TARGETS` left
  `paint-setup.js` — the app had to read `simulation.js` to know the second.

**Deferred to a follow-up**, deliberately: the two structural extension points
(§5, "Extension points"). The `Renderer` interface and `Simulator.simulate()`'s
named pass list are refactors of those two files rather than of the boundary,
they are independently verifiable, and neither blocks Phase 6. `simulate()` is
~180 lines of fixed advect → divergence → jacobi → subtract with a shared
scissored draw-state preamble; converting it to a pass list is its own change.

### Phase 6 — Input: PointerDispatcher — DONE (device retest outstanding)

This lands *before* the visual UI, deliberately. Input is the riskiest part of
the UI change (it is what the engine actually feels like) and it can be swapped
underneath the existing canvas-drawn chrome, so it gets tested in isolation.

Done:

- Vendored `pointer-dispatcher.js` into `app/ui/`, with **one** local patch.
- Replaced the `onPointer*` handlers with dispatcher subscriptions and deleted
  the `activePointers` / `primaryPointerId` bookkeeping.
- Wired `pressure` into the stroke — the pen-pressure TODO is closed.

**Device retest still required**, on the A56 and the tablet, with a stylus if
available. Gesture behaviour cannot be verified by golden images.

#### Two deviations from this plan, both deliberate

**`getResizingSide()` was NOT deleted.** The plan assumed `pinch` could replace
it. It cannot: a pinch has a scale about a centroid but no notion of *which*
edge is being dragged, and that is what drives the asymmetric clamping in the
resize, the `offsetX`/`offsetY` anchoring on commit, and the resize **cursor**.
Deleting it would have swapped edge-anchored resizing for centroid scaling — a
different feature. `pinch` was added *alongside* it as the touch path.

**The vendored file is not byte-identical.** The plan says "take as-is / no
changes needed"; one patch was unavoidable. `_move()` tested only whether
`getCoalescedEvents` *exists*, not whether it returned anything, and a synthetic
`PointerEvent` has the method but returns an **empty list** — so no `pan` was
ever emitted under any automated test, while `panstart`/`panend` still fired.
Recorded in `docs/UI-COMPONENTS.md`, marked `LOCAL PATCH` in the file.

Also note the plan's "no changes needed / self-contained" assessment missed that
the dispatcher's coordinates are **Y-down CSS pixels** scaled by its own reading
of the backing store, while this app's screen space is **Y-up** and `Viewport`
owns the DPR. That is adapted at the boundary (`_toScreen` / `_deltaToScreen`)
rather than by editing the vendored file.

### Phase 7 — Responsive HTML layout — DONE, with one deliberate departure
- `app/layout.css` + the `#canvas-cell` / `#ui` markup: chrome became DOM.
  `paint.css` deleted.
- **The panel FLOATS over the canvas; it does not take a grid column.** The
  docked-column version in the bullet below was built first, then changed after
  seeing it: a 300px column costs a phone a third of its painting permanently,
  and the Phase 6 retest had just scored phones 3.7/5 against the tablet's 5/5
  on exactly that axis. The canvas now keeps the whole window at every
  breakpoint. Decided by the user against a working implementation.
- The panel collapses to a compact bar carrying the two controls a painter
  changes mid-stroke — brush size and a hue stripe — with a grip that drags the
  panel and, on a tap, toggles the collapse. `app/ui/panel.js`.
- Breakpoints: phone (narrow, starts collapsed), tablet, desktop. There is no
  drawer/rail/dock switch any more — one positioning model everywhere, which is
  what keeps the drag code honest.
- Canvas sizing driven by `ResizeObserver` on its container, not
  `window.innerWidth` — this is what finally killed the pinned-to-window
  assumption at paint.js:298. **The container is opt-in**: defaulting it to
  `canvas.parentElement` makes a canvas appended to `<body>` size itself from a
  box that is sized by the canvas, which cost all six dpr2 goldens.
- Deleted `panelProgram`, `blurProgram`, `makeBlurShader()`, `pascalRow()`,
  `app/shaders/panel.frag`, the `PANEL_*` constants and the two full-canvas
  scratch textures the blur ping-ponged through.
- **`shadowProgram` was NOT deleted, though this plan said to.** It has a second
  caller: the *painting's* own drop shadow, which is presentation of the
  painting rather than panel chrome.
- Verified by `debug/phase7-probe.js` (30/30) — the goldens cannot see any of
  it. `paint` hashes byte-identical on all 12; `screen` hashes moved on all 12
  because `readScreen()` hashes the painting rectangle and the old panel
  overlapped it. Baseline deliberately not re-recorded; see HANDOFF Open items.

### Phase 8 — Controls — DONE

- `lib/iro.js` — vendored v5.5.2, MPL-2.0, **unmodified by us** but *already*
  carrying one upstream-local patch (`iroContainerScale`), which is disclosed
  per the licence in `docs/UI-COMPONENTS.md`. Inert here.
- `app/ui/color.js` — `ColorControl`: the iro wheel plus value and alpha
  sliders, mounted into `#color-picker-slot`. HSVA at the boundary and nothing
  else; `color.rgb` is deliberately never read, because that is the WIDGET's
  colour, not the pigment.
- `colorpicker.js` deleted, with `app/shaders/picker.vert` and `picker.frag`.
  Shader lint went 23 → 21.
- **`_positionColorPicker()` and `COLOR_PICKER_LEFT`/`TOP` deleted too.** The
  picker no longer needs telling where its slot is; it IS the slot's content.
  Same for the picker's `scale`: CSS pixels are a DOM widget's native unit.
- **Every `colorPicker.onMouse*` forward deleted**, and with them the
  `isInUse()` early return, the two cursor branches and the `!isInUse()` term
  in the brush-draw test. The browser hit-tests a real element, so the canvas
  never sees the pointer — the same trade Phase 7 made for the panel.
- The RGB toggle now reads `FluidEngine.COLOR_MODEL` (Phase 9 finding 2), so
  the app's own `ColorModel` enum is deleted. One name for one number.
- The Phase 7 hue stripe stays and still sets hue only; the wheel pushes it so
  the two agree when the panel collapses.
- **The §5a sliders fork was deliberately NOT done.** The tilecraft component
  is vertical and its valuable CSS is all vertical-specific, so the fork would
  have been a port that discarded the asset it was taken for, replacing
  device-tested code. `slider.js` → `app/ui/sliders.js` and `buttons.js` →
  `app/ui/buttons.js`, both moved unchanged. Reasoning and the one real gap it
  leaves (keyboard/a11y) are in `docs/UI-COMPONENTS.md`.
- `brushviewer.js` did **not** move to `fluid-engine/debug/` in Phase 1 — the
  plan said so twice and was wrong both times. It is still at the repo root and
  still loaded; §5a's delete-list also names it and then says it is not
  deleted. Left alone here rather than swept up by accident.
- Verified by `debug/phase8-probe.js` at **17/17**, sabotage-verified twice.
  Goldens: all 12 `paint` hashes byte-identical, source and dist — **no RGB
  leaked into the pigment**, which is the whole risk of this phase.

### Phase 8a — Bristle re-seeding: identical stamps on repeated taps

**The bug.** `docs/bug-reports/non-random-wristles-brush-hits.png`: a page of
single taps in one colour, and every stamp is visibly the *same* star — the same
bristle splay, the same spokes, only translated. Real paint does not do this.

**The cause, read from the code rather than guessed.** `Brush`'s randoms texture
is filled once in the constructor (brush.js:102-110) and never refilled.
`initialize()` then lays the bristles out with a fixed "jittered sunflower"
formula in `setbristles.frag`:

```
theta = (bristleIndex + (randoms.z - 0.5) * u_jitter) * 2PI / PHI^2
r     = sqrt(bristleIndex + (randoms.w - 0.5) * u_jitter) / sqrt(u_bristleCount)
```

Every term is constant for the life of the brush: `bristleIndex`, `PHI`,
`u_jitter` (`BRISTLE_JITTER = 0.5`), and the randoms texel. So a jitter *does*
already exist — it is simply the **same** jitter every time. The stamp is
deterministic by construction.

**What to do.** The user's framing is the design constraint and it is correct:
a real brush is not rotated between monotonous strokes of one colour, so the fix
must not read as the brush being spun. Something small and per-press:

- A per-stroke rotation offset added to `theta` — one uniform, seeded when
  `initialize()` runs. Physically this is the brush being set down at a slightly
  different angle, which is what actually happens; it is not a spin.
- And/or a per-stroke offset into the randoms texture, so a different row of
  randoms feeds the jitter each press.

Prefer whichever is smaller. Both are a uniform plus a line of shader maths;
neither needs a new texture upload per press, which would cost a stall.

**Constraints, and they are strict.**

- **The new value must come from the engine's own seedable source, not bare
  `Math.random()`.** Under `?seed=` the goldens must stay reproducible. This is
  the same class of trap that shifted all 12 hashes in Phase 5 when `Brush`'s
  construction moved: RNG ordering is load-bearing here.
- The default must keep a *stroke* looking continuous. The offset is per press
  (`initialize()`), not per frame and not per splat — re-rolling inside a stroke
  would make a single drag shimmer.
- Expect all 12 golden hashes to move. That is correct for this change and must
  be re-recorded deliberately, with the probe below proving the difference is
  the intended one.

**How to verify.** The goldens cannot see this: they hash one settled stroke, and
"different stamps" is a statement about *repeated* strokes. Write a probe that
taps N times at N positions with identical parameters and compares the stamps to
each other — today they are near-identical, and the check is that they stop
being so while a single continuous drag is unchanged. Sabotage it by fixing the
offset to a constant; the probe must fail.

### Phase 9 — Prove reuse — DONE

- `examples/minimal/` — a bare canvas, `new FluidEngine(...)`, three controls
  (hue, brush size, fluidity) plus Clear. No panel, no picker, no
  `paint-setup.js`, no `common.js`, no `app/shaders/`, no `viewport.js`, no
  `debug/`. Loads the engine and exactly four dependencies.
- Verified by `debug/phase9-probe.js` at **18/18**, sabotage-verified twice.
  Goldens: all 12 `paint` hashes byte-identical on source AND dist — the
  simulation is untouched. Shader lint 23.
- **It found three things, and one of them was a real bug that broke painting
  entirely.** Full record in `docs/API-FINDINGS.md`:
  1. `Brush.update()` read a bare `presenter` global that only `index.html`
     declares, so in any other host it threw a `ReferenceError` **every frame,
     before `splat()` was reached** — a healthy-looking canvas that deposits
     nothing. Fixed with `typeof`. The engine must not require a global its host
     never heard of.
  2. The colour-model enum was app-owned while being an engine parameter →
     `FluidEngine.COLOR_MODEL`, with a load-time assertion that it agrees with
     `renderer.js`'s private literal (everything failing that equality falls
     through to RYB, silently).
  3. The engine's own shader manifest was app-owned → `FluidEngine.SHADER_FILES`.
     `common.js`'s `SHADER_TREES` became the function `shaderTrees()` because it
     loads before the engine.
- The parts of the API that held are recorded too: no host needed
  `engine.simulator`/`.brush`/`.renderer`, and `canDepositPaint`, the `fluidity`
  getter and `renderToTexture()`'s host-owned target each earned themselves.

### Phase 9a — A named stroke API: `beginStroke` / `strokeTo` / `endStroke`

**Why.** The primitives are already public and already sufficient —
`initializeBrush`, `positionBrush`, `splat`, `frame`; `debug/golden-harness.js`
drives scripted strokes with them today. What is missing is that three
non-obvious rules are the *caller's* to get right, and getting them wrong is
silent rather than loud:

1. **Bristles need settling frames after a press.** `initializeBrush()` places
   them; they must fall before any crosses `Z_THRESHOLD` and deposits. The
   harness settles 10 frames. Painting immediately lays nothing at all.
2. **Point spacing IS the stroke dynamics.** `Brush.update()` derives bristle
   speed from the delta it is handed, not from elapsed time — so feeding A then
   B paints differently from feeding 20 interpolated points between them. In
   Phase 6 a one-frame-stale position changed deposition ~2% and read as noise.
3. **Colour must arrive as RYB.** Hex -> HSVA -> `hsvToRyb` at the boundary.
   Handing RGB straight in produces plausible-looking wrong mixing (§3b).

**The surface.**

```js
engine.beginStroke({x, y, pressure, color});  // press + settle, internally
engine.strokeTo({x, y, pressure});            // interpolates at the engine's spacing
engine.endStroke();
```

The settling frame count and the interpolation spacing move *into* the engine,
where they are verified once, instead of being re-derived per host.

**The motivating use case** is tilecraft tracing vector art in real time
(`docs/api-usecases.md`, and the model at
`D:/work/js-games/ua-dream/docs/spec/story-model-spec-min-render.json`). That
model already carries stroke structure, which is why it maps cleanly:
`g` = group id, one group per stroke; `b` > 0 = polyline break, so lift and
re-press; `gz` = close back to the group's first tile; `s` = relative size,
documented as "brush-dependent scale factor, or stylus pressure if applicable",
which feeds the `height` argument; `c` = hex, converted at the boundary.

**Rules.**
- Do **not** implement this by exposing `engine.simulator` or `engine.brush`.
  The Phase 5 rule stands: add methods, never an escape hatch.
- It sits next to Phase 9 deliberately: a second host needing something the API
  lacks is a *finding about the API*. This is that finding, recorded before the
  host exists — so build the host first if the two disagree about the shape.
- Interacts with Phase 8a: per-press bristle re-seeding must happen inside
  `beginStroke()`, so a scripted trace gets the same variation a hand does.

### Phase 10 — Documentation
- `docs/FLUID-ENGINE-API.md`: commands, events, capabilities, coordinate spaces,
  debug flags.
- `docs/COLOR-MODEL.md`: §3b written up properly — the cube, why yellow+blue is
  green, why the blue corner is ultramarine, and an explicit warning against
  "fixing" it. This is the piece of David Li's design most likely to be lost by
  a future maintainer who assumes RGB.
- `docs/UI-COMPONENTS.md`: what was vendored, from where, at what version, and
  what was changed (needed for the MPL-2.0 obligation on iro.js).
- Update `WEBGL2-DUAL-PATH.md` for the new file locations.

## 7. Module system

Currently every file is a global script tag. The engine should be ES modules.
The tooling migration (gulp concat -> a bundler entry point) is real work and is
*not* folded into a phase silently — it happens at the start of Phase 3, as its
own commit, with `?webgl=1` and the production build both re-verified.

## 8. Explicit non-goals

- No change to the simulation math or the shaders. The mobile bristle-collapse
  fix and the NEAREST discipline are load-bearing and stay exactly as they are.
- **No change to the RYB colour model.** The eight cube corners in
  `painting.frag` are the artistic character of the product (§3b). Not
  simplified, not replaced by a colour library, not migrated to a standard
  space.
- No removal of debug capability. Debug features are demoted behind flags, not
  deleted (§3a).
- No TypeScript conversion in this work.
- No new simulation features. Extension points only.
- No UI framework. The components are plain classes over DOM; adding React or
  similar would put a dependency between the engine and every future host.
- No redesign of the *visual language* — the layout becomes responsive and the
  controls become DOM, but this is not an exercise in restyling.

## 9. Licensing

`iro.js` is MPL 2.0 — file-level copyleft. Vendored unmodified, it is satisfied
by keeping the header and recording its origin in `docs/UI-COMPONENTS.md`. If it
ever needs behavioural changes, wrap it rather than editing it.

`pointer-dispatcher.js` and `components.js` are the author's own code from
`tilecraft`; no external obligation. The `SlidersComponent` styling derives from
a CodePen credited in the file header — the attribution comment moves with it.
