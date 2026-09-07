# Handoff — Phases 0-3 done, iPhone fixed but not re-tested

Written 2026-09-07. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**, working tree **clean**. **Phases 0-3 are done.**

Golden images: **12/12 pass** on both the source and dist paths, with hashes
**byte-identical** to the Phase 0 baseline. Shader lint passes.

```
ca509aa  Note simulator.md as an orphaned self-test dump
b616c1e  Record Phase 3 in the plan and handoff
9cf9f2b  Phase 3: move the engine into fluid-engine/
5199f72  Delete debug2.js, which was never loaded
e4a313c  Sever splat()'s screen dependency: take a brush-space rectangle
96f051f  Fix the iPhone 14 blank canvas: probe float blending, degrade to half-float
819c96b  Record the device verification results and the iPhone 14 failure
ad4c3e3  Add a float-blend probe to the device diagnostics
05299c8  Update the plan and handoff for the end of Phase 2
19ef834  Turn devicePixelRatio on, with a render-target memory budget
fe6f42f  Express the CSS-authored UI metrics in screen pixels
7dc05bd  Introduce the Viewport module, with DPR still off
```

The six commits from `96f051f` up are this session's work.

### Device verification results (user, 2026-09-07)

| Device | Result |
|---|---|
| Samsung A56 | **Good** — Phase 2 works, DPR on |
| Samsung Galaxy Tab S9 | **Good** |
| iPhone 14 | **Was blank; fixed in code, awaiting re-test on the device** |

### Current tree

```
fluid-paint/              <- git repo root
  fluid-engine/           <- the engine (Phase 3)
    simulation.js         Simulator (was simulator.js)
    brush.js              Brush
    gl/wrappedgl.js       WrappedGL
    gl/glsl3.js
    shaders/              all shaders, UI chrome included (see Phase 4)
  paint.js (1480 lines)   the app: still fuses render + chrome + input + undo
  paint-setup.js          app constants
  viewport.js             coordinate spaces + DPR
  common.js               shaderFiles manifest + SHADER_BASE_PATH
  colorpicker.js slider.js buttons.js brushviewer.js rectangle.js utilities.js
  debug/                  harnesses and probes
  docs/
```

`d:/work/fluid-paint/fluid-engine/` — the empty directory **beside** the repo —
is a stale placeholder. Nothing went there. Do not put anything there.

## The iPhone 14 failure — diagnosed and fixed

The user ran `?diag=1` on the device and it reported:

```
context                  WebGL 2
EXT_color_buffer_float   true
hasFloatTextureSupport() true
EXT_float_blend          false
blend into FLOAT target  FAIL (got 0.000, want 0.5)
```

So the app passed its own capability gate, initialised fully, ran its physics,
and deposited nothing — `Simulator.splat()` alpha-blends into `paintTexture`,
which was always `gl.FLOAT`, and an implementation without `EXT_float_blend` is
entitled to drop that draw silently.

### The fix

`paintTexture`'s type is chosen by **capability probe, not user-agent**.
`WrappedGL.canBlendIntoTexture(type)` performs the exact blend `splat()` uses
and reads the result back. That is correct on untested hardware and
self-correcting once WebKit ships the extension. **A UA switch was considered
and rejected** — it guesses which devices are affected and is wrong in both
directions (misses non-Apple GPUs with the same gap, penalises iPhones after a
fix). If someone proposes device sniffing again, this is the argument.

Precedence in the `Simulator` constructor:

1. float blends → stays `gl.FLOAT`. Every current desktop and Android device;
   hashes provably unmoved.
2. float does not blend, half-float does → **half-float**, with a console
   warning. This is the iPhone path.
3. neither blends → `canDepositPaint = false`, and the startup gate in
   `index.html` shows the unsupported page rather than a healthy-looking blank
   canvas. Looking healthy while painting nothing was the worst part of the bug.

`paint.js` snapshot textures follow `simulator.paintTextureType`; a snapshot
holds a copy of `paintTexture` and a format mismatch would break undo.

### Why it is believed to work

`?gpu=iphone-14` (in `debug/gpu-profiles.js`) reproduces the device: denies
`EXT_float_blend` and forces blended draws into 32-bit float targets to deposit
nothing, by masking colour writes for the duration of the draw, while leaving
half-float blending intact.

**Sabotage-verified.** With the fallback disabled, the profile reproduces the
reported symptom exactly — `painted=0`, `maxAlpha=0`, no error, on both WebGL
paths — while desktop is unaffected. With the fallback in place all four
combinations paint. The harness can fail, so its passes mean something.

