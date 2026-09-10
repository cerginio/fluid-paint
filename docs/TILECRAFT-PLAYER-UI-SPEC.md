# Tilecraft File & Player UI Specification

Status: core implementation shipped; telemetry and roadmap items remain  
Scope: local Story Model import and visible Fluid Paint playback controls  
Target shell: `#panel-extension` with the existing **File** and **Player** tabs  
Primary runtime: `TilecraftStrokePlayer` + the existing `Paint` RAF loop

## 1. Product goal

Let a user load a local Tilecraft Story Model JSON file, verify what will be
painted, configure playback, watch it render through Fluid Paint, pause or stop
it safely, and decide whether to keep or discard the result.

The experience must work without URL parameters or DevTools. URL-driven
`?story=1&storySpeed=8` remains a deterministic debug path, not the primary UI.

The two tabs answer different questions:

- **File:** “What content am I going to paint?”
- **Player:** “How and when is that content being painted?”

Do not mix brush controls into this extension. Fluidity, bristles, brush size,
colour and quality remain in the main Paint panel. The Story Model supplies its
own stroke colour and size data during playback.

## 2. Existing foundation

The current application already has:

- an extension shell opened with `#panel-extension-toggle`;
- accessible File/Player tab buttons;
- adjacent-left, adjacent-right and overlay placement logic in `ToolPanel`;
- `TilecraftStrokePlayer.replay()` for synchronous deterministic rendering;
- `TilecraftStrokePlayer.play()` for visible live playback;
- slow playback through `framesPerStep`;
- fast playback through `ticksPerFrame` and the host's synthetic clock;
- `onPaint`, `waitFrame`, `advanceTick` and `resetAdvanceClock` hooks;
- snapshots and restore primitives on `FluidEngine`;
- an existing app RAF loop that can present story changes.

The extension is implemented by `StoryToolsUI` and
`StoryPlaybackController`. The current `window.playTilecraftStory()` remains a
thin deterministic adapter around the same controller for the checked-in
fixture and browser/GPU tests.

## 3. UX principles

1. **The loaded file is visible and inspectable before painting starts.**
2. **Playback never silently destroys existing paint.** The chosen canvas
   policy is explicit.
3. **There is only one active stroke owner.** Manual painting and story
   playback cannot run concurrently.
4. **Selected speed and achieved speed are different facts.** The UI may show
   both; it must not claim that a GPU-bound 8× run is actually achieving 8×.
5. **Stop is reversible by default.** The pre-play canvas snapshot is retained
   until the user keeps the result or starts another committed action.
6. **Progress is honest.** It is based on processed drawable model items, not
   RAF count or wall-clock guesses.
7. **The first version is not seekable.** Fluid simulation has no random access;
   moving to an arbitrary point requires restore + deterministic replay.
8. **Errors stay in context.** A file error appears in File; a runtime/GPU error
   appears in Player, with a route back to the source file.

## 4. Information architecture

```text
Additional tools
├── File
│   ├── import/drop zone
│   ├── validation state
│   ├── loaded-file summary
│   ├── content/bounds summary
│   └── replace/remove file actions
└── Player
    ├── current file summary
    ├── playback status
    ├── read-only progress
    ├── primary transport controls
    ├── speed
    ├── canvas result policy
    └── optional diagnostics
```

The shell header and tab navigation stay fixed while the active page scrolls.
The transport row in Player stays sticky at the bottom on short viewports.

## 5. Desktop wireframes

### File — empty

```text
┌────────────────────────────────┐
│ [ File ] [ Player ]          × │
├────────────────────────────────┤
│                                │
│   ┌────────────────────────┐   │
│   │      Upload icon       │   │
│   │ Drop Tilecraft JSON    │   │
│   │ here, or               │   │
│   │ [ Choose file ]        │   │
│   │ .json · max 25 MB      │   │
│   └────────────────────────┘   │
│                                │
│ Local files stay in this       │
│ browser session.               │
└────────────────────────────────┘
```

### File — loaded

```text
┌────────────────────────────────┐
│ [ File ] [ Player • ]        × │
├────────────────────────────────┤
│ ✓ story-september.json         │
│   1.9 MB                       │
│                                │
│ Content                        │
│ 12 layers · 4 frames           │
│ 18,420 points · 936 strokes    │
│ 3 unsupported layers skipped   │
│                                │
│ Bounds                         │
│ 2234 × 1677 source units        │
│ Fit: Contain                   │
│                                │
│ [ Replace file ] [ Remove ]    │
│                                │
│              [ Open Player → ] │
└────────────────────────────────┘
```

### Player — ready

```text
┌────────────────────────────────┐
│ [ File ] [ Player ]          × │
├────────────────────────────────┤
│ story-september.json           │
│ Ready                          │
│                                │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━ 0% │
│ 0 / 18,420 points              │
│                                │
│ Speed                          │
│ [ 0.5× ] [ 1× ] [ 2× ] [ 8× ] │
│                                │
│ Paint onto canvas              │
│ (•) Replace current painting   │
│ ( ) Add over current painting  │
│                                │
│ [ Restart ] [ ▶ Play ] [ Stop ]│
└────────────────────────────────┘
```

### Player — playing

