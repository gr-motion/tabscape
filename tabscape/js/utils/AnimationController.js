/**
 * AnimationController - keyframe timeline for Tabscape parameters.
 */
class AnimationController {
  constructor() {
    this.app = null;
    this.duration = 5;
    this.currentTime = 0;
    this.isPlaying = false;
    this.motionEnabled = false;
    this.isApplying = false;
    this.keyframingEnabled = {};
    this.keyframes = {};
    this.registry = new Map();
    this._raf = null;
    this._lastTick = 0;
    this._timelineEl = null;
    this._tracksEl = null;
    this._playheadEl = null;
    this._timeEl = null;
    this._playBtn = null;
    this._scrubberEl = null;
    this._durationInput = null;
    this._keyboardPlaybackStartTime = null;
    this._selectedKeyframes = [];
    this._lastKeyframeClick = { key: null, kf: null, time: 0 };
    this._selectionBoxEl = null;
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistory = 100;
    this._coalesceKey = null;
    this._coalesceTimer = null;
    this._timelineHeight = 240;
    this._keyframeClipboard = null;
    // --- EASING BAR & BEZIER POPUP ---
    this._easingBarEl = null;
    this._bezierPopupEl = null;
  }

  init(app) {
    this.app = app;
    this._buildTimeline();
    this._renderTimeline();
    this._updateTimeUI();
    this._updateMotionButton();
  }

  registerKey(key, meta = {}) {
    if (!key || this.registry.has(key)) return;
    this.registry.set(key, meta);
    if (!this.keyframes[key]) this.keyframes[key] = [];
    if (this._tracksEl) this._renderTimeline();
  }

  toggleMotion(force) {
    this.setMotionEnabled(force === undefined ? !this.motionEnabled : !!force);
  }

  setMotionEnabled(enabled) {
    this.motionEnabled = !!enabled;
    document.body.classList.toggle('motion-open', this.motionEnabled);
    document.dispatchEvent(new CustomEvent('motiontoggle', { detail: { enabled: this.motionEnabled } }));
    if (this._timelineEl) this._timelineEl.hidden = !this.motionEnabled;
    if (!this.motionEnabled) this.pause();
    this._updateMotionButton();
    if (this.app && this.app.parameterPanel && this.app.parameterPanel._updateVideoExportOptions) {
      this.app.parameterPanel._updateVideoExportOptions();
    }
    setTimeout(() => {
      if (this.app && this.app.fitCanvasToTexture) this.app.fitCanvasToTexture();
    }, 30);
  }

  toggleKeyframing(key) {
    if (!this.registry.has(key)) return;
    if (!this.motionEnabled) this.setMotionEnabled(true);

    this._pushTimelineHistory();
    const enabled = !this.keyframingEnabled[key];
    this.keyframingEnabled[key] = enabled;

      if (enabled) {
      this.keyframes[key] = [{
        time: this.currentTime,
        value: this._readCurrentValue(key),
        easing: '0.3, 0, 0, 1'
      }];
    } else {
      const firstKf = this.keyframes[key] && this.keyframes[key][0];
      this.keyframes[key] = [];
      this._clearSelectedKeyframes(key);
      if (firstKf) this._applyValue(key, firstKf.value);
    }

    this._updateTimerButtons(key);
    this._renderTimeline();
  }

  recordChange(key, value) {
    if (this.isApplying || !this.keyframingEnabled[key] || !this.registry.has(key)) return;
    if (this.app && this.app.isLoadingSettings) return;

    const track = this.keyframes[key] || (this.keyframes[key] = []);
    const threshold = 0.08;
    let existing = track.find(kf => Math.abs(kf.time - this.currentTime) < threshold);
    this._pushTimelineHistory({ coalesceKey: 'record:' + key });
    if (existing) {
      existing.value = this._cloneValue(value);
    } else {
      track.push({ time: this.currentTime, value: this._cloneValue(value), easing: '0.3, 0, 0, 1' });
      track.sort((a, b) => a.time - b.time);
    }
    this._renderTimeline();
  }

  play() {
    if (!this.motionEnabled) this.setMotionEnabled(true);
    this.isPlaying = true;
    this._lastTick = performance.now();
    this._updatePlayButton();
    this._tick(this._lastTick);
  }

  pause() {
    this.isPlaying = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._updatePlayButton();
  }

  setCurrentTime(time) {
    this.currentTime = Math.max(0, Math.min(this.duration, time || 0));
    this.applyCurrentTime();
    this._updateTimeUI();
  }

  applyCurrentTime() {
    this.registry.forEach((_, key) => {
      const track = this.keyframes[key];
      if (!track || track.length === 0) return;
      const value = this._interpolateValue(key, track, this.currentTime);
      this._applyValue(key, value);
    });
  }

  serialize() {
    const keyframes = JSON.parse(JSON.stringify(this.keyframes));
    const tracks = [];
    this.registry.forEach((meta, key) => {
      const frames = Array.isArray(keyframes[key]) ? keyframes[key] : [];
      if (!this.keyframingEnabled[key] && frames.length === 0) return;
      tracks.push({
        key,
        label: meta.label || key,
        type: meta.type || (meta.parameter && meta.parameter.type) || null,
        group: (meta.parameter && meta.parameter.group) || null,
        enabled: !!this.keyframingEnabled[key],
        currentValue: this._cloneValue(this._readCurrentValue(key)),
        settings: this._serializeParameterSettings(meta.parameter),
        keyframes: frames.map(kf => ({
          time: kf.time,
          value: this._cloneValue(kf.value),
          easing: kf.easing || 'linear'
        }))
      });
    });

    return {
      version: 2,
      motionEnabled: this.motionEnabled,
      duration: this.duration,
      currentTime: this.currentTime,
      keyframingEnabled: { ...this.keyframingEnabled },
      keyframes,
      tracks
    };
  }

  restore(data) {
    if (!data || typeof data !== 'object') return;
    this.pause();
    const motion = this._normalizeMotionData(data);
    if (typeof motion.duration === 'number') this.duration = Math.max(0.5, motion.duration);
    if (typeof motion.currentTime === 'number') this.currentTime = Math.max(0, Math.min(this.duration, motion.currentTime));
    this.keyframingEnabled = { ...(motion.keyframingEnabled || {}) };
    this.keyframes = JSON.parse(JSON.stringify(motion.keyframes || {}));
    this.registry.forEach((_, key) => {
      if (!this.keyframes[key]) this.keyframes[key] = [];
      this._updateTimerButtons(key);
    });
    if (typeof motion.motionEnabled === 'boolean') {
      this.setMotionEnabled(motion.motionEnabled);
    } else {
      this._updateMotionButton();
    }
    this.applyCurrentTime();
    this._renderTimeline();
    this._updateTimeUI();
    this._clearTimelineHistory();
  }

  undo() {
    if (this._undoStack.length === 0) return false;
    this._clearTimelineCoalesce();
    const snapshot = this._undoStack.pop();
    this._redoStack.push(this._createTimelineSnapshot());
    this._restoreTimelineSnapshot(snapshot);
    return true;
  }