`?diag=1` gained a **`blend into HALF_FLOAT target`** row, shown whenever the
float row fails, which separates "the fallback will work here" from "this device
cannot paint at all".

### What has NOT been verified

**The fix has not run on the iPhone 14.** Everything above is desktop
SwiftShader with blending suppressed by hand — a model of the device, not the
device. Re-test with `?diag=1` and a stroke.

Two things the harness cannot see:

- **Banding or drift in long strokes.** Half-float has ~11 bits of mantissa and
  pigment accumulates over many splats. The reproduction showed peak alpha
  dropping 8.42 → 5.19 on WebGL 2, which is that precision loss showing up in
  the accumulation. Plausible, but needs a real look.
- **`readPaintTexture()` reads with `gl.FLOAT`.** It worked against a half-float
  target under SwiftShader; a stricter driver may refuse the combination. That
  would break the golden harness and undo, not painting.

## Phase 3 — what was done

The engine moved to `fluid-engine/`, inside the repo.

**The shader manifest keys did not change, on purpose.** `loadTextFiles()` takes
a `basePath` that is prepended to fetch a file but is **not** part of the result
key, so every `shaderSources['shaders/...']` lookup still resolves and
`SHADER_BASE_PATH` in `common.js` is the only thing that knows the real
location. Relocating the shader tree is a one-string change, not a rename of ~24
keys across four files. The dist task mirrors the layout into
`dist/fluid-engine/shaders` — a flat `dist/shaders` would 404 every fetch.

**There was no `constants.js` to split.** The plan assumed one. Constants live
in `paint-setup.js` (app) and as file-local `const`s in the engine files.
Verified mechanically with comments stripped: **zero** app constants used by
engine code, **zero** engine constants used by app code. The one apparent
crossing, `BRUSH_HEIGHT` in `simulation.js`, is inside a comment. The separation
the plan asked for already held.

**`splat()` no longer names the screen.** It takes `brushRectangle` — the
painting expressed in the brush's own coordinate space. The app passes its
screen-space rectangle because *its* brush lives in screen pixels; that is the
app's business. Note `viewport.screenToSimulation` was written for this seam and
**still has no caller**.

**`debug/lint-shaders.js` would have silently stopped working.** It scanned only
the repo root for `.js` files, so after the move it would have checked nothing
that creates textures — passing cleanly while testing nothing. It now walks
`fluid-engine/` and `fluid-engine/gl/` and reports repo-relative paths.

## Phase 4 — next

Extract the painting render out of `Paint.update()` into
`fluid-engine/renderer.js`, and split the UI shaders out of
`fluid-engine/shaders/` as part of it.

`update()` is `paint.js:596-905` and already falls into three consecutive
sections, which is the seam to cut along:

| Lines (approx) | What | Destination |
|---|---|---|
| 597-646 | brush update, `splat()`, `simulator.simulate()` | already engine |
| 648-734 | `clippedPaintingRectangle`, painting into texture, output to screen | **engine renderer** |
| 736-905 | shadow, rect outline, brush overlay, cursor, panel blur, panel | **app chrome** |

The chrome shaders to move back out with that third block: `panel.frag`,
`picker.vert`/`picker.frag`, `shadow.frag`, `rectborder.frag`. They were moved
into `fluid-engine/shaders/` in Phase 3 deliberately — splitting them during a
*move* would have mixed relocation with redesign, and the golden images could
not have said which one broke things. Phase 4 is where that split belongs.

Watch out: the painting render reads `this.paintingRectangle`,
`this.canvasTexture`, `this.framebuffer`, `this.resolutionScale` and the colour
model flag. Those are the real inputs of the renderer's future signature.

## Things a fresh session will otherwise get wrong

**`paintTexture` is the odd one out.** It is the only resolution-sized target
that is BLENDED into, which is why it needs `paintTextureType` (chosen by probe)
rather than `simulationTextureType`. Snapshot textures in `paint.js` must follow
it.

**`hasFloatTextureSupport()` does not test blending.** Renderable ≠ blendable.
That gap is why the iPhone passed its own gate and painted nothing; the startup
gate now asks `canBlendIntoTexture()` too.

**On WebGL 2, `OES_texture_half_float` is generally NOT exposed** even though
half-float is core, so asking for the extension object returns null on hardware
that supports half-float fine. Use `wgl.getHalfFloatType()`. Getting this wrong
silently disables the iPhone fallback on the exact context the iPhone reports.