```text
┌────────────────────────────────┐
│ [ File ] [ Player ● ]        × │
├────────────────────────────────┤
│ story-september.json           │
│ Painting · layer Foreground    │
│                                │
│ ━━━━━━━━━━━━━━━╸━━━━━━━━━ 63%  │
│ 11,605 / 18,420 points         │
│ Stroke 574 / 936               │
│                                │
│ Speed          Actual          │
│ 8×             6.4×            │
│                                │
│ Frame 2 / 4 · Group 94 / 936   │
│ [⏮ Frame]          [Frame ⏭]   │
│                                │
│ [ Restart ] [ ❚❚ Pause ] [Stop]│
└────────────────────────────────┘
```

The dot on the Player tab means a file is ready. While playing, it uses the
animated/accent state. Do not use the dot as the only status signal; text and
ARIA live announcements carry the same information.

## 6. Responsive behaviour

### Desktop: viewport width above 1024 px

- extension width: `320px`;
- preferred placement: adjacent to the base panel with an `8px` gap;
- maximum height: `min(680px, calc(100dvh - 24px))`;
- header remains sticky at the top;
- active page scrolls, not the entire `#ui` panel;
- transport row remains sticky at the bottom of Player.

The existing `240px` width is too narrow for file metadata, transport controls
and localized labels. Increase it to 320px while preserving `ToolPanel`'s
left/right placement measurement.

### Tablet: 641–1024 px

- extension width: `300px`;
- prefer the side with enough room;
- otherwise overlay the base panel, aligned to its left or right edge;
- use a scrim only when the extension overlays more than half of the base panel;
- minimum control height: `40px`.

### Phone: at or below 640 px

- render the extension as a bottom sheet, not as a narrow adjacent card;
- position against the visual viewport;
- width: `calc(100vw - 16px)`;
- maximum height: `min(72dvh, 620px)`;
- horizontal inset: `8px`; bottom inset: `8px` plus safe-area;
- border radius: `14px` top corners, `12px` bottom corners;
- drag of the Paint panel must be disabled while a pointer is operating the
  sheet;
- minimum touch target: `44 × 44px`;
- native file chooser remains the only file-system surface.

On phone, opening the extension expands the collapsed Paint panel only as much
as needed to show the extension toggle state. Closing the sheet returns to the
previous collapsed/expanded state rather than always expanding the main panel.

## 7. Visual language

Use the existing panel tokens and frosted dark surface:

```css
--player-surface: var(--panel-bg);
--player-border: var(--panel-border);
--player-text: #fff;
--player-muted: rgba(255, 255, 255, 0.68);
--player-subtle: rgba(255, 255, 255, 0.08);
--player-accent: #75c455;
--player-warning: #f6c53a;
--player-danger: #ef5350;
--player-focus: #68b5ff;
```

- Keep the current 12px card radius and translucent background.
- Use the green accent for loaded/ready/completed states and the primary Play
  action.
- Use blue only for keyboard focus and selected neutral controls.
- Use amber for warnings such as skipped unsupported layers or degraded actual
  speed.
- Use red only for destructive/error semantics, never merely for Stop.
- Avoid icon-only controls except Close. Transport controls include visible
  text at widths above 360px.
- Numbers use tabular numerals so progress and performance values do not jump.
- Animation respects `prefers-reduced-motion`.

## 8. File tab specification

### 8.1 Empty state

Required controls:

- drop target with a visible “Drop Tilecraft JSON here” label;
- native file input activated by **Choose file**;
- accepted extension `.json`;
- stated local size limit;
- privacy note: no automatic upload and no arbitrary remote URL fetch.

Dragging a file over the page highlights only the drop target, not the painting
canvas. Dropping elsewhere must not navigate the browser to the JSON file.

### 8.2 Loading state

Show:

- spinner and “Reading `<filename>`…”;
- file name and human-readable size;
- disabled Replace/Remove/Play actions;
- an `aria-live="polite"` status message.

For files above 5 MB, parsing and preflight analysis should run in a Web Worker
to avoid freezing painting/presentation. The hard default limit is 25 MB and
must be a named host policy constant, not embedded in validation code.

### 8.3 Validation

Validation has two levels.

**Fatal — reject the file:**

- invalid JSON;
- root is not an object;
- missing or non-array `layers`;
- no drawable `polyline` or `polygon` tiles;
- non-finite coordinates in every drawable item;
- file exceeds configured byte/tile limits.

**Warning — load but disclose:**

- unsupported shapes such as `circle` are skipped by the current adapter;
- invisible layers are ignored;
- individual malformed tiles are skipped;
- colours outside the subtractive pigment gamut are approximated;
- frame metadata is absent or incomplete;
- source bounds are degenerate on one axis.

Never insert file-controlled strings through `innerHTML`. File names, layer tags
and narrative text are untrusted content and must use `textContent`.

### 8.4 Loaded summary

Show, without expanding a technical dump:

- file name and byte size;
- total and visible layers;
- drawable polyline and polygon counts;
- total drawable points;
- logical stroke/spot count;
- frame count;
- source width × height;
- warning count.

Warnings open a small inline disclosure listing categories and counts, not one
row per malformed point.

Actions:

- **Replace file** opens the chooser and retains the current valid file until a
  replacement passes validation;
- **Remove** unloads the model and resets Player to Empty;
- **Open Player** switches tabs and focuses the primary Play button.

If playback is active, Replace and Remove first invoke the controller's safe
stop flow. They must never orphan an active FluidEngine stroke.

### 8.5 File persistence

Version 1 keeps the parsed model in memory for the current page session. Do not
write a potentially large model to `localStorage`.

