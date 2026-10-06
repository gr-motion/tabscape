/**
 * MediaUploadParameter - File upload for images and videos
 */
class ImageUploadParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'image' });
    this.config = config;
    this.onMediaLoad = config.onMediaLoad || config.onImageLoad || null;
    this.accept = config.accept || 'image/*,video/*';
    this._videoControlsContainer = null;
    // Allow specifying which sampler to use (defaults to 'imageSampler')
    this.targetSampler = config.targetSampler || 'imageSampler';
    // State key to enable when media is loaded
    this.enableStateKey = config.enableStateKey || 'imageSamplerEnabled';
    this._preview = null;
    this._previewImg = null;
    this._previewVideo = null;
    this._videoControls = null;
    this._playBtn = null;
    this._fileInput = null;
  }

  _getSampler() {
    // Return the appropriate sampler based on targetSampler
    if (this.targetSampler === 'scaleVideoSampler') {
      return typeof scaleVideoSampler !== 'undefined' ? scaleVideoSampler : null;
    }
    if (this.targetSampler === 'maskSampler') {
      return typeof maskSampler !== 'undefined' ? maskSampler : null;
    }
    return typeof imageSampler !== 'undefined' ? imageSampler : null;
  }

  /**
   * Extract an image from a paste event: a clipboard image file (screenshots,
   * copied images) or SVG markup copied as text. Returns a File or null.
   */
  static getPastedImage(e) {
    const cd = e.clipboardData;
    if (!cd) return null;
    for (const item of cd.items || []) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
    const text = cd.getData && cd.getData('text/plain');
    if (text && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      return new File([text], 'pasted.svg', { type: 'image/svg+xml' });
    }
    return null;
  }

  /**
   * Re-apply this parameter's media to its sampler (used when several
   * parameters share one sampler, e.g. the mask's Custom / Library modes).
   */
  activate() {
    const sampler = this._getSampler();
    if (!sampler) return;
    if (this.value instanceof File) {
      sampler.loadMedia(this.value);
    } else {
      sampler.clearMedia();
    }
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--image';

    const label = this._createLabel();

    const browseBtn = document.createElement('button');
    browseBtn.className = 'parameter__browse-btn';
    browseBtn.textContent = 'Browse';
    this._browseBtn = browseBtn;

    // Wrap label and browse in a row
    const headerRow = document.createElement('div');
    headerRow.className = 'parameter__header';
    headerRow.appendChild(label);
    headerRow.appendChild(browseBtn);

    const uploadArea = document.createElement('div');
    uploadArea.className = 'parameter__upload-area';
    uploadArea.id = this.id + '-upload';
    uploadArea.style.display = 'none';

    const preview = document.createElement('div');
    preview.className = 'parameter__image-preview';
    preview.id = this.id + '-preview';
    preview.style.display = 'none';

    const previewImg = document.createElement('img');
    previewImg.id = this.id + '-preview-img';
    preview.appendChild(previewImg);

    const previewVideo = document.createElement('video');
    previewVideo.id = this.id + '-preview-video';
    previewVideo.muted = true;
    previewVideo.loop = true;
    previewVideo.style.display = 'none';
    preview.appendChild(previewVideo);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'parameter__clear-btn';
    clearBtn.textContent = '\u00d7';
    clearBtn.title = 'Clear media';
    preview.appendChild(clearBtn);

    // Video controls
    const videoControls = document.createElement('div');
    videoControls.className = 'parameter__video-controls';
    videoControls.style.display = 'none';
    this._videoControlsContainer = videoControls;

    const playBtn = document.createElement('button');
    playBtn.className = 'parameter__video-btn';
    playBtn.innerHTML = '\u25b6';
    playBtn.title = 'Play/Pause';

    const progressBar = document.createElement('input');
    progressBar.type = 'range';
    progressBar.className = 'parameter__video-progress';
    progressBar.min = 0;
    progressBar.max = 100;
    progressBar.value = 0;

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
      const trim = (typeof stateManager !== 'undefined' ? stateManager.get('loopTrim') : null) ?? 100;
      trimOverlay.style.width = (100 - trim) + '%';
    };
    if (typeof stateManager !== 'undefined') stateManager.subscribe('loopTrim', updateTrimOverlay);
    updateTrimOverlay();

    const timeLabel = document.createElement('input');
    timeLabel.type = 'text';
    timeLabel.className = 'parameter__value parameter__value--editable';
    timeLabel.size = 5;
    timeLabel.style.cssText = 'font-variant-numeric:tabular-nums;width:calc(48px * var(--s));flex:0 0 auto;';
    timeLabel.value = '0.0s';

    videoControls.appendChild(playBtn);
    videoControls.appendChild(progressWrap);
    videoControls.appendChild(timeLabel);

    const writeTime = (secs) => {
      if (document.activeElement !== timeLabel) {
        timeLabel.value = secs.toFixed(1) + 's';
      }
    };
    timeLabel.addEventListener('blur', () => {
      const sampler = this._getSampler();
      if (!(sampler && sampler.hasVideo())) return;
      const dur = previewVideo.duration;
      if (!(dur > 0 && isFinite(dur))) return;
      const typed = parseFloat(timeLabel.value);
      if (isNaN(typed)) { writeTime((parseFloat(progressBar.value) / 100) * dur); return; }
      const secs = Math.max(0, Math.min(dur, typed));
      const pct = secs / dur;
      progressBar.value = pct * 100;
      sampler.seekPercent(pct);
      previewVideo.currentTime = secs;
      timeLabel.value = secs.toFixed(1) + 's';
    });
    timeLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); timeLabel.blur(); }
    });

    // Video control events
    playBtn.addEventListener('click', () => {
      const sampler = this._getSampler();
      if (sampler && sampler.hasVideo()) {
        sampler.togglePlay();
        if (sampler.isPlaying) {
          previewVideo.play();
        } else {
          previewVideo.pause();
        }
        playBtn.innerHTML = sampler.isPlaying ? '\u275a\u275a' : '\u25b6';
      }
    });

    progressBar.addEventListener('input', (e) => {
      const sampler = this._getSampler();
      const pct = parseFloat(e.target.value) / 100;
      if (sampler && sampler.hasVideo()) {
        sampler.seekPercent(pct);
      }
      if (previewVideo.duration) {
        previewVideo.currentTime = pct * previewVideo.duration;
        writeTime(pct * previewVideo.duration);
      }
    });

    let isScrubbing = false;
    progressBar.addEventListener('mousedown', () => { isScrubbing = true; });
    progressBar.addEventListener('mouseup',   () => { isScrubbing = false; });
    progressBar.addEventListener('touchstart', () => { isScrubbing = true; });
    progressBar.addEventListener('touchend',   () => { isScrubbing = false; });

    setInterval(() => {
      if (isScrubbing) return;
      const sampler = this._getSampler();
      if (sampler && sampler.hasVideo()) {
        const progress = sampler.getVideoProgress();
        progressBar.value = progress * 100;
        if (previewVideo.duration) {
          const targetTime = progress * previewVideo.duration;
          if (sampler.isPlaying) {
            const drift = Math.abs(previewVideo.currentTime - targetTime);
            if (drift > 0.5) previewVideo.currentTime = targetTime;
          }
          writeTime(targetTime);
        }
      }
    }, 100);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = this.id;
    fileInput.className = 'parameter__file-input';
    fileInput.accept = this.accept;
    fileInput.style.display = 'none';
    this._preview = preview;
    this._previewImg = previewImg;
    this._previewVideo = previewVideo;
    this._videoControls = videoControls;
    this._playBtn = playBtn;
    this._fileInput = fileInput;

    container.appendChild(fileInput);

    // Browse button triggers file input
    browseBtn.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this._handleFile(e.target.files[0], previewImg, previewVideo, preview, uploadArea, videoControls, playBtn);
      }
    });

    // Clear button
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._clearControlUI();
      this.setValue(null);
      const sampler = this._getSampler();
      if (sampler) {
        sampler.clearMedia();
      }
      stateManager.set(this.enableStateKey, false);
      if (typeof app !== 'undefined' && app && app._clearPersistedParameterMedia) {
        app._clearPersistedParameterMedia(this.id);
      }
      // Disable video-only export formats
      if (typeof app !== 'undefined' && app.parameterPanel && app.parameterPanel._updateVideoExportOptions) {
        app.parameterPanel._updateVideoExportOptions();
      }
    });

    container.appendChild(headerRow);
    container.appendChild(preview);
    container.appendChild(videoControls);

    // Drop zone support: drag & drop, or click to focus then paste (Cmd/Ctrl+V).
    // Clicking only activates the zone; the Browse button opens the file dialog.
    if (this.config && this.config.dropZone) {
      const dropZone = document.createElement('div');
      dropZone.className = 'parameter__mask-dropzone';
      dropZone.tabIndex = 0;
      const idleText = this.config.dropZoneText || 'Drop image here';
      const pasteKey = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '\u2318V' : 'Ctrl+V';
      dropZone.textContent = idleText;
      this._dropZone = dropZone;

      dropZone.addEventListener('focus', () => {
        dropZone.textContent = 'Press ' + pasteKey + ' to paste';
      });
      dropZone.addEventListener('blur', () => {
        dropZone.textContent = idleText;
      });
      dropZone.addEventListener('click', () => dropZone.focus());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('parameter__mask-dropzone--dragover');
      });
      dropZone.addEventListener('dragleave', (e) => {
        e.stopPropagation();
        dropZone.classList.remove('parameter__mask-dropzone--dragover');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('parameter__mask-dropzone--dragover');
        const file = e.dataTransfer.files[0];
        if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) {
          this._handleFile(file, previewImg, previewVideo, preview, uploadArea, videoControls, playBtn);
        }
      });

      // Paste works while the drop zone (or the loaded preview, to replace it)
      // has focus; the event bubbles up from whichever one is focused.
      preview.tabIndex = 0;
      container.addEventListener('paste', (e) => {
        const file = ImageUploadParameter.getPastedImage(e);
        if (!file) return;
        e.preventDefault();
        this._handleFile(file, previewImg, previewVideo, preview, uploadArea, videoControls, playBtn);
      });

      // Show/hide drop zone based on preview state
      clearBtn.addEventListener('click', () => {
        dropZone.style.display = '';
      });

      container.appendChild(dropZone);
    }

    return container;
  }

  _clearControlUI() {
    if (this._preview) this._preview.style.display = 'none';
    if (this._videoControls) this._videoControls.style.display = 'none';
    if (this._browseBtn) this._browseBtn.style.display = '';
    if (this._previewImg) {
      this._previewImg.src = '';
      this._previewImg.style.display = 'none';
    }
    if (this._previewVideo) {
      this._previewVideo.pause();
      this._previewVideo.src = '';
      this._previewVideo.style.display = 'none';
    }
    if (this._playBtn) this._playBtn.innerHTML = '▶';
    if (this._fileInput) this._fileInput.value = '';
    if (this._dropZone) this._dropZone.style.display = '';
  }

  /** Re-load media saved in IndexedDB (see WorkspacePersistence). */
  async restorePersistedMedia(entry, runtimeState = null) {
    if (!entry || !entry.blob) return;
    const file = entry.blob instanceof File
      ? entry.blob
      : new File([entry.blob], entry.name || `${this.id}`, {
          type: entry.type || entry.blob.type || 'application/octet-stream',
          lastModified: entry.lastModified || Date.now()
        });
    await this._handleFile(
      file,
      this._previewImg,
      this._previewVideo,
      this._preview,
      null,
      this._videoControls,
      this._playBtn,
      { persist: false, runtimeState }
    );
  }

  /** Samplers are created inside the p5 sketch; wait for them when restoring on startup. */
  _waitForSampler(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const sampler = this._getSampler();
        if (sampler || performance.now() - started > timeoutMs) resolve(sampler);
        else setTimeout(check, 50);
      };
      check();
    });
  }

  _handleFile(file, previewImg, previewVideo, preview, uploadArea, videoControls, playBtn, options = {}) {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');

    if (isVideo) {
      previewImg.style.display = 'none';
      previewVideo.style.display = 'block';
      previewVideo.src = url;
      previewVideo.play();
      videoControls.style.display = 'flex';
      if (playBtn) playBtn.innerHTML = '❚❚';
    } else {
      previewImg.style.display = 'block';
      previewVideo.style.display = 'none';
      previewImg.src = url;
      videoControls.style.display = 'none';
    }

    preview.style.display = 'block';
    if (this._browseBtn) this._browseBtn.style.display = 'none';
    if (this._dropZone) {
      const wasActive = document.activeElement === this._dropZone;
      this._dropZone.style.display = 'none';
      if (wasActive) preview.focus();
    }

    this.setValue(file);
    if (typeof app !== 'undefined' && app && app._persistParameterMedia && options.persist !== false) {
      app._persistParameterMedia(this.id, file);
    }

    if (this.onMediaLoad) {
      this.onMediaLoad(file);
    }

    // The mask sampler is shared by Custom and Library; when restoring a saved
    // workspace only load it if Custom is the active mode (activate() loads it
    // later on a mode switch).
    if (options.persist === false && this.targetSampler === 'maskSampler' &&
        stateManager.get('maskMode') !== 'custom') {
      return Promise.resolve();
    }

    // Load into the appropriate sampler
    return this._waitForSampler().then((sampler) => {
      if (!sampler) return;
      return sampler.loadMedia(file).then(() => {
        stateManager.set(this.enableStateKey, true);
        if (sampler.isVideo) {
          sampler.play();
        }
        // Sync motion loop duration from texture source
        if (typeof app !== 'undefined' && app._syncLoopDuration) {
          app._syncLoopDuration();
        }
        if (typeof app !== 'undefined' && app.parameterPanel && app.parameterPanel._updateVideoExportOptions) {
          app.parameterPanel._updateVideoExportOptions();
        }
        // Match the live canvas to the texture aspect so exports don't letterbox.
        if (typeof app !== 'undefined' && app.fitCanvasToTexture && sampler === imageSampler) {
          app.fitCanvasToTexture();
        }
        if (sampler.isVideo && options.runtimeState) {
          const pct = Math.max(0, Math.min(1, parseFloat(options.runtimeState.progress) || 0));
          const shouldPause = options.runtimeState.paused === true;
          sampler.seekPercent(pct);
          const duration = sampler.getVideoDuration ? sampler.getVideoDuration() : 0;
          if (previewVideo && duration > 0) {
            previewVideo.currentTime = pct * duration;
          }
          if (shouldPause) {
            sampler.pause();
            if (previewVideo) previewVideo.pause();
            if (playBtn) playBtn.innerHTML = '▶';
          } else {
            sampler.play();
            if (previewVideo) previewVideo.play().catch(() => {});
            if (playBtn) playBtn.innerHTML = '❚❚';
          }
        }
      });
    });
  }
}