**Capability probes must restore GL state.** `canBlendIntoTexture()` drives raw
GL behind `WrappedGL`'s state cache, so it resets viewport, blend equation,
blend func and clear colour to the tracked defaults before clearing the
dirty-set. Clearing the dirty-set alone would leak a 1×1 viewport into the next
draw.

**At ratio 1 the Phase 2 code is equivalent to the old by construction.** That
is why the DPR axis had to exist: without dpr2 rows every Phase 2 commit passes
while the whole feature is untested. A future feature that is off by default
needs the same treatment.

**An identical hash across different scenarios means nothing was drawn**, not
that the renderer is stable. That is how the harness's own coordinate bug was
caught.

**The harness had the very bug Viewport exists to prevent** —
`paintingFractionToClient` mixed screen pixels into a CSS-pixel result.
Invisible while the units were equal; at ratio 2 it aimed every stroke at twice
its intended offset.

**Budget arithmetic was wrong by 4× on the first attempt** — 4 bytes a texel
instead of 16, and the 15 undo snapshots ignored entirely. Recompute from
`BYTES_PER_TEXEL` and `SIMULATION_TARGETS + HISTORY_SIZE`, never from memory.

**A time-driven scripted stroke is not a measurement.** Painted-texel counts
over identical code returned 76080, 99735 and 77917. Fine for "did any paint
land"; useless for regressions.

**A `typeof fn === 'function'` guard around a debug entry point hides a missing
script.** That is how `debug2.js` sat dead in the build while its self-test
appeared to run. If a probe matters, let it throw.

Still true from earlier phases: the RYB colour model is protected;
`hsvToRgb`/`hsvToRyb` being identical is not a bug; hue maps onto RYB channels
(`0.333` yellow, `0.667` blue); bristles need settling frames after
pointer-down; splatting is alpha-blended, not additive (**which is precisely
what the iPhone cannot do at full float**); debug features are on by default and
their flags are decomposition, not a visibility switch; the ±5000 depth range is
unresolved because the harness cannot see the bristle overlay; **both
`index.html` and `gulpfile.js` must list any new script**, and the gulpfile's
order matters because the project uses globals with no module system.

## Commands

```
npm run test:golden          12 checks, several minutes
npm run test:golden:dist     the same against dist/ (GOLDEN_ROOT=dist)
npm run test:golden:record   re-record the baseline (refuses to record failures)
npm run lint:shaders         FLOAT+LINEAR textures, shader precision
npm run build                gulp build into dist/
npm run dev                  build + serve
```

Useful query parameters: `?diag=1` (on-device capability panel), `?gpu=<profile>`
(`desktop`, `samsung-a56`, `samsung-a56-boots`, `iphone-14`, `mobile-worst`),
`?golden=basic|colorMix|wetBlend|all`, `?webgl=1`, `?dpr=N`, `?seed=N`,
`?selftest=1`, `?audit=1`, `?debug=-textureProbe`.

## Environment notes

- Playwright chromium is installed. Headless uses SwiftShader via ANGLE:
  a local regression tripwire only, and **its float-blend behaviour is not
  Apple's** — it passes the probe, which is why the iPhone needs a real check.
- Launch flags matter: `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. Wrong flags fail to compile shaders and report
  a clean result that means nothing.
- One-off probes go in `debug/` (not the scratchpad) because Node resolves
  `playwright` from the script's own path; delete them after use. This session
  wrote and deleted `debug/iphone-probe.js` that way.
- A dev server was previously run on `192.168.1.224:8099` for device testing.

## Open items

- **Re-test the iPhone 14 with the fix** — the priority. `?diag=1` should now
  show `blend into HALF_FLOAT target PASS`, and a stroke should deposit paint.
  Look for banding in long strokes.
- The 1 GB render-target budget is validated on Android, not on iOS.
- The ±5000 depth range — unresolved; needs a mid-stroke golden scenario.
- `viewport.screenToSimulation` still has no caller.
- `simulator.md` is misnamed: it is not simulator documentation but a saved
  `runWebGLSelfTest()` output dump from an Adreno 642L. That function went with
  `debug2.js`, so the file is an orphaned artifact. Keep it as a device record
  under a better name, or delete it.
- `docs/image.png` / `docs/image-ui.png` are untracked device screenshots;
  `image.png` is the `?diag=1` report that confirmed the iPhone diagnosis.