Remember only lightweight preferences such as speed and canvas policy. Future
recent-file support should use explicit user consent and IndexedDB/File System
Access handles where available, with a fallback to choosing the file again.

## 9. Player tab specification

### 9.1 Empty state

When no model is loaded:

- show “Load a Tilecraft JSON file to enable playback”;
- show **Choose file** as the primary action;
- disable transport and speed controls;
- clicking Choose file routes through the same File controller, not a second
  hidden input implementation.

### 9.2 Ready state

Show file identity, content totals, progress at zero, speed selector, canvas
policy and a primary **Play** action.

Canvas policy:

- **Replace current painting** — default. Snapshot current paint, clear, play.
- **Add over current painting** — snapshot current paint, do not clear, play.

Both policies create a pre-play snapshot. This makes Stop reversible and makes
Restart deterministic.

### 9.3 Transport controls

Use three visible controls:

| Control | Ready | Playing | Paused | Completed |
|---|---|---|---|---|
| Restart | reset + start | restore baseline + start | restore baseline + start | restore baseline + start |
| Play/Pause | Play | Pause | Resume | Replay |
| Stop | disabled | enabled | enabled | disabled |

Stop opens an inline decision row rather than a blocking browser confirm:

```text
Playback stopped at 63%.
[ Restore previous canvas ]   [ Keep partial result ]
```

Default keyboard focus goes to **Restore previous canvas**. Closing the
extension while playback is active behaves like Pause, not Stop or Keep.

`Escape` closes the extension only when no stop decision is pending. With a
pending decision it selects Restore and returns to Ready.

### 9.4 Speed control

Supported choices:

| Label | Player mapping |
|---:|---|
| `0.25×` | `framesPerStep: 4`, `ticksPerFrame: 1` |
| `0.5×` | `framesPerStep: 2`, `ticksPerFrame: 1` |
| `1×` | `framesPerStep: 1`, `ticksPerFrame: 1` |
| `2×` | `framesPerStep: 1`, `ticksPerFrame: 2` |
| `4×` | `framesPerStep: 1`, `ticksPerFrame: 4` |
| `8×` | `framesPerStep: 1`, `ticksPerFrame: 8` |
| `16×` | `framesPerStep: 1`, `ticksPerFrame: 16` |

Desktop may use a segmented selector for the four most common values and a
More menu for the rest. Phone uses a native/select-style popup to save width.

Changing speed while Paused applies on Resume. Changing it while Playing is a
controller setting update applied through a safe scheduler hand-off: the
current stroke is closed, playback restarts at the current registry-backed
playhead, and already painted operations are not deposited again.

At `2×` and above, show actual achieved speed after enough samples exist. When
actual speed remains below 80% of selected speed for two seconds, show:

> Device limit: currently achieving approximately 6.4×.

Do not silently skip model points to reach the selected multiplier.

### 9.5 Thickness control

Speed and Thickness share one responsive control row. Thickness is an
accessible range input with `min="0.1"`, `max="1.2"`, `step="0.05"` and default
`1`. Its adjacent output displays the current value as a multiplier.

The final size for both polygon spots and polyline segments is
`calculatedBrushSize × brushSizeCorrectionRate × brushSizeMultiplier`, where
the fixed `brushSizeCorrectionRate` is `0.5` and the UI-controlled
`brushSizeMultiplier` defaults to `1`. Changing it while Paused applies on
Resume. Changing it while Playing uses the same safe hand-off as Speed so the
next unpainted operation uses the new thickness without repainting completed
operations.

### 9.6 Progress

The progress bar is display-only in version 1:

```text
processedDrawableItems / totalDrawableItems
```

Display:

- percent;
- processed / total points or spots;
- current stroke / total strokes;
- active layer tag when available;
- current frame identifier when reliably derivable;
- elapsed wall time;
- estimated remaining time only after a stable sample window.

Do not add `role="slider"`, a draggable thumb or click-to-seek. Use
`role="progressbar"` with `aria-valuemin`, `aria-valuemax` and
`aria-valuenow`.

Seeking is a separate feature requiring:

1. cancel current playback;
2. restore the pre-play baseline;
3. reset deterministic RNG/player state;
4. replay from the beginning to the requested model position;
5. resume live scheduling if requested.

Until that is implemented and benchmarked, a seekable-looking control is
misleading.

### 9.7 Navigation across frames

Player provides two boundary-navigation actions:

| Action | Forward behaviour | Backward behaviour |
|---|---|---|
| Previous Frame | — | Jump to the nearest earlier frame that still contains unpainted operations. |
| Next Frame | Skip the unpainted remainder of the current frame and continue at the next frame boundary. | — |

The UI label is **Previous unpainted frame** in accessible names and tooltips.
The compact visible label may remain “⏮ Frame”. This
distinction matters: Back is not canvas rewind.

#### Non-destructive backward rule

Fluid paint is cumulative. Painting an already processed frame a second time
would add more pigment and produce a different image. Therefore:

- backward navigation targets only operations whose paint has not yet been
  deposited;
- already painted portions are never replayed;
- backward navigation does not erase or restore the canvas;
- if no earlier unpainted portion exists, the corresponding Previous control
  is disabled;
- Restart remains the only action that restores the baseline and reconstructs
  the full playback from the beginning.

#### Forward jump rule

When the user jumps forward:

1. close the currently active FluidEngine stroke safely;
2. calculate the half-open operation range being skipped;
3. retain that range as pending in `UnpaintedRangeRegistry`;
4. move the playhead to the requested frame boundary;
5. resume only if the player was Playing before the jump.

