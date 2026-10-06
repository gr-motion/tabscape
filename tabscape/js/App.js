/**
 * App - Main application coordinator
 * Image sampler with spring-based attractor motion
 */
class App {
  constructor() {
    this.p5Instance = null;
    this.parameterPanel = null;
    this.renderer = null;
    this.isInitialized = false;
    this.isLoadingSettings = false;
    this.isPaused = false;
    this._rippleMode = null;
    this._attractorMode = null;
    this._activeModeName = 'ripple';
    this.realtimeRecorder = new RealtimeRecorder();
    this.animationController = null;
    this._isSyncingMaskTextureTransform = false;
    this.workspacePersistence = typeof WorkspacePersistence !== 'undefined'
      ? new WorkspacePersistence()
      : null;
    this._workspaceSaveTimer = null;
    this._isRestoringWorkspace = false;
  }

  /**
   * Initialize the application
   */
  async init() {
    // Initialize animation controller before rendering parameters so controls
    // can register keyframe buttons as they are created.
    this.animationController = new AnimationController();
    window.animationController = this.animationController;

    // Initialize parameter panel
    this.parameterPanel = new ParameterPanel('parameter-panel');
    this.parameterPanel.registerParameters(PARAMETER_CONFIG);
    this.parameterPanel.render();
    this.animationController.init(this);

    // Load default settings override if present
    await this._loadDefaultSettings();

    // Initialize PaletteProcessor for Loop Generator color mode
    this._initPaletteProcessor();

    // Initialize p5.js
    this._initP5();

    // Subscribe to video scrub changes
    this._setupVideoScrubbing();

    // Subscribe to effect mode changes
    stateManager.subscribe('effectMode', (mode) => {
      this._switchMode(mode);
      this._updateModeParamVisibility(mode);
    });

    // Subscribe to force driver and null mode changes for parameter visibility
    stateManager.subscribe('forceDriver', () => this._updateNullParamVisibility());
    stateManager.subscribe('nullMode', () => this._updateNullParamVisibility());
    stateManager.subscribe('autoRippleRate', () => this._updateNullParamVisibility());
    this._updateNullParamVisibility();
    this._updateModeParamVisibility(stateManager.get('effectMode') || 'ripple');

    // Subscribe to mask mode changes for parameter visibility
    stateManager.subscribe('maskMode', (mode) => this._updateMaskVisibility(mode));
    this._updateMaskVisibility(stateManager.get('maskMode') || 'tabloop');
    this._setupMaskTextureSync();

    // Mask noise preset → set hidden noise params
    stateManager.subscribe('maskNoise', (value) => {
      if (this.isLoadingSettings) return;
      const v = parseFloat(value) || 0;
      stateManager.set('maskRingInnerNoise', v);
      stateManager.set('maskRingOuterNoise', v);
      stateManager.set('maskRingNoiseScale', this._getMaskNoiseScale(v));
    });

    // fadeToGrey: desaturate tabs below scaleMin (mask-shrunk tabs)
    stateManager.subscribe('fadeToGrey', (value) => {
      const v = parseInt(value) || 0;
      stateManager.set('postFadeEnabled', v > 0);
      stateManager.set('postFadeDriver', 'size');
      stateManager.set('postFadeStrength', v);
    });

    // When background colour changes, update postFadeTarget, page bg, and UI theme
    stateManager.subscribe('backgroundColor', (hex) => {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      // Blend 40% toward mid-grey (128)
      const mr = Math.round(r * 0.6 + 128 * 0.4);
      const mg = Math.round(g * 0.6 + 128 * 0.4);
      const mb = Math.round(b * 0.6 + 128 * 0.4);
      stateManager.set('postFadeTarget', '#' + [mr,mg,mb].map(c => c.toString(16).padStart(2,'0')).join(''));

      // Match page & panel background to canvas background
      document.body.style.background = hex;
      document.documentElement.style.setProperty('--canvas-bg', hex);

      // Dark background → inverted (light cards), light background → default (dark cards)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      document.documentElement.classList.toggle('inverted', luminance <= 0.5);
    });

    // Hue Offset is only available when Color Remap is not 'none'
    const hueOffsetParam = this.parameterPanel.getParameter('imageHueOffset');
    const colorRemapParam = this.parameterPanel.getParameter('colorRemapMode');
    if (hueOffsetParam && colorRemapParam) {
      hueOffsetParam.setDisabled(colorRemapParam.value === 'none');
      colorRemapParam.onChange = (value) => {
        hueOffsetParam.setDisabled(value === 'none');
      };
    }

    // Re-sync loop duration when trim changes
    stateManager.subscribe('loopTrim', () => this._syncLoopDuration());

    // Subscribe to texture mode changes
    stateManager.subscribe('textureMode', (mode) => {
      this._updateTextureVisibility(mode);
      this._applyTextureMode(mode);
    });
    stateManager.subscribe('texturePlaybackSpeed', (speed) => {
      this._applyTexturePlaybackSpeed(speed);
      this._syncLoopDuration();
    });
    stateManager.subscribe('extendScope', () => {
      this._updateSliderScopes();
      this._applyTexturePlaybackSpeed();
      this._syncLoopDuration();
    });
    stateManager.subscribeAll((key, value) => {
      if (!this._isRestoringWorkspace && (key === '__undoRedo' || key !== '_motion')) {
        this._scheduleLocalStateSave();
      }
      if (key === 'extendScope' || key === '__undoRedo') return;
      const param = this.parameterPanel && this.parameterPanel.getParameter
        ? this.parameterPanel.getParameter(key)
        : null;
      if (param && param.type === 'slider') {
        this._updateSliderScopeWarning(param, key, value);
      }
    });
    this._updateTextureVisibility(stateManager.get('textureMode') || 'default');
    this._updateSliderScopes();
    this._setupWorkspacePersistence();
    await this._restoreLocalWorkspace();

    // Auto-load default texture on startup
    this._defaultTextureLoaded = false;
    setTimeout(() => {
      const mode = stateManager.get('textureMode') || 'default';
      if (mode === 'default') {
        this._loadDefaultTexture();
      }
    }, 200);

    // Global drag-and-drop for JSON settings files
    this._setupGlobalJsonDrop();

    this.isInitialized = true;
    console.log('Tabscape initialized');
  }

