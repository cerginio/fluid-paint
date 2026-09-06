# Verifying the fix on a real device

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
| `OES_texture_float` | **true** | Float textures usable at all. If false, the device cannot run the simulation. |
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

## 5. Report back

Whatever the outcome, the useful artifact is the diagnostic panel plus a photo
or screenshot of a stroke attempt. If the round-trip line says
`FLOAT + NEAREST: PASS` and paint still misbehaves, the remaining problem is
**not** the filtering bug and needs separate diagnosis.