If a jump happens in the middle of a polyline group, the already emitted prefix
is marked painted and the unpainted suffix remains pending. Returning to that
suffix begins a new FluidEngine stroke. A small bristle discontinuity at that
resume boundary is accepted in version 1; hiding it by replaying the painted
prefix is forbidden because that would double-deposit pigment.

#### Group identity

A navigable group is not identified by raw `g` alone. IDs can repeat across
layers and frames. Its stable key is:

```text
layerIndex + frameId + tile.g + segmentOrdinal
```

`segmentOrdinal` distinguishes runs split by Tilecraft `b`, frame changes or
colour changes. Ungrouped tiles receive a generated key based on their stable
position in the compiled playback plan.

Polygon spots may be grouped into one navigable group only when they share the
same layer/frame and contiguous source order. Otherwise each spot is an atomic
group. The normalizer, registry and player must use the same grouping result.

#### Frame identity

Frame navigation uses normalized `tile.f`. Operations without a usable `f`
belong to a generated **Unassigned** frame placed after explicitly numbered
frames within their existing execution order.

Frame ordering follows each frame's first appearance in the adapter's render
order, not numeric sorting of IDs. The compiler groups all operations with the
same `f` into one contiguous frame range. Inside that range, original
layer/source order is preserved without colour-based reordering. A polyline
group's first tile still supplies its immutable stroke colour.

#### Coverage rail and playhead

Navigation makes one percentage insufficient. Show two separate values:

- **Painted coverage:** unique painted operations / total drawable operations;
  monotonic and used for completion.
- **Playhead position:** current plan index / total plan length; may move forward
  or backward.

The read-only progress rail visualizes ranges:

```text
painted       pending gap       painted       future
████████████│··········│██████│················
                         ▲ playhead
```

It remains non-interactive. Frame buttons are the only navigation surface
in version 1. The rail uses pattern plus colour so pending gaps remain visible
without relying on colour alone.

When the playhead reaches the end while registry entries remain, state becomes
**Completed with unpainted ranges**, not Completed. Show:

```text
78% painted · 7 unpainted ranges remain
[ Paint earliest remaining ] [ Previous unpainted frame ] [ Keep result ]
```

**Paint earliest remaining** selects the lowest pending plan index and resumes
normal playback. Final Completed is reached only when the registry is empty or
the user explicitly chooses Keep result.

### 9.8 Diagnostics disclosure

Keep business-facing controls simple. Put diagnostics under a collapsed
“Performance” disclosure:

- selected multiplier;
- achieved model ticks/s;
- presentation FPS;
- canvas backing resolution;
- simulation resolution and resolution scale;
- WebGL version and paint texture type;
- cumulative dropped engine seconds;
- skipped malformed/unsupported item counts.
- pending range count and pending operation count;
- current plan index, group key and frame ID.

This section is optional in branded builds but should remain available behind a
debug/product-support flag.

## 10. State model

One `StoryPlaybackController` owns all file and playback state.

```text
EMPTY
  └─ choose/drop ─> LOADING

LOADING
  ├─ valid ──────> READY
  ├─ invalid ────> FILE_ERROR
  └─ replace ────> LOADING

READY
  ├─ play ───────> PLAYING
  ├─ remove ─────> EMPTY
  └─ replace ────> LOADING

PLAYING
  ├─ pause ──────> PAUSED
  ├─ end + registry empty ─> COMPLETED
  ├─ end + pending ranges ─> COMPLETED_WITH_GAPS
  ├─ stop ───────> STOP_DECISION
  └─ failure ────> PLAYER_ERROR

PAUSED
  ├─ resume ─────> PLAYING
  ├─ restart ────> PLAYING
  └─ stop ───────> STOP_DECISION

STOP_DECISION
  ├─ restore ────> READY
  └─ keep ───────> READY

COMPLETED
  ├─ replay ─────> PLAYING
  ├─ keep ───────> READY
  └─ load other ─> LOADING

COMPLETED_WITH_GAPS
  ├─ paint earliest pending ─> PLAYING
  ├─ previous pending frame ─> PAUSED/PLAYING
  └─ keep result ────────────> READY

PLAYER_ERROR
  ├─ restore ────> READY
  ├─ keep partial ─> READY
  └─ inspect file ─> FILE_ERROR/READY
```

State is authoritative. DOM labels and enabled/disabled states are projections
of it; click handlers must not infer playback state from button text.

Suggested public controller surface:

```ts
type StoryPlaybackState =
  | 'empty' | 'loading' | 'file-error' | 'ready'
  | 'playing' | 'paused' | 'stop-decision'
  | 'completed' | 'completed-with-gaps' | 'player-error';

interface StoryPlaybackController {
  readonly state: StoryPlaybackState;
  readonly modelSummary: StoryModelSummary | null;
  readonly progress: StoryProgress;

  loadFile(file: File): Promise<void>;
  removeFile(): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  resume(): void;
  restart(): Promise<void>;
  stop(): Promise<void>;
  previousUnpaintedFrame(): Promise<boolean>;
  nextFrame(): Promise<boolean>;
  playEarliestRemaining(): Promise<boolean>;
  restoreBaseline(): Promise<void>;
  keepResult(): void;
  setSpeed(multiplier: number): Promise<boolean>;
  setThickness(multiplier: number): Promise<boolean>;
  setCanvasPolicy(policy: 'replace' | 'overlay'): void;
  subscribe(listener: (viewModel: StoryPlayerViewModel) => void): () => void;
}
```

