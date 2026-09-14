'use strict';

class StoryToolsUI {
  constructor(controller, toolPanel) {
    this.controller = controller;
    this.toolPanel = toolPanel;
    this.fileInput = document.getElementById('story-file-input');
    this.dropzone = document.getElementById('story-file-dropzone');
    this.fileStatus = document.getElementById('story-file-status');
    this.fileSummary = document.getElementById('story-file-summary');
    this.backgroundCard = document.getElementById('story-background-card');
    this.playerEmpty = document.getElementById('story-player-empty');
    this.playerContent = document.getElementById('story-player-content');
    this.playerStatus = document.getElementById('story-player-status');
    this.progress = document.getElementById('story-player-progress');
    this.progressFill = document.getElementById('story-player-progress-fill');
    this.coverage = document.getElementById('story-player-coverage');
    this.playhead = document.getElementById('story-playhead-label');
    this.stopDecision = document.getElementById('story-stop-decision');
    this.gaps = document.getElementById('story-player-gaps');
    this._thicknessFrame = null;
    this._bind();
    this.unsubscribe = controller.subscribe((view) => this.render(view));
  }

  _bind() {
    const choose = () => this.fileInput && this.fileInput.click();
    if (this.dropzone) {
      this.dropzone.addEventListener('click', choose);
      this.dropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        this.dropzone.classList.add('is-dragging');
      });
      this.dropzone.addEventListener('dragleave', () => this.dropzone.classList.remove('is-dragging'));
      this.dropzone.addEventListener('drop', (event) => {
        event.preventDefault();
        this.dropzone.classList.remove('is-dragging');
        const file = event.dataTransfer && event.dataTransfer.files[0];
        if (file) this._load(file);
      });
    }
    document.addEventListener('dragover', (event) => event.preventDefault());
    document.addEventListener('drop', (event) => {
      if (!this.dropzone || !this.dropzone.contains(event.target)) event.preventDefault();
    });
    if (this.fileInput) {
      this.fileInput.addEventListener('change', () => {
        const file = this.fileInput.files && this.fileInput.files[0];
        if (file) this._load(file);
        this.fileInput.value = '';
      });
    }

    this._on('story-replace-file', 'click', choose);
    this._on('story-remove-file', 'click', () => this._safe(() => this.controller.removeFile()));
    this._on('story-remove-background', 'click', () => this.controller.removeBackground());
    this._on('story-open-player', 'click', () => {
      if (this.toolPanel) this.toolPanel.selectExtensionTab('player', true);
    });
    this._on('story-player-choose-file', 'click', () => {
      if (this.toolPanel) this.toolPanel.selectExtensionTab('file', true);
      choose();
    });
    this._on('story-speed', 'change', (event) => {
      this._safe(() => this.controller.setSpeed(Number(event.target.value)));
    });
    this._on('story-thickness', 'input', (event) => {
      const value = Number(event.target.value);
      this._renderThicknessValue(value);
      if (this._thicknessFrame !== null) cancelAnimationFrame(this._thicknessFrame);
      this._thicknessFrame = requestAnimationFrame(() => {
        this._thicknessFrame = null;
        this._safe(() => this.controller.setThickness(value));
      });
    });
    document.querySelectorAll('input[name="story-canvas"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) this.controller.setCanvasPolicy(input.value);
      });
    });
    this._on('story-play-pause', 'click', () => this._togglePlayback());
    this._on('story-restart', 'click', () => this._safe(() => this.controller.restart()));
    this._on('story-stop', 'click', () => this._safe(() => this.controller.stop()));
    this._on('story-restore-baseline', 'click', () => this._safe(() => this.controller.restoreBaseline()));
    this._on('story-keep-partial', 'click', () => this.controller.keepResult());
    this._on('story-keep-result', 'click', () => this.controller.keepResult());
    this._on('story-paint-remaining', 'click', () => this._safe(() => this.controller.playEarliestRemaining()));
    this._on('story-previous-frame', 'click', () => this._safe(() => this.controller.previousUnpaintedFrame()));
    this._on('story-next-frame', 'click', () => this._safe(() => this.controller.nextFrame()));
  }

  async _load(file) {
    try {
      const result = await this.controller.loadFile(file);
      if ((!result || result.kind !== 'background') && this.toolPanel) {
        this.toolPanel.selectExtensionTab('player', true);
      }
    } catch (_) { /* controller state renders the contextual error */ }
  }

  _on(id, eventName, handler) {
    const element = document.getElementById(id);
    if (element) element.addEventListener(eventName, handler);
  }

  _safe(action) {
    Promise.resolve().then(action).catch((error) => console.error('Story tools:', error));
  }

  _togglePlayback() {
    if (this.controller.state === 'playing') this.controller.pause();
    else this._safe(() => this.controller.play());
  }

  render(view) {
    const summary = view.modelSummary;
    const hasFile = !!summary;
    const busy = view.state === 'loading';
    const background = view.backgroundSummary;
    if (this.toolPanel) this.toolPanel.setExtensionHasStory(hasFile);

    if (this.dropzone) this.dropzone.hidden = hasFile || busy;
    if (this.fileSummary) this.fileSummary.hidden = !hasFile;
    if (this.backgroundCard) this.backgroundCard.hidden = !background;
    if (background) {
      const name = document.getElementById('story-background-name');
      const meta = document.getElementById('story-background-meta');
      if (name) name.textContent = background.fileName;
      if (meta) {
        meta.textContent = `${background.sourceWidth} × ${background.sourceHeight} · ${this._formatBytes(background.byteSize)}`;
      }
    }

    if (this.fileStatus) {
      this.fileStatus.textContent = view.backgroundLoading
        ? 'Decoding PNG background…'
        : view.backgroundError
          ? view.backgroundError.message
          : busy
            ? 'Reading and validating file…'
            : view.state === 'file-error' && view.error
              ? view.error.message
              : hasFile ? 'Story file is ready for playback.'
                : background ? 'PNG background is ready for painting.' : '';
      this.fileStatus.classList.toggle(
        'is-error',
        view.state === 'file-error' || !!view.backgroundError
      );
    }
    if (summary) this._renderSummary(summary);

    if (this.playerEmpty) this.playerEmpty.hidden = hasFile;
    if (this.playerContent) this.playerContent.hidden = !hasFile;
    if (!hasFile) return;

    const progress = view.progress;
    const total = progress.totalItems || 0;
    const painted = progress.paintedOperations || 0;
    const percent = total ? Math.round(painted / total * 100) : 0;
    if (this.progress) {
      this.progress.setAttribute('aria-valuenow', String(percent));
      this.progress.setAttribute('aria-valuetext', `${percent}% painted; playhead ${progress.playheadIndex || 0} of ${total}`);
    }
    if (this.progressFill) this.progressFill.style.width = `${percent}%`;
    if (this.coverage) {
      this.coverage.textContent = `${painted.toLocaleString()} / ${total.toLocaleString()} operations · ${percent}% painted`;
    }
    if (this.playhead) {
      this.playhead.textContent = `${progress.frameId || 'Frame —'} · ${progress.groupId || 'Group —'}`;
    }
    if (this.playerStatus) this.playerStatus.textContent = this._statusText(view);

    const playPauseText = view.state === 'playing' ? 'Pause' :
        view.state === 'paused' ? 'Resume' : view.state === 'completed' ? 'Replay' : 'Play';
    for (const playPause of [document.getElementById('story-play-pause')]) {
      if (!playPause) continue;
      playPause.textContent = playPauseText;
      playPause.disabled = ['stop-decision', 'player-error'].includes(view.state);
    }
    const stop = document.getElementById('story-stop');
    if (stop) stop.disabled = !['playing', 'paused'].includes(view.state);
    const restart = document.getElementById('story-restart');
    if (restart) restart.disabled = !['playing', 'paused', 'completed', 'completed-with-gaps'].includes(view.state);

    const previousFrame = document.getElementById('story-previous-frame');
    const nextFrame = document.getElementById('story-next-frame');
    const navigable = ['playing', 'paused', 'completed-with-gaps'].includes(view.state);
    if (previousFrame) previousFrame.disabled = !navigable || !view.canPreviousFrame;
    if (nextFrame) nextFrame.disabled = !navigable || !view.canNextFrame;

    const speed = document.getElementById('story-speed');
    if (speed && Number(speed.value) !== view.speed) speed.value = String(view.speed);
    const thickness = document.getElementById('story-thickness');
    if (thickness && Number(thickness.value) !== view.thickness) thickness.value = String(view.thickness);
    this._renderThicknessValue(view.thickness);
    document.querySelectorAll('input[name="story-canvas"]').forEach((input) => {
      input.checked = input.value === view.canvasPolicy;
      input.disabled = ['playing', 'paused', 'stop-decision', 'completed', 'completed-with-gaps'].includes(view.state);
    });
    const showResultDecision = ['stop-decision', 'completed', 'player-error'].includes(view.state);
    if (this.stopDecision) this.stopDecision.hidden = !showResultDecision;
    const resultTitle = document.getElementById('story-result-decision-title');
    const keepPartial = document.getElementById('story-keep-partial');
    if (resultTitle) resultTitle.textContent = view.state === 'completed'
      ? 'Playback complete. Keep the result?'
      : view.state === 'player-error' ? 'Playback failed. Keep the painted part?' : 'Keep the partial painting?';
    if (keepPartial) keepPartial.textContent = view.state === 'completed' ? 'Keep result' : 'Keep partial';
    if (this.gaps) this.gaps.hidden = view.state !== 'completed-with-gaps';
  }

  _renderSummary(summary) {
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    set('story-file-name', summary.fileName);
    set('story-file-size', this._formatBytes(summary.byteSize));
    set('story-file-counts', `${summary.layersVisible} visible layers · ${summary.framesTotal} frames`);
    set('story-file-items', `${summary.drawableItems.toLocaleString()} drawable items · ${summary.logicalGroups.toLocaleString()} groups`);
    set('story-file-bounds', `${Math.round(summary.bounds.right - summary.bounds.left)} × ${Math.round(summary.bounds.bottom - summary.bounds.top)} source units`);
    set('story-player-file-name', summary.fileName);
    const warnings = document.getElementById('story-file-warnings');
    if (warnings) {
      warnings.hidden = !summary.warnings.length;
      warnings.textContent = summary.warnings.map((warning) => warning.message).join(' ');
    }
  }

  _statusText(view) {
    if (view.state === 'playing') return 'Painting story…';
    if (view.state === 'paused') return 'Playback paused.';
    if (view.state === 'completed') return 'Playback completed.';
    if (view.state === 'completed-with-gaps') {
      return `${view.progress.pendingRanges || view.pendingRanges.length} unpainted ranges remain.`;
    }
    if (view.state === 'stop-decision') return 'Playback stopped. Restore the canvas or keep the partial result.';
    if (view.state === 'player-error') return view.error ? view.error.message : 'Playback failed.';
    return 'Ready.';
  }

  _formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  _renderThicknessValue(value) {
    const output = document.getElementById('story-thickness-value');
    if (output && Number.isFinite(value)) output.textContent = `${value.toFixed(2)}×`;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = StoryToolsUI;
if (typeof globalThis !== 'undefined') globalThis.StoryToolsUI = StoryToolsUI;
