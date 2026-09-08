1. model tilecraft json D:\work\js-games\ua-dream\docs\spec\story-model-spec-min-render.json
tilcraft has player feature
player connected to fluid paint api and redraw with real time fluid paint simulation vector image to 

fluid-paint\docs\bug-reports\non-random-wristles-brush-hits.png

---

# Notes on use case 1 — tilecraft player redrawing vector art with fluid paint

Written 2026-09-07 alongside the Phase 7 handoff. This records what the engine
can already do for this use case and what is genuinely missing, so the gap is a
decision rather than a surprise mid-implementation.

## What now works

`FluidEngine` exposes the stroke primitives publicly, and the Tilecraft adapter
uses only those named methods; it never reaches into engine internals:

| Method | Meaning |
|---|---|
| `beginStroke({...})` | press and begin one named stroke |
| `strokeTo({x, y, pressure})` | extend the current stroke |
| `endStroke()` | lift and flush the endpoint |

`fluid-engine/tilecraft-stroke-player.js` is the use-case adapter. It walks all
visible `polyline` layers first (one `g` group per path, splitting at `b`, frame
or colour changes and closing `gz` paths), then walks visible `polygon` layers
as individual spots. Polylines select spatial `timing: 'replay'`; spots select
`timing: 'live'` so each is an immediate sub-tick tap rather than ten settle
frames. Neither route calls `advance()` during this synchronous import.

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

## Legacy low-level rules (not used by the adapter)

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
   and protected (plan §3b). A Tilecraft hex colour is display RGB, so the
   adapter numerically inverts the engine's RYB display cube at the boundary.
   Handing RGB straight in produces plausible-looking wrong mixing.

## Calling it

```js
const player = new TilecraftStrokePlayer(engine);
player.replay(story, {
  paintingRectangle,
  resolutionScale: 1,
  // Same `cw`/`ch` input used by Tilecraft polyline-lcr.js.
  canvasSize: { width: paintingRectangle.width, height: paintingRectangle.height },
  // Uniform source-to-target scale used by mapPoint; keeps width in step with XY.
  coordinateScale: 1,
  mapPoint: (tile) => ({ x: tile.x, y: tile.y }),
});
```

`mapPoint` is deliberately supplied by the host because the schema promises
canvas coordinates but does not prescribe the target FluidEngine rectangle or
its coordinate orientation. The adapter converts Tilecraft `#RRGGBB[A]` from
display RGB into the nearest RYB load of the engine's pigment cube before
passing the required `color: { space: 'pigment', ... }` payload. Some saturated
RGB colours lie outside that subtractive cube, so “nearest” is intentional.
For polylines the fixed Stroke API brush size includes Tilecraft's
`distance(first,last) / gd` group correction (when `gd` is present), responsive
`min(1, max(canvasSize)/3000)` factor, and `coordinateScale`; `s` remains
normalized pressure. For polygon spots, each tile's full scaled size becomes
its brush size.

## Live fixture demo

With the development server running, open `/?story=1`. The main app fetches
`docs/story-2026-09-08-4-frames.json`, fits its selected frame — or the union
of all four frames when none is selected — into the current painting rectangle,
clears the canvas and feeds the resulting live stroke input to the app RAF. The
result is visible fluid simulation, not an instant import; reloading the URL
restarts the story. `?story=1` uses eight browser frames per model point for
the large fixture (8× the one-frame baseline). Override it with
`?story=1&storyFramesPerStep=N`; the older `storySpeed=N` remains an alias.
