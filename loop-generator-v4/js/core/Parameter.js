/**
 * MediaUploadParameter - File upload for images and videos
 */
class ImageUploadParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'image' });
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
    return typeof imageSampler !== 'undefined' ? imageSampler : null;
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--image';

    const label = this._createLabel();

    const uploadArea = document.createElement('div');
    uploadArea.className = 'parameter__upload-area';
    uploadArea.id = this.id + '-upload';

    const uploadText = document.createElement('span');
    uploadText.className = 'parameter__upload-text';
    uploadText.textContent = 'Drop image/video or click';

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

    const loopBtn = document.createElement('button');
    loopBtn.className = 'parameter__video-btn parameter__video-btn--active';
    loopBtn.innerHTML = '\u21bb';
    loopBtn.title = 'Toggle Loop';

    videoControls.appendChild(playBtn);
    videoControls.appendChild(progressBar);
    videoControls.appendChild(loopBtn);

    // Video control events
    playBtn.addEventListener('click', () => {
      const sampler = this._getSampler();
      if (sampler && sampler.hasVideo()) {
        sampler.togglePlay();
        playBtn.innerHTML = sampler.isPlaying ? '\u275a\u275a' : '\u25b6';
        // Sync the preview video element
        if (sampler.isPlaying) {
          previewVideo.play();
        } else {
          previewVideo.pause();
        }
      }
    });

    progressBar.addEventListener('input', (e) => {
      const sampler = this._getSampler();
      if (sampler && sampler.hasVideo()) {
        const pct = parseFloat(e.target.value) / 100;
        sampler.seekPercent(pct);
        // Sync preview video scrub
        if (previewVideo.duration) {
          previewVideo.currentTime = previewVideo.duration * pct;
        }
      }
    });

    loopBtn.addEventListener('click', () => {
      const sampler = this._getSampler();
      if (sampler && sampler.hasVideo()) {
        const newLoop = !sampler.isLooping;
        sampler.setLoop(newLoop);
        previewVideo.loop = newLoop;
        loopBtn.classList.toggle('parameter__video-btn--active', newLoop);
      }
    });

    // Update progress bar periodically
    setInterval(() => {
      const sampler = this._getSampler();
      if (sampler && sampler.hasVideo() && sampler.isPlaying) {
        progressBar.value = sampler.getVideoProgress() * 100;
      }
    }, 100);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = this.id;
    fileInput.className = 'parameter__file-input';
    fileInput.accept = this.accept;
    fileInput.style.display = 'none';

    uploadArea.appendChild(uploadText);
    uploadArea.appendChild(fileInput);

    // Click to upload
    uploadArea.addEventListener('click', () => fileInput.click());

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('parameter__upload-area--dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('parameter__upload-area--dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('parameter__upload-area--dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          this._handleFile(file, previewImg, previewVideo, preview, uploadArea, videoControls, playBtn);
        }
      }
    });

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
      uploadArea.style.display = 'flex';
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
    });

    container.appendChild(label);
    container.appendChild(uploadArea);
    container.appendChild(preview);
    container.appendChild(videoControls);

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
      playBtn.innerHTML = '\u275a\u275a';
    } else {
      previewImg.style.display = 'block';
      previewVideo.style.display = 'none';
      previewImg.src = url;
      videoControls.style.display = 'none';
    }

    preview.style.display = 'block';
    uploadArea.style.display = 'none';

    this.setValue(file);

    if (this.onMediaLoad) {
      this.onMediaLoad(file);
    }

    // Load into the appropriate sampler
    const sampler = this._getSampler();
    if (sampler) {
      sampler.loadMedia(file).then(() => {
        stateManager.set(this.enableStateKey, true);
        if (sampler.isVideo) {
          sampler.play();
        }
        // Auto-enable colour mode when image/video is loaded
        stateManager.set('colorMode', true);
        const toggle = document.getElementById('colorMode');
        if (toggle) toggle.checked = true;
      });
    }
  }
}

/**
 * NumberParameter - Number input with per-field randomize button
 */
class NumberParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'number' });
    this.min = config.min ?? 0;
    this.max = config.max ?? 1000;
    this.step = config.step ?? 1;
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--number';

    const label = this._createLabel();

    const inputRow = document.createElement('div');
    inputRow.className = 'parameter__number-row';

    const input = document.createElement('input');
    input.type = 'number';
    input.id = this.id;
    input.className = 'parameter__number-input';
    input.min = this.min;
    input.max = this.max;
    input.step = this.step;
    input.value = this.value;

    input.addEventListener('change', (e) => {
      let val = parseFloat(e.target.value);
      val = Math.max(this.min, Math.min(this.max, val));
      val = Math.round(val / this.step) * this.step;
      input.value = val;
      this.setValue(val);
    });

    const randomBtn = document.createElement('button');
    randomBtn.className = 'parameter__randomize-btn';
    randomBtn.textContent = '\u2733';
    randomBtn.title = 'Randomize';
    randomBtn.addEventListener('click', () => {
      const range = this.max - this.min;
      const steps = Math.floor(range / this.step);
      const randomSteps = Math.floor(Math.random() * (steps + 1));
      const val = this.min + randomSteps * this.step;
      input.value = val;
      this.setValue(val);
    });

    inputRow.appendChild(input);
    inputRow.appendChild(randomBtn);

    container.appendChild(label);
    container.appendChild(inputRow);

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

    const label = this._createLabel();

    const row = document.createElement('div');
    row.className = 'parameter__button-row';
    this._buttonRow = row;

    this.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'parameter__group-btn';
      btn.textContent = opt.label;
      btn.dataset.value = opt.value;
      if (opt.value === this.value) btn.classList.add('parameter__group-btn--active');

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
 * RangeParameter - Dual-handle range slider controlling two state keys
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

    // Track container with highlighted range
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

    // Initial state
    stateManager.set(this.startKey, this.startDefault);
    stateManager.set(this.endKey, this.endDefault);
    requestAnimationFrame(updateFill);

    return container;
  }
}

// Register tool-specific types with the shared factory
ParameterFactory.registerType('image', ImageUploadParameter);
ParameterFactory.registerType('number', NumberParameter);
ParameterFactory.registerType('button-group', ButtonGroupParameter);
ParameterFactory.registerType('range', RangeParameter);
