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
    this.demoSelect = document.getElementById('story-demo-select');
    this.demoRefresh = document.getElementById('story-demo-refresh');
    this.demoRun = document.getElementById('story-demo-run');
    this.demoStatus = document.getElementById('story-demo-status');
    this.demoMeta = document.getElementById('story-demo-meta');
    this.demoCatalog = typeof StoryDemoCatalog === 'function' ? new StoryDemoCatalog() : null;
    this.demoOpened = false;
    this.demoRefreshing = false;
    this.demoRunning = false;
    this.demoRefreshSerial = 0;
    this.demoRunSerial = 0;
    this.demoLastUpdate = null;
    this.demoMessage = '';
    this.demoError = false;
    this._thicknessFrame = null;
    this._bind();
    this.unsubscribe = controller.subscribe((view) => this.render(view));
  }

  _bind() {
    if (this.toolPanel?.extension) {
      this.toolPanel.extension.addEventListener('story-extension-tab-selected', (event) => {
        if (event.detail.tab !== 'demo' || !this._demoAvailable() || this.demoOpened) return;
        this.demoOpened = true;
        this._refreshDemo();
      });
    }
    this._on('story-demo-refresh', 'click', () => this._refreshDemo());
    this._on('story-demo-select', 'change', () => {
      this.demoRunSerial++;
      this._renderDemo();
    });
    this._on('story-demo-run', 'click', () => this._runDemo());
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
    this._on('story-color-model', 'change', (event) => {
      this._safe(() => this.controller.setColorModel(event.target.value));
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

  _demoAvailable() {
    return !!this.demoCatalog && !!this.demoSelect && !document.getElementById('story-demo-tab')?.hidden;
  }

  async _refreshDemo() {
    if (!this._demoAvailable() || this.demoRefreshing || this.demoRunning) return;
    this.demoRefreshing = true;
    const serial = ++this.demoRefreshSerial;
    this.demoMessage = 'Updating…';
    this.demoError = false;
    this._renderDemo();
    try {
      const index = await this.demoCatalog.refreshIndex();
      if (serial !== this.demoRefreshSerial) return;
      const selected = this.demoSelect.value;
      this.demoSelect.replaceChildren(...index.stories.map((story) => new Option(story.title, story.slug)));
      if (index.stories.some((story) => story.slug === selected)) this.demoSelect.value = selected;
      this.demoLastUpdate = new Date();
      this.demoMessage = index.stories.length
        ? `${index.stories.length} demos · Last update: ${this.demoLastUpdate.toLocaleString()}`
        : `No demos yet · Last update: ${this.demoLastUpdate.toLocaleString()}`;
    } catch (error) {
      if (serial !== this.demoRefreshSerial) return;
      this.demoMessage = `Could not update demos: ${error.message} Select Refresh index to retry.`;
      if (this.demoLastUpdate) this.demoMessage += ` Last update: ${this.demoLastUpdate.toLocaleString()}`;
      this.demoError = true;
    } finally {
      if (serial === this.demoRefreshSerial) {
        this.demoRefreshing = false;
        this._renderDemo();
      }
    }
  }

  async _runDemo() {
    if (!this._demoAvailable() || this.demoRunning || this.demoRefreshing || !this.demoSelect.value || !this.demoCatalog.index) return;
    if (!['empty', 'ready', 'file-error'].includes(this.controller.state)) {
      this.demoMessage = 'Finish or resolve the current playback in Player before running another demo.';
      this.demoError = true;
      this._renderDemo();
      return;
    }
    const slug = this.demoSelect.value;
    const previousModel = this.controller.model;
    const serial = ++this.demoRunSerial;
    this.demoRunning = true;
    this.demoMessage = 'Loading and validating story…';
    this.demoError = false;
    this._renderDemo();
    try {
      const loaded = await this.demoCatalog.fetchStory(slug);
      if (serial !== this.demoRunSerial || slug !== this.demoSelect.value) return;
      if (this.controller.model !== previousModel ||
          !['empty', 'ready', 'file-error'].includes(this.controller.state)) {
        throw new Error('Finish or resolve the current playback in Player before running another demo.');
      }
      const entry = this.demoCatalog.index.stories.find((story) => story.slug === slug);
      loaded.summary.fileName = entry?.title || `${slug}.json`;
      loaded.summary.slug = slug;
      await this.controller.loadModel(loaded.model, loaded.summary);
      this.toolPanel?.selectExtensionTab('player', true);
      this.controller.play().catch((error) => console.error('Demo playback:', error));
      this.demoMessage = `Started ${loaded.summary.fileName}.`;
    } catch (error) {
      if (serial !== this.demoRunSerial) return;
      this.demoMessage = `Could not run demo: ${error.message}`;
      this.demoError = true;
    } finally {
      this.demoRunning = false;
      this._renderDemo();
    }
  }

  _renderDemo() {
    if (!this.demoSelect) return;
    const story = this.demoCatalog?.index?.stories.find((entry) => entry.slug === this.demoSelect.value);
    this.demoSelect.disabled = this.demoRefreshing || this.demoRunning || !this.demoSelect.options.length;
    if (this.demoRefresh) {
      this.demoRefresh.disabled = this.demoRefreshing || this.demoRunning;
      this.demoRefresh.textContent = this.demoRefreshing ? 'Updating…' : this.demoError && !this.demoCatalog?.index ? 'Retry' : 'Refresh index';
    }
    if (this.demoRun) this.demoRun.disabled = this.demoRunning || this.demoRefreshing || !story;
    if (this.demoMeta) this.demoMeta.textContent = story
      ? `${story.slug} · ${story.frameCount} frames · ${this._formatBytes(story.sizeBytes)} · ${story.credit}` : '';
    if (this.demoStatus) {
      this.demoStatus.textContent = this.demoMessage;
      this.demoStatus.classList.toggle('is-error', this.demoError);
    }
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
    const colorModel = document.getElementById('story-color-model');
    if (colorModel) {
      colorModel.value = view.colorModel;
      colorModel.disabled = !['empty', 'ready', 'file-error'].includes(view.state);
    }
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
    const slug = document.getElementById('story-player-slug');
    if (slug) {
      slug.hidden = !summary.slug;
      slug.textContent = summary.slug || '';
    }
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
    if (view.state === 'ready' && view.error) return `Could not start playback: ${view.error.message}`;
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