Navigation methods return `false` when no valid destination exists. They are
serialized by the controller so rapid repeated taps cannot run overlapping
abort/restart transitions.

## 11. Unpainted range registry

Navigation requires a registry separate from DOM state and separate from
FluidEngine snapshots. Call it `UnpaintedRangeRegistry`.

The player first compiles the model into an immutable linear playback plan.
Every atomic paint operation has a stable integer index and group/frame keys:

```ts
interface PlaybackOperation {
  index: number;
  kind: 'polyline-point' | 'polygon-spot';
  layerIndex: number;
  layerTag?: string;
  frameKey: string;
  groupKey: string;
  sourceTileIndex: number;
  // normalized mapping/colour/size data needed to execute the operation
}

interface PlaybackPlan {
  readonly operations: readonly PlaybackOperation[];
  readonly groupRanges: readonly PlaybackBoundary[];
  readonly frameRanges: readonly PlaybackBoundary[];
}

interface PendingRange {
  start: number;       // inclusive plan index
  end: number;         // exclusive plan index
  reason: 'future' | 'frame-jump' | 'interrupted';
}
```

Registry invariants:

1. At load, the registry contains one pending range `[0, plan.length)`.
2. Successfully deposited operations are removed exactly once.
3. Forward jumps do not remove skipped operations. They split the pending
   interval and tag the range behind the new playhead with the jump reason.
4. Adjacent compatible ranges are merged; empty ranges are deleted.
5. Ranges are always sorted, non-overlapping and half-open.
6. Painted operations can never be reinserted except by full Restart after the
   baseline snapshot is restored.
7. A backward query intersects frame boundaries with pending ranges and
   returns only the pending intersection.
8. Completion is `registry.pendingCount === 0`, not `playhead === plan.length`.

An operation becomes painted only after its corresponding engine work is
acknowledged: the immediate contact created by `beginStroke()` for the first
point/spot, or the simulation tick that consumes a later live `strokeTo()`
target. Merely placing a point into the live mailbox must not remove it from the
registry; cancellation may occur before `advance()` deposits that target.

Suggested API:

```ts
interface UnpaintedRangeRegistry {
  readonly pendingCount: number;
  readonly ranges: readonly PendingRange[];

  reset(planLength: number): void;
  markPainted(start: number, end: number): void;
  markJump(start: number, end: number, reason: PendingRange['reason']): void;
  previousPendingFrame(beforeIndex: number, plan: PlaybackPlan): PendingRange | null;
  nextFrameBoundary(afterIndex: number, plan: PlaybackPlan): number | null;
  earliestPending(): PendingRange | null;
  contains(index: number): boolean;
}
```

`markJump()` records reason metadata but does not change pending coverage; its
purpose is to split/tag the abandoned interval for navigation and diagnostics.

The registry is session memory. It is not persisted into the Story JSON and it
is not a GPU resource. A new file or a full Restart creates a fresh registry.

For debugability, expose a read-only snapshot through the controller, never the
mutable registry instance:

```js
controller.getPendingRanges();
// [{ start: 120, end: 188, reason: 'frame-jump' }, ...]
```

### Registry example

```text
Plan:       [0 ........................................ 999]
Initial:    pending [0, 1000)

Paint 0–99:
            painted [0, 100), pending [100, 1000)

Next Frame jumps from 100 to 300:
            painted [0, 100)
            pending gap [100, 300) reason=frame-jump
            pending future [300, 1000)

Paint 300–449:
            painted [0, 100), [300, 450)
            pending [100, 300), [450, 1000)

Previous unpainted frame:
            target = intersection of prior frame boundary with [100, 300)
            already painted [0, 100) is not replayed
```

## 12. Required player API changes

The current `TilecraftStrokePlayer.play()` cannot fully support this UI. It has
no explicit cancellation contract, no pause state and returns detailed stats
only after completion.

Add these options without putting DOM or UI state into the adapter:

```ts
player.play(model, {
  // existing options
  paintingRectangle,
  resolutionScale,
  canvasSize,
  coordinateScale,
  mapPoint,
  framesPerStep,
  ticksPerFrame,
  waitFrame,
  advanceTick,
  resetAdvanceClock,
  onPaint,

  // new integration hooks
  signal: AbortSignal,
  waitUntilResumed: () => Promise<void>,
  onProgress: (progress: StoryProgress) => void
});
```

Sequential `play(model)` is not enough for frame navigation. Add a
compile-once plan API so the controller can move by stable boundaries without
re-running model grouping logic:

```ts
const plan = player.compile(model, mappingOptions);

await player.playPlan(plan, {
  startIndex,
  registry,
  signal,
  waitUntilResumed,
  onProgress,
  shouldStopAt: optionalExclusiveBoundary
});
```

`compile()` must be pure for the same model/options and must preserve the exact
order, splitting and colour/size calculations currently used by `replay()` and
`play()`. Those two convenience methods should delegate to the compiled plan so
there is only one interpretation of Tilecraft groups and frames.

Proposed progress payload:

```ts
interface StoryProgress {
  status: 'playing' | 'paused' | 'completed';
  processedItems: number;
  totalItems: number;
  processedStrokes: number;
  totalStrokes: number;
  layerIndex: number;
  layerTag?: string;
  frameId?: string | number;
  modelTicks: number;
  playheadIndex: number;
  paintedOperations: number;
  pendingOperations: number;
  pendingRanges: number;
}
```

