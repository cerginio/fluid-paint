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
    this.gaps = document.getElementById('story-player-gaps');
    this.demoSelect = document.getElementById('story-demo-select');
    this.demoRefresh = document.getElementById('story-demo-refresh');
    this.demoRun = document.getElementById('story-demo-run');
    this.demoStatus = document.getElementById('story-demo-status');
    this.demoMeta = document.getElementById('story-demo-meta');
    this.demoCatalog = typeof StoryDemoCatalog === 'function' ? new StoryDemoCatalog() : null;
    this.recentCard = document.getElementById('story-recent-card');
    this.recentList = document.getElementById('story-recent-list');
    this.recentStore = typeof StoryRecentStore === 'function' ? new StoryRecentStore() : null;
    this.recentEntries = [];
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
    this._refreshRecent();
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

    this._on('story-recent-clear', 'click', async () => {
      if (this.recentStore) await this.recentStore.clear();
      this._refreshRecent();
    });
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
      this._safe(() => this.controller.setSpeed(StoryToolsUI.parseSpeed(event.target.value)));
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
    this._on('story-paint-remaining', 'click', () => this._safe(() => this.controller.playEarliestRemaining()));
    this._on('story-previous-frame', 'click', () => this._safe(() => this.controller.previousUnpaintedFrame()));
    this._on('story-next-frame', 'click', () => this._safe(() => this.controller.nextFrame()));
  }

  async _load(file) {
    try {
      const result = await this.controller.loadFile(file);
      const isBackground = result && result.kind === 'background';
      // Switch tabs FIRST: remembering is bookkeeping, and making the visible
      // response wait on an IndexedDB write would delay the Player tab behind
      // storage that may be slow, or blocked and never settle at all.
      if (!isBackground && this.toolPanel) {
        this.toolPanel.selectExtensionTab('player', true);
      }
      // Only stories go in the list: a PNG background is not something the
      // player can reopen, and it would push a real story out of three slots.
      if (!isBackground) await this._remember(file);
    } catch (_) { /* controller state renders the contextual error */ }
  }

  /* Store the text AFTER the controller accepted it, so the list never offers
   * a file that fails to open. */
  async _remember(file) {
    if (!this.recentStore || !file || typeof file.text !== 'function') return;
    try {
      await this.recentStore.remember(file.name, file.size, await file.text());
    } catch (_) { /* a full or blocked quota must not fail the load */ }
    this._refreshRecent();
  }

  /*
   * Reopen a stored story.
   *
   * The controller's own loadFile() is reused by rebuilding a File from the
   * stored text, so a reopened story travels exactly the path a picked one
   * does -- same preflight, same errors, same recency bump. Reconstructing the
   * File rather than calling parse() directly is what keeps those paths from
   * drifting apart.
   */
  async _openRecent(id) {
    if (!this.recentStore) return;
    let entry = null;
    try {
      entry = await this.recentStore.read(id);
    } catch (_) { /* treated as missing below */ }
    if (!entry) {
      // Evicted by the browser, or cleared in another tab.
      await this.recentStore.forget(id);
      this._refreshRecent();
      return;
    }
    await this._load(new File([entry.text], entry.name, { type: 'application/json' }));
  }

  async _refreshRecent() {
    if (!this.recentStore) {
      if (this.recentCard) this.recentCard.hidden = true;
      return;
    }
    let entries = [];
    try {
      entries = await this.recentStore.list();
    } catch (_) { entries = []; }
    this.recentEntries = entries;
    this._renderRecent();
  }

  _renderRecent() {
    if (!this.recentCard || !this.recentList) return;
    const entries = this.recentEntries || [];
    this.recentCard.hidden = entries.length === 0;
    this.recentList.textContent = '';
    for (const entry of entries) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      // textContent, never innerHTML: the name comes from a user's filesystem.
      const name = document.createElement('span');
      name.className = 'story-recent-name';
      name.textContent = entry.name;
      const meta = document.createElement('span');
      meta.className = 'story-recent-meta';
      meta.textContent = StoryToolsUI.formatRecentMeta(entry);
      button.append(name, meta);
      button.addEventListener('click', () => this._openRecent(entry.id));
      item.append(button);
      this.recentList.append(item);
    }
  }

  static formatRecentMeta(entry) {
    const megabytes = (Number(entry.size) || 0) / (1024 * 1024);
    const size = megabytes >= 0.1 ? `${megabytes.toFixed(1)} MB`
      : `${Math.max(1, Math.round((Number(entry.size) || 0) / 1024))} KB`;
    return `${size} · ${StoryToolsUI.formatRecentAge(entry.openedAt)}`;
  }

  static formatRecentAge(openedAt, now = Date.now()) {
    const minutes = Math.floor((now - (Number(openedAt) || 0)) / 60000);
    if (!Number.isFinite(minutes) || minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
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
    const slug = this.demoSelect.value;
    const serial = ++this.demoRunSerial;
    this.demoRunning = true;
    this.demoMessage = 'Loading and validating story…';
    this.demoError = false;
    this._renderDemo();
    try {
      const loaded = await this.demoCatalog.fetchStory(slug);
      if (serial !== this.demoRunSerial || slug !== this.demoSelect.value) return;
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
    const session = view.sessionSummary;
    const hasSource = hasFile || !!session;
    const busy = view.state === 'loading';
    const background = view.backgroundSummary;
    if (this.toolPanel) this.toolPanel.setExtensionHasStory(hasSource);

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
            : view.fileError
              ? view.fileError.message
              : hasFile ? 'Story file is ready for playback.'
                : background ? 'PNG background is ready for painting.' : '';
      this.fileStatus.classList.toggle(
        'is-error',
        !!view.fileError || !!view.backgroundError
      );
    }
    if (summary) this._renderSummary(summary);
    if (session) this._renderSessionSummary(session);

    if (this.playerEmpty) this.playerEmpty.hidden = hasSource;
    if (this.playerContent) this.playerContent.hidden = !hasSource;
    if (!hasSource) return;

    const progress = view.progress;
    const total = progress.totalItems || 0;
    const painted = progress.paintedOperations || 0;
    const percent = total ? Math.round(painted / total * 100) : 0;
    if (this.progress) {
      this.progress.setAttribute('aria-valuenow', String(percent));
      this.progress.setAttribute('aria-valuetext', session
        ? `${percent}% replayed; ${progress.processedStrokes} of ${progress.totalStrokes} strokes`
        : `${percent}% painted; playhead ${progress.playheadIndex || 0} of ${total}`);
    }
    if (this.progressFill) this.progressFill.style.width = `${percent}%`;
    if (this.coverage) {
      // SPEC §2.8: ticks done / total, and the strokes finished.
      this.coverage.textContent = session
        ? `${painted.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} ticks · ` +
          `${progress.processedStrokes} / ${progress.totalStrokes} strokes`
        : `${painted.toLocaleString()} / ${total.toLocaleString()} operations · ${percent}% painted`;
    }
    if (this.playhead) {
      this.playhead.textContent = session ? 'Session — no frames'
        : `${progress.frameId || 'Frame —'} · ${progress.groupId || 'Group —'}`;
    }
    if (this.playerStatus) this.playerStatus.textContent = this._statusText(view);

    const playPauseText = view.state === 'playing' ? 'Pause' :
        view.state === 'paused' ? 'Resume' : view.state === 'completed' ? 'Replay' : 'Play';
    for (const playPause of [document.getElementById('story-play-pause')]) {
      if (!playPause) continue;
      playPause.textContent = playPauseText;
      playPause.disabled = false;
    }
    const stop = document.getElementById('story-stop');
    if (stop) stop.disabled = !['playing', 'paused'].includes(view.state);
    const restart = document.getElementById('story-restart');
    if (restart) restart.disabled = !['playing', 'paused', 'completed', 'completed-with-gaps'].includes(view.state);

    const previousFrame = document.getElementById('story-previous-frame');
    const nextFrame = document.getElementById('story-next-frame');
    const navigable = ['playing', 'paused', 'completed-with-gaps'].includes(view.state);
    // A session has no frames, and skipping strokes would change how the
    // next ones mix wet (SPEC §2.8).
    if (previousFrame) previousFrame.disabled = !!session || !navigable || !view.canPreviousFrame;
    if (nextFrame) nextFrame.disabled = !!session || !navigable || !view.canNextFrame;

    const speed = document.getElementById('story-speed');
    const colorModel = document.getElementById('story-color-model');
    if (colorModel) {
      colorModel.value = view.colorModel;
      colorModel.disabled = false;
    }
    // A session holds the engine's pigment colours, not display RGB.
    const colorModelGroup = document.getElementById('story-color-model-group');
    if (colorModelGroup) colorModelGroup.hidden = !!session;
    if (speed && StoryToolsUI.parseSpeed(speed.value) !== view.speed) speed.value = String(view.speed);
    const thickness = document.getElementById('story-thickness');
    if (thickness && Number(thickness.value) !== view.thickness) thickness.value = String(view.thickness);
    if (thickness) {
      thickness.disabled = !!session;
      thickness.title = session ? 'An exact session replays its recorded brush sizes.' : '';
    }
    this._renderThicknessValue(view.thickness);
    document.querySelectorAll('input[name="story-canvas"]').forEach((input) => {
      input.checked = input.value === view.canvasPolicy;
      input.disabled = false;
    });
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

  _renderSessionSummary(session) {
    const name = document.getElementById('story-player-file-name');
    if (name) name.textContent = session.fileName;
    const slug = document.getElementById('story-player-slug');
    if (slug) {
      slug.hidden = false;
      slug.textContent = `Session recording · ${session.mode} · ${SessionToolsUI.clock(session.durationSec)} · ` +
        `${session.strokes} strokes${session.baseline ? ' · over a background' : ''}`;
    }
  }

  /** Select value to controller speed: a multiplier, or the string 'max'. */
  static parseSpeed(value) {
    return value === 'max' ? 'max' : Number(value);
  }

  _statusText(view) {
    if (view.state === 'playing' && view.speed === 'max') {
      // Max shows only what it measured, never a promised multiplier.
      if (!view.maxRate) return 'Playing · Max (measuring…)';
      const multiplier = Math.round(view.maxRate.multiplier);
      const ticks = Math.round(view.maxRate.ticksPerSecond).toLocaleString('en-US').replace(/,/g, ' ');
      const eta = Number.isFinite(view.estimatedRemaining)
        ? ` · ${Math.ceil(view.estimatedRemaining)} s left` : '';
      return `Playing · Max ≈ ${multiplier}× · ${ticks} ticks/s${eta}`;
    }
    if (view.state === 'playing') return view.sourceKind === 'session' ? 'Replaying session…' : 'Painting story…';
    if (view.state === 'paused') return 'Playback paused.';
    if (view.state === 'completed') return 'Playback completed.';
    if (view.state === 'completed-with-gaps') {
      return `${view.progress.pendingRanges || view.pendingRanges.length} unpainted ranges remain.`;
    }
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