/**
 * RangeParameter - Dual-handle range slider for start/end values
 */
class RangeParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'range' });
    this.min = config.min ?? 0;
    this.max = config.max ?? 100;
    this.step = config.step ?? 1;
    this.startKey = config.startKey;
    this.endKey = config.endKey;
    this.startDefault = config.startDefault ?? this.min;
    this.endDefault = config.endDefault ?? this.max;
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--range';

    const header = document.createElement('div');
    header.className = 'parameter__header';
    const label = this._createLabel();
    if (window.animationController) {
      window.animationController.registerKey(this.startKey, {
        label: this.label + ' Start',
        type: 'range',
        parameter: this
      });
      window.animationController.registerKey(this.endKey, {
        label: this.label + ' End',
        type: 'range',
        parameter: this
      });
      label.appendChild(this._createMotionToggle(this.startKey, this.label + ' Start'));
      label.appendChild(this._createMotionToggle(this.endKey, this.label + ' End'));
    }
    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'parameter__value';
    valueDisplay.textContent = `${this.startDefault} – ${this.endDefault}`;
    header.appendChild(label);
    header.appendChild(valueDisplay);

    const track = document.createElement('div');
    track.className = 'parameter__range-track';

    const fill = document.createElement('div');
    fill.className = 'parameter__range-fill';
    track.appendChild(fill);

    const sliderLow = document.createElement('input');
    sliderLow.type = 'range';
    sliderLow.id = this.startKey;
    sliderLow.className = 'parameter__range-input parameter__range-input--low';
    sliderLow.min = this.min;
    sliderLow.max = this.max;
    sliderLow.step = this.step;
    sliderLow.value = this.startDefault;

    const sliderHigh = document.createElement('input');
    sliderHigh.type = 'range';
    sliderHigh.id = this.endKey;
    sliderHigh.className = 'parameter__range-input parameter__range-input--high';
    sliderHigh.min = this.min;
    sliderHigh.max = this.max;
    sliderHigh.step = this.step;
    sliderHigh.value = this.endDefault;

    const updateFill = () => {
      const lo = parseFloat(sliderLow.value);
      const hi = parseFloat(sliderHigh.value);
      const range = this.max - this.min;
      const leftPct = ((lo - this.min) / range) * 100;
      const rightPct = ((hi - this.min) / range) * 100;
      fill.style.left = leftPct + '%';
      fill.style.width = (rightPct - leftPct) + '%';
    };

    sliderLow.addEventListener('input', () => {
      let lo = parseFloat(sliderLow.value);
      const hi = parseFloat(sliderHigh.value);
      if (lo > hi) { lo = hi; sliderLow.value = lo; }
      stateManager.set(this.startKey, lo);
      if (window.animationController) window.animationController.recordChange(this.startKey, lo);
      valueDisplay.textContent = `${lo} – ${hi}`;
      updateFill();
    });

    sliderHigh.addEventListener('input', () => {
      const lo = parseFloat(sliderLow.value);
      let hi = parseFloat(sliderHigh.value);
      if (hi < lo) { hi = lo; sliderHigh.value = hi; }
      stateManager.set(this.endKey, hi);
      if (window.animationController) window.animationController.recordChange(this.endKey, hi);
      valueDisplay.textContent = `${lo} – ${hi}`;
      updateFill();
    });

    track.appendChild(sliderLow);
    track.appendChild(sliderHigh);

    container.appendChild(header);
    container.appendChild(track);

    stateManager.set(this.startKey, this.startDefault);
    stateManager.set(this.endKey, this.endDefault);
    requestAnimationFrame(updateFill);

    return container;
  }
}

