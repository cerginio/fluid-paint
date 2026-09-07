# Handoff — Phases 0-4 done, iPhone fix still not device-tested

Written 2026-09-07. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`**, working tree **clean**. **Phases 0-4 are done.**

Golden images: **12/12 pass** on both the source and dist paths, with hashes
**byte-identical** to the Phase 0 baseline. Shader lint passes, now reporting
24 shaders across two trees.

```
767820b  Phase 4: extract the painting render into fluid-engine/renderer.js
da591b8  Split the UI chrome shaders out of the engine tree
fa0c2f9  Rewrite the handoff for a fresh session
ca509aa  Note simulator.md as an orphaned self-test dump
b616c1e  Record Phase 3 in the plan and handoff
9cf9f2b  Phase 3: move the engine into fluid-engine/
5199f72  Delete debug2.js, which was never loaded
e4a313c  Sever splat()'s screen dependency: take a brush-space rectangle
96f051f  Fix the iPhone 14 blank canvas: probe float blending, degrade to half-float
```

The two commits from `da591b8` up are this session's work.

### Device verification results (user, 2026-09-07)

| Device | Result |
|---|---|
| Samsung A56 | **Good** — Phase 2 works, DPR on |
| Samsung Galaxy Tab S9 | **Good** |
| iPhone 14 | **Was blank; fixed in code, still awaiting re-test on the device** |

### Current tree

```
fluid-paint/              <- git repo root
  fluid-engine/           <- the engine
    simulation.js         Simulator
    brush.js              Brush
    renderer.js           PaintingRenderer (Phase 4)
    gl/wrappedgl.js       WrappedGL
    gl/glsl3.js
    shaders/              engine shaders only (19)
  app/
    shaders/              UI chrome shaders (5), split out in Phase 4
  paint.js (1363 lines)   the app: chrome + input + undo, no painting render
  paint-setup.js          app constants (the lighting ones left in Phase 4)
  viewport.js             coordinate spaces + DPR
  common.js               the two shader manifests + loadShaderTrees()
  colorpicker.js slider.js buttons.js brushviewer.js rectangle.js utilities.js
  debug/                  harnesses and probes
  docs/
