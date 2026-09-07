# Handoff — state after Phase 0

Written 2026-09-07 so the next session can start on Phase 1 without re-deriving
anything. Read this, then `FLUID-ENGINE-EXTRACTION-PLAN.md`.

## Where things stand

Branch: **`fluid-engine-v1`** (note: the plan's header still says
`webgl2_migration` — that is stale, fix it when convenient).

```
e08b253  Restore david.li's original brush and simulation constants
58e7d74  Add golden-image harness for the engine extraction
df884cc  Report the active context and its real float gate in the diag panel
```

Working tree clean apart from `docs/image.png` (untracked, not mine).

**Phase 0 is done.** Phase 1 is next and has not been started.

## What Phase 0 delivered

A golden-image harness that makes "the refactor changed nothing" checkable.

```
npm run test:golden          verify (non-zero exit on drift)
npm run test:golden:record   re-record
npm run test:golden:dist     verify the production bundle
```

Three scenarios × two WebGL paths = six checks. Full detail in
`docs/GOLDEN-IMAGES.md` — **read it before touching the harness**, it records
several traps that cost real time to find.

The three things worth knowing up front:

1. **Two hashes per run.** `paintHash` is the simulator's RYB texture;
   `screenHash` is the composited canvas after `rybToRgb` and lighting. Which
   one moves tells you *where* a regression is. A colour-model change moves only
   `screenHash`.

2. **It was verified by sabotage.** Breaking `rybToRgb` and breaking
   `DELTA_TIME` were both caught 6/6, and each was correctly classified as a
   rendering vs a simulation change. A test that has never failed proves nothing.

3. **The green assertion is not the tripwire.** It *passed* under the
   `rybToRgb` sabotage that `screenHash` caught. It exists to explain a moved
   hash in words. Do not rely on it alone; do not delete it either.

## Also done: david.li's constants restored

Four values had drifted during earlier debugging and are now back to upstream:

| Constant | Was | Now | File |
|---|---|---|---|
| `SPLATS_PER_SEGMENT` | 18 | **8** | brush.js |
| `GRAVITY` | 10.0 | **30.0** | brush.js |
| `BRUSH_HEIGHT` | 3.0 | **2.0** | paint-setup.js |
| `SPLAT_PADDING` | 3.5 (working tree) | **4.5** | simulator.js |

Everything else was checked against david.li's published sources and already
matched. `SPLAT_PADDING` is tied to `BRUSH_HEIGHT` by its own comment
(`sqrt(BRISTLE_LENGTH² - BRUSH_HEIGHT²)`) — the two must move together.

Baselines were re-recorded after this, so the current baseline reflects the
david.li tuning.

## Phase 1 — what to do next

From the plan, §6. Nothing here has been started.

- Hoist `this.save` out of `update()` — it is reassigned every frame at
  [paint.js:585](../paint.js#L585), a ~60-line closure allocated 60×/second.
- Delete textures in `onResize` before rebuilding
  ([paint.js:318-355](../paint.js#L318)) — GPU leak on every rotate.
- Build the ortho matrix in one place (currently
  [:289](../paint.js#L289) and [:314](../paint.js#L314)).
- Introduce `engine.debug` + `?debug=` parsing.
- Move each §3a debug item behind its flag, **one per commit**, each verified
  with `npm run test:golden` (flag off — hashes must not move).

The user's instruction on debug features is explicit and worth repeating: they
are **demoted behind flags, never deleted**. They were built to make invisible
GPU problems visible, and that problem class recurs. Requirement: a flag that is
off must be *structurally* absent — no compiled GL programs, no allocated
textures, no per-frame branches.

## Things a fresh session will otherwise get wrong

**The RYB colour model is protected.** `rybToRgb` in `shaders/painting.frag` is
david.li's subtractive pigment cube — eight corners, trilinear, no branching.
Yellow+blue must give green (RGB would give grey); all three give muddy brown,
not black; the blue corner is ultramarine, not `(0,0,1)`. Never "simplify" it
toward a standard colour space. Plan §3b has the full table.

**`hsvToRgb` and `hsvToRyb` are behaviourally identical** (common.js:60, :76) —
both plain HSV→RGB. The RYB interpretation happens entirely in the shader. This
looks like a bug and is not. Comment it; do not "fix" it.

**Hue maps onto RYB channels, not RGB.** `0.333` is yellow, `0.667` is blue. An
RGB-minded `0.15` for "yellow" actually paints orange.

**The UI panel silently swallows strokes.** `desiredInteractionMode`
([paint.js:919](../paint.js#L919)) returns `NONE` inside the panel rect and the
stroke deposits nothing — no error. The harness now throws instead. Phase 7
removes the cause.

**Bristles need settling frames after pointer-down** before any cross
`Z_THRESHOLD`. A short scripted stroke without them lays nothing.

**Splatting is alpha-blended**, not additive
([simulator.js:548](../simulator.js#L548)). A denser second stroke *covers* the
first rather than mixing with it — measured ~4:1 displacement toward whichever
pigment lands second, in both orders. This is physically right and constrains
what colour-mixing tests can assert.

## Environment notes

- Playwright chromium was installed this session (`npx playwright install
  chromium`). Headless uses SwiftShader, so hashes are **not** comparable to a
  real GPU's — they are a local regression tripwire only.
- Device verification stays manual: `docs/DEVICE-VERIFICATION.md`. The user
  confirmed the WebGL 2 dual path works on their Samsung A56 and tablet.
- A dev server was running on `192.168.1.224:8099` for device testing.

## Open items

- Plan header says branch `webgl2_migration`; actual branch is
  `fluid-engine-v1`.
- `docs/image.png` is untracked and not from this work.
- Phase 2 (device-pixel-ratio) is the one phase expected to move hashes on
  purpose. Re-record then, and say in the commit which moved and why.
  Re-recording to silence an unexplained drift defeats the baseline.
