# View zoom and mobile layout specification

Status: implemented; physical-device verification pending

## Problem statement

The painting currently has one rectangle (`Paint.paintingRectangle`) serving
two different jobs:

1. the persistent dimensions of the simulated painting; and
2. the rectangle through which the painting is presented on screen.

`Paint.onGesturePinch()` changes that rectangle and commits the change through
`FluidEngine.resizePainting()`. A gesture users understand as view zoom can
therefore resample or crop persistent paint. View zoom must never mutate the
simulation, history, export dimensions, or painting rectangle.

The supplied phone captures also expose layout rules that depend on CSS
viewport width alone. Android's "Desktop site" mode can change the layout
viewport and page scale without changing the fact that the device has a coarse
touch pointer. The UI consequently has to identify compact touch layout by
capability as well as by width.

## Observed failures

- The initial painting/backing store can become unnecessarily large on a high
  DPR phone, especially when browser desktop mode changes viewport scaling.
- The text-sized `Brush preview` toggle covers the compact panel's hue/preview
  control.
- The `Texture probe` toggle is offset by the probe's assumed 256 px height, so
  it floats in the middle of the painting while the probe is disabled.
- The expanded panel reaches beyond the visual mobile viewport. Users must
  scroll the panel to discover Undo/Redo, and browser chrome changes can leave
  its bottom inaccessible.
- Debug controls have a higher stacking level than the tool panel and can
  intercept touches over it.

## View zoom model

### Coordinate spaces

`Viewport` owns an affine view transform in addition to DPR:

- world/painting space: stable coordinates used by `FluidEngine`, snapshots,
  resizing, brush size, and export;
- screen space: canvas backing-store pixels used by WebGL presentation;
- CSS space: pointer/layout pixels.

The view transform is:

```
screen = world * viewScale + viewOffset
world  = (screen - viewOffset) / viewScale
```

Required API:

- `worldToScreen(x, y)` / `screenToWorld(x, y)`;
- `worldDeltaToScreen(dx, dy)` / `screenDeltaToWorld(dx, dy)`;
- `worldRectToScreen(rect)`;
- `panViewBy(dx, dy)`;
- `zoomViewAt(screenX, screenY, nextScale)` preserves the world point under
  the gesture centroid above 1:1; at or below 1:1 it centers the complete
  canvas so offsets accumulated while zoomed in cannot strand it off-screen;
- scale clamp: `0.25 <= viewScale <= 8`.

### Input contract

- Pointer CSS coordinates are converted to backing-store screen coordinates,
  then inverse-transformed to world coordinates before painting/hit-testing.
- Two-finger pan changes only `viewOffset`.
- Pinch changes only `viewScale`; it must not enter `InteractionMode.RESIZING`,
  save an undo snapshot, or call `resizePainting()`.
- Pinch is based on the total span relative to `pinchStartSpan`, and on the
  view scale captured at gesture start, so RAF batching cannot compound scale.
- Mouse wheel continues to set brush size. `Ctrl+wheel` / `Meta+wheel` zooms
  about the cursor, covering trackpad pinch on desktop browsers.
- Returning to 1:1 clears presentation pan offsets. Below 1:1, equal margins
  keep the scaled canvas centered in the viewport.
- Explicit edge/corner dragging remains the only destructive canvas resize.

### Rendering contract

- `paintingRectangle` stays in world space.
- `PaintingRenderer.renderToTexture()` receives a derived display rectangle
  (`worldRectToScreen(paintingRectangle)`).
- Clipping, painting shadow, and outline use that display rectangle.
- The bristle preview projection includes the same view transform.
- Zoom allocates no simulation textures and does not change simulation
  resolution, history, or saved PNG dimensions.

## Responsive layout contract

- The app is bounded by the dynamic viewport (`100dvh`, with `100%` fallback).
- Compact touch rules match either a narrow viewport or a coarse, non-hovering
  primary pointer. They therefore remain active when "Desktop site" changes
  CSS viewport width.