```

`d:/work/fluid-paint/fluid-engine/` — the empty directory **beside** the repo —
is a stale placeholder. Nothing went there. Do not put anything there.

## Phase 4 — what was done

### The renderer

`PaintingRenderer` in `fluid-engine/renderer.js` owns all six
`painting.vert`/`painting.frag` programs (four screen: RYB/RGB x normal/resizing;
two SAVE), the `output.frag` blit, and its own quad buffer.

**It does not own the target texture or framebuffer.** Those are per-call
arguments. That is the whole reason one implementation serves three callers:
`renderToTexture()` for the screen, `renderToPixels()` for save, and whatever a
second host wants in Phase 9. If you find yourself wanting to cache the target
in the constructor, that is the design going backwards.

`present()` is separate from `renderToTexture()` because the painting is redrawn
only when `needsRedraw`, but must be blitted **every** frame — the chrome is
drawn over it and is not part of the painting texture. Merging them silently
drops the chrome on still frames.

### Constants that moved, and the one that is shared

The lighting constants (`NORMAL_SCALE`, `ROUGHNESS`, `F0`, `SPECULAR_SCALE`,
`DIFFUSE_SCALE`, `LIGHT_DIRECTION`, `BACKGROUND_GRAY`) left `paint-setup.js` for
the renderer. They were only ever in the app because the draw call was.

**`RESIZING_FEATHER_SIZE` is the exception and the interesting one.** It reaches
two places that must agree: `painting.frag`'s RESIZING variant, which draws the
preview, and `simulator.resize()`, which feathers the paint texture when the
resize commits. If they ever disagreed the painting would visibly jump at the
moment the user let go of the handle. It is defined once in the renderer and
exposed as `PaintingRenderer.RESIZING_FEATHER_SIZE` so `paint.js` can pass the
same number to the simulator. Do not re-inline it on either side.

### A real bug found on the way

The screen and save paths open-coded the same seven material uniforms
separately, and **had already drifted** — the save path never set
`u_featherSize`. It happened not to matter (the SAVE variant does not declare
it), but that is luck, not design. `_applyMaterialUniforms()` now feeds both.

Setting a uniform a program does not declare is a safe no-op here: WrappedGL
builds `uniformLocations` from `ACTIVE_UNIFORMS`, so the lookup is `undefined`,
and a null location is ignored per the WebGL spec. The screen path was already
relying on this — it sets `u_featherSize` on the non-resizing programs too.

### The shader split

`panel.frag`, `picker.vert`/`picker.frag`, `shadow.frag` and `rectborder.frag`
moved to `app/shaders/`. **`fullscreen.vert` deliberately stayed engine-side**
even though the chrome uses it: the app hosts the engine, so an app -> engine
dependency is the right direction for that arrow. Do not "fix" this by copying
it into the app tree.

`loadTextFiles` applies **one** base path to every name, so two trees need two
calls. `SHADER_TREES` in `common.js` pairs each manifest with its path;
`loadShaderTrees()` merges the results into the single flat `shaderSources`
object every lookup already expects. **The ~24 keys are unchanged**, same as
Phase 3 — `shaderSources['shaders/panel.frag']` still resolves even though the
file now lives under `app/`. Only the base paths know where anything really is.

### The lint had the Phase 3 trap set for it again

`debug/lint-shaders.js` read one hardcoded shader directory, so after this split
it would have passed cleanly while checking **nothing** in `app/shaders/`. It
now walks both trees and **fails outright if it finds no shaders at all** — a
lint that checks nothing must not report OK. It prints the count (24) for
exactly that reason. This is the second time a path move has quietly disarmed
this script; assume a third.

### How the extraction was actually verified

Goldens 12/12 byte-identical, source and dist. But **the goldens cannot see
either path Phase 4 rewrote** — they never call `save()` and never enter the
resize preview. Passing goldens said nothing about the two hardest bits.

A throwaway probe (`debug/phase4-probe.js`, deleted after use per the `debug/`
convention) drove both directly on WebGL 1 and 2 and matched the pre-Phase-4
tree exactly:

| | WebGL 2 | WebGL 1 |
|---|---|---|
| save data-URL sha256 | `0fe8aca396d1` | `a4f3d1589650` |
| resize preview screen sum | 190394951 | 2522806384 |

**Sabotage-verified.** Moving `NORMAL_SCALE` 7.0 -> 7.5 shifted all four
numbers, so the match means something. If you rewrite either path again, write
the probe back — the numbers above are the expected values.

## Phase 5 — next

Add `fluid-engine/index.js` with the command API, and rewrite `Paint` as a host
that owns no simulation state.

The exact surface to cover is measurable — this is every engine member
`paint.js` currently touches:

| Member | Uses | Note |
|---|---|---|
| `simulator.resolutionWidth` / `Height` | 3 / 3 | read-only |
| `simulator.splat` / `simulate` / `resize` / `clear` | 1 each | the verbs |
| `simulator.copyPaintTexture` / `applyPaintTexture` | 1 each | undo/redo |
| `simulator.changeResolution` | 2 | quality slider |
| `simulator.fluidity` | 2 | mutated directly by a slider |
| `simulator.paintTextureType` | 2 | snapshot allocation must follow it |
| `brush.initialize` | 3 | |
| `brush.update` / `setBristleCount` | 1 each | |
| `brush.bristleCount` / `maxBristleCount` | 1 each | read by the splat alpha math |
| `brush.positionsTexture` / `brushTextureCoordinatesBuffer` / `brushIndexBuffer` | 1 each | **the bristle overlay reaches into GL objects** |

The last row is the one that will fight you. The brush preview draw in
`update()` binds the brush's own buffers and texture directly, so a facade that
hides them breaks it. That draw is chrome (it is a debug/UI overlay), so either
the facade exposes a `drawBristles()` command or the overlay moves into the
engine's debug area. Decide deliberately; do not leak the buffers through the
API just to keep the existing call compiling.

`simulator.fluidity` being written directly by a slider is the other one: a
command API wants a setter, not a public field.

## Things a fresh session will otherwise get wrong

**`paintTexture` is the odd one out.** It is the only resolution-sized target
that is BLENDED into, which is why it needs `paintTextureType` (chosen by probe)
rather than `simulationTextureType`. Snapshot textures in `paint.js` must follow
it.

**`hasFloatTextureSupport()` does not test blending.** Renderable != blendable.
That gap is why the iPhone passed its own gate and painted nothing; the startup
gate now asks `canBlendIntoTexture()` too.

**A UA switch for the iPhone was considered and rejected.** It guesses which
devices are affected and is wrong in both directions — it misses non-Apple GPUs
with the same gap and penalises iPhones after WebKit ships a fix. The fix is a
capability probe (`WrappedGL.canBlendIntoTexture(type)`) that performs the exact
blend `splat()` uses and reads the result back. If someone proposes device
sniffing again, this is the argument.

**On WebGL 2, `OES_texture_half_float` is generally NOT exposed** even though
half-float is core, so asking for the extension object returns null on hardware
that supports half-float fine. Use `wgl.getHalfFloatType()`. Getting this wrong
silently disables the iPhone fallback on the exact context the iPhone reports.

**Capability probes must restore GL state.** `canBlendIntoTexture()` drives raw
GL behind `WrappedGL`'s state cache, so it resets viewport, blend equation,
blend func and clear colour to the tracked defaults before clearing the
dirty-set. Clearing the dirty-set alone would leak a 1x1 viewport into the next
draw.

**The goldens have blind spots, and they are where the risk is.** They never
call `save()`, never enter the resize preview, and cannot see the bristle
overlay. A change confined to those paths passes 12/12 while being completely
untested. Write a probe; sabotage it to prove it can fail.

**An identical hash across different scenarios means nothing was drawn**, not
that the renderer is stable. That is how the harness's own coordinate bug was
caught.

**At ratio 1 the Phase 2 code is equivalent to the old by construction.** That
is why the DPR axis had to exist: without dpr2 rows every Phase 2 commit passes
while the whole feature is untested. A future feature that is off by default
needs the same treatment.

**A time-driven scripted stroke is not a measurement.** Painted-texel counts
over identical code returned 76080, 99735 and 77917. Fine for "did any paint
land"; useless for regressions.

**Budget arithmetic was wrong by 4x on the first attempt** — 4 bytes a texel
instead of 16, and the 15 undo snapshots ignored entirely. Recompute from
`BYTES_PER_TEXEL` and `SIMULATION_TARGETS + HISTORY_SIZE`, never from memory.

**A `typeof fn === 'function'` guard around a debug entry point hides a missing
script.** That is how `debug2.js` sat dead in the build while its self-test
appeared to run. If a probe matters, let it throw.

Still true from earlier phases: the RYB colour model is protected;
`hsvToRgb`/`hsvToRyb` being identical is not a bug; hue maps onto RYB channels
(`0.333` yellow, `0.667` blue); bristles need settling frames after
pointer-down; splatting is alpha-blended, not additive (**which is precisely
what the iPhone cannot do at full float**); debug features are on by default and
their flags are decomposition, not a visibility switch; the +/-5000 depth range
is unresolved because the harness cannot see the bristle overlay; **both
`index.html` and `gulpfile.js` must list any new script**, and the gulpfile's
order matters because the project uses globals with no module system.

## Commands

```
npm run test:golden          12 checks, several minutes
npm run test:golden:dist     the same against dist/ (GOLDEN_ROOT=dist)
npm run test:golden:record   re-record the baseline (refuses to record failures)
npm run lint:shaders         FLOAT+LINEAR textures, shader precision, both trees
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
  `playwright` from the script's own path; delete them after use.
- A dev server was previously run on `192.168.1.224:8099` for device testing.

## Open items

- **Re-test the iPhone 14 with the fix** — still the priority, and now two
  phases stale. `?diag=1` should show `blend into HALF_FLOAT target PASS`, and
  a stroke should deposit paint. Look for banding in long strokes.
- The 1 GB render-target budget is validated on Android, not on iOS.
- The +/-5000 depth range — unresolved; needs a mid-stroke golden scenario.
- `viewport.screenToSimulation` still has no caller.
- `simulator.md` is misnamed: it is not simulator documentation but a saved
  `runWebGLSelfTest()` output dump from an Adreno 642L. That function went with
  `debug2.js`, so the file is an orphaned artifact. Keep it as a device record
  under a better name, or delete it.
- `docs/image.png` / `docs/image-ui.png` are untracked device screenshots;
  `image.png` is the `?diag=1` report that confirmed the iPhone diagnosis.
