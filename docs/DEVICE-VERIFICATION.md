# Verifying the fix on a real device

## Results log

| Date | Device | Phase checked | Result |
|---|---|---|---|
| earlier | Samsung A56 | WebGL 2 dual path | good |
| earlier | tablet | WebGL 2 dual path | good |
| 2026-09-07 | Samsung A56 | Phase 2 (DPR + Viewport) | **good** |
| 2026-09-07 | Samsung Galaxy Tab S9 | Phase 2 (DPR + Viewport) | **good** |
| 2026-09-07 | iPhone 14 | Phase 2 (DPR + Viewport) | **FAILS — canvas stays white** |

**iPhone 14, 2026-09-07.** Brush moves correctly, bristles orient correctly,
the debug view shows them touching the canvas — and the canvas stays white and
clean, with no error. Physics runs; the splat deposits nothing.

Leading hypothesis: `EXT_float_blend`. `Simulator.splat()` alpha-blends into
`paintTexture`, which is the one resolution-sized target that is always
`gl.FLOAT` with no half-float fallback, and the app neither requests nor checks
that extension. `hasFloatTextureSupport()` does not cover it — renderable is
not the same question as blendable.

**To settle it, open `?diag=1` on the device** and read the two rows
`EXT_float_blend` and `blend into FLOAT target`. The second actually performs
the blend and expects 0.5; it is sabotage-verified, so a pass means something.
Full analysis and the fix options are in `HANDOFF.md`.


The capability-clamp harness reproduces the bug and confirms the fix on a desktop,
but the physical device is ground truth. This is how to check it.

## 1. Serve the project on your LAN

From the project root:

```powershell
python -m http.server 8099 --bind 0.0.0.0
```

`--bind 0.0.0.0` matters — the default binds to localhost only and the phone
cannot reach it.

Desktop LAN address (re-check if your network changed):

```
192.168.1.224
```

Allow it through the firewall once, if Windows prompts:

```powershell
New-NetFirewallRule -DisplayName "fluid-paint dev" -Direction Inbound `
  -LocalPort 8099 -Protocol TCP -Action Allow -Profile Private
```

## 2. Open it on the phone

Phone on the **same Wi-Fi**, then browse to:

```
http://192.168.1.224:8099/index.html?diag=1
```

`?diag=1` paints an on-screen diagnostic panel — you do not need a desktop
console to read the result.

## 3. What to look for

The diagnostic panel reports:

| Line | Expected on a Samsung A56 | Meaning |
|---|---|---|
| context | **WebGL 2** expected | The A56 supports it. `?webgl=1` forces the WebGL 1 fallback if you want to compare. |
| `EXT_color_buffer_float` (WebGL 2)<br>`OES_texture_float` (WebGL 1) | **true** | Renderable float textures. The panel shows whichever one applies to the active path. If false, the device cannot run the simulation. |
| `OES_texture_float_linear` | **false** | Confirms the device is in the affected class. |
| `hasFloatTextureSupport()` | **true** | The relaxed gate now lets it boot. Was false before the fix. |
| `FLOAT + NEAREST round-trip` | **PASS** | The path the app now uses. **This is the one that must pass.** |
| `FLOAT + LINEAR round-trip` | FAIL, all-zero | Expected and harmless — nothing samples this way any more. It is the bug, demonstrated. |

Then **draw a stroke across the middle of the canvas**. Success is:

- paint appears **under your finger**, anywhere on the canvas
- individual bristles are visible in the stroke
- the brush preview (top-right) shows bristles hanging **down and orthogonal**
  to the canvas, not collapsed into a point

Failure signatures, and what each means:

| Symptom | Diagnosis |
|---|---|
| Paint only at the bottom-left corner | Bristles still collapsing — some float texture is still LINEAR. Load `?audit=1` and check the console for remaining `FLOAT + LINEAR` creations. |
| Nothing paints anywhere | Brush is off-canvas or the splat quad is degenerate. Check whether `FLOAT + NEAREST` passes. |
| "does not support WebGL floating point textures" | `OES_texture_float` absent or float rendering unsupported. This device needs the half-float tier (§5.3 of the spec), which is not implemented. |
| Beaded / dotted strokes rather than smooth | `u_verticesPerBristle` is not reaching the splat shaders, so `sampleBristle()` degenerates. |

## 4. Optional: USB instead of Wi-Fi

If you install Android platform-tools, USB avoids firewall and Wi-Fi issues
entirely and gives you a real console via `chrome://inspect`:

```powershell
adb devices                 # confirm the phone is listed and authorized
adb reverse tcp:8099 tcp:8099
```

Then on the phone open `http://localhost:8099/index.html?diag=1`, and on the
desktop open `chrome://inspect` to see the phone's console.

## 4b. Check both paths

Worth doing once, since the app now has two rendering backends:

```
http://192.168.1.224:8099/index.html?diag=1              WebGL 2 (default)
http://192.168.1.224:8099/index.html?diag=1&webgl=1      WebGL 1 fallback
```

Both should paint identically. If WebGL 2 misbehaves but `?webgl=1` is fine, the
problem is in the ES 3.00 translation (see docs/WEBGL2-DUAL-PATH.md), not in the
filtering fix.

## 5. Report back

Whatever the outcome, the useful artifact is the diagnostic panel plus a photo
or screenshot of a stroke attempt. If the round-trip line says
`FLOAT + NEAREST: PASS` and paint still misbehaves, the remaining problem is
**not** the filtering bug and needs separate diagnosis.