Player requirements:

- inspect `signal.aborted` before beginning a stroke and after every await;
- cancellation must end an active engine stroke in `finally`;
- `resetAdvanceClock()` must run on completion, cancellation and error;
- `waitUntilResumed()` pauses between model steps without blocking JavaScript;
- `onProgress()` fires at most once per displayed frame, even at 16×;
- progress totals come from the same filtering/grouping logic used by playback;
- each successful operation calls `registry.markPainted()` exactly once;
- `playPlan()` skips painted indices even if its requested range contains them;
- boundary stop/jump closes the active stroke before returning control;
- cancellation rejects with a recognizable `AbortError`, not a generic failure;
- `replay()` remains synchronous and deterministic; UI transport uses `play()`.

Do not add `pause()`, DOM references or global UI variables directly to
`TilecraftStrokePlayer`. Scheduling policy belongs to the controller; the
adapter accepts neutral hooks.

## 13. Controller and engine coordination

### Before Play

1. Keep the canvas and paint controls interactive.
2. If `engine.strokeActive`, end the manual stroke before story playback starts.
3. Create/save a baseline snapshot including painting dimensions and quality.
4. If policy is Replace, call `engine.clear()`.
5. Freeze the painting rectangle and resolution scale for this run.
6. Compute source-to-target mapping.
7. Create a new `TilecraftStrokePlayer(engine)` and `AbortController`.
8. Start playback and mark the app render dirty through `onPaint`.

### Pause

Pause is cooperative at a model-step boundary. It does not suspend the browser
thread or accumulate pointer events. While paused:

- the canvas continues to present the current texture;
- the engine clock is returned to wall time;
- manual pointer-down performs a safe scheduler hand-off and leaves story
  playback paused;
- file replacement/removal remains available through the safe stop flow.

### Resume

- reset the engine clock to current wall time;
- release the controller's pause gate;
- continue from the next unprocessed model item;
- do not repeat or skip the pending point.

### Restart

1. abort and await completion of the current scheduler;
2. ensure no engine stroke remains active;
3. restore the baseline snapshot;
4. clear again only if Replace policy requires it;
5. reset progress/performance counters;
6. create a fresh player run with the same deterministic inputs;
7. start from item zero.

### Stop

1. abort and await safe player cleanup;
2. show Restore/Keep decision;
3. keep the decision visible without blocking canvas input; a manual edit
   implicitly chooses Keep;
4. Restore reloads the baseline snapshot;
5. Keep discards the controller's reference to the baseline and treats the
   partial paint as the new canvas state;
6. return the engine clock to wall time in both paths.

### Complete

Leave the final painting visible and the canvas interactive after the run's
active stroke is closed. Present **Keep result** as the primary completion
action and **Replay** as secondary; a manual edit implicitly chooses Keep.

### Previous/Next Frame

1. serialize the navigation request behind any operation already in flight;
2. remember whether the prior state was Playing or Paused;
3. abort/close the current plan run at an operation boundary;
4. for a forward jump, split/tag the abandoned pending range;
5. resolve the destination through the compiled plan and registry;
6. set the playhead to the destination's first pending operation;
7. reset the engine clock;
8. resume only when the prior state was Playing; otherwise remain Paused;
9. update focus/status without moving focus away from the pressed control.

If the destination boundary contains a mix of painted and unpainted operations,
execution visits only the unpainted subranges. This is the core no-double-paint
guarantee.

## 14. Manual input arbitration

The public Stroke API forbids two concurrent named strokes. Therefore:

- Paint controls and the canvas remain interactive in every story state.
- A manual pointer-down calls `StoryPlaybackController.yieldToManualInput()`.
  The controller aborts the current scheduler at an operation boundary, closes
  its active stroke, resets the synthetic clock and enters `Paused` before the
  manual stroke begins.
- Pointer move/end events received during that short asynchronous hand-off are
  queued, so a quick tap or short stroke is not lost.
- `Clear`, `Undo` and `Redo` use the same hand-off instead of being disabled.
- Manual editing while a completed/stopped/error result decision is visible
  implicitly keeps the visible result and returns the controller to `Ready`.
- Story playback never resumes automatically after manual painting; the user
  can explicitly press `Resume`.

The player UI must never call private `engine.simulator`, `engine.brush` or
`engine.renderer` fields.

## 15. Proposed semantic markup

This is the target structure, not a requirement to preserve every class name.
It keeps the existing shell IDs and `data-extension-*` tab hooks.

