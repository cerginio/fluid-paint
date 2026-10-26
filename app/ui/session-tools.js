'use strict';

/*
 * The State tab's Session recording card and the ● REC chip
 * (docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md §2.7, fluid-session
 * phase 3). SessionRecorder does the recording; this owns what the user sees:
 *
 *   idle -> recording (recorder waiting/recording/stopping) -> finishing
 *        (encoding) -> recorded (not saved) -> saved
 *
 * Open… reads and validates a .flus and shows its summary; playing it in the
 * Player is phase 4.
 */
class SessionToolsUI {
  constructor(painter, recorder, toolPanel) {
    this.painter = painter;
    this.recorder = recorder;
    this.toolPanel = toolPanel;
    this.phase = 'idle';
    this.file = null;          // { bytes, name, durationSeconds, strokes }
    this.savedName = null;
    this.note = '';
    this._pending = null;      // the action an unsaved-recording warning holds
    this._timer = null;
    this._baseline = null;     // Promise<Uint8Array|null> of the baseline PNG

    const $ = (id) => document.getElementById(id);
    this.card = $('session-card');
    this.statusText = $('session-status-text');
    this.statusLive = $('session-status-live');
    this.recordButton = $('session-record');
    this.saveButton = $('session-save');
    this.openButton = $('session-open');
    this.openInput = $('session-open-input');
    this.startFrom = $('session-start-from');
    this.noteElement = $('session-note');
    this.discard = $('session-discard');
    this.opened = $('session-opened');
    this.chip = $('session-rec-chip');
    if (!this.card) return;

    this.recordButton.addEventListener('click', () => this._safe(() => this._toggleRecording()));
    this.saveButton.addEventListener('click', () => this._safe(() => this.save()));
    this.openButton.addEventListener('click', () => this._guard(() => this.openInput.click()));
    this.openInput.addEventListener('change', () => {
      const file = this.openInput.files && this.openInput.files[0];
      this.openInput.value = '';
      if (file) this._safe(() => this.open(file));
    });
    $('session-discard-confirm').addEventListener('click', () => this._confirmDiscard());
    $('session-discard-cancel').addEventListener('click', () => {
      this._pending = null;
      this.discard.hidden = true;
    });
    if (this.chip) {
      this.chip.addEventListener('click', () => {
        if (!this.toolPanel) return;
        this.toolPanel.setExtensionOpen(true);
        this.toolPanel.selectExtensionTab('bake');
      });
    }
    // The canvas content decides whether "Starts from" is offered; reading it
    // back costs a texture readback, so only when the State tab is shown.
    const extension = document.getElementById('panel-extension');
    if (extension) {
      extension.addEventListener('story-extension-tab-selected', (event) => {
        if (event.detail && event.detail.tab === 'bake') this.render();
      });
    }
    // Record is disabled while a story plays; follow its state, not its
    // per-frame progress events.
    const story = painter.storyPlaybackController;
    if (story && typeof story.subscribe === 'function') {
      let storyBusy = this._storyBusy();
      story.subscribe(() => {
        if (this._storyBusy() === storyBusy) return;
        storyBusy = !storyBusy;
        this.render();
      });
    }
    window.addEventListener('beforeunload', (event) => {
      if (!this.hasUnsavedWork()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    this.render();
  }

  /** Recording, or recorded and not saved: closing the page would lose it. */
  hasUnsavedWork() {
    return this.recorder.active || this.phase === 'finishing' || this.phase === 'recorded';
  }

  _safe(action) {
    Promise.resolve().then(action).catch((error) => {
      console.error('Session recording:', error);
      this.note = error.message;
      this.render();
    });
  }

  /* SPEC §2.7: Record and Open… first warn inline when a recording is unsaved. */
  _guard(action) {
    if (this.phase !== 'recorded') {
      action();
      return;
    }
    this._pending = action;
    this.discard.hidden = false;
  }

  _confirmDiscard() {
    const action = this._pending;
    this._pending = null;
    this.discard.hidden = true;
    this.recorder.discard();
    this.file = null;
    this.note = '';
    this._setPhase('idle');
    if (action) action();
  }

  _storyBusy() {
    const story = this.painter.storyPlaybackController;
    return !!story && ['playing', 'paused'].includes(story.state);
  }

  _toggleRecording() {
    if (this.recorder.active) {
      this.recorder.stop('stop');
      this.render();
      return;
    }
    this._guard(() => this._safe(() => this.start()));
  }

  async start() {
    if (this.recorder.active || this._storyBusy()) return;
    const painter = this.painter;
    const clearFirst = !this.startFrom.hidden &&
      this.startFrom.querySelector('input[value="clear"]').checked;
    if (clearFirst) {
      await painter.clear();
      if (painter.engine.renderer.hasBackground) painter.clearBackgroundImage();
    }
    this.file = null;
    this.savedName = null;
    this.note = '';
    this.opened.hidden = true;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.recorder.start({ bristleSeed: seed, prepare: () => this._prepare() });
    this._setPhase('recording');
  }

  /* Runs when recording actually starts, inside the recorder. Synchronous:
   * the baseline pixels are read now, the PNG is encoded afterwards. */
  _prepare() {
    const painter = this.painter;
    const rectangle = painter.paintingRectangle;
    let baselinePixels = null;
    if (painter.hasArtwork()) {
      const width = Math.max(1, Math.round(rectangle.width));
      const height = Math.max(1, Math.round(rectangle.height));
      baselinePixels = { width, height, pixels: painter.engine.exportPixels({
        width, height, resolutionScale: painter.resolutionScale, colorModel: FluidEngine.COLOR_MODEL.RGB,
      }) };
    }
    this._baseline = baselinePixels ? this._encodePng(baselinePixels) : Promise.resolve(null);
    // A replay starts with an empty undo ring, so the live one starts over
    // too: an Undo past Record could not be replayed.
    painter.snapshotIndex = 0;
    painter.maxRedoIndex = 0;
    painter.undoing = false;
    painter.refreshDoButtons();
    this.note = baselinePixels
      ? 'Started over the current painting: it is kept as a flat background, so new paint will not mix wet with it. Undo history starts here.'
      : 'Undo history starts here.';
    return {
      painting: { left: rectangle.left, bottom: rectangle.bottom, width: rectangle.width, height: rectangle.height },
      resolutionScale: painter.resolutionScale,
      effectiveResolutionScale: painter.getEffectiveResolutionScale(),
      paletteMode: painter.paletteMode,
      blackPigment: painter.blackPigment,
    };
  }

  async _encodePng({ width, height, pixels }) {
    const canvas = this.painter._pixelsToCanvas(pixels, width, height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('The baseline PNG could not be encoded.'));
    }, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** SessionRecorder.onFinish. */
  onRecorderFinished(reason) {
    if (reason === 'cancelled') {
      this._setPhase('idle');
      return;
    }
    this.note = SessionToolsUI.STOP_NOTES[reason] || '';
    this._setPhase('finishing');
    this._safe(async () => {
      const recorder = this.recorder;
      const baselinePng = await this._baseline;
      const session = recorder.toSession({ baselinePng });
      const bytes = await SessionCodec.encode(session);
      this.file = {
        bytes,
        name: SessionToolsUI.fileName(new Date(session.header.created)),
        durationSeconds: recorder.durationSeconds,
        strokes: recorder.strokes,
      };
      this._setPhase('recorded');
    });
  }

  save() {
    if (!this.file) return;
    this.painter.downloadBlob(new Blob([this.file.bytes], { type: 'application/octet-stream' }), this.file.name);
    this.savedName = this.file.name;
    this._setPhase('saved');
  }

  async open(file) {
    this.opened.hidden = false;
    this.opened.classList.remove('is-error');
    if (file.size > SessionCodec.MAX_FILE_BYTES) {
      throw new Error(`${file.name} is larger than 25 MB.`);
    }
    let session;
    try {
      session = await SessionCodec.decode(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      this.opened.textContent = `${file.name}: ${error.message}`;
      this.opened.classList.add('is-error');
      return null;
    }
    const header = session.header;
    const exact = header.engineContract === SessionRecorder.ENGINE_CONTRACT;
    const mode = exact ? 'Exact' : session.hasKeyframes ? 'Vector — approximate' : null;
    const stats = header.stats || {};
    this.opened.textContent = mode
      ? `${file.name}: ${SessionToolsUI.clock(header.durationSec || 0)} · ${stats.strokes || 0} strokes · ` +
        `${(stats.ticks || 0).toLocaleString('en-US')} ticks · ${SessionToolsUI.kilobytes(file.size)} · ${mode} · ` +
        `${session.baselinePng ? 'starts over a background' : 'starts from an empty canvas'}. ` +
        'Playing it in the Player arrives in the next update.'
      : `${file.name} was recorded by a different engine version and has no keyframes to replay approximately.`;
    if (!mode) this.opened.classList.add('is-error');
    return session;
  }

  _setPhase(phase) {
    this.phase = phase;
    if (this.statusLive) this.statusLive.textContent = this._statusText();
    const ticking = this.recorder.active;
    if (ticking && !this._timer) {
      this._timer = setInterval(() => this._tick(), 1000);
    } else if (!ticking && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.render();
  }

  _tick() {
    // An observer that threw was detached by the engine; keep what it got.
    if (this.recorder.state === 'recording' && !this.recorder.attached) this.recorder.stop('error');
    this.render();
  }

  _statusText() {
    const recorder = this.recorder;
    switch (recorder.active ? recorder.state : this.phase) {
      case 'waiting': return '● REC — starts when the current stroke ends';
      case 'recording':
        return `● REC ${SessionToolsUI.clock(recorder.durationSeconds)} · ${recorder.strokes} strokes · ` +
          `~${SessionToolsUI.kilobytes(SessionToolsUI.estimateBytes(recorder))}`;
      case 'stopping': return '● REC · finishing the current stroke…';
      case 'finishing': return 'Preparing the recording…';
      case 'recorded':
        return `Recorded ${SessionToolsUI.clock(this.file.durationSeconds)} · ${this.file.strokes} strokes · ` +
          `${SessionToolsUI.kilobytes(this.file.bytes.length)} — not saved`;
      case 'saved': return `Saved ${this.savedName}`;
      default: return 'Not recording';
    }
  }

  render() {
    if (!this.card) return;
    const recording = this.recorder.active;
    const busy = recording || this.phase === 'finishing';
    this.card.classList.toggle('is-recording', recording);
    this.statusText.textContent = this._statusText();
    this.recordButton.textContent = recording ? '■ Stop' : '● Record';
    this.recordButton.setAttribute('aria-pressed', recording ? 'true' : 'false');
    const storyBusy = !recording && this._storyBusy();
    this.recordButton.disabled = this.phase === 'finishing' || this.recorder.state === 'stopping' || storyBusy;
    this.recordButton.title = storyBusy ? 'Stop story playback first, then start recording and play it.' : '';
    this.saveButton.disabled = busy || !this.file;
    this.openButton.disabled = busy;
    if (this.chip) this.chip.hidden = !recording;
    this.noteElement.hidden = !this.note;
    this.noteElement.textContent = this.note;
    this.startFrom.hidden = busy || !this._hasArtwork();
  }

  _hasArtwork() {
    // Only read back while the State tab is on screen; see the constructor.
    const page = document.getElementById('bake-page');
    if (!page || page.hidden || page.closest('[hidden]')) return !this.startFrom.hidden;
    try {
      return this.painter.hasArtwork();
    } catch (_) {
      return false;
    }
  }

  static estimateBytes(recorder) {
    // Measured on the phase 3 synthetic corpus: 6.7 B per tick after gzip,
    // plus each stroke's begin record.
    return recorder.ticks * 6.7 + recorder.strokes * 120;
  }

  static kilobytes(bytes) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('en-US')} KB`;
  }

  static clock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  }

  static fileName(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `painting-session-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}.flus`;
  }
}

SessionToolsUI.STOP_NOTES = {
  limit: 'Recording stopped at the 2-hour limit. What was recorded is kept.',
  resize: 'Recording stopped: the painting was resized. What was recorded is kept.',
  background: 'Recording stopped: the background image changed. What was recorded is kept.',
  error: 'Recording stopped after an error. What was recorded is kept.',
};

if (typeof module !== 'undefined' && module.exports) module.exports = SessionToolsUI;