/**
 * ButtonGroupParameter - Row of toggle buttons (e.g. Off / Low / Med / High)
 */
class ButtonGroupParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'button-group' });
    this.options = config.options || [];
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--button-group';
    container.id = this.id + '-container';

    const label = this._createLabel();

    const row = document.createElement('div');
    row.className = 'parameter__button-row';
    row.id = this.id;
    this._buttonRow = row;

    this.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'parameter__group-btn';
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      if (opt.value == this.value) btn.classList.add('parameter__group-btn--active');

      btn.addEventListener('click', () => {
        row.querySelectorAll('.parameter__group-btn').forEach(b =>
          b.classList.remove('parameter__group-btn--active')
        );
        btn.classList.add('parameter__group-btn--active');
        this.setValue(opt.value);
      });

      row.appendChild(btn);
    });

    container.appendChild(label);
    container.appendChild(row);

    return container;
  }
}

/**
 * MaskLibraryParameter - Pick a mask from the SVG shapes in the mask_library
 * folder. The folder is read at runtime (manifest.json, or the server's
 * directory listing as a fallback) so new shapes can be dropped in without
 * touching the code.
 */
class MaskLibraryParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'mask-library' });
    this.config = config;
    this.libraryPath = (config.libraryPath || 'mask_library').replace(/\/+$/, '');
    this.enableStateKey = config.enableStateKey || 'maskImageLoaded';
    this._file = null;
    this._item = null;
    this._modal = null;
    this._previewImg = null;
    this._previewBox = null;
    this._chooseBtn = null;
    if (typeof stateManager !== 'undefined') {
      // Restore a mask by name when settings are loaded
      stateManager.subscribe(this.id, (name) => {
        if (typeof name === 'string' && name && (!this._item || this._item.file !== name)) {
          this._selectByName(name, { restore: true });
        }
      });
    }
  }

  _getSampler() {
    return typeof maskSampler !== 'undefined' ? maskSampler : null;
  }

  _prettyName(file) {
    return file.replace(/\.svg$/i, '').replace(/[-_]+/g, ' ').trim();
  }

  _makeItem(file) {
    return {
      file,
      name: this._prettyName(file),
      url: this.libraryPath + '/' + encodeURIComponent(file)
    };
  }

  /**
   * Read the library folder. manifest.json (array of file names) wins;
   * otherwise parse .svg links out of the directory listing.
   */
  async _loadItems() {
    const base = this.libraryPath + '/';
    try {
      const res = await fetch(base + 'manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const list = await res.json();
        const files = (Array.isArray(list) ? list : (list.files || []))
          .map(f => (typeof f === 'string' ? f : f && f.file))
          .filter(f => typeof f === 'string' && /\.svg$/i.test(f));
        if (files.length) return files.map(f => this._makeItem(f));
      }
    } catch (e) { /* fall through to directory listing */ }

    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (res.ok) {
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const seen = new Set();
        const files = [];
        doc.querySelectorAll('a[href]').forEach(a => {
          const href = decodeURIComponent((a.getAttribute('href') || '').split(/[?#]/)[0]);
          const file = href.split('/').pop();
          if (/\.svg$/i.test(file) && !seen.has(file)) {
            seen.add(file);
            files.push(file);
          }
        });
        return files.sort().map(f => this._makeItem(f));
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  async _selectByName(name, options = {}) {
    const items = await this._loadItems();
    const item = items.find(i => i.file === name);
    if (item) this._select(item, options);
  }

  async _select(item, options = {}) {
    let file;
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      file = new File([blob], item.file, { type: 'image/svg+xml' });
    } catch (err) {
      console.warn('Failed to load mask from library:', item.file, err);
      return;
    }
    this._applyFile(file, item, options);
  }

  _applyFile(file, item, options = {}) {
    this._file = file;
    this._item = item;
    this.value = item.file;
    if (this._previewImg) this._previewImg.src = item.url;
    if (this._previewBox) this._previewBox.style.display = 'block';
    if (this._chooseBtn) this._chooseBtn.style.display = 'none';
    stateManager.set(this.id, item.file);

    // Library shapes are transparent SVGs — read the alpha channel. Skipped
    // when restoring a saved workspace so the saved channel setting wins.
    if (!options.restore && typeof app !== 'undefined' && app._setLinkedParameterValue) {
      app._setLinkedParameterValue('maskChannel', 'alpha');
    }

    // Custom and Library share one sampler: only load while Library is the
    // active mode; switching modes re-applies via activate().
    if (stateManager.get('maskMode') !== 'library') return;
    this._loadIntoSampler(file);
  }

  _loadIntoSampler(file) {
    this._waitForSampler().then((sampler) => {
      if (!sampler) return;
      sampler.loadMedia(file).then(() => {
        stateManager.set(this.enableStateKey, true);
      }).catch(err => console.warn('Failed to load library mask:', err));
    });
  }

  _waitForSampler(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const sampler = this._getSampler();
        if (sampler || performance.now() - started > timeoutMs) resolve(sampler);
        else setTimeout(check, 50);
      };
      check();
    });
  }

  _clear() {
    this._file = null;
    this._item = null;
    this.value = null;
    if (this._previewImg) this._previewImg.removeAttribute('src');
    if (this._previewBox) this._previewBox.style.display = 'none';
    if (this._chooseBtn) this._chooseBtn.style.display = '';
    stateManager.set(this.id, null);
    const sampler = this._getSampler();
    if (sampler) sampler.clearMedia();
    stateManager.set(this.enableStateKey, false);
  }

  /** Re-apply this parameter's mask to the shared mask sampler. */
  activate() {
    if (this._file) {
      this._loadIntoSampler(this._file);
      return;
    }
    const sampler = this._getSampler();
    if (sampler) sampler.clearMedia();
  }

  async _openModal() {
    this._closeModal();

    const overlay = document.createElement('div');
    overlay.className = 'mask-library__overlay';
    const card = document.createElement('div');
    card.className = 'mask-library__card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Mask library');

    const header = document.createElement('div');
    header.className = 'mask-library__header';
    const title = document.createElement('div');
    title.className = 'mask-library__title';
    title.textContent = 'Mask Library';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'mask-library__close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    header.appendChild(title);
    header.appendChild(closeBtn);

    const grid = document.createElement('div');
    grid.className = 'mask-library__grid';
    const status = document.createElement('div');
    status.className = 'mask-library__status';
    status.textContent = 'Loading…';
    grid.appendChild(status);

    card.appendChild(header);
    card.appendChild(grid);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this._modal = overlay;

    const onKey = (e) => { if (e.key === 'Escape') this._closeModal(); };
    document.addEventListener('keydown', onKey);
    this._modalKeyHandler = onKey;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this._closeModal(); });
    closeBtn.addEventListener('click', () => this._closeModal());

    const items = await this._loadItems();
    if (this._modal !== overlay) return; // closed while loading
    grid.innerHTML = '';
    if (!items.length) {
      status.textContent = 'No masks found in ' + this.libraryPath + '/';
      grid.appendChild(status);
      return;
    }
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'mask-library__item';
      if (this._item && this._item.file === item.file) btn.classList.add('mask-library__item--active');
      btn.title = item.name;
      const thumb = document.createElement('div');
      thumb.className = 'mask-library__thumb';
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.name;
      img.draggable = false;
      thumb.appendChild(img);
      const name = document.createElement('div');
      name.className = 'mask-library__name';
      name.textContent = item.name;
      btn.appendChild(thumb);
      btn.appendChild(name);
      btn.addEventListener('click', () => {
        this._closeModal();
        this._select(item);
      });
      grid.appendChild(btn);
    });
  }

  _closeModal() {
    if (this._modalKeyHandler) {
      document.removeEventListener('keydown', this._modalKeyHandler);
      this._modalKeyHandler = null;
    }
    if (this._modal) {
      this._modal.remove();
      this._modal = null;
    }
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--image parameter--mask-library';

    const headerRow = document.createElement('div');
    headerRow.className = 'parameter__header';
    headerRow.appendChild(this._createLabel());

    // Preview of the chosen mask (click to pick another)
    const preview = document.createElement('div');
    preview.className = 'parameter__image-preview parameter__image-preview--library';
    preview.style.display = 'none';
    const previewImg = document.createElement('img');
    previewImg.alt = '';
    preview.appendChild(previewImg);
    const clearBtn = document.createElement('button');
    clearBtn.className = 'parameter__clear-btn';
    clearBtn.textContent = '×';
    clearBtn.title = 'Clear mask';
    preview.appendChild(clearBtn);
    preview.addEventListener('click', () => this._openModal());
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._clear();
    });

    // The "choose from the library" button shown while nothing is selected
    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.id = this.id;
    chooseBtn.className = 'parameter__mask-dropzone parameter__mask-library-btn';
    chooseBtn.textContent = this.config.buttonText || 'Choose from the library';
    chooseBtn.addEventListener('click', () => this._openModal());

    this._previewBox = preview;
    this._previewImg = previewImg;
    this._chooseBtn = chooseBtn;

    container.appendChild(headerRow);
    container.appendChild(preview);
    container.appendChild(chooseBtn);
    return container;
  }
}

// Register tool-specific types with the shared factory
ParameterFactory.registerType('image', ImageUploadParameter);
ParameterFactory.registerType('mask-library', MaskLibraryParameter);
ParameterFactory.registerType('range', RangeParameter);
ParameterFactory.registerType('button-group', ButtonGroupParameter);