  redo() {
    if (this._redoStack.length === 0) return false;
    this._clearTimelineCoalesce();
    const snapshot = this._redoStack.pop();
    this._undoStack.push(this._createTimelineSnapshot());
    this._restoreTimelineSnapshot(snapshot);
    return true;
  }

  _pushTimelineHistory(options = {}) {
    const coalesceKey = options.coalesceKey || null;
    if (coalesceKey && this._coalesceKey === coalesceKey && this._coalesceTimer) {
      clearTimeout(this._coalesceTimer);
      this._coalesceTimer = setTimeout(() => {
        this._coalesceKey = null;
        this._coalesceTimer = null;
      }, 400);
      return;
    }

    this._undoStack.push(this._createTimelineSnapshot());
    if (this._undoStack.length > this._maxHistory) this._undoStack.shift();
    this._redoStack.length = 0;

    this._coalesceKey = coalesceKey;
    clearTimeout(this._coalesceTimer);
    this._coalesceTimer = coalesceKey
      ? setTimeout(() => {
          this._coalesceKey = null;
          this._coalesceTimer = null;
        }, 400)
      : null;
  }

  _clearTimelineHistory() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._clearTimelineCoalesce();
  }

  _clearTimelineCoalesce() {
    this._coalesceKey = null;
    clearTimeout(this._coalesceTimer);
    this._coalesceTimer = null;
  }

  _createTimelineSnapshot() {
    return {
      motionEnabled: this.motionEnabled,
      duration: this.duration,
      currentTime: this.currentTime,
      keyframingEnabled: { ...this.keyframingEnabled },
      keyframes: JSON.parse(JSON.stringify(this.keyframes || {}))
    };
  }

  _restoreTimelineSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    this.pause();
    this.motionEnabled = !!snapshot.motionEnabled;
    document.body.classList.toggle('motion-open', this.motionEnabled);
    if (this._timelineEl) this._timelineEl.hidden = !this.motionEnabled;
    this.duration = Math.max(0.5, parseFloat(snapshot.duration) || 5);
    this.currentTime = Math.max(0, Math.min(this.duration, parseFloat(snapshot.currentTime) || 0));
    this.keyframingEnabled = { ...(snapshot.keyframingEnabled || {}) };
    this.keyframes = JSON.parse(JSON.stringify(snapshot.keyframes || {}));
    this.registry.forEach((_, key) => {
      if (!this.keyframes[key]) this.keyframes[key] = [];
      this._updateTimerButtons(key);
    });
    this._selectedKeyframes = [];
    this._updateMotionButton();
    this.applyCurrentTime();
    this._renderTimeline();
    this._updateTimeUI();
    if (this.app && this.app.parameterPanel && this.app.parameterPanel._updateVideoExportOptions) {
      this.app.parameterPanel._updateVideoExportOptions();
    }
  }

  _applyTimelineHeight() {
    if (!this._timelineEl) return;
    this._timelineEl.style.setProperty('--motion-timeline-height', this._timelineHeight + 'px');
    document.body.style.setProperty('--motion-timeline-height', this._timelineHeight + 'px');
    this._updateTimeUI();
    if (this.app && this.app.fitCanvasToTexture) this.app.fitCanvasToTexture();
  }

  _buildTimeline() {
    const el = document.createElement('div');
    el.id = 'motion-timeline';
    el.className = 'motion-timeline';
    el.hidden = true;

    el.innerHTML =
      '<div class="motion-timeline__resize-handle" title="Resize timeline"></div>' +
      '<div class="motion-timeline__toolbar">' +
        '<button class="motion-timeline__play" type="button" title="Play animation" aria-label="Play animation">' +
          '<svg class="motion-timeline__icon motion-timeline__icon--play" width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2l8 5-8 5V2z"/></svg>' +
          '<svg class="motion-timeline__icon motion-timeline__icon--pause" width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 2h3v10H3V2zm5 0h3v10H8V2z"/></svg>' +
        '</button>' +
        '<label class="motion-timeline__duration">Duration <input type="number" min="0.5" max="60" step="0.5" value="5"></label>' +
        '<div class="motion-timeline__time">00:00.0 / 00:05.0</div>' +
        '<div class="motion-easing-bar" hidden>' +
          '<span class="motion-easing-bar__label">Easing</span>' +
          '<input type="text" class="motion-easing-bar__input" placeholder="linear" spellcheck="false" />' +
          '<button type="button" class="motion-easing-bar__graph-btn" title="Edit cubic-bézier curve">' +
            '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="1" y="1" width="11" height="11" rx="1.5" stroke-width="1"/><path d="M2 10C2 10 4.5 3 11 3"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="motion-timeline__scrubber">' +
        '<div class="motion-timeline__scrub-label"></div>' +
        '<div class="motion-timeline__scrub-area">' +
          '<div class="motion-timeline__ruler"></div>' +
          '<div class="motion-timeline__playhead"></div>' +
        '</div>' +
      '</div>' +
      '<div class="motion-timeline__tracks"></div>';

    document.body.appendChild(el);
    el.addEventListener('mousedown', () => this._lockSelectionUntilMouseup(), true);
    this._timelineEl = el;
    this._tracksEl = el.querySelector('.motion-timeline__tracks');
    this._playheadEl = el.querySelector('.motion-timeline__playhead');
    this._timeEl = el.querySelector('.motion-timeline__time');
    this._playBtn = el.querySelector('.motion-timeline__play');
    this._scrubberEl = el.querySelector('.motion-timeline__scrub-area');
    this._durationInput = el.querySelector('.motion-timeline__duration input');
    this._resizeHandleEl = el.querySelector('.motion-timeline__resize-handle');
    // --- EASING BAR SETUP ---
    this._easingBarEl = el.querySelector('.motion-easing-bar');
    const easingInput = this._easingBarEl.querySelector('.motion-easing-bar__input');
    const easingGraphBtn = this._easingBarEl.querySelector('.motion-easing-bar__graph-btn');
    easingInput.addEventListener('change', () => this._applyEasingFromInput(easingInput.value.trim()));
    easingInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); easingInput.blur(); } });
    easingGraphBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._bezierPopupEl) this._closeEasingGraph();
      else this._openEasingGraph();
    });
    // ---
    this._applyTimelineHeight();

    this._playBtn.addEventListener('click', () => {
      if (this.isPlaying) this.pause();
      else this.play();
    });

    const durationInput = this._durationInput;
    durationInput.addEventListener('change', () => {
      const next = parseFloat(durationInput.value);
      const nextDuration = Math.max(0.5, Math.min(60, isNaN(next) ? this.duration : next));
      if (nextDuration !== this.duration) this._pushTimelineHistory();
      this.duration = nextDuration;
      durationInput.value = this.duration;
      this.currentTime = Math.min(this.currentTime, this.duration);
      this._renderTimeline();
      this._updateTimeUI();
    });

    const seek = (e) => {
      const rect = this._getTimelineAreaRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const time = (x / rect.width) * this.duration;
      this.setCurrentTime(e.shiftKey ? this._snapTimeToKeyframes(time, rect) : time);
    };

    this._scrubberEl.addEventListener('mousedown', (e) => {
      seek(e);
      const onMove = (moveEvent) => seek(moveEvent);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    window.addEventListener('resize', () => this._updateTimeUI());

    this._resizeHandleEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startHeight = this._timelineHeight;
      document.body.classList.add('motion-resizing');
      const onMove = (moveEvent) => {
        const nextHeight = Math.max(180, Math.min(window.innerHeight * 0.75, startHeight + (startY - moveEvent.clientY)));
        this._timelineHeight = Math.round(nextHeight);
        this._applyTimelineHeight();
      };
      const onUp = () => {
        document.body.classList.remove('motion-resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._updateTimeUI();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    document.addEventListener('keydown', (e) => {
      if (!this.motionEnabled || e.code !== 'Space') return;
      if (this._isTypingTarget(e.target)) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (this.isPlaying) {
        const restoreTime = this._keyboardPlaybackStartTime;
        this.pause();
        if (typeof restoreTime === 'number') {
          this.setCurrentTime(restoreTime);
        }
        this._keyboardPlaybackStartTime = null;
      } else {
        this._keyboardPlaybackStartTime = this.currentTime;
        this.play();
      }
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!this.motionEnabled || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      if (this._isTypingTarget(e.target)) return;
      if (this._selectedKeyframes.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      this._deleteSelectedKeyframes();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!this.motionEnabled) return;
      if (this._isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (key === 'c' && this._selectedKeyframes.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._copySelectedKeyframes();
        return;
      }
      if (key === 'v' && this._keyframeClipboard && this._keyframeClipboard.items.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._pasteKeyframes();
        return;
      }

      const wantsUndo = key === 'z' && !e.shiftKey;
      const wantsRedo = (key === 'z' && e.shiftKey) || key === 'y';
      if (wantsUndo && this._undoStack.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.undo();
      } else if (wantsRedo && this._redoStack.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.redo();
      }
    }, true);

    this._tracksEl.addEventListener('mousedown', (e) => {
      if (!this.motionEnabled) return;
      if (e.target.closest('.motion-keyframe') ||
          e.target.closest('.motion-track__remove') ||
          e.target.closest('.motion-track__value') ||
          e.target.closest('.motion-track__key-btn')) return;
      if (e.button !== 0) return;

      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let didDrag = false;

      const box = document.createElement('div');
      box.className = 'motion-selection-box';
      box.style.display = 'none';
      document.body.appendChild(box);
      this._selectionBoxEl = box;

      const drawBox = (x, y) => {
        const left = Math.min(startX, x);
        const top = Math.min(startY, y);
        const width = Math.abs(x - startX);
        const height = Math.abs(y - startY);
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
        box.style.display = width > 2 || height > 2 ? '' : 'none';
        return { left, top, right: left + width, bottom: top + height };
      };

      const onMove = (moveEvent) => {
        const rect = drawBox(moveEvent.clientX, moveEvent.clientY);
        didDrag = didDrag || Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3;
        if (didDrag) {
          this._selectedKeyframes = this._collectKeyframesInRect(rect);
          this._syncSelectedMarkerClasses();
          this._updateEasingBar();
        }
      };

      const onUp = (upEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (box.parentNode) box.parentNode.removeChild(box);
        this._selectionBoxEl = null;

        if (!didDrag) {
          this._clearSelectedKeyframes();
          this._renderTimeline();
          return;
        }

        const rect = drawBox(upEvent.clientX, upEvent.clientY);
        this._selectedKeyframes = this._collectKeyframesInRect(rect);
        this._renderTimeline();
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _tick(now) {
    if (!this.isPlaying) return;
    const delta = Math.max(0, (now - this._lastTick) / 1000);
    this._lastTick = now;
    this.currentTime += delta;
    if (this.currentTime > this.duration) this.currentTime = this.currentTime % this.duration;
    this.applyCurrentTime();
    this._updateTimeUI();
    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  _renderTimeline() {
    if (!this._tracksEl) return;
    this._tracksEl.innerHTML = '';

    let activeTracks = 0;
    this.registry.forEach((meta, key) => {
      const track = this.keyframes[key] || [];
      if (!this.keyframingEnabled[key] && track.length === 0) return;
      activeTracks++;

      const row = document.createElement('div');
      row.className = 'motion-track';

      const label = document.createElement('div');
      label.className = 'motion-track__label';

      const removeTrackBtn = document.createElement('button');
      removeTrackBtn.type = 'button';
      removeTrackBtn.className = 'motion-track__remove';
      removeTrackBtn.title = 'Remove animation';
      removeTrackBtn.setAttribute('aria-label', 'Remove animation for ' + (meta.label || key));
      removeTrackBtn.textContent = 'x';
      removeTrackBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeTrackAnimation(key, track);
      });
      label.appendChild(removeTrackBtn);

      const labelText = document.createElement('span');
      labelText.className = 'motion-track__label-text';
      labelText.textContent = meta.label || key;
      label.appendChild(labelText);

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'motion-track__value';
      valueInput.dataset.motionValueKey = key;
      valueInput.value = this._formatTrackValue(key, this._readCurrentValue(key));
      valueInput.title = 'Edit or drag value';
      valueInput.addEventListener('mousedown', (e) => this._startTrackValueDrag(e, key, valueInput));
      valueInput.addEventListener('focus', () => {
        valueInput._focusValue = valueInput.value;
      });
      valueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          valueInput.blur();
        }
      });
      valueInput.addEventListener('blur', () => {
        if (valueInput._skipTrackCommit) {
          valueInput._skipTrackCommit = false;
          return;
        }
        if (valueInput.value === valueInput._focusValue) return;
        this._commitTrackValueInput(key, valueInput.value);
      });
      label.appendChild(valueInput);

      const addKeyBtn = document.createElement('button');
      addKeyBtn.type = 'button';
      addKeyBtn.className = 'motion-track__key-btn';
      addKeyBtn.title = 'Add keyframe at current time';
      addKeyBtn.setAttribute('aria-label', 'Add keyframe for ' + (meta.label || key));
      addKeyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9 9-9z"/></svg>';
      addKeyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._addKeyframeAtCurrentValue(key);
      });
      label.appendChild(addKeyBtn);
      row.appendChild(label);

      const area = document.createElement('div');
      area.className = 'motion-track__area';
      row.appendChild(area);

      track.forEach((kf, index) => {
        const marker = document.createElement('div');
        const isSelected = this._isKeyframeSelected(key, kf);
        const hasEasing = kf.easing && kf.easing !== 'linear';
        marker.className = 'motion-keyframe' +
          (hasEasing ? ' motion-keyframe--eased' : '') +
          (isSelected ? ' motion-keyframe--selected' : '');
        marker.style.left = ((kf.time / this.duration) * 100) + '%';
        marker.dataset.motionKey = key;
        marker._motionKeyframe = kf;
        marker.title = `${this._formatTime(kf.time)}\n${String(kf.value)}`;

        const shape = document.createElement('div');
        shape.className = 'motion-keyframe__shape';
        if (hasEasing) {
          shape.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 2h12v6l-4 4 4 4v6H6v-6l4-4-4-4V2z"/></svg>';
        }

        const drag = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const alreadySelected = this._isKeyframeSelected(key, kf);
          if (!alreadySelected && e.shiftKey) {
            this._selectedKeyframes.push({ key, kf });
          } else if (!alreadySelected) {
            this._selectedKeyframes = [{ key, kf }];
          }
          marker.classList.add('motion-keyframe--selected');
          this._updateEasingBar();

          const now = performance.now();
          const isDoubleClick = this._lastKeyframeClick.key === key &&
            this._lastKeyframeClick.kf === kf &&
            now - this._lastKeyframeClick.time < 300;
          this._lastKeyframeClick = { key, kf, time: now };
          if (isDoubleClick) {
            const selection = this._isKeyframeSelected(key, kf)
              ? this._selectedKeyframes
              : [{ key, kf }];
            const shouldEase = selection.some(item => !item.kf.easing || item.kf.easing === 'linear');
            this._pushTimelineHistory();
            selection.forEach(item => {
              item.kf.easing = shouldEase ? '0.3, 0, 0, 1' : 'linear';
            });
            this._renderTimeline();
            this.applyCurrentTime();
            return;
          }

          const rect = area.getBoundingClientRect();
          const markerRect = marker.getBoundingClientRect();
          const grabOffsetX = e.clientX - (markerRect.left + markerRect.width / 2);
          const dragSelection = this._isKeyframeSelected(key, kf)
            ? this._selectedKeyframes.slice()
            : [{ key, kf }];
          const startTimes = dragSelection.map(item => ({
            key: item.key,
            kf: item.kf,
            time: item.kf.time
          }));
          const primaryStartTime = kf.time;
          const minStartTime = Math.min(...startTimes.map(item => item.time));
          const maxStartTime = Math.max(...startTimes.map(item => item.time));
          const scaleSpan = maxStartTime - minStartTime;
          const canScaleSelection = dragSelection.length > 1 &&
            scaleSpan > 0.0001 &&
            Math.abs(primaryStartTime - maxStartTime) < 0.0001;
          let historyPushed = false;
          const move = (moveEvent) => {
            const x = Math.max(0, Math.min(rect.width, moveEvent.clientX - grabOffsetX - rect.left));
            const rawTime = (x / rect.width) * this.duration;
            const requestedTime = moveEvent.shiftKey
              ? this._snapTimeToKeyframes(rawTime, rect, dragSelection)
              : rawTime;
            if (!historyPushed) {
              this._pushTimelineHistory();
              historyPushed = true;
            }

            if (moveEvent.altKey && canScaleSelection) {
              const handleTime = Math.max(minStartTime, Math.min(this.duration, requestedTime));
              const scale = (handleTime - minStartTime) / scaleSpan;
              startTimes.forEach(item => {
                item.kf.time = Math.max(0, Math.min(this.duration, minStartTime + ((item.time - minStartTime) * scale)));
              });
            } else {
              const requestedOffset = requestedTime - primaryStartTime;
              const minOffset = -minStartTime;
              const maxOffset = this.duration - maxStartTime;
              const offset = Math.max(minOffset, Math.min(maxOffset, requestedOffset));
              startTimes.forEach(item => {
                item.kf.time = item.time + offset;
              });
            }
            this._sortSelectedTracks(dragSelection);
            this._syncMarkerPositions();
            this.setCurrentTime(kf.time);
          };
          const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            this._renderTimeline();
          };
          document.addEventListener('mousemove', move);
          document.addEventListener('mouseup', up);
        };

        marker.addEventListener('mousedown', drag);
        marker.appendChild(shape);
        area.appendChild(marker);
      });

      this._tracksEl.appendChild(row);
    });

    if (activeTracks === 0) {
      const empty = document.createElement('div');
      empty.className = 'motion-timeline__empty';
      empty.textContent = 'Click a clock beside a control to start keyframing.';
      this._tracksEl.appendChild(empty);
    }
    this._updateTimeUI();
    this._updateEasingBar();
  }

  _applyValue(key, value) {
    const meta = this.registry.get(key);
    if (meta && meta.parameter && meta.parameter.step) {
      const step = meta.parameter.step;
      value = Math.round(value / step) * step;
    }
    this.isApplying = true;
    stateManager.set(key, value, { skipHistory: true });

    const el = document.getElementById(key);
    if (el) {
      if (el.type === 'checkbox') {
        el.checked = !!value;
      } else if ('value' in el) {
        el.value = value;
      }

      if (el.type === 'range') {
        el.dispatchEvent(new Event('input'));
      }

      const row = el.closest('.parameter');
      const display = row ? row.querySelector('.parameter__value') : null;
      if (display) {
        const displayValue = meta && meta.parameter && meta.parameter.formatValue
          ? meta.parameter.formatValue(value)
          : value;
        if (display.tagName === 'INPUT') display.value = displayValue;
        else display.textContent = displayValue;
      }
    }

    if (meta && meta.parameter) {
      meta.parameter.value = value;
      if (meta.parameter.type === 'button-group' && meta.parameter._buttonRow) {
        meta.parameter._buttonRow.querySelectorAll('.parameter__group-btn').forEach(btn => {
          btn.classList.toggle('parameter__group-btn--active', String(btn.dataset.value) === String(value));
        });
      }
    }

    this.isApplying = false;
    this._syncTrackValueDisplays(key, value);
  }

  _addKeyframeAtCurrentValue(key, value = this._readCurrentValue(key), options = {}) {
    if (!this.registry.has(key)) return;
    if (!this.keyframingEnabled[key]) {
      this.keyframingEnabled[key] = true;
      this._updateTimerButtons(key);
    }

    if (!options.skipHistory) this._pushTimelineHistory(options.history || {});
    const track = this.keyframes[key] || (this.keyframes[key] = []);
    const threshold = 0.001;
    const existing = track.find(kf => Math.abs(kf.time - this.currentTime) < threshold);
    if (existing) {
      existing.value = this._cloneValue(value);
    } else {
      track.push({ time: this.currentTime, value: this._cloneValue(value), easing: '0.3, 0, 0, 1' });
      track.sort((a, b) => a.time - b.time);
    }
    this._renderTimeline();
    this.applyCurrentTime();
  }

  _removeTrackAnimation(key, track) {
    this._pushTimelineHistory();
    const currentValue = track && track.length > 0
      ? this._interpolateValue(key, track, this.currentTime)
      : this._readCurrentValue(key);
    this._applyValue(key, currentValue);
    this.keyframingEnabled[key] = false;
    this.keyframes[key] = [];
    this._clearSelectedKeyframes(key);
    this._updateTimerButtons(key);
    this._renderTimeline();
  }

  _commitTrackValueInput(key, rawValue) {
    const parsed = this._parseTrackValue(key, rawValue);
    if (parsed === undefined) {
      this._syncTrackValueDisplays(key, this._readCurrentValue(key), { force: true });
      return;
    }
    this._pushTimelineHistory();
    this._applyValue(key, parsed);
    this._addKeyframeAtCurrentValue(key, parsed, { skipHistory: true });
  }

  _startTrackValueDrag(e, key, input) {
    if (e.button !== 0) return;
    const startValue = parseFloat(this._readCurrentValue(key));
    if (!Number.isFinite(startValue)) return;
    if (document.activeElement === input) return;

    e.preventDefault();
    e.stopPropagation();
    const param = this.registry.get(key)?.parameter;
    const step = Number.isFinite(parseFloat(param?.step)) ? parseFloat(param.step) : 1;
    const min = Number.isFinite(parseFloat(param?.min)) ? parseFloat(param.min) : -Infinity;
    const max = Number.isFinite(parseFloat(param?.max)) ? parseFloat(param.max) : Infinity;
    const startX = e.clientX;
    let didDrag = false;
    let latestValue = startValue;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      if (!didDrag && Math.abs(dx) < 3) return;
      if (!didDrag) {
        didDrag = true;
        input._skipTrackCommit = true;
        input.blur();
        document.body.classList.add('motion-value-dragging');
        this._pushTimelineHistory();
      }
      moveEvent.preventDefault();
      const precision = this._getStepPrecision(step);
      const multiplier = moveEvent.shiftKey ? 0.1 : 1;
      const raw = startValue + dx * step * multiplier;
      latestValue = Math.max(min, Math.min(max, parseFloat(raw.toFixed(precision))));
      this._applyValue(key, latestValue);
    };

    const onUp = () => {
      document.body.classList.remove('motion-value-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (didDrag) {
        this._addKeyframeAtCurrentValue(key, latestValue, { skipHistory: true });
      } else {
        input.focus({ preventScroll: true });
        const end = input.value.length;
        if (input.setSelectionRange) input.setSelectionRange(end, end);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _parseTrackValue(key, rawValue) {
    const meta = this.registry.get(key);
    const current = this._readCurrentValue(key);
    const value = String(rawValue).trim();
    if (value === '') return undefined;

    if (typeof current === 'boolean') {
      if (/^(true|1|yes|on)$/i.test(value)) return true;
      if (/^(false|0|no|off)$/i.test(value)) return false;
      return undefined;
    }

    if (meta && meta.parameter && meta.parameter.type === 'color') {
      return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
    }

    const currentNumber = parseFloat(current);
    const nextNumber = parseFloat(value.replace(/^x/i, ''));
    if (meta && meta.parameter && meta.parameter.valueLabels) {
      const labels = meta.parameter.valueLabels;
      const match = Object.keys(labels).find(labelKey => String(labels[labelKey]).toLowerCase() === value.toLowerCase());
      if (match != null) return parseFloat(match);
    }
    if (Number.isFinite(currentNumber) && Number.isFinite(nextNumber)) {
      const param = meta && meta.parameter;
      const min = Number.isFinite(parseFloat(param?.min)) ? parseFloat(param.min) : -Infinity;
      const max = Number.isFinite(parseFloat(param?.max)) ? parseFloat(param.max) : Infinity;
      return Math.max(min, Math.min(max, nextNumber));
    }

    return value;
  }

  _formatTrackValue(key, value) {
    const param = this.registry.get(key)?.parameter;
    if (param && param.formatValue) return param.formatValue(value);
    if (typeof value === 'number') return parseFloat(value.toFixed(5));
    return String(value);
  }

  _syncTrackValueDisplays(key = null, value = null, options = {}) {
    if (!this._timelineEl) return;
    this._timelineEl.querySelectorAll('[data-motion-value-key]').forEach(input => {
      if (!options.force && document.activeElement === input) return;
      const inputKey = input.dataset.motionValueKey;
      if (key && inputKey !== key) return;
      const nextValue = key ? value : this._readCurrentValue(inputKey);
      input.value = this._formatTrackValue(inputKey, nextValue);
    });
  }

  _getStepPrecision(step) {
    const text = String(step);
    const dot = text.indexOf('.');
    return dot === -1 ? 0 : Math.min(6, text.length - dot - 1);
  }

  _readCurrentValue(key) {
    const stateValue = stateManager.get(key);
    if (stateValue !== undefined) return this._cloneValue(stateValue);
    const el = document.getElementById(key);
    if (!el) return 0;
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') return parseFloat(el.value);
    return el.value;
  }

  _interpolateValue(key, track, time) {
    if (track.length === 0) return null;
    if (track.length === 1 || time <= track[0].time) return this._cloneValue(track[0].value);
    if (time >= track[track.length - 1].time) return this._cloneValue(track[track.length - 1].value);

    for (let i = 0; i < track.length - 1; i++) {
      const a = track[i];
      const b = track[i + 1];
      if (time < a.time || time > b.time) continue;
      const span = b.time - a.time;
      let t = span <= 0 ? 1 : (time - a.time) / span;

      const bezierParams = this._parseCubicBezier(a.easing);
      if (bezierParams) t = this._bezierY(t, bezierParams[0], bezierParams[1], bezierParams[2], bezierParams[3]);

      return this._mixValues(key, a.value, b.value, t);
    }
    return this._cloneValue(track[track.length - 1].value);
  }

  _mixValues(key, a, b, t) {
    const an = parseFloat(a);
    const bn = parseFloat(b);
    if (Number.isFinite(an) && Number.isFinite(bn) && String(a).trim() !== '' && String(b).trim() !== '') {
      let value = an + (bn - an) * t;
      return parseFloat(value.toFixed(5));
    }

    if (this._isHex(a) && this._isHex(b)) {
      const ca = this._hexToRgb(a);
      const cb = this._hexToRgb(b);
      return this._rgbToHex(
        Math.round(ca.r + (cb.r - ca.r) * t),
        Math.round(ca.g + (cb.g - ca.g) * t),
        Math.round(ca.b + (cb.b - ca.b) * t)
      );
    }

    return t < 1 ? this._cloneValue(a) : this._cloneValue(b);
  }

  _bezierY(x, p1x, p1y, p2x, p2y) {
    const cubic = (t, p0, p1, p2, p3) => {
      const u = 1 - t;
      return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3);
    };
    let lower = 0;
    let upper = 1;
    let t = x;
    for (let i = 0; i < 20; i++) {
      const currentX = cubic(t, 0, p1x, p2x, 1);
      if (Math.abs(currentX - x) < 0.001) break;
      if (currentX < x) lower = t;
      else upper = t;
      t = (upper + lower) / 2;
    }
    return cubic(t, 0, p1y, p2y, 1);
  }

  _updateTimeUI() {
    if (this._timeEl) {
      this._timeEl.textContent = this._formatTime(this.currentTime) + ' / ' + this._formatTime(this.duration);
    }
    if (this._durationInput && document.activeElement !== this._durationInput) {
      this._durationInput.value = this.duration;
    }
    if (this._playheadEl) {
      const pct = this.duration > 0 ? (this.currentTime / this.duration) * 100 : 0;
      const scrubRect = this._scrubberEl ? this._scrubberEl.getBoundingClientRect() : null;
      const areaRect = this._getTimelineAreaRect();
      if (scrubRect && areaRect && areaRect.width) {
        const left = (areaRect.left - scrubRect.left) + (pct / 100) * areaRect.width;
        this._playheadEl.style.left = left + 'px';
      } else {
        this._playheadEl.style.left = pct + '%';
      }
    }
  }

  _updatePlayButton() {
    if (this._playBtn) this._playBtn.classList.toggle('is-playing', this.isPlaying);
  }

  _updateMotionButton() {
    document.querySelectorAll('.settings-bar__btn--motion').forEach(btn => {
      btn.classList.toggle('is-active', this.motionEnabled);
    });
  }

  _updateTimerButtons(key) {
    document.querySelectorAll('[data-motion-key]').forEach(btn => {
      if (btn.dataset.motionKey === key) {
        btn.classList.toggle('parameter__motion-toggle--active', !!this.keyframingEnabled[key]);
      }
    });
  }

  _deleteSelectedKeyframes() {
    if (this._selectedKeyframes.length === 0) return;

    this._pushTimelineHistory();
    const byKey = new Map();
    this._selectedKeyframes.forEach(item => {
      if (!byKey.has(item.key)) byKey.set(item.key, new Set());
      byKey.get(item.key).add(item.kf);
    });

    byKey.forEach((frames, key) => {
      const track = this.keyframes[key];
      if (!track) return;
      this.keyframes[key] = track.filter(kf => !frames.has(kf));
    });

    this._selectedKeyframes = [];
    this.applyCurrentTime();
    this._renderTimeline();
  }

  _copySelectedKeyframes() {
    if (this._selectedKeyframes.length === 0) return;

    const copied = this._selectedKeyframes
      .filter(item => item && item.key && item.kf)
      .map(item => ({
        key: item.key,
        time: item.kf.time,
        value: this._cloneValue(item.kf.value),
        easing: item.kf.easing || 'linear'
      }))
      .sort((a, b) => (a.time - b.time) || a.key.localeCompare(b.key));

    if (copied.length === 0) return;
    const minTime = Math.min(...copied.map(item => item.time));
    const maxTime = Math.max(...copied.map(item => item.time));
    this._keyframeClipboard = {
      minTime,
      maxTime,
      items: copied.map(item => ({
        key: item.key,
        offset: item.time - minTime,
        value: this._cloneValue(item.value),
        easing: item.easing
      }))
    };
  }

  _pasteKeyframes() {
    if (!this._keyframeClipboard || !Array.isArray(this._keyframeClipboard.items)) return;

    const items = this._keyframeClipboard.items.filter(item => item && this.registry.has(item.key));
    if (items.length === 0) return;

    const span = Math.max(0, (this._keyframeClipboard.maxTime || 0) - (this._keyframeClipboard.minTime || 0));
    const startTime = Math.max(0, Math.min(this.duration, this.currentTime));
    const pasteStart = span > 0
      ? Math.max(0, Math.min(startTime, this.duration - span))
      : startTime;
    const pastedSelection = [];

    this._pushTimelineHistory();
    items.forEach(item => {
      const targetTime = Math.max(0, Math.min(this.duration, pasteStart + item.offset));
      const track = this.keyframes[item.key] || (this.keyframes[item.key] = []);
      this.keyframingEnabled[item.key] = true;
      this._updateTimerButtons(item.key);

      let pasted = track.find(kf => Math.abs(kf.time - targetTime) < 0.001);
      if (pasted) {
        pasted.value = this._cloneValue(item.value);
        pasted.easing = item.easing || 'linear';
      } else {
        pasted = {
          time: targetTime,
          value: this._cloneValue(item.value),
          easing: item.easing || 'linear'
        };
        track.push(pasted);
      }
      pastedSelection.push({ key: item.key, kf: pasted });
    });

    this._sortSelectedTracks(pastedSelection);
    this._selectedKeyframes = pastedSelection;
    this._renderTimeline();
    this.applyCurrentTime();
  }

  _clearSelectedKeyframes(key = null) {
    if (this._selectedKeyframes.length === 0) return;
    this._selectedKeyframes = key
      ? this._selectedKeyframes.filter(item => item.key !== key)
      : [];
  }

  _isKeyframeSelected(key, kf) {
    return this._selectedKeyframes.some(item => item.key === key && item.kf === kf);
  }

  _collectKeyframesInRect(rect) {
    const selected = [];
    this._tracksEl.querySelectorAll('.motion-keyframe').forEach(marker => {
      const key = marker.dataset.motionKey;
      const kf = marker._motionKeyframe;
      if (!key || !kf) return;
      const r = marker.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
        selected.push({ key, kf });
      }
    });
    return selected;
  }

  _syncSelectedMarkerClasses() {
    this._tracksEl.querySelectorAll('.motion-keyframe').forEach(marker => {
      const key = marker.dataset.motionKey;
      const kf = marker._motionKeyframe;
      marker.classList.toggle('motion-keyframe--selected', this._isKeyframeSelected(key, kf));
    });
  }

  _sortSelectedTracks(selection) {
    const keys = new Set(selection.map(item => item.key));
    keys.forEach(key => {
      const track = this.keyframes[key];
      if (track) track.sort((a, b) => a.time - b.time);
    });
  }

  _syncMarkerPositions() {
    this._tracksEl.querySelectorAll('.motion-keyframe').forEach(marker => {
      const kf = marker._motionKeyframe;
      if (!kf) return;
      marker.style.left = ((kf.time / this.duration) * 100) + '%';
    });
  }

  _getTimelineAreaRect() {
    const trackArea = this._tracksEl
      ? this._tracksEl.querySelector('.motion-track__area')
      : null;
    return (trackArea || this._scrubberEl).getBoundingClientRect();
  }

  _snapTimeToKeyframes(time, rect, excluded = []) {
    if (!rect || !rect.width || !this.duration) return time;

    const excludedFrames = new Set(excluded.map(item => item.kf));
    const thresholdSeconds = (10 / rect.width) * this.duration;
    let bestTime = time;
    let bestDistance = thresholdSeconds;

    Object.values(this.keyframes).forEach(track => {
      if (!Array.isArray(track)) return;
      track.forEach(kf => {
        if (!kf || excludedFrames.has(kf)) return;
        const distance = Math.abs(kf.time - time);
        if (distance <= bestDistance) {
          bestDistance = distance;
          bestTime = kf.time;
        }
      });
    });

    return Math.max(0, Math.min(this.duration, bestTime));
  }

  _serializeParameterSettings(param) {
    if (!param) return null;
    const settings = {
      id: param.id,
      label: param.label,
      group: param.group,
      type: param.type,
      defaultValue: this._cloneValue(param.defaultValue)
    };
    ['min', 'max', 'step', 'options', 'valueLabels', 'valuePrefix', 'valueSuffix'].forEach(key => {
      if (param[key] !== undefined && param[key] !== null) {
        settings[key] = this._cloneValue(param[key]);
      }
    });
    return settings;
  }

  _normalizeMotionData(data) {
    const normalized = {
      motionEnabled: data.motionEnabled,
      duration: data.duration,
      currentTime: data.currentTime,
      keyframingEnabled: { ...(data.keyframingEnabled || {}) },
      keyframes: JSON.parse(JSON.stringify(data.keyframes || {}))
    };

    if (Array.isArray(data.tracks)) {
      normalized.keyframingEnabled = {};
      normalized.keyframes = {};
      data.tracks.forEach(track => {
        if (!track || !track.key) return;
        normalized.keyframingEnabled[track.key] = !!track.enabled;
        normalized.keyframes[track.key] = Array.isArray(track.keyframes)
          ? track.keyframes.map(kf => ({
              time: parseFloat(kf.time) || 0,
              value: this._cloneValue(kf.value),
              easing: kf.easing || 'linear'
            })).sort((a, b) => a.time - b.time)
          : [];
      });
    }

    return normalized;
  }

  _isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      return ['text', 'search', 'url', 'email', 'number', 'password'].includes(target.type);
    }
    return !!target.closest?.('[contenteditable="true"]');
  }

  _formatTime(seconds) {
    const safe = Math.max(0, seconds || 0);
    const m = Math.floor(safe / 60).toString().padStart(2, '0');
    const s = Math.floor(safe % 60).toString().padStart(2, '0');
    const tenths = Math.floor((safe % 1) * 10);
    return `${m}:${s}.${tenths}`;
  }

  _cloneValue(value) {
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
  }

  _isHex(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  }

  _hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  _rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  // --- EASING BAR & BEZIER POPUP (removable block) ---

  _parseCubicBezier(easing) {
    if (!easing || easing === 'linear') return null;
    if (easing === 'ease-in-out') return [0.42, 0, 0.58, 1];
    const parts = easing.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) return parts;
    return null;
  }

  _easingToDisplayString(easing) {
    if (!easing || easing === 'linear') return 'linear';
    if (easing === 'ease-in-out') return '0.42, 0, 0.58, 1';
    return easing;
  }

  _updateEasingBar() {
    if (!this._easingBarEl) return;
    const sel = this._selectedKeyframes;
    this._easingBarEl.hidden = sel.length === 0;
    if (sel.length === 0) {
      this._closeEasingGraph();
      return;
    }
    const input = this._easingBarEl.querySelector('.motion-easing-bar__input');
    if (!input || document.activeElement === input) return;
    const easings = sel.map(item => item.kf.easing || 'linear');
    const allSame = easings.every(e => e === easings[0]);
    if (allSame) {
      input.value = this._easingToDisplayString(easings[0]);
      input.placeholder = 'linear';
    } else {
      input.value = '';
      input.placeholder = 'mixed';
    }
  }

  _applyEasingFromInput(raw) {
    if (this._selectedKeyframes.length === 0) return;
    let easing;
    if (!raw || raw.toLowerCase() === 'linear') {
      easing = 'linear';
    } else {
      const parts = raw.split(',').map(s => parseFloat(s.trim()));
      if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
        parts[0] = Math.max(0, Math.min(1, parts[0]));
        parts[2] = Math.max(0, Math.min(1, parts[2]));
        const isLinear = parts[0] === 0 && parts[1] === 0 && parts[2] === 1 && parts[3] === 1;
        easing = isLinear ? 'linear' : parts.map(n => parseFloat(n.toFixed(2))).join(', ');
      } else {
        this._updateEasingBar();
        return;
      }
    }
    this._pushTimelineHistory();
    this._selectedKeyframes.forEach(item => { item.kf.easing = easing; });
    this._renderTimeline();
    this.applyCurrentTime();
  }

  _openEasingGraph() {
    this._closeEasingGraph();
    const sel = this._selectedKeyframes;
    if (sel.length === 0) return;

    const easings = sel.map(item => item.kf.easing || 'linear');
    const allSame = easings.every(e => e === easings[0]);
    const parsed = allSame ? this._parseCubicBezier(easings[0]) : null;
    let p1x = parsed ? parsed[0] : 0;
    let p1y = parsed ? parsed[1] : 0;
    let p2x = parsed ? parsed[2] : 1;
    let p2y = parsed ? parsed[3] : 1;

    const svgNS = 'http://www.w3.org/2000/svg';
    const W = 180, H = 300, PX = 20, BOX = 140, Y0 = 80;
    const toSX = bx => PX + bx * BOX;
    const toSY = by => Y0 + (1 - by) * BOX;
    const fromSX = sx => (sx - PX) / BOX;
    const fromSY = sy => 1 - (sy - Y0) / BOX;

    const popup = document.createElement('div');
    popup.className = 'motion-bezier-popup';

    const header = document.createElement('div');
    header.className = 'motion-bezier-popup__header';
    header.innerHTML = '<span>Cubic Bézier</span>';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'motion-bezier-popup__close';
    closeBtn.title = 'Close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => this._closeEasingGraph());
    header.appendChild(closeBtn);
    popup.appendChild(header);

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.add('motion-bezier-popup__svg');

    const mkRect = (x, y, w, h, fill) => {
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', w); r.setAttribute('height', h);
      r.setAttribute('fill', fill);
      return r;
    };
    svg.appendChild(mkRect(PX, 0, BOX, Y0, 'rgba(255,255,255,0.02)'));
    svg.appendChild(mkRect(PX, Y0 + BOX, BOX, H - Y0 - BOX, 'rgba(255,255,255,0.02)'));
    const unitBox = mkRect(PX, Y0, BOX, BOX, 'rgba(255,255,255,0.04)');
    unitBox.setAttribute('stroke', 'var(--input-border)');
    unitBox.setAttribute('stroke-width', '1');
    svg.appendChild(unitBox);

    const mkLine = (x1, y1, x2, y2, attrs = {}) => {
      const l = document.createElementNS(svgNS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      Object.entries(attrs).forEach(([k, v]) => l.setAttribute(k, v));
      return l;
    };
    svg.appendChild(mkLine(toSX(0), toSY(0), toSX(1), toSY(1), { stroke: 'var(--text-muted)', 'stroke-width': '1', 'stroke-dasharray': '4 3', opacity: '0.4' }));
    [Y0, Y0 + BOX].forEach(y => svg.appendChild(mkLine(0, y, W, y, { stroke: 'var(--text-muted)', 'stroke-width': '1', 'stroke-dasharray': '3 3', opacity: '0.2' })));

    const ctrlGroup = document.createElementNS(svgNS, 'g');
    svg.appendChild(ctrlGroup);

    const curvePath = document.createElementNS(svgNS, 'path');
    curvePath.setAttribute('fill', 'none');
    curvePath.setAttribute('stroke', 'var(--opera-red)');
    curvePath.setAttribute('stroke-width', '2');
    curvePath.setAttribute('stroke-linecap', 'round');
    svg.appendChild(curvePath);

    [[0, 0], [1, 1]].forEach(([bx, by]) => {
      const d = document.createElementNS(svgNS, 'circle');
      d.setAttribute('cx', toSX(bx)); d.setAttribute('cy', toSY(by));
      d.setAttribute('r', '3'); d.setAttribute('fill', 'var(--text-muted)');
      svg.appendChild(d);
    });

    const mkHandle = () => {
      const h = document.createElementNS(svgNS, 'circle');
      h.setAttribute('r', '5'); h.setAttribute('fill', 'var(--opera-red)');
      h.setAttribute('stroke', 'var(--card-bg)'); h.setAttribute('stroke-width', '2');
      h.style.cursor = 'grab';
      return h;
    };
    const h1 = mkHandle(), h2 = mkHandle();
    svg.appendChild(h1); svg.appendChild(h2);
    popup.appendChild(svg);

    const refresh = () => {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const bx = this._bezierCubicPoint(t, 0, p1x, p2x, 1);
        const by = this._bezierCubicPoint(t, 0, p1y, p2y, 1);
        pts.push((i === 0 ? 'M' : 'L') + toSX(bx).toFixed(1) + ',' + toSY(by).toFixed(1));
      }
      curvePath.setAttribute('d', pts.join(' '));
      h1.setAttribute('cx', toSX(p1x)); h1.setAttribute('cy', toSY(p1y));
      h2.setAttribute('cx', toSX(p2x)); h2.setAttribute('cy', toSY(p2y));
      ctrlGroup.innerHTML = '';
      [[0, 0, p1x, p1y], [1, 1, p2x, p2y]].forEach(([ax, ay, bx, by]) => {
        ctrlGroup.appendChild(mkLine(toSX(ax), toSY(ay), toSX(bx), toSY(by), { stroke: 'var(--text-muted)', 'stroke-width': '1', opacity: '0.5' }));
      });
      const isLinear = p1x === 0 && p1y === 0 && p2x === 1 && p2y === 1;
      const str = isLinear ? 'linear' : [p1x, p1y, p2x, p2y].map(n => parseFloat(n.toFixed(2))).join(', ');
      const inp = this._easingBarEl?.querySelector('.motion-easing-bar__input');
      if (inp && document.activeElement !== inp) inp.value = str;
    };

    const commit = () => {
      const isLinear = p1x === 0 && p1y === 0 && p2x === 1 && p2y === 1;
      const easing = isLinear ? 'linear' : [p1x, p1y, p2x, p2y].map(n => parseFloat(n.toFixed(2))).join(', ');
      this._selectedKeyframes.forEach(item => { item.kf.easing = easing; });
      this.applyCurrentTime();
    };

    const attachDrag = (handle, isP2) => {
      handle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        handle.style.cursor = 'grabbing';
        this._pushTimelineHistory();
        const svgRect = svg.getBoundingClientRect();
        const onMove = (me) => {
          let bx = Math.max(0, Math.min(1, fromSX(me.clientX - svgRect.left)));
          let by = Math.max(-0.5, Math.min(1.5, fromSY(me.clientY - svgRect.top)));
          if (me.shiftKey) {
            bx = Math.round(bx * 10) / 10;
            by = Math.round(by * 10) / 10;
          }
          if (isP2) { p2x = bx; p2y = by; } else { p1x = bx; p1y = by; }
          refresh();
          commit();
        };
        const onUp = () => {
          handle.style.cursor = 'grab';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          this._renderTimeline();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    };
    attachDrag(h1, false);
    attachDrag(h2, true);

    const presetsRow = document.createElement('div');
    presetsRow.className = 'motion-bezier-popup__presets';
    [
      ['Opera', '0.3, 0, 0, 1'],
      ['Ease', '0.25, 0.1, 0.25, 1'],
      ['In', '0.42, 0, 1, 1'],
      ['Out', '0, 0, 0.58, 1'],
      ['In-Out', '0.42, 0, 0.58, 1'],
      ['Spring', '0.34, 1.56, 0.64, 1'],
      ['Linear', 'linear'],
    ].forEach(([label, val]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'motion-bezier-popup__preset';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (val === 'linear') { p1x = 0; p1y = 0; p2x = 1; p2y = 1; }
        else { [p1x, p1y, p2x, p2y] = val.split(',').map(s => parseFloat(s.trim())); }
        refresh();
        this._pushTimelineHistory();
        commit();
        this._renderTimeline();
      });
      presetsRow.appendChild(btn);
    });
    popup.appendChild(presetsRow);

    document.body.appendChild(popup);
    popup.addEventListener('mousedown', () => this._lockSelectionUntilMouseup(), true);
    this._bezierPopupEl = popup;

    requestAnimationFrame(() => {
      if (!popup.isConnected) return;
      const graphBtn = this._easingBarEl?.querySelector('.motion-easing-bar__graph-btn');
      if (!graphBtn) return;
      const btnRect = graphBtn.getBoundingClientRect();
      const pw = popup.offsetWidth || 220;
      const ph = popup.offsetHeight || 400;
      let left = btnRect.left + btnRect.width / 2 - pw / 2;
      let top = btnRect.top - ph - 8;
      left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
      if (top < 8) top = btnRect.bottom + 8;
      popup.style.left = left + 'px';
      popup.style.top = top + 'px';
    });

    this._easingBarEl?.querySelector('.motion-easing-bar__graph-btn')?.classList.add('is-active');
    refresh();

    const onDocDown = (e) => {
      if (popup.isConnected && !popup.contains(e.target) && !this._easingBarEl?.contains(e.target)) {
        this._closeEasingGraph();
        document.removeEventListener('mousedown', onDocDown);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
  }

  _closeEasingGraph() {
    if (this._bezierPopupEl) {
      this._bezierPopupEl.remove();
      this._bezierPopupEl = null;
    }
    this._easingBarEl?.querySelector('.motion-easing-bar__graph-btn')?.classList.remove('is-active');
  }

  _bezierCubicPoint(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  _lockSelectionUntilMouseup() {
    document.body.classList.add('motion-grabbing');
    const prevent = e => e.preventDefault();
    document.addEventListener('selectstart', prevent);
    const cleanup = () => {
      document.body.classList.remove('motion-grabbing');
      document.removeEventListener('selectstart', prevent);
      document.removeEventListener('mouseup', cleanup);
    };
    document.addEventListener('mouseup', cleanup);
  }

  // --- END EASING BAR & BEZIER POPUP ---
}