```html
<section id="panel-extension" hidden aria-label="Story tools">
  <header class="panel-extension-header">
    <div class="panel-extension-tabs" role="tablist" aria-label="Story tools">
      <button id="story-file-tab" type="button" role="tab"
              data-extension-tab="file" aria-selected="true"
              aria-controls="story-file-page">File</button>
      <button id="story-player-tab" type="button" role="tab"
              data-extension-tab="player" aria-selected="false"
              aria-controls="story-player-page">Player</button>
    </div>
    <button id="panel-extension-close" type="button"
            aria-label="Hide story tools">×</button>
  </header>

  <div id="story-file-page" class="panel-extension-page"
       role="tabpanel" tabindex="0"
       aria-labelledby="story-file-tab" data-extension-page="file">
    <input id="story-file-input" type="file" accept=".json,application/json" hidden>
    <button id="story-file-dropzone" type="button">
      <span>Drop Tilecraft JSON here</span>
      <span>or choose a file</span>
    </button>
    <div id="story-file-status" aria-live="polite"></div>
    <section id="story-file-summary" hidden></section>
  </div>

  <div id="story-player-page" class="panel-extension-page" hidden
       role="tabpanel" tabindex="0"
       aria-labelledby="story-player-tab" data-extension-page="player">
    <header id="story-player-summary"></header>
    <div id="story-player-status" role="status" aria-live="polite"></div>
    <div id="story-player-progress" role="progressbar"
         aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div>

    <nav class="story-boundary-navigation" aria-label="Story position">
      <output id="story-playhead-label">Frame 1 · Group 1</output>
      <button id="story-previous-frame" type="button"
              aria-label="Previous unpainted frame">Previous frame</button>
      <button id="story-next-frame" type="button">Next frame</button>
    </nav>

    <div class="story-runtime-controls">
      <label>Speed <select id="story-speed"><!-- supported speeds --></select></label>
      <label>Thickness
        <output id="story-thickness-value">1.00×</output>
        <input id="story-thickness" type="range" min="0.1" max="1.2"
               step="0.05" value="1">
      </label>
    </div>

    <fieldset id="story-canvas-policy">
      <legend>Paint onto canvas</legend>
      <label><input type="radio" name="story-canvas" value="replace" checked>
        Replace current painting</label>
      <label><input type="radio" name="story-canvas" value="overlay">
        Add over current painting</label>
    </fieldset>

    <footer class="story-transport">
      <button id="story-restart" type="button">Restart</button>
      <button id="story-play-pause" type="button">Play</button>
      <button id="story-stop" type="button">Stop</button>
    </footer>
  </div>
</section>
```

The tab implementation must also add keyboard navigation missing from the
current shell:

- Left/Right arrows move between tabs;
- Home/End select first/last tab;
- selected tab has `tabindex="0"`; the other has `tabindex="-1"`;
- selection updates `aria-selected`, panel `hidden` and focus together.

## 16. Component boundaries

Recommended files:

```text
app/ui/story-file-panel.js       DOM rendering and file/drop events
app/ui/story-player-panel.js     DOM rendering and transport events
app/story-file-loader.js         read, parse, validate, summarize
app/story-playback-controller.js authoritative state machine
app/story-playback-plan.js       immutable operations + boundaries
app/unpainted-range-registry.js  pending interval ownership/navigation
fluid-engine/tilecraft-stroke-player.js
                                 schema-to-Stroke-API adapter only
```

`ToolPanel` continues to own only:

- extension open/close;
- tab selection mechanics;
- adjacent/overlay placement;
- responsive shell placement.

It must not load files or control playback. The panels emit intentions to the
controller; they do not call the engine directly.

Suggested data flow:

```text
FilePanel ── load/remove intent ──┐
                                  v
PlayerPanel ─ transport/settings ─> StoryPlaybackController
                                  |       |
                                  |       +── StoryFileLoader
                                  |
                                  +── TilecraftStrokePlayer
                                            |
                                            v
                                      FluidEngine API
```

## 17. File preflight model

The loader should produce a normalized summary before enabling Player:

```ts
interface StoryModelSummary {
  fileName: string;
  byteSize: number;
  layersTotal: number;
  layersVisible: number;
  framesTotal: number;
  polylinePoints: number;
  polygonSpots: number;
  logicalStrokes: number;
  skippedItems: number;
  unsupportedLayers: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  warnings: Array<{ code: string; count: number; message: string }>;
}
```

The same normalizer should feed playback totals. Do not calculate UI counts
with separate logic that can disagree with what the adapter actually draws.

For version 1, playback scope is **all visible supported content**. A frame
selector is deferred until the product defines whether frame IDs filter tiles,
only determine fitting bounds, or represent a composited scene. The current
demo uses selected-frame points for bounds but does not provide a general
frame-filter contract; the UI must not imply one.

## 18. Fit and mapping policy

Version 1 uses **Contain** with centered placement:

```js
scale = Math.min(
  target.width / sourceWidth,
  target.height / sourceHeight
);

offsetX = target.left + (target.width - sourceWidth * scale) / 2;
offsetY = target.bottom + (target.height - sourceHeight * scale) / 2;
```

Tilecraft is top-left/Y-down; FluidEngine painting space is bottom-left/Y-up:

```js
mapPoint = (tile) => ({
  x: offsetX + (tile.x - sourceLeft) * scale,
  y: offsetY + (sourceBottom - tile.y) * scale
});
```

Pass the same `scale` as `coordinateScale` so stroke widths transform with
positions. Pass the destination painting dimensions as `canvasSize` so the
Tilecraft responsive stroke factor matches the target.

Cover/crop, stretch and manual positioning are out of scope for version 1.

## 19. Accessibility requirements

- All actions are native `<button>`, `<input>`, `<select>` or properly grouped
  radio inputs.
- File drop is never the only import mechanism.
- Focus is visible at 3:1 contrast against the translucent surface.
- Tabs implement the ARIA Tabs keyboard pattern.
- Loading, pause, completion and error messages use one polite live region.
- Fatal errors receive focus only after user-initiated load/play actions.
- Progress announcements are throttled to meaningful steps (for example every
  5% or state change), not every point.
- Colour is never the only loaded/warning/error indicator.
- Touch targets are at least 44px on coarse pointers.
- Text remains usable at 200% zoom.
- Previous controls announce “unpainted” in their accessible names and disabled
  state when no pending destination exists.
