# Paint UX change request

Status: implemented and covered by browser regression checks.

## Scope

### CR-1 — Story speed select contrast

- Native Speed options must never render white text on a white popup surface.
- The closed select keeps the existing dark panel styling.
- Acceptance: every option is readable in Chromium/WebKit native select UI.

### CR-2 — Story brush ownership

- While Story playback is Playing or Paused, the Story scheduler owns the
  FluidEngine brush target.
- Manual pointer hover must not feed an idle target between Story strokes.
- The bristle preview follows Story geometry independently of pointer position.
- Manual pointer ownership returns after playback leaves Playing/Paused.

### CR-3 — PNG canvas background

- The File tab accepts Tilecraft JSON and PNG files.
- A PNG is a non-simulated canvas background; paint remains a separate wet
  layer above it.
- The image uses `contain`, is centred, and transparent pixels resolve to white.
- Loading a PNG does not unload the current Story JSON, and loading Story JSON
  does not remove the PNG.
- The background is included in the saved PNG.
- Users can replace or remove the background from the File tab.
- Invalid/non-PNG image input reports a contextual error without damaging the
  current Story or background.

### CR-4 — Range value pop notification

- Updating Bristle Count, Brush Size, or Fluidity shows a
  transient value bubble near the active control.
- Pointer and keyboard changes use the same notification.

### CR-5 — Ad-hoc white and black

- Symmetric White and Black actions sit above the colour ring, aligned with the
  existing HEX and RYB labels.
- They select exact `#fff` and `#000` paint colours and expose a selected state.

### CR-6 — Preserve colour-space selection

- Selecting ad-hoc White/Black does not mutate the saved ring hue, saturation,
  brightness, or alpha.
- The visible iro handle becomes white or black while an ad-hoc colour is
  active.
- Touching/dragging the iro handle restores the saved colour-space selection.
- Selecting a normal ring colour clears the ad-hoc selected state.

### CR-7 — Compact ad-hoc colour actions

- White and Black actions are circular and labelled `#fff` / `#000`.
- Their accessible names remain “Use white” and “Use black”.

### CR-8 — Ad-hoc alpha

- The iro alpha slider changes opacity without clearing an active ad-hoc
  White/Black selection.
- Hue, saturation, and brightness remain byte-for-byte unchanged.
- Moving a hue/value control still restores the normal ring colour.

### CR-9 — Alpha channel readout

- A separate two-character uppercase hex alpha value appears beside the
  six-character colour label.
- The alpha badge uses the active colour and opacity as its background.

### CR-10 — Story extension grip and collapse

- The Story extension header has its own drag/tap grip.
- Dragging it moves the attached panel group without collapsing it.
- Tapping it collapses only the extension body and never pauses playback.
- With a Story loaded, collapsed chrome exposes Play/Pause; without one it
  keeps the File/Player tabs.
- The extension remains reachable inside desktop and mobile viewports.

## Delivery order

1. CR-1 contrast bugfix.
2. CR-2 brush-ownership bugfix.
3. CR-3 PNG background.
4. CR-4 value notifications.
5. CR-5 and CR-6 as one colour-state change.
6. CR-7 through CR-10 as the compact colour/Story chrome follow-up.
