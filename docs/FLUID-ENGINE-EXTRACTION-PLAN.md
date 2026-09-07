# Fluid Engine Extraction Plan

Status: Phase 0 complete (58e7d74) -- see HANDOFF.md
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

Concrete defects that follow from having no single owner of the mapping:

- **`devicePixelRatio` is never read.** Not once in the codebase. On a DPR-3
  phone the backing store equals CSS pixels, so the painting is soft and pointer
  coordinates are only approximately right.
- **The Y-flip is open-coded in four places** — `canvas.height - position.y` at
  paint.js:1004, :1064, :1166, :1250. Any new input path must remember to repeat
  it, and forgetting is silent.
- **`onResize` rebuilds three textures without deleting the old ones**
  (paint.js:318-355). A GPU leak on every resize — and on mobile, resize fires
  on rotation and on every soft-keyboard open.
- **The orthographic matrix is built twice** (paint.js:289 and :314) from the
  same inputs, so the two can drift apart under edit.
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

## 3a. Debugging sediment — cleared for removal

The author has confirmed that a number of parameters and properties in `Paint`
are residue from attempts to fix what turned out to be the mobile shader bug
(see `MOBILE-GPU-BRISTLE-COLLAPSE-SPEC.md`), not deliberate design.

**These are not deleted — they are demoted behind feature flags.** The
distinction matters: they were built to make an invisible problem visible, and
that problem class is not gone. The next GPU quirk will want the same tools.
What is wrong with them today is only that they are always-on and mixed into
production code paths, not that they exist.

| Item | Location | Disposition |
|---|---|---|
| Painting-rect outline (`showPaintingRect`, `paintingRectThickness`, `paintingRectColor`, `rectOutlineProgram`) | paint.js:105-116 | Flag `debug.paintingRect`, default off |
| Ortho near/far ±5000 probe | `rebuildProjectionMatrix()` | **Left at ±5000 — unresolved, see note below.** Deduplicated in Phase 1; the value is untouched |
| `debug.js`, `debug2.js`, `debug/` | — | Fold into the engine's debug module |
| `brushviewer.js` live bristle preview | — | Flag `debug.brushViewer` |
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

### Phase 2 — Viewport module
- Introduce `Viewport`: owns canvas sizing, `devicePixelRatio`, the Y-flip, and
  all three coordinate spaces, with explicit conversions
  (`screenToPainting`, `paintingToSimulation`, ...).
- Replace all four open-coded Y-flips and every ad-hoc scale with calls into it.
- **DPR is turned on here.** This is the one phase that intentionally changes
  rendered output on high-DPR devices — the painting gets sharper. Golden
  baselines are re-recorded per DPR, and the phone/tablet are retested
  deliberately rather than compared to the old blurry baseline.

**Risk:** highest of any phase, because it is the one that changes behaviour.
Mitigation: it lands alone, on its own commit, with device retest before Phase 3.

### Phase 3 — Move the engine, unchanged
- Move `Simulator`, `Brush`, `wrappedgl`, `glsl3`, shaders into `fluid-engine/`.
- Split `constants.js`: simulation/render constants to the engine, panel/picker
  geometry stays with the app.
- Sever the screen dependency: `splat()` receives simulation-space arguments
  from `Viewport`, not a screen-space `paintingRectangle`.
- Still no public API — `paint.js` imports the moved modules directly.

### Phase 4 — Extract the renderer
- Lift the painting draw out of `Paint.update()` into `renderer.js`.
- What stays behind in `Paint.update()` is exactly the UI chrome. After this
  phase the boundary is visible in the file structure.

### Phase 5 — The FluidEngine facade
- Add `fluid-engine/index.js` with the command API above.
- Rewrite `Paint` as a host: it calls commands and draws chrome, owning no
  simulation state.
- Extension points established as described in §5.

### Phase 6 — Input: PointerDispatcher

This lands *before* the visual UI, deliberately. Input is the riskiest part of
the UI change (it is what the engine actually feels like) and it can be swapped
underneath the existing canvas-drawn chrome, so it gets tested in isolation.

- Vendor `pointer-dispatcher.js` into `app/ui/`.
- Replace the `onPointer*` handlers with dispatcher subscriptions:
  `pan` -> stroke, `pan2` -> canvas pan, `pinch` -> painting resize.
- Delete the hand-rolled `getResizingSide()` edge hit-testing (paint.js:938)
  and the `activePointers` bookkeeping.
- **Wire `pressure` into `beginStroke`/`moveStroke`** — closes the pen-pressure
  TODO. Stylus on the tablet is the acceptance test.

**Device retest required**, on the A56 and the tablet, with a stylus if
available. Gesture behaviour cannot be verified by golden images.

### Phase 7 — Responsive HTML layout
- `app/index.html` + `layout.css`: the canvas becomes one grid cell; chrome
  becomes DOM around it.
- Breakpoints: phone portrait (collapsed drawer), phone landscape (side rail),
  tablet, desktop (persistent panel).
- Canvas sizing driven by `ResizeObserver` on its container, not
  `window.innerWidth` — this is what finally kills the pinned-to-window
  assumption at paint.js:298.
- Delete `panelProgram`, `blurProgram`, `shadowProgram` and their shaders.

### Phase 8 — Controls
- `app/ui/sliders.js` — the scoped fork per §5a. Brush scale, bristle count,
  fluidity, quality, opacity.
- `app/ui/color.js` — iro.js wheel, HSVA -> RYB at the boundary. The natural
  colour model stays the default; the RGB toggle is a control, not a setting
  buried in code.
- Delete `colorpicker.js`, `slider.js`, `buttons.js`.
- `brushviewer.js` already moved to `fluid-engine/debug/` in Phase 1; nothing
  to do here.

### Phase 9 — Prove reuse
- A minimal second host: a bare canvas, `new FluidEngine(canvas)`, three
  controls. No panel, no picker.
- If this host needs anything the API does not expose, the API is wrong —
  and that is the point of building it.

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
