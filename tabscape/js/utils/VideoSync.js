/**
 * VideoSync - keeps "locked" uploaded videos (texture, mask, displacement)
 * playing in step: same playback rate, same start, shared play/pause/seek.
 *
 * The locked video with the shortest (trimmed) duration is the reference
 * clock. When it reaches its end every locked video restarts from 0, so
 * longer videos are cut to the shortest one's length.
 *
 * Lock state lives in stateManager (videoLockTexture / videoLockMask /
 * videoLockDisplace) so it is saved with the workspace and settings.
 */
class VideoSync {
  constructor() {
    this.entries = [
      {
        key: 'videoLockTexture',
        isTexture: true,
        sampler: () => (typeof imageSampler !== 'undefined' ? imageSampler : null),
        // Only the uploaded (custom) texture has a lock button
        active: () => (stateManager.get('textureMode') || 'default') === 'custom'
      },
      {
        key: 'videoLockMask',
        sampler: () => (typeof maskSampler !== 'undefined' ? maskSampler : null),
        active: () => stateManager.get('maskMode') === 'custom'
      },
      {
        key: 'videoLockDisplace',
        sampler: () => (typeof displaceSampler !== 'undefined' ? displaceSampler : null),
        active: () => true
      }
    ];
    this._lastPlaying = new Map();
    this._seeking = false;

    // Locking a video restarts the whole group together
    for (const entry of this.entries) {
      stateManager.subscribe(entry.key, (locked) => {
        if (locked) this.restartGroup();
      });
    }
  }

  /** stateManager key for a sampler's lock, or null if it can't be locked. */
  keyForSampler(sampler) {
    const entry = this.entries.find(e => e.sampler() === sampler);
    return entry ? entry.key : null;
  }

  _effectiveDuration(entry, sampler) {
    let dur = sampler.getVideoDuration();
    if (!(dur > 0 && isFinite(dur))) {
      const elt = sampler.video && sampler.video.elt;
      dur = elt ? elt.duration : 0;
    }
    if (entry.isTexture) dur *= (stateManager.get('loopTrim') ?? 100) / 100;
    return dur > 0 && isFinite(dur) ? dur : 0;
  }

  /** Locked videos that are loaded and in use. */
  _group() {
    const group = [];
    for (const entry of this.entries) {
      if (!stateManager.get(entry.key) || !entry.active()) continue;
      const sampler = entry.sampler();
      if (!sampler || !sampler.hasVideo() || !sampler.video || !sampler.video.elt) continue;
      const duration = this._effectiveDuration(entry, sampler);
      if (duration <= 0) continue;
      group.push({ entry, sampler, elt: sampler.video.elt, duration });
    }
    return group.length >= 2 ? group : [];
  }

  /** True while the texture video is driven by the sync group (disables its trim crossfade). */
  isTextureGrouped() {
    return this._group().some(m => m.entry.isTexture);
  }

  _rate(group) {
    const textureLocked = group.some(m => m.entry.isTexture);
    if (textureLocked && typeof app !== 'undefined' && app && app._getTexturePlaybackRate) {
      return app._getTexturePlaybackRate();
    }
    return 1;
  }

  _isExporting() {
    return typeof app !== 'undefined' && app && app.renderer && app.renderer._exportInProgress;
  }

  /** Jump a video to time t and refresh its sampled frame once decoded. */
  _setTime(member, t) {
    const { sampler, elt } = member;
    const target = Math.max(0, Math.min(t, (elt.duration || t) - 0.001));
    const onSeeked = () => {
      elt.removeEventListener('seeked', onSeeked);
      sampler.updateVideoBuffer();
      sampler._cacheValid = false;
      sampler._lastFrameTime = -1;
    };
    elt.addEventListener('seeked', onSeeked);
    elt.currentTime = target;
  }

  _setPlaying(member, playing) {
    const { sampler } = member;
    if (playing && !sampler.isPlaying) sampler.play();
    else if (!playing && sampler.isPlaying) sampler.pause();
  }

  /** Restart every locked video from 0 (keeps the current play state). */
  restartGroup() {
    const group = this._group();
    if (!group.length) return;
    const playing = group.some(m => m.sampler.isPlaying);
    for (const m of group) {
      this._setTime(m, 0);
      this._setPlaying(m, playing);
    }
    this._rememberPlayState(group);
  }

  /**
   * Called by ImageSampler.seek for user seeks: move the whole group to the
   * same time (wrapped to the shortest video's length).
   */
  onSeek(sampler, time) {
    if (this._seeking || this._isExporting()) return;
    const group = this._group();
    if (!group.some(m => m.sampler === sampler)) return;
    const period = Math.min(...group.map(m => m.duration));
    const t = period > 0 ? time % period : 0;
    this._seeking = true;
    for (const m of group) {
      if (m.sampler !== sampler) this._setTime(m, t);
    }
    this._seeking = false;
  }

  _rememberPlayState(group) {
    this._lastPlaying.clear();
    for (const m of group) this._lastPlaying.set(m.entry.key, m.sampler.isPlaying);
  }

  /** Call once per frame. */
  update() {
    if (this._isExporting()) return;
    const group = this._group();
    if (!group.length) {
      this._lastPlaying.clear();
      return;
    }

    // Play / pause: a change on any locked video applies to all of them
    let playing = null;
    for (const m of group) {
      const last = this._lastPlaying.get(m.entry.key);
      if (last !== undefined && last !== m.sampler.isPlaying) playing = m.sampler.isPlaying;
    }
    if (playing === null) playing = group.some(m => m.sampler.isPlaying);
    for (const m of group) this._setPlaying(m, playing);

    // Same speed for everyone
    const rate = this._rate(group);
    for (const m of group) {
      if (Math.abs(m.elt.playbackRate - rate) > 0.001) m.elt.playbackRate = rate;
    }

    // Reference clock = shortest video; loop everything at its end
    let ref = group[0];
    for (const m of group) if (m.duration < ref.duration) ref = m;
    let t = ref.elt.currentTime;
    if (t >= ref.duration - 0.01 && ref.duration < (ref.elt.duration || Infinity) - 0.01) {
      // Reference is a trimmed texture: wrap manually at the trim point
      t = 0;
      this._setTime(ref, 0);
    }

    const tolerance = playing ? 0.15 : 0.04;
    for (const m of group) {
      if (m === ref || m.elt.seeking) continue;
      if (Math.abs(m.elt.currentTime - t) > tolerance) this._setTime(m, t);
    }

    this._rememberPlayState(group);
  }
}

let videoSync = null;