  _setupWorkspacePersistence() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._flushLocalStateSave();
    });
    window.addEventListener('beforeunload', () => this._flushLocalStateSave());
  }

  _scheduleLocalStateSave() {
    if (!this.workspacePersistence || this._isRestoringWorkspace || !this.parameterPanel) return;
    clearTimeout(this._workspaceSaveTimer);
    this._workspaceSaveTimer = setTimeout(() => this._flushLocalStateSave(), 250);
  }

  _flushLocalStateSave() {
    if (!this.workspacePersistence || this._isRestoringWorkspace || !this.parameterPanel) return;
    clearTimeout(this._workspaceSaveTimer);
    this._workspaceSaveTimer = null;
    this.workspacePersistence.saveSnapshot({
      settings: this._buildLocalWorkspaceSettings()
    });
  }

  _buildLocalWorkspaceSettings() {
    const state = stateManager.getAll();
    const settings = {};
    for (const [key, value] of Object.entries(state)) {
      const param = this.parameterPanel.parameters.get(key);
      if (param && param.type === 'image') continue;
      if (value instanceof File || value instanceof Blob) continue;
      settings[key] = value;
    }

    const locks = {};
    this.parameterPanel.parameters.forEach((param, key) => {
      if (param.locked) locks[key] = true;
    });
    if (Object.keys(locks).length > 0) settings._locks = locks;

    Object.assign(settings, this.parameterPanel._getExtraSettingsData());
    settings._persistedMediaState = this._collectPersistedMediaState();
    return settings;
  }

  _collectPersistedMediaState() {
    const mediaState = {};
    if (!this.parameterPanel || !this.parameterPanel.parameters) return mediaState;
    this.parameterPanel.parameters.forEach((param, key) => {
      if (!param || param.type !== 'image' || typeof param._getSampler !== 'function') return;
      const sampler = param._getSampler();
      if (sampler && sampler.hasVideo && sampler.hasVideo()) {
        mediaState[key] = {
          progress: sampler.getVideoProgress ? sampler.getVideoProgress() : 0,
          paused: !sampler.isPlaying
        };
      }
    });
    return mediaState;
  }

  async _persistParameterMedia(id, file) {
    if (!this.workspacePersistence) return;
    await this.workspacePersistence.saveMedia(id, file);
    this._scheduleLocalStateSave();
  }

  async _clearPersistedParameterMedia(id) {
    if (!this.workspacePersistence) return;
    await this.workspacePersistence.removeMedia(id);
    this._scheduleLocalStateSave();
  }

  async _restoreLocalWorkspace() {
    if (!this.workspacePersistence || !this.parameterPanel) return false;
    const snapshot = this.workspacePersistence.loadSnapshot();
    if (!snapshot || !snapshot.settings) return false;

    this._isRestoringWorkspace = true;
    try {
      this.parameterPanel._applySettings(snapshot.settings);
      await this._restorePersistedMedia(snapshot.settings._persistedMediaState || {});
      stateManager.clearHistory();
      if (this.animationController && this.animationController._clearTimelineHistory) {
        this.animationController._clearTimelineHistory();
      }
      return true;
    } catch (err) {
      console.warn('Failed to restore local workspace:', err);
      return false;
    } finally {
      this._isRestoringWorkspace = false;
    }
  }

  async _restorePersistedMedia(mediaState) {
    if (!this.workspacePersistence || !this.parameterPanel) return;
    const entries = await this.workspacePersistence.loadAllMedia();
    for (const entry of entries) {
      if (!entry || !entry.id || !this._shouldRestorePersistedMedia(entry.id)) continue;
      const param = this.parameterPanel.getParameter(entry.id);
      if (!param || typeof param.restorePersistedMedia !== 'function') continue;
      await param.restorePersistedMedia(entry, mediaState[entry.id] || null);
    }
  }

  _shouldRestorePersistedMedia(id) {
    if (id === 'imageSource') {
      return (stateManager.get('textureMode') || 'default') === 'custom';
    }
    if (id === 'maskCustomImage') {
      // Always restore the file; Parameter._handleFile only loads it into the
      // shared mask sampler while Custom mode is active.
      return true;
    }
    return true;
  }

  _getMaskNoiseScale(value) {
    const stops = [
      { value: 0, scale: 0.5 },
      { value: 33, scale: 0.5 },
      { value: 66, scale: 0.6 },
      { value: 99, scale: 0.8 }
    ];
    const v = Math.max(stops[0].value, Math.min(stops[stops.length - 1].value, value));
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (v >= a.value && v <= b.value) {
        const range = b.value - a.value;
        const t = range === 0 ? 0 : (v - a.value) / range;
        return a.scale + (b.scale - a.scale) * t;
      }
    }
    return stops[stops.length - 1].scale;
  }

  _setupMaskTextureSync() {
    stateManager.subscribe('maskSyncWithTexture', (enabled) => {
      if (enabled) this._syncMaskTransformFromTexture();
    });

    ['texturePositionX', 'texturePositionY', 'textureScale', 'textureRotation'].forEach(key => {
      stateManager.subscribe(key, () => {
        if (stateManager.get('maskSyncWithTexture')) this._syncMaskTransformFromTexture();
      });
    });

    ['maskPositionX', 'maskPositionY', 'maskScale', 'maskRotation'].forEach(key => {
      stateManager.subscribe(key, () => {
        if (stateManager.get('maskSyncWithTexture')) this._syncTextureTransformFromMask();
      });
    });

    if (stateManager.get('maskSyncWithTexture')) this._syncMaskTransformFromTexture();
  }

  _setLinkedParameterValue(key, value) {
    stateManager.set(key, value, { skipHistory: true });
    const param = this.parameterPanel && this.parameterPanel.getParameter
      ? this.parameterPanel.getParameter(key)
      : null;
    if (param) param.value = value;

    const el = document.getElementById(key);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;

    const row = el.closest('.parameter');
    const display = row ? row.querySelector('.parameter__value') : null;
    if (display) {
      const displayValue = param && param.formatValue ? param.formatValue(value) : value;
      if (display.tagName === 'INPUT') display.value = displayValue;
      else display.textContent = displayValue;
    }
  }

  _syncMaskTransformFromTexture() {
    if (this._isSyncingMaskTextureTransform) return;
    this._isSyncingMaskTextureTransform = true;
    this._setLinkedParameterValue('maskPositionX', stateManager.get('texturePositionX') ?? 0);
    this._setLinkedParameterValue('maskPositionY', stateManager.get('texturePositionY') ?? 0);
    this._setLinkedParameterValue('maskScale', stateManager.get('textureScale') ?? 100);
    this._setLinkedParameterValue('maskRotation', stateManager.get('textureRotation') ?? 0);
    this._isSyncingMaskTextureTransform = false;
  }

  _syncTextureTransformFromMask() {
    if (this._isSyncingMaskTextureTransform) return;
    this._isSyncingMaskTextureTransform = true;
    this._setLinkedParameterValue('texturePositionX', stateManager.get('maskPositionX') ?? 0);
    this._setLinkedParameterValue('texturePositionY', stateManager.get('maskPositionY') ?? 0);
    this._setLinkedParameterValue('textureScale', stateManager.get('maskScale') ?? 100);
    this._setLinkedParameterValue('textureRotation', stateManager.get('maskRotation') ?? 0);
    this._isSyncingMaskTextureTransform = false;
  }

  _setupGlobalJsonDrop() {
    // Prevent default drag behavior on the whole window
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    window.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;

      const file = e.dataTransfer.files[0];
      // Only handle JSON files — let other drop zones handle images/videos
      if (!file.name.endsWith('.json') && file.type !== 'application/json') return;

      e.preventDefault();
      e.stopPropagation();

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const settings = JSON.parse(ev.target.result);
          this.parameterPanel._processLoadedSettings(settings);
        } catch (err) {
          console.error('Failed to parse settings JSON:', err);
        }
      };
      reader.readAsText(file);
    });
  }

  /**
   * Set up video scrubbing via slider
   */
  _setupVideoScrubbing() {
    let isScrubbingMain = false;

    const setupScrubTracking = (sliderId, setFlag) => {
      const slider = document.getElementById(sliderId);
      if (slider) {
        slider.addEventListener('mousedown', () => setFlag(true));
        slider.addEventListener('mouseup', () => setFlag(false));
        slider.addEventListener('touchstart', () => setFlag(true));
        slider.addEventListener('touchend', () => setFlag(false));
      }
    };

    setTimeout(() => {
      setupScrubTracking('videoScrub', (v) => { isScrubbingMain = v; });
    }, 100);

    stateManager.subscribe('videoScrub', (value) => {
      if (imageSampler && imageSampler.hasVideo()) {
        imageSampler.seekPercent(value / 100);
      }
    });

    this._videoScrubUpdateInterval = setInterval(() => {
      if (!isScrubbingMain && imageSampler && imageSampler.hasVideo()) {
        const progress = imageSampler.getVideoProgress() * 100;
        const slider = document.getElementById('videoScrub');
        if (slider && Math.abs(parseFloat(slider.value) - progress) > 0.5) {
          slider.value = progress;
          const display = slider.parentElement?.querySelector('.parameter-value');
          if (display) {
            display.textContent = progress.toFixed(1);
          }
        }
      }
    }, 100);
  }

  _initP5() {
    const self = this;

    const sketch = (p) => {
      p.setup = function() {
        const canvasContainer = document.getElementById('canvas-container');
        const canvas = p.createCanvas(
          canvasContainer.offsetWidth,
          canvasContainer.offsetHeight
        );
        canvas.parent('canvas-container');
        p.rectMode(p.CORNER);

        // Initialize renderer and image sampler (WebGL instanced, with Canvas 2D fallback)
        self.renderer = new WebGLGridRenderer(p);
        imageSampler = new ImageSampler(p);
        maskSampler = new ImageSampler(p);
        self.renderer._maskProcessor = new MaskProcessor(p);

        // Initialize effect modes
        rippleManager = new RippleManager();
        self._rippleMode = new RippleMode(rippleManager, cursorTracker);
        self._attractorMode = new AttractorMode(cursorTracker);

        // Set initial mode
        const initialMode = stateManager.get('effectMode') || 'ripple';
        self._switchMode(initialMode);

        // Set up mouse enter/leave events on canvas element
        canvas.mouseOver(() => cursorTracker.setActive(true));
        canvas.mouseOut(() => cursorTracker.setActive(false));

        // Store p5 instance
        self.p5Instance = p;
      };

      p.keyPressed = function() {
        // Spacebar toggles pause
        if (p.keyCode === 32) {
          self.isPaused = !self.isPaused;
          if (self.renderer) {
            self.renderer.setPaused(self.isPaused);
          }
          if (rippleManager) {
            rippleManager.setPaused(self.isPaused);
          }
          if (self.isPaused) {
            cursorTracker.freeze();
          } else {
            cursorTracker.unfreeze();
            if (self.renderer) {
              self.renderer.resetManualScaleOffsets();
            }
          }
          return false;
        }
      };

      // Undo/Redo via native keydown so we can preventDefault on the browser
      document.addEventListener('keydown', (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;

        // Skip when focus is inside a text input (but not range/color/checkbox etc.)
        const active = document.activeElement;
        if (active && (active.tagName === 'TEXTAREA' ||
            (active.tagName === 'INPUT' && ['text', 'search', 'url', 'email', 'number', 'password'].includes(active.type)))) return;

        // Undo: Cmd+Z / Ctrl+Z
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          if (stateManager.undo()) self._syncUIFromState();
          return;
        }
        // Redo: Cmd+Shift+Z / Ctrl+Shift+Z
        if (e.key === 'z' && e.shiftKey) {
          e.preventDefault();
          if (stateManager.redo()) self._syncUIFromState();
          return;
        }
        // Redo: Ctrl+Y (Win alternative)
        if (e.key === 'y') {
          e.preventDefault();
          if (stateManager.redo()) self._syncUIFromState();
        }
      });

      p.mousePressed = function(event) {
        if (!self.isPaused && self.renderer && self.renderer._activeMode) {
          // Ignore clicks whose DOM target is a UI element (parameter panel,
          // popups, etc.) — only the canvas itself should trigger ripples.
          const target = event && event.target;
          const canvasEl = (p.canvas || (p._renderer && p._renderer.canvas));
          if (target && canvasEl && target !== canvasEl) return;
          const isInCanvas = p.mouseX >= 0 && p.mouseX <= p.width &&
                            p.mouseY >= 0 && p.mouseY <= p.height;
          if (isInCanvas) {
            const state = stateManager.getRef();
            self.renderer._activeMode.onMousePressed(p.mouseX, p.mouseY, state);
          }
        }
      };

      p.draw = function() {
        // Only update dynamics when not paused
        if (!self.isPaused) {
          const deltaTime = p.deltaTime / 1000;
          cursorTracker.update(p.mouseX, p.mouseY, deltaTime);

          const isInCanvas = p.mouseX >= 0 && p.mouseX <= p.width &&
                            p.mouseY >= 0 && p.mouseY <= p.height;
          if (isInCanvas && !cursorTracker.isActive) {
            cursorTracker.setActive(true);
          }

          // Update ripple manager (expanding ripple rings)
          // Skip during export — export drives ripples with deterministic clock
          if (rippleManager && rippleManager.hasActiveRipples() && !self.renderer._exportInProgress) {
            const rippleSpeed = stateManager.get('rippleSpeed') || 300;
            rippleManager.update(rippleSpeed);
          }
        }

        // Loop trim with GPU crossfade using cloned video
        if (imageSampler && imageSampler.hasVideo() && imageSampler.isPlaying) {
          const trim = (stateManager.get('loopTrim') ?? 100) / 100;
          const videoDur = imageSampler.getVideoDuration();
          const trimmedEnd = videoDur * trim;
          const excess = videoDur - trimmedEnd;
          const maxFade = Math.min(2, excess);
          const currentTime = imageSampler.getVideoTime();

          if (maxFade > 0 && currentTime >= trimmedEnd) {
            // Create clone video if not yet started
            if (!self._fadeClone && !self._fadeSwapping) {
              const srcElt = imageSampler.video.elt;
              const clone = document.createElement('video');
              clone.src = srcElt.currentSrc || srcElt.src;
              clone.crossOrigin = 'anonymous';
              clone.muted = true;
              clone.playsInline = true;
              clone.playbackRate = self._getTexturePlaybackRate();
              clone.currentTime = 0;
              clone.play();
              self._fadeClone = clone;
              self._fadeCloneReady = false;
              self._fadeStartTime = null;
            }

            // Wait until clone has decoded a frame before starting the crossfade
            // to prevent a jump from 0 → mid-fade
            if (self._fadeClone && !self._fadeCloneReady) {
              if (self._fadeClone.readyState >= 2) {
                self._fadeCloneReady = true;
                self._fadeStartTime = currentTime;
              }
            }

            let fadeProgress = 0;
            if (self._fadeCloneReady && self._fadeStartTime != null) {
              fadeProgress = Math.min(1, (currentTime - self._fadeStartTime) / maxFade);
              if (!self._fadeSwapping) self._loopFadeAmount = fadeProgress;
            }

            // Clone video is uploaded directly to GPU in WebGLGridRenderer

            if (fadeProgress >= 1 && !self._fadeSwapping) {
              // Fade complete — seek primary to clone's position, keep showing clone until seeked
              self._fadeSwapping = true;
              self._loopFadeAmount = 1.0;
              const targetTime = self._fadeClone.currentTime;
              const elt = imageSampler.video.elt;
              elt.currentTime = targetTime;
              const onSeeked = () => {
                elt.removeEventListener('seeked', onSeeked);
                // Wait 2 extra frames for the decoded frame to actually render
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    // Smooth fade-back from clone to primary over ~150ms
                    self._fadeBackStart = performance.now();
                  });
                });
              };
              elt.addEventListener('seeked', onSeeked);
            }

            // Smooth fade-back after swap
            if (self._fadeBackStart) {
              const elapsed = performance.now() - self._fadeBackStart;
              const fadeBackDuration = 150;
              self._loopFadeAmount = Math.max(0, 1 - elapsed / fadeBackDuration);
              if (self._loopFadeAmount <= 0) {
                self._loopFadeAmount = 0;
                self._fadeBackStart = null;
                self._fadeSwapping = false;
                self._fadeCloneReady = false;
                self._fadeStartTime = null;
                if (self._fadeClone) {
                  self._fadeClone.pause();
                  self._fadeClone.removeAttribute('src');
                  self._fadeClone.load();
                  self._fadeClone = null;
                }
              }
            }
          } else if (trimmedEnd > 0 && maxFade <= 0 && currentTime >= trimmedEnd) {
            imageSampler.seek(0);
            self._loopFadeAmount = 0;
          } else if (!self._fadeSwapping) {
            self._loopFadeAmount = 0;
            self._fadeCloneReady = false;
            self._fadeStartTime = null;
            // Clean up clone if trim was changed while fading
            if (self._fadeClone) {
              self._fadeClone.pause();
              self._fadeClone.removeAttribute('src');
              self._fadeClone.load();
              self._fadeClone = null;
            }
          }
        } else {
          self._loopFadeAmount = 0;
        }

        // Background colour
        p.background(stateManager.get('backgroundColor') || '#FFFEF7');


        // Update and render grid
        if (self.renderer) {
          if (!self.isPaused) {
            self.renderer.update();
          }
          self.renderer.render();
        }

        // Real-time recording capture (no-op when not recording)
        if (self.realtimeRecorder && self.realtimeRecorder.isRecording) {
          self.realtimeRecorder.captureFrame(p.drawingContext.canvas);
        }

        // Handle manual scale adjustment when paused with mouse held
        if (self.isPaused && p.mouseIsPressed && p.mouseButton === p.LEFT && self.renderer) {
          const isInCanvas = p.mouseX >= 0 && p.mouseX <= p.width &&
                            p.mouseY >= 0 && p.mouseY <= p.height;
          if (isInCanvas) {
            const deltaTime = p.deltaTime / 1000;
            const isGrow = !p.keyIsDown(p.SHIFT);
            self.renderer.applyManualScale(p.mouseX, p.mouseY, isGrow, deltaTime);
          }
        }

        // Show/hide pause indicator
        if (!self._pauseOverlay) {
          const overlay = document.createElement('div');
          overlay.className = 'pause-overlay';
          overlay.innerHTML = '<div class="pause-overlay__title">Paused</div>' +
            '<div class="pause-overlay__hint">Press space to resume</div>';
          document.getElementById('canvas-container').appendChild(overlay);
          self._pauseOverlay = overlay;
        }
        self._pauseOverlay.style.display = self.isPaused ? '' : 'none';
      };

      p.windowResized = function() {
        self.fitCanvasToTexture();
      };
    };

    new p5(sketch);
  }

  /**
   * Sync all UI elements to match current stateManager values.
   * Called after undo/redo to bring DOM in line with restored state.
   */
  _syncUIFromState() {
    if (!this.parameterPanel) return;
    const state = stateManager.getAll();

    this.parameterPanel.parameters.forEach((param, key) => {
      const value = state[key];
      if (value === undefined) return;

      // Update param object
      param.value = value;

      // Update DOM element
      const el = document.getElementById(key);
      if (!el) return;

      if (el.type === 'checkbox') {
        el.checked = value;
      } else if (el.tagName === 'SELECT') {
        el.value = value;
      } else {
        el.value = value;
      }

      // Update value display for sliders
      const container = el.closest('.parameter');
      if (container) {
        const display = container.querySelector('.parameter__value');
        if (display) {
          const displayValue = param.formatValue ? param.formatValue(value) : value;
          if (display.tagName === 'INPUT') display.value = displayValue;
          else display.textContent = displayValue;
        }
      }

      // Button group: update active button
      if (param.type === 'button-group' && param._buttonRow) {
        param._buttonRow.querySelectorAll('.parameter__group-btn').forEach(b => {
          b.classList.toggle('parameter__group-btn--active', String(b.dataset.value) === String(value));
        });
      }
    });

    // Sync range parameters (dual-handle sliders with separate start/end keys)
    this.parameterPanel.parameters.forEach((param) => {
      if (param.type !== 'range') return;
      const loVal = state[param.startKey];
      const hiVal = state[param.endKey];
      const loEl = document.getElementById(param.startKey);
      const hiEl = document.getElementById(param.endKey);
      if (loEl && loVal !== undefined) {
        loEl.value = loVal;
        loEl.dispatchEvent(new Event('input'));
      }
      if (hiEl && hiVal !== undefined) {
        hiEl.value = hiVal;
        hiEl.dispatchEvent(new Event('input'));
      }
    });

    this._updateSliderScopes();
  }

  /**
   * Get the current state
   */
  getState() {
    return stateManager.getAll();
  }

  /**
   * Export current configuration as JSON
   */
  exportConfig() {
    return JSON.stringify(stateManager.getAll(), null, 2);
  }

  /**
   * Import configuration from JSON
   */
  importConfig(jsonString) {
    try {
      const config = JSON.parse(jsonString);
      Object.entries(config).forEach(([key, value]) => {
        this.parameterPanel.updateParameter(key, value);
      });
      return true;
    } catch (e) {
      console.error('Failed to import config:', e);
      return false;
    }
  }

  /**
   * Get the renderer instance
   */
  getRenderer() {
    return this.renderer;
  }

  /**
   * Initialize the PaletteProcessor with v3 defaults
   */
  async _initPaletteProcessor() {
    paletteProcessor = new PaletteProcessor();
    try {
      const resp = await fetch('../loop-generator-v3/assets/defaults.json');
      if (resp.ok) {
        const defaults = await resp.json();
        const skip = ['gridDensity', 'colorMode', 'backgroundColor', 'scaleMin', 'scaleMax',
          'scaleVariation', 'ringRadius', 'ringThickness', 'ringInnerSoftness', 'ringOuterSoftness',
          'ringNoise', 'ringInnerNoise', 'ringOuterNoise', 'ringNoiseScale', 'ringNoiseSeed',
          'velocityPushAmount', 'pushDecay', 'colourSource', 'colourPosition',
          'videoBlendEnabled', 'videoBlendMode', 'videoBlendAmount', 'invertImage',
          'imageHueOffset', 'videoScrub', 'imageSamplerEnabled', 'imageMappingMode',
          'imagePositionX', 'imagePositionY', 'imageScaleX', 'imageScaleY', 'imageRotation',
          'imageColorOpacity', 'imageBrightnessToScale', 'imageBrightnessScaleMin',
          'imageBrightnessScaleMax', 'imageSaturationToScale', 'imageSaturationScaleMin',
          'imageSaturationScaleMax', 'customGradientStops', 'hueGradMapStops',
          'curvePoints', 'heatmapColorOrder'];
        for (const [key, value] of Object.entries(defaults)) {
          if (!skip.includes(key) && stateManager.get(key) === undefined) {
            stateManager.set(key, value);
          }
        }
      }
    } catch (e) {
      // defaults not available — PaletteProcessor will use its own defaults
    }
    paletteProcessor.bindToStateManager();
    paletteProcessor.syncFromState();
  }

  /**
   * Switch the active effect mode
   */
  _switchMode(modeName) {
    this._activeModeName = modeName;
    if (!this.renderer) return;

    const mode = modeName === 'attractor' ? this._attractorMode : this._rippleMode;
    this.renderer.setMode(mode);
  }

  /**
   * Show/hide parameters based on active effect mode
   */
  _updateModeParamVisibility(modeName) {
    const setVisible = (id, visible) => {
      const el = document.getElementById(id);
      if (el) {
        const row = el.closest('.parameter');
        if (row) row.style.display = visible ? '' : 'none';
      }
    };

    const isRipple = modeName === 'ripple';
    const isSpring = modeName === 'attractor';

    // Ripple-only params
    setVisible('rippleDecay', isRipple);

    // Spring-only params
    setVisible('attractorRepulsion', isSpring);
    setVisible('springDamping', isSpring);
    setVisible('springStrength', isSpring);
  }

  /**
   * Show/hide null-related parameters based on forceDriver and nullMode
   */
  _updateNullParamVisibility() {
    const forceDriver = stateManager.get('forceDriver') || 'cursor';
    const nullMode = stateManager.get('nullMode') || 'noise';
    const isNull = forceDriver === 'null';
    const isNoise = nullMode === 'noise';
    const isPosition = nullMode === 'position';

    // Helper to show/hide a parameter row by its id
    const setVisible = (id, visible) => {
      const el = document.getElementById(id);
      if (el) {
        const row = el.closest('.parameter');
        if (row) row.style.display = visible ? '' : 'none';
      }
    };

    // nullMode toggle: only visible when forceDriver is 'null'
    setVisible('nullMode', isNull);

    // Noise null params: visible when null + noise mode
    setVisible('noiseNullCount', isNull && isNoise);
    setVisible('noiseNullFreq', isNull && isNoise);
    setVisible('noiseNullStrength', isNull && isNoise);

    // Position null params: visible when null + position mode
    setVisible('nullPositionX', isNull && isPosition);
    setVisible('nullPositionY', isNull && isPosition);

    // Auto ripple rate: only visible when force driver is null
    setVisible('autoRippleRate', isNull);

    // Pulse params: visible when force driver is null
    setVisible('rippleSpeed', isNull);
    setVisible('rippleWidth', isNull);
    setVisible('pulseStrength', isNull);
  }


  /**
   * Show/hide texture sub-parameters based on texture mode
   */
  _updateTextureVisibility(mode) {
    const setVisible = (id, visible) => {
      const el = document.getElementById(id);
      if (el) {
        const row = el.closest('.parameter');
        if (row) row.style.display = visible ? '' : 'none';
      }
    };

    // Show/hide mode-specific params
    setVisible('imageSource', mode === 'custom');
    setVisible('texturePlaybackSpeed', mode === 'default');
    this._updateSliderScopes();
    // Create default video controls once, then show/hide
    if (!this._defaultVideoControls) {
      this._createDefaultVideoControls();
    }
    if (this._defaultVideoControls) {
      this._defaultVideoControls.style.display = mode === 'default' ? 'flex' : 'none';
    }

    // In default mode: disable 'none' option, force to 'full' if currently 'none'
    const colorRemapParam = this.parameterPanel ? this.parameterPanel.getParameter('colorRemapMode') : null;
    const hueOffsetParam = this.parameterPanel ? this.parameterPanel.getParameter('imageHueOffset') : null;
    if (colorRemapParam) {
      const selectEl = document.getElementById('colorRemapMode');
      const noneOption = selectEl ? selectEl.querySelector('option[value="none"]') : null;
      if (mode === 'custom') {
        // Custom mode: all options available
        if (noneOption) noneOption.disabled = false;
      } else {
        // Default mode: disable 'none', force to 'full' if currently 'none'
        if (noneOption) noneOption.disabled = true;
        if (colorRemapParam.value === 'none') {
          colorRemapParam.setValue('full');
          stateManager.set('colorRemapMode', 'full');
          if (selectEl) selectEl.value = 'full';
        }
      }
      if (hueOffsetParam) {
        hueOffsetParam.setDisabled(colorRemapParam.value === 'none');
      }
    }
  }

  _createDefaultVideoControls() {
    // Insert after the textureMode parameter row
    const textureModeEl = document.getElementById('textureMode');
    if (!textureModeEl) return;
    const row = textureModeEl.closest('.parameter');
    if (!row) return;

    const controls = document.createElement('div');
    controls.className = 'parameter__video-controls';
    controls.id = 'defaultTextureControls';

    const playBtn = document.createElement('button');
    playBtn.className = 'parameter__video-btn';
    playBtn.innerHTML = '\u25b6'; // starts paused
    playBtn.title = 'Play/Pause';

    const progressBar = document.createElement('input');
    progressBar.type = 'range';
    progressBar.className = 'parameter__video-progress';
    progressBar.min = 0;
    progressBar.max = 1000;
    progressBar.value = 0;

    // Lock icon for video scrub
    const lock = document.createElement('span');
    lock.className = 'parameter__lock';
    lock.innerHTML = '<svg width="8" height="10" viewBox="0 0 8 10" fill="none"><rect x="0.5" y="4.5" width="7" height="5" rx="1" stroke="currentColor"/><path d="M2 4.5V3a2 2 0 1 1 4 0v1.5" stroke="currentColor" fill="none"/></svg>';
    lock.title = 'Lock to prevent randomization';
    this._defaultVideoScrubLocked = false;
    lock.addEventListener('click', (e) => {
      e.preventDefault();
      this._defaultVideoScrubLocked = !this._defaultVideoScrubLocked;
      lock.classList.toggle('parameter__lock--active', this._defaultVideoScrubLocked);
    });

    const progressWrap = document.createElement('div');
    progressWrap.style.cssText = 'position:relative;flex:1;display:flex;align-items:center;';
    progressBar.style.width = '100%';
    progressBar.style.background = 'transparent';
    progressBar.style.position = 'relative';
    progressBar.style.zIndex = '2';
    const trackBg = document.createElement('div');
    trackBg.style.cssText = 'position:absolute;top:50%;left:0;right:0;height:4px;transform:translateY(-50%);background:var(--input-border);border-radius:2px;pointer-events:none;z-index:0;';
    const trimOverlay = document.createElement('div');
    trimOverlay.style.cssText = 'position:absolute;top:50%;right:0;height:4px;transform:translateY(-50%);background:rgba(0,0,0,0.5);border-radius:0 2px 2px 0;pointer-events:none;z-index:1;';
    trimOverlay.style.width = '0%';
    progressWrap.appendChild(trackBg);
    progressWrap.appendChild(trimOverlay);
    progressWrap.appendChild(progressBar);

    const updateTrimOverlay = () => {
      const trim = stateManager.get('loopTrim') ?? 100;
      trimOverlay.style.width = (100 - trim) + '%';
    };
    stateManager.subscribe('loopTrim', updateTrimOverlay);
    updateTrimOverlay();

    const timeLabel = document.createElement('input');
    timeLabel.type = 'text';
    timeLabel.className = 'parameter__value parameter__value--editable';
    timeLabel.size = 5;
    timeLabel.style.cssText = 'font-variant-numeric:tabular-nums;width:calc(48px * var(--s));flex:0 0 auto;';
    timeLabel.value = '0.0s';

    controls.appendChild(playBtn);
    controls.appendChild(progressWrap);
    controls.appendChild(timeLabel);
    controls.appendChild(lock);
    row.parentNode.insertBefore(controls, row.nextSibling);

    this._defaultVideoControls = controls;
    this._defaultPlayBtn = playBtn;
    this._defaultProgressBar = progressBar;

    let isScrubbing = false;

    playBtn.addEventListener('click', () => {
      const mode = stateManager.get('textureMode');
      if (imageSampler && imageSampler.hasVideo()) {
        imageSampler.togglePlay();
        playBtn.innerHTML = imageSampler.isPlaying ? '\u275a\u275a' : '\u25b6';
      }
    });

    progressBar.addEventListener('mousedown', () => { isScrubbing = true; });
    progressBar.addEventListener('mouseup', () => { isScrubbing = false; });
    progressBar.addEventListener('touchstart', () => { isScrubbing = true; });
    progressBar.addEventListener('touchend', () => { isScrubbing = false; });

    progressBar.addEventListener('input', (e) => {
      const pct = parseFloat(e.target.value) / 1000;
      const mode = stateManager.get('textureMode');
      if (imageSampler && imageSampler.hasVideo()) {
        imageSampler.seekPercent(pct);
      }
    });

    const writeTime = (secs) => {
      if (document.activeElement !== timeLabel) {
        timeLabel.value = secs.toFixed(1) + 's';
      }
    };

    setInterval(() => {
      if (isScrubbing) return;
      if (imageSampler && imageSampler.hasVideo()) {
        const progress = imageSampler.getVideoProgress();
        progressBar.value = progress * 1000;
        const dur = imageSampler.getVideoDuration();
        if (dur > 0 && isFinite(dur)) writeTime(progress * dur);
      }
    }, 100);

    progressBar.addEventListener('input', () => {
      const dur = imageSampler && imageSampler.hasVideo() ? imageSampler.getVideoDuration() : 0;
      if (dur > 0 && isFinite(dur)) writeTime((parseFloat(progressBar.value) / 1000) * dur);
    });

    const commitTimeEdit = () => {
      if (!(imageSampler && imageSampler.hasVideo())) return;
      const dur = imageSampler.getVideoDuration();
      if (!(dur > 0 && isFinite(dur))) return;
      const typed = parseFloat(timeLabel.value);
      if (isNaN(typed)) { writeTime((parseFloat(progressBar.value) / 1000) * dur); return; }
      const secs = Math.max(0, Math.min(dur, typed));
      const pct = secs / dur;
      progressBar.value = pct * 1000;
      imageSampler.seekPercent(pct);
      timeLabel.value = secs.toFixed(1) + 's';
    };
    timeLabel.addEventListener('blur', commitTimeEdit);
    timeLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); timeLabel.blur(); }
    });
  }

  /**
   * Apply texture mode change — load default or clear for custom
   */
  _applyTextureMode(mode) {
    if (mode === 'default') {
      this._loadDefaultTexture();
    } else if (mode === 'custom') {
      // Clear the default texture so user starts fresh
      if (this._defaultTextureLoaded && imageSampler) {
        imageSampler.clearMedia();
        this._defaultTextureLoaded = false;
      }
      // Custom image with no video: default 10s loop
      this._syncLoopDuration();
    }
  }

  _getTexturePlaybackRate(value = stateManager.get('texturePlaybackSpeed')) {
    const max = stateManager.get('extendScope') ? 3 : 1;
    return Math.max(0.45, Math.min(max, parseFloat(value) || 1));
  }

  _updateSliderScopes() {
    if (!this.parameterPanel || !this.parameterPanel.parameters) return;
    const factor = stateManager.get('extendScope') ? 3 : 1;

    this.parameterPanel.parameters.forEach((param, key) => {
      if (!param || param.type !== 'slider') return;

      const baseMin = param.baseMin ?? param.min ?? 0;
      const baseMax = param.baseMax ?? param.max ?? 100;
      const nextMin = factor > 1 && key === 'maskRingRadius'
        ? 0
        : (factor > 1 && baseMin < 0 ? baseMin * factor : baseMin);
      const nextMax = factor > 1 && key === 'maskRingRadius'
        ? 1000
        : (factor > 1 && baseMax > 0 ? baseMax * factor : baseMax);
      param.min = nextMin;
      param.max = nextMax;

      const slider = document.getElementById(key);
      if (slider) {
        slider.min = nextMin;
        slider.max = nextMax;
      }

      const current = parseFloat(stateManager.get(key));
      if (!Number.isFinite(current)) return;
      const clamped = Math.max(nextMin, Math.min(nextMax, current));
      if (clamped !== current) {
        param.value = clamped;
        stateManager.set(key, clamped, { skipHistory: true });
        if (slider) slider.value = clamped;
        const row = slider ? slider.closest('.parameter') : null;
        const display = row ? row.querySelector('.parameter__value') : null;
        if (display) {
          const displayValue = param.formatValue ? param.formatValue(clamped) : clamped;
          if (display.tagName === 'INPUT') display.value = displayValue;
          else display.textContent = displayValue;
        }
      }
      this._updateSliderScopeWarning(param, key, clamped);
    });
  }

  _updateSliderScopeWarning(param, key, value = stateManager.get(key)) {
    const slider = document.getElementById(key);
    const row = slider ? slider.closest('.parameter') : param._container;
    if (!row) return;

    const baseMin = param.baseMin ?? param.min ?? 0;
    const baseMax = param.baseMax ?? param.max ?? 100;
    const numeric = parseFloat(value);
    const isExtended = !!stateManager.get('extendScope');
    const isOutOfBaseScope = isExtended
      && Number.isFinite(numeric)
      && (numeric < baseMin || numeric > baseMax);

    row.classList.toggle('parameter--outside-base-scope', isOutOfBaseScope);
    if (slider) {
      slider.classList.toggle('parameter__slider--outside-base-scope', isOutOfBaseScope);
    }
  }

  _applyTexturePlaybackSpeed(speed = stateManager.get('texturePlaybackSpeed')) {
    const rate = this._getTexturePlaybackRate(speed);
    if (imageSampler && imageSampler.video && imageSampler.video.elt) {
      imageSampler.video.elt.playbackRate = rate;
    }
    if (this._fadeClone) {
      this._fadeClone.playbackRate = rate;
    }
  }

  /**
   * Sync the motion loopDuration to match the current texture source,
   * scaled by the loopTrim percentage.
   */
  _syncLoopDuration() {
    let duration = 10; // default for static images

    if (imageSampler && imageSampler.hasVideo()) {
      const dur = imageSampler.getVideoDuration();
      if (dur > 0 && isFinite(dur)) duration = Math.round(dur * 10) / 10;
    }

    if (!isFinite(duration) || duration <= 0) duration = 10;

    const trim = (stateManager.get('loopTrim') ?? 100) / 100;
    duration *= trim;
    if (imageSampler && imageSampler.hasVideo()) {
      const rate = this._getTexturePlaybackRate();
      duration /= rate;
    }

    stateManager.set('loopDuration', duration);

    // Refresh the slider's displayed value (shown in seconds, not %)
    if (this.parameterPanel && this.parameterPanel._refreshLoopDurationDisplay) {
      this.parameterPanel._refreshLoopDurationDisplay();
    }
  }

  /**
   * Load defaults.json from assets/ folder if it exists.
   * Drop any exported settings JSON into assets/defaults.json to override hardcoded defaults.
   */
  async _loadDefaultSettings() {
    try {
      const resp = await fetch('assets/defaults.json');
      if (!resp.ok) return;
      const settings = await resp.json();
      this.isLoadingSettings = true;
      this.parameterPanel._applySettings(settings);
      this.isLoadingSettings = false;
      stateManager.clearHistory();
      console.log('Loaded default settings from assets/defaults.json');
    } catch (e) {
      // File doesn't exist or is invalid — silently use hardcoded defaults
    }
  }

  /**
   * Load the default looping texture video
   */
  _loadDefaultTexture() {
    if (!imageSampler || !this.p5Instance) return;
    imageSampler.loadMedia('assets/looping_texture.mp4').then(() => {
      this._defaultTextureLoaded = true;
      stateManager.set('imageSamplerEnabled', true);
      this._applyTexturePlaybackSpeed();
      this.fitCanvasToTexture();
      if (imageSampler.hasVideo()) {
        imageSampler.pause();
        if (this._defaultPlayBtn) {
          this._defaultPlayBtn.innerHTML = '\u25b6';
        }
      }
      this._syncLoopDuration();
      // Update video export options
      if (this.parameterPanel && this.parameterPanel._updateVideoExportOptions) {
        this.parameterPanel._updateVideoExportOptions();
      }
    }).catch(err => {
      console.warn('Failed to load default texture:', err);
    });
  }

  /**
   * Show/hide mask sub-parameters based on mask mode
   */
  /**
   * Fit the p5 canvas inside the container, preserving the loaded texture's
   * aspect ratio. Falls back to filling the container when no texture loaded.
   */
  fitCanvasToTexture() {
    if (!this.p5Instance) return;
    const container = document.getElementById('canvas-container');
    if (!container) return;
    const cw = container.offsetWidth, ch = container.offsetHeight;

    let aspect = cw / ch; // default: fill container
    const tw = (typeof imageSampler !== 'undefined' && imageSampler && imageSampler._bufferWidth) || 0;
    const th = (typeof imageSampler !== 'undefined' && imageSampler && imageSampler._bufferHeight) || 0;
    if (tw > 0 && th > 0) aspect = tw / th;

    let w, h;
    if (cw / ch > aspect) {
      h = ch;
      w = Math.round(ch * aspect);
    } else {
      w = cw;
      h = Math.round(cw / aspect);
    }
    // Composition is rendered larger than the container so more of the
    // texture is visible (the "crop" boundary moves outward). Cubes scale
    // proportionally — same composition layout, just bigger.
    const CANVAS_SCALE = 1.2;
    w = Math.round(w * CANVAS_SCALE);
    h = Math.round(h * CANVAS_SCALE);
    // Motion buffer: visible padding around the composition so cubes pushed
    // by velocity/ripple stay visible instead of clipping at the canvas
    // edge. Composition (cube size, grid extent) is unchanged — the buffer
    // is empty space cubes can spill into. Container CSS uses
    // overflow:visible so the buffer renders past the container into the
    // adjacent UI margins.
    const MOTION_PAD = 200;
    if (this.renderer) {
      this.renderer._layoutCore = { w, h };
      this.renderer._layoutMaskRef = null;
    }
    const pw = w + 2 * MOTION_PAD;
    const ph = h + 2 * MOTION_PAD;
    this.p5Instance.resizeCanvas(pw, ph);
    if (this.renderer && this.renderer.resize) this.renderer.resize(pw, ph);
  }

  _updateMaskVisibility(mode) {
    const setVisible = (id, visible) => {
      const el = document.getElementById(id);
      if (el) {
        const row = el.closest('.parameter');
        if (row) row.style.display = visible ? '' : 'none';
      }
    };

    const isTabLoop = mode === 'tabloop';
    const isCustom = mode === 'custom';
    const isLibrary = mode === 'library';
    const usesMaskImage = isCustom || isLibrary;

    // Shared mask params
    // (custom + library masks are warped by the same noise)
    setVisible('maskNoise', isTabLoop || usesMaskImage);
    setVisible('maskNoiseEvolutionSpeed', isTabLoop || usesMaskImage);
    setVisible('maskNoiseSeed', isTabLoop || usesMaskImage);

    // Tab loop params
    setVisible('maskRingRadius', isTabLoop);
    setVisible('maskRingThickness', isTabLoop);
    setVisible('maskInnerSoftness', isTabLoop);
    setVisible('maskOuterSoftness', isTabLoop);

    // Custom + library params (both read the shared mask sampler)
    setVisible('maskCustomImage', isCustom);
    setVisible('maskLibraryItem', isLibrary);
    setVisible('maskSyncWithTexture', usesMaskImage);
    setVisible('maskPositionX', usesMaskImage);
    setVisible('maskPositionY', usesMaskImage);
    setVisible('maskScale', usesMaskImage);
    setVisible('maskRotation', usesMaskImage);
    setVisible('maskChannel', usesMaskImage);
    setVisible('maskInvert', usesMaskImage);
    setVisible('maskSoftness', usesMaskImage);

    // Custom and library share one mask sampler: load whichever the active
    // mode owns (or clear it) so the canvas matches the preview shown.
    if (usesMaskImage && this.parameterPanel && this.parameterPanel.getParameter) {
      const owner = this.parameterPanel.getParameter(isLibrary ? 'maskLibraryItem' : 'maskCustomImage');
      if (owner && owner.activate && owner !== this._activeMaskOwner) owner.activate();
      this._activeMaskOwner = owner;
    } else {
      this._activeMaskOwner = null;
    }
  }

}

// Global app instance
let app;
