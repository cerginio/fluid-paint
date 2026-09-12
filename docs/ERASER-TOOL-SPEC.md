# Eraser tool specification

Status: proposed implementation specification.

## Product contract

The eraser is a second painting tool, not a white-brush preset.

- It deposits an opaque, visually white circular stroke with a soft edge.
- Its diameter is the current `brushScale`; both existing size sliders and the
  non-modified mouse wheel continue to control that one value.  Switching
  between Brush and Eraser does not restore a separate size.
- The brush colour, opacity, bristle count, and fluidity do not affect it.
- A press creates one round dab.  Dragging creates a continuous swept stroke
  with no gaps.  Pen pressure does not change the eraser diameter in v1.
- One eraser gesture is one history operation: undo restores the exact paint
  state before pointer-down; redo reapplies it.
- The tool is available only while manual painting owns the canvas.  It yields
  Story playback through the same `yieldToManualInput()` path used by Brush.
- Right-click panel behaviour, Space-to-pan, resize-edge hit testing, two-finger
  pan, pinch zoom, pointer cancellation, and export retain their present
  semantics.

`plain white` means an opaque white paint result, not transparent deletion.
With a PNG background installed, the erased area must still render white rather
than revealing the background image.  This is deliberately different from a
future “clear to background” tool.

## UI and cursor

Add a mutually-exclusive `Brush` / `Eraser` control in the expanded tool panel.
The supplied SVG is the Eraser button icon.  Preserve its paths, use
`fill="currentColor"` rather than its hard-coded navy fill, and set the button
name/title to `Eraser`.  The active control exposes `aria-pressed="true"`.

The canvas cursor is hidden while the eraser is usable.  A DOM cursor overlay
shows the *actual footprint*:

- a circle centred at the latest hover/active pointer;
- diameter = `brushScale * viewport.viewScale` in screen pixels, converted to
  CSS pixels with `Viewport.screenLengthToCss()` (add this symmetric helper if
  it does not already exist);
- a 1 CSS-pixel high-contrast outline, with a subtle white interior tint; and
- hidden over panel chrome, during Story ownership, while panning/resizing,
  and when the pointer has not entered the canvas.

The circle follows zoom because brush coordinates are world coordinates.  It
may extend past the canvas/painting rectangle visually, but stamping is clipped
to the paint texture; do not let its DOM element intercept pointers.

Do **not** use the supplied eraser SVG as the cursor footprint: an angled
eraser silhouette does not communicate the round area that will be changed.
Do **not** render the cursor in a shader: it is UI that needs to remain crisp,
can sit above the canvas, and has no reason to trigger a framebuffer draw.

### Overlay structure

`FocusOverlay` is not reusable as-is.  It is a short-lived, fixed-size marker
owned by `Viewport.getFocusIndicator()`; the eraser cursor is persistent,
pointer-owned, and size-aware.  Avoid an inheritance hierarchy for these two
cases.  Extract only the two shared DOM-placement concerns into a small,
stateless `CanvasOverlay` helper (root selection, screen-to-CSS conversion, and
canvas/root offset).  Keep `FocusOverlay` as its existing icon client and add
an `EraserCursorOverlay` client with `draw({ screenX, screenY, diameterScreen
})` and `hide()`.  This shares coordinate correctness without coupling their
lifecycles or visuals.

## Rendering and engine API

The ordinary stroke pipeline cannot implement this feature.  Its `splat.frag`
is made from moving bristles, blends pigment, injects velocity, and is then
advected; choosing `_strokeColor()` white would yield a bristled, fluid white
brush rather than a controlled circular eraser.

Add a dedicated engine operation, e.g.:

```js
engine.eraseStroke({ x, y, brushSize, paintingRectangle, timing: 'live' })
engine.eraseTo({ x, y })
engine.endEraseStroke()
```

It must be mutually exclusive with `strokeActive`; preferably generalise the
engine's private active-operation state so paint and erase share the same
`begin`/`to`/`end` guard and error handling.  The public Brush APIs and
Tilecraft replay contract must remain unchanged.

Implement erasing as a ping-pong compositor in `Simulator`, not as blending
into the sampled texture in place:

