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
      preview.style.display = 'none';
      videoControls.style.display = 'none';
      if (this._browseBtn) this._browseBtn.style.display = '';
      previewImg.src = '';
      previewImg.style.display = 'none';
      previewVideo.src = '';
      previewVideo.style.display = 'none';
      fileInput.value = '';
      this.setValue(null);
      const sampler = this._getSampler();
      if (sampler) {
        sampler.clearMedia();
      }
      stateManager.set(this.enableStateKey, false);
      // Disable video-only export formats
      if (typeof app !== 'undefined' && app.parameterPanel && app.parameterPanel._updateVideoExportOptions) {
        app.parameterPanel._updateVideoExportOptions();
      }
    });

    container.appendChild(headerRow);
    container.appendChild(preview);
    container.appendChild(videoControls);

    // Drop zone support for mask images
    if (this.config && this.config.dropZone) {
      const dropZone = document.createElement('div');
      dropZone.className = 'parameter__mask-dropzone';
      dropZone.textContent = this.config.dropZoneText || 'Drop image here';
      this._dropZone = dropZone;

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
          dropZone.style.display = 'none';
        }
      });
      dropZone.addEventListener('click', () => fileInput.click());

      // Show/hide drop zone based on preview state
      clearBtn.addEventListener('click', () => {
        dropZone.style.display = '';
      });

      container.appendChild(dropZone);
    }

    return container;
  }

  _handleFile(file, previewImg, previewVideo, preview, uploadArea, videoControls, playBtn) {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');

    if (isVideo) {
      previewImg.style.display = 'none';
      previewVideo.style.display = 'block';
      previewVideo.src = url;
      previewVideo.play();
      videoControls.style.display = 'flex';
      if (playBtn) playBtn.innerHTML = '\u275a\u275a';
    } else {
      previewImg.style.display = 'block';
      previewVideo.style.display = 'none';
      previewImg.src = url;
      videoControls.style.display = 'none';
    }

    preview.style.display = 'block';
    if (this._browseBtn) this._browseBtn.style.display = 'none';

    this.setValue(file);

    if (this.onMediaLoad) {
      this.onMediaLoad(file);
    }

    // Load into the appropriate sampler
    const sampler = this._getSampler();
    if (sampler) {
      sampler.loadMedia(file).then(() => {
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
      });
    }
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
      valueDisplay.textContent = `${lo} – ${hi}`;
      updateFill();
    });

    sliderHigh.addEventListener('input', () => {
      const lo = parseFloat(sliderLow.value);
      let hi = parseFloat(sliderHigh.value);
      if (hi < lo) { hi = lo; sliderHigh.value = hi; }
      stateManager.set(this.endKey, hi);
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

// Register tool-specific types with the shared factory
ParameterFactory.registerType('image', ImageUploadParameter);
ParameterFactory.registerType('range', RangeParameter);
ParameterFactory.registerType('button-group', ButtonGroupParameter);