- A coarse phone reporting a desktop-width layout viewport scales fixed-size
  controls with viewport units, keeping their physical size comparable to
  normal mobile mode after the browser's page scale is applied.
- Coarse touch layout publishes a DPR cap of 1 for the canvas backing store;
  this prevents browser desktop-mode page scaling from multiplying simulation
  area. An explicit `?dpr=` URL remains an uncapped diagnostic override.
- The expanded panel is at most the dynamic viewport height minus safe edge
  gaps; `#panel-body` is the only scrolling region and has `min-height: 0`.
- Compact-height rules reduce spacing and picker size before relying on scroll.
- The panel stacking level is above every debug surface.
- Debug toggles are square icon buttons with accessible labels:
  brush icon for brush preview, bug icon for texture probe.
- On compact touch layouts debug toggles form a bottom-right stack. The texture
  probe toggle is fixed to the bottom-right edge even while the probe is off.

## Floating panel behavior

- The drag coordinate is the compact header, not the outer panel rectangle.
  Reflowing the body must therefore never move the header away from the finger.
- When the header center is in the upper viewport half, the body opens below
  it. In the lower half, the body opens above it.
- The body is capped below half of the dynamic viewport and owns its scrolling.
- On phones the expanded body uses two columns. The left column starts with
  brush sliders and history; Clear, Save, and Quality form its bottom group.
  The right column starts with the iro color wheel. Directly beneath the wheel
  (before its value and alpha sliders), a compact readout shows the selected
  pigment as `#RRGGBB`, provides an icon button that copies that value, and
  identifies the active model as `RYB` or `RGB`; the Natural/Digital selector
  follows the complete picker. The HEX field is constrained to its seven-character
  value rather than taking the remaining row width. There is no redundant
  "Paint Color" label. Compact spacing should make scrolling a fallback,
  never the only way to discover the palette.
- An optional extension shell contains two initial tabs, File and Player, plus
  controls in both the base header and extension header to show/hide it.
- The extension chooses an adjacent side with enough room. If neither side can
  fit (typical phone portrait), it overlays the base panel instead of extending
  beyond the viewport.
- The base panel remains the painting UX. File/project and player/timeline
  features belong in the extension and are placeholders until their action
  contracts are specified.

## Acceptance criteria

1. Pinching in and out changes presentation only; paint hashes, simulation
   dimensions, snapshot index, and export dimensions stay unchanged.
2. Above 1:1, a point beneath the pinch centroid remains beneath it within one
   backing pixel throughout zoom.
3. Painting at 1x, zooming, then painting at the same document point deposits
   into the same simulation texels.
4. Two-finger translation pans without resizing; a combined pan/pinch performs
   both view operations without changing the painting rectangle.
5. Zooming out from a panned enlargement to 1:1 restores zero view offsets;
   zoom levels below 1:1 keep the canvas centered.
6. Normal mobile mode and Android "Desktop site" show the same compact UI
   proportions and control placement.
7. At 360x640, 412x915, and landscape 915x412, the panel bar remains reachable,
   the body can reach every control, and no page-level vertical overflow exists.
8. The brush-preview button never covers the compact bar. The texture-probe
   button touches the bottom/right safe gap rather than reserving 256 px for an
   absent probe.
9. A panel overlapping a debug control receives the pointer event.
10. Existing color, timing, shader lint, and build checks remain valid.
11. Dragging the header across the viewport midpoint flips the body without
    changing the header's screen coordinate by more than one pixel.
12. The extension can open, close, and switch File/Player tabs; its rectangle
    remains inside the viewport or deliberately overlays the base panel when
    no adjacent side fits.
13. Changing the picker updates the HEX readout; changing Natural/Digital
    updates the readout and its RYB/RGB label; the copy icon writes the visible
    HEX value to the clipboard.
