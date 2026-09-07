# Golden images — the refactor safety net

Phase 0 of `FLUID-ENGINE-EXTRACTION-PLAN.md`. This is what makes "the refactor
changed nothing" a checkable claim instead of a matter of opinion.

## Running it

```
npm run test:golden          verify against the baseline (non-zero exit on drift)
npm run test:golden:record   re-record the baseline
npm run test:golden:dist     verify the production bundle in dist/
```

In the browser, directly:

```
index.html?seed=20260907&golden=basic
index.html?seed=20260907&golden=all&webgl=1
```

Results land on `window.__goldenResults`.

## What it checks

Three scenarios, each run on both the WebGL 2 and WebGL 1 paths — six checks.

| Scenario | What it exercises |
|---|---|
| `basic` | single diagonal stroke — bristle dynamics, splatting, advection |
| `colorMix` | yellow over blue — the RYB cube's Y+B corner (plan §3b) |
| `wetBlend` | three overlapping strokes — the fluid solver under load |

**Two hashes per run, deliberately kept apart:**

- `paintHash` — the simulator's paint texture, raw RYB. Simulation state,
  independent of how it is rendered.
- `screenHash` — the composited canvas, after `rybToRgb()` and lighting. What
  the eye actually sees.

Which hash moves says *where* a regression is:

| paint | screen | Meaning |
|---|---|---|
| moved | moved | the simulation changed |
| unchanged | moved | rendering or the colour model changed |
| moved | unchanged | almost certainly a bug in the harness |

## Determinism

The simulation is deterministic once `Math.random` is pinned:

- `DELTA_TIME` is a fixed `1/60` (simulator.js:680) — never a wall-clock delta.
- The bristle `randoms` texture is filled once in the Brush constructor
  (brush.js:108), not per frame.

`debug/deterministic-rng.js` installs a seeded mulberry32 when `?seed=` is
present, and is inert otherwise. Verified: repeated runs of the same scenario
produce byte-identical hashes on both WebGL paths.

## The harness was tested by breaking things

A test that has never failed proves nothing. Both classes of regression were
deliberately introduced and confirmed caught:

| Sabotage | Result |
|---|---|
| `rybToRgb` forced to the RGB fallback | 6/6 caught, `screen` only — correctly identified as a rendering change |
| `DELTA_TIME` changed to `1/61` | 6/6 caught, `paint` **and** `screen` — correctly identified as a simulation change |

## Honest limit of the green assertion

`colorMix` carries an explicit assertion that yellow-over-blue renders green.
**It is not the tripwire, and it must not be trusted alone.**

Sabotaging `rybToRgb` and re-running showed the assertion *passing* while
`screenHash` moved. At the paint density this scenario can actually reach, the
two colour models are too similar for a threshold to separate them — and the
density cannot simply be raised, because splatting blends with
`SRC_ALPHA/ONE_MINUS_SRC_ALPHA` (simulator.js:548), so a denser second stroke
covers the first rather than mixing with it. The overlap gets *weaker*, not
stronger.

What the assertion is for: when `screenHash` moves, it explains in words what
changed about the colour — "B collapsed: the ultramarine blue corner is gone" is
a better starting point than a changed hex string. Keep it; do not rely on it.

## What the hashes are and are not

Headless Chromium renders through SwiftShader, so these hashes are stable for a
given Playwright version but are **not** comparable to a real GPU's. The
baseline is a regression tripwire for refactors on this machine.

Device verification stays manual — see `DEVICE-VERIFICATION.md`. Gesture
behaviour in particular cannot be checked this way at all, which is why Phase 6
requires a physical retest.

## Traps discovered while building this

Both cost real debugging time and are now guarded in code:

1. **The UI panel silently swallows strokes.** `desiredInteractionMode`
   (paint.js:919) returns `NONE` for any pointer-down inside the panel rect, and
   the stroke deposits nothing at all — no error, just an empty canvas. The
   harness now throws with a clear message instead. Phase 7 removes the cause by
   moving chrome to DOM.

2. **Hue maps straight onto RYB channels**, not RGB. `hsvToRyb` (common.js:76)
   means `0.333` is yellow and `0.667` is blue; an RGB-minded `0.15` for
   "yellow" actually paints orange. Documented at the scenario definitions.

3. **Bristles need settling frames after pointer-down.** They are placed by
   `Brush.initialize` but must fall before any cross `Z_THRESHOLD` and deposit
   paint. A short stroke without those frames lays nothing.

## Files

| File | Role |
|---|---|
| `debug/deterministic-rng.js` | seeded `Math.random`, `?seed=` |
| `debug/golden-harness.js` | in-page: scripted strokes, readback, hashing, assertions |
| `debug/golden-run.js` | Node: serves, drives headless Chromium, compares |
| `debug/golden-baseline.json` | the recorded hashes |

Both in-page files ship in the production bundle and are inert without their URL
parameters. `npm run test:golden:dist` confirms the bundle produces identical
hashes to the sources — minification changes nothing.

## When a hash legitimately changes

Phase 2 (device-pixel-ratio) is the one phase expected to move hashes on
purpose. Re-record with `npm run test:golden:record`, and state in the commit
message which hashes moved and why. Re-recording to silence an unexplained drift
defeats the purpose of having a baseline.