- Coverage and playhead are announced as separate values after navigation.
- `prefers-reduced-motion` disables pulsing status dots and animated progress
  interpolation; the numerical progress still updates.

## 20. Error copy

Use actionable, specific messages.

| Condition | Message | Primary action |
|---|---|---|
| Invalid JSON | “This file is not valid JSON.” | Choose another file |
| Wrong schema | “This JSON has no Tilecraft `layers` array.” | Choose another file |
| Nothing drawable | “No supported visible strokes were found.” | View warnings |
| Too large | “This file exceeds the 25 MB local limit.” | Choose another file |
| Unsupported content | “3 layers will be skipped because their shapes are not supported yet.” | Continue |
| GPU failure | “Playback stopped because the graphics context failed.” | Restore canvas |
| Context lost | “Graphics context was lost. Reload to continue safely.” | Reload |
| Cancelled | No error banner; enter Stop Decision or Ready as requested. | — |

Keep technical stack traces in the console/diagnostic report, not in the
primary panel.

## 21. Telemetry without file-content leakage

If the business product collects telemetry, record only operational facts:

- load success/failure category;
- byte-size bucket;
- layer/point count buckets;
- selected and achieved speed;
- playback completion/cancel/error;
- frame forward and backward jump counts;
- pending-range count at Keep result;
- elapsed time;
- WebGL version and resolution bucket.

Do not record file names, narrative text, colours, coordinates or the JSON body
without a separate explicit privacy decision.

## 22. Acceptance criteria

### File flow

- A valid local `.json` can be chosen and dropped.
- Replacing with an invalid file leaves the previous valid model available.
- Fatal schema errors never enable Play.
- Warnings state exactly what will be skipped.
- A 1.9 MB reference fixture does not visibly freeze the UI.
- Dropping a JSON outside the drop zone does not navigate away.

### Playback flow

- Play snapshots the current canvas before any clear/deposit.
- Replace clears; Overlay preserves existing pigment.
- Pause stops consumption at a model-step boundary without losing the next
  point.
- Resume does not duplicate or skip a point.
- Restart restores the exact baseline and starts from item zero.
- Stop always closes an active engine stroke and offers Restore/Keep.
- Restore returns paint, dimensions and resolution scale to the baseline.
- Keep leaves the partial result paintable by the user.
- Completion leaves the final result visible and manual painting available;
  the first manual edit implicitly keeps it.
- Closing the extension pauses active playback.

### Speed and progress

- Every supported multiplier maps to the documented scheduler options.
- Fast modes preserve all model points.
- Progress is monotonic and reaches 100% exactly once.
- Progress totals match drawable items after filtering/skips.
- Selected speed never masquerades as measured actual speed.
- Painted coverage is monotonic even when the playhead moves backward.
- Playhead position and painted coverage are never presented as the same value.

### Frame navigation

- Next Frame lands on a stable compiled boundary.
- Every skipped forward interval remains pending in the separate registry.
- Previous Frame selects only earlier pending intersections.
- Back controls are disabled when all earlier content is already painted.
- Returning to a partially painted frame never replays its painted prefix.
- Rapid navigation clicks are serialized and leave at most one active engine
  stroke.
- Reaching the plan end with pending ranges enters Completed with Gaps.
- Paint Earliest Remaining eventually drains the registry without duplicating
  operations.
- Final Completed is emitted only when the registry is empty or the user
  explicitly keeps an incomplete result.

### Boundary and robustness

- UI/controller code uses only public `FluidEngine` methods.
- Manual and story strokes never overlap.
- Context loss produces an explicit recoverable product state.
- File-controlled strings are rendered as text, never HTML.
- Extension remains reachable after resize, rotation and panel dragging.
- Keyboard-only and coarse-pointer flows can load, play, pause, stop and decide
  Restore/Keep.

## 23. Delivery phases

### P0 — Safe end-to-end MVP

- File picker and drop zone;
- JSON parsing, minimal validation and summary;
- Replace canvas policy only;
- Play, Pause/Resume, Restart and Stop/Restore;
- fixed speed choices;
- read-only progress;
- compiled playback plan with frame boundaries;
- separate `UnpaintedRangeRegistry`;
- Previous/Next Frame controls;
- Completed with Gaps and Paint Earliest Remaining flow;
- controller ownership and safe manual-input hand-off;
- `AbortSignal`, pause gate and `onProgress` hooks in the player;
- desktop/tablet/phone layout.

### P1 — Product completeness

- Overlay policy and Keep Partial;
- warnings disclosure;
- measured speed and diagnostics;
- Worker preflight for large files;
- persisted lightweight preferences;
- robust context-loss messaging;
- debug global rewritten as a controller adapter.

### P2 — Advanced navigation

- explicitly defined frame filtering;
- frame list and narrative preview;
- replay-backed seek if performance is acceptable;
- thumbnails/preflight visualization;
- additional fit/crop policies;
- durable project persistence outside GPU snapshots.

## 24. Explicit non-goals for the first release

- arbitrary remote URL loading;
- drag-to-seek timeline;
- replaying already painted ranges when navigating backward;
- canvas rewind on Previous Frame;
- editing Story Model JSON;
- per-layer enable/disable controls;
- changing Fluid Paint brush controls during playback;
- silently thinning points for performance;
- persistent storage of imported files;
- multiple concurrent story players;
- making `TilecraftStrokePlayer` aware of DOM elements.

These exclusions keep the first UI honest and achievable with the current
engine boundary.