1. Add `shaders/erase.frag`, using the existing fullscreen vertex shader.
2. Each operation draws from `paintTexture` to `paintTextureTemp`, then swaps
   them.  It receives the prior and current centres in simulation UV space,
   the radius in simulation texels/UV, and a fixed feather width.
3. The fragment shader computes distance to the swept line segment.  Its mask
   is `1 - smoothstep(radius - feather, radius, distance)`.  This guarantees a
   filled circle for a tap and a gap-free capsule for movement.
4. For mask `m`, mix the prior material toward the canonical opaque-white
   material: zero pigment (`rgb = 0`, which the renderer maps to white) and
   an opaque/covered height value.  The chosen white material must cover a PNG
   background; zero alpha would look white without a background but would
   reveal one.  Store the white-material constants in one engine location and
   make the renderer's background composition treat that state as opaque
   white without introducing a visible raised ridge at the feather boundary.
5. Do not write velocity and do not append an eraser area to `splatAreas`.
   Erasing is an immediate edit; existing wet paint outside the mask may keep
   simulating normally, but the erased white mark itself must not smear.

The fourth item needs an explicit representation rather than overloading the
current alpha/height channel blindly: alpha currently drives both surface
normal and opacity over a background.  Recommended implementation: add a
small, dedicated “paper/opaque-white” mask texture owned alongside
`paintTexture`, erased with the same pass and included in snapshots, resize,
clear, restore, rendering, and export.  The renderer composites this mask over
the background as white while its normal derives from the wet-paint texture,
so an eraser produces a flat white patch.  This is a new shader path, but it
is the smallest one that satisfies both `plain white` and PNG-background
semantics without corrupting fluid data.

The erase operation must clamp its affected rectangle to the simulation bounds
before setting the viewport/scissor.  Convert world brush size through the
same `paintingRectangle -> simulation` mapping that `Simulator.splat()` uses;
never use CSS pixels in the engine.

## Host integration

In `paint.js`:

- Store `activeTool: 'brush' | 'eraser'`, defaulting to Brush.
- On a paintable pointer-down, snapshot once, then dispatch to the selected
  engine begin method.  Pan/resize branches stay before tool dispatch.
- Route live pointer synchronisation, pan updates, and pointer-up endpoint
  flushing to the corresponding operation.  `engine.advance()` remains the
  Brush-only simulation clock; it must not emit brush splats during an eraser
  operation.
- Update `needsRedraw` after each erase edit and display the eraser overlay
  from the latest pointer state only when `activeTool === 'eraser'`.
- Keep colour controls enabled.  They retain the next Brush colour and are not
  changed by entering or leaving Eraser mode.

Add the SVG to the DOM button, tool-specific CSS (including visible keyboard
focus and selected state), and include any new JS module/shader in
`gulpfile.js` / `FluidEngine.SHADER_FILES` so source and `dist` load the same
assets.

## Acceptance checks

1. At DPR 1 and DPR 2, set the size to 50, hover at view scale 1, and verify a
   50-screen-pixel cursor diameter.  At 2x view zoom it is 100 screen pixels;
   at 0.5x it is 25.
2. Adjust either size slider and the wheel while Eraser is selected.  Both
   sliders and the cursor update immediately; returning to Brush preserves the
   same value.
3. A click and a slow/fast 300-pixel drag make solid circular/capsule white
   marks with one consistent soft boundary and no bristle texture, gaps,
   colour dependence, or fluid drift.
4. Place the same test over an imported PNG: it remains flat white, not
   transparent/background-coloured.  Exported PNG matches the screen.
5. Undo/redo after one and after several eraser gestures reproduce raw paint
   state and the opaque-white mask exactly.  Clear, resize, quality change,
   snapshot restore, and background replacement leave no stale mask texels.
6. Two-finger gesture or pointer cancellation terminates the operation once;
   no active engine operation remains and no delayed brush splat appears.
7. Run `npm run lint:shaders`, `npm run test:timing`, `npm run test:live-gpu`,
   relevant browser UI checks, and new deterministic GPU checks for dab,
   sweep, background opacity, undo/redo, and DPR/zoom cursor geometry.
