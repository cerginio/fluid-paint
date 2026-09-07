1. model tilecraft json D:\work\js-games\ua-dream\docs\spec\story-model-spec-min-render.json
tilcraft has player feature
player connected to fluid paint api and redraw with real time fluid paint simulation vector image to 

fluid-paint\docs\bug-reports\non-random-wristles-brush-hits.png

---

# Notes on use case 1 — tilecraft player redrawing vector art with fluid paint

Written 2026-09-07 alongside the Phase 7 handoff. This records what the engine
can already do for this use case and what is genuinely missing, so the gap is a
decision rather than a surprise mid-implementation.

## What already works

`FluidEngine` exposes the stroke primitives publicly, and they do not need DOM
events:

| Method | Meaning |
|---|---|
| `initializeBrush(x, y, height, scale)` | place the brush and settle the bristles — "press" |
| `positionBrush(x, y, height, scale)` | move without depositing — advances bristle physics |
| `splat(paintingRect, {zThreshold, color, radius, velocityScale})` | deposit where bristles cross the painting |
| `frame()` | advance the fluid one step |

A stroke from A to B is: `initializeBrush(A)` -> settle frames -> per step
`positionBrush(p)` + `splat(...)` + `frame()`. `debug/golden-harness.js` already
drives scripted strokes this way, which is the evidence it works.

## Mapping the tilecraft model onto it

The model (`story-model-spec-min-render.json`) is a better fit than a generic
path, because it already carries stroke structure:

| Tile field | Meaning in the model | Use for painting |
|---|---|---|
| `g` | group id, "tiles that form a logical stroke/path" | one group = one stroke |
| `b` | polyline break marker | lift the brush, re-press: a new sub-stroke |
| `gz` | close-group flag, like SVG close | return to the group's first tile |
| `s` | relative size, "or stylus pressure if applicable" | the `height` argument |
| `c` | hex colour | convert to HSVA, then `hsvToRyb` at the boundary |
| `x`, `y` | position | painting-space coordinates |

`layer.gridSize` and `layer.scale` decide how model units map to painting
pixels; `frame.points` gives the four corners if the content is inside a
transformable frame.

## The three rules a caller must not get wrong

These are load-bearing, and each was learned from a real bug in an earlier phase:

1. **Settle after a press.** `initializeBrush()` places the bristles; they must
   fall before any crosses `Z_THRESHOLD` and deposits. The golden harness
   settles 10 frames. Painting immediately after the press lays nothing at all,
   silently.
2. **Point spacing IS the stroke dynamics.** `Brush.update()` derives bristle
   speed from the delta it is handed, not from elapsed time. Feeding A then B
   paints differently from feeding 20 interpolated points between them. In Phase
   6 a one-frame-stale position changed deposition by ~2% and read as noise.
3. **Colour must reach the simulator as RYB.** The pigment model is subtractive
   and protected (plan §3b). Hex -> RGB -> HSVA -> `hsvToRyb`, at the boundary.
   Handing RGB straight in produces plausible-looking wrong mixing.

## What is missing: a named stroke API

Nothing above is blocked, but every caller has to re-derive the three rules, and
getting them wrong is invisible rather than loud. The missing piece is a small
surface on the engine:

```
beginStroke({x, y, pressure, color})   // press + settle, internally
strokeTo({x, y, pressure})             // interpolate at the engine's own spacing
endStroke()                            // lift
```

with the settling frame count and the point interpolation owned by the engine,
where they can be verified once, rather than by each host.

This belongs with **Phase 9 ("prove reuse")**, whose stated purpose is that a
second host needing something the API does not offer is a finding about the API
rather than a licence to reach past it. This is that finding, recorded before
the second host exists.

**Do not** implement it by exposing `engine.simulator` or `engine.brush` to the
player. The Phase 5 rule stands: add methods, never an escape hatch.
