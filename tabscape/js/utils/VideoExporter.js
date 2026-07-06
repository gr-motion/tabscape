/**
 * VideoExporter - Exports the squircle grid visualization as a PNG sequence or MP4 video.
 *
 * PNG Sequence: renders each frame to a transparent p5.Graphics buffer, converts to PNG blob,
 *   collects into a JSZip archive, and downloads as .zip.
 * MP4: same frame stepping but encodes via WebCodecs VideoEncoder + mp4-muxer (dynamically imported).
 */
class VideoExporter {
  /**
   * @param {object} opts
   * @param {p5}            opts.p5Instance   - The main p5 instance (needed for createGraphics)
   * @param {GridRenderer}  opts.renderer      - The grid renderer (has renderToTarget)
   * @param {ImageSampler}  opts.imageSampler  - The image sampler (has prepareFrameForExport, seek)
   */
  constructor({ p5Instance, renderer, imageSampler }) {
    this.p = p5Instance;
    this.renderer = renderer;
    this.sampler = imageSampler;
    this._cancelled = false;

    // Callbacks
    this.onProgress = null;  // (frameIndex, totalFrames) => void
    this.onComplete = null;  // () => void
    this.onError = null;     // (error) => void
  }

  /** Signal the current export to stop after the current frame. */
  cancel() {
    this._cancelled = true;
  }

  // ─── PNG Sequence ───────────────────────────────────────────────

  /**
   * Export every video frame as a numbered PNG inside a .zip archive.
   * @param {object} opts
   * @param {number} opts.framerate  - Frames per second to sample (e.g. 30)
   * @param {number} opts.width      - Output width in pixels
   * @param {number} opts.height     - Output height in pixels
   */
  async exportPNGSequence({ framerate = 30, width = 2048, height = 2048 } = {}) {
    this._cancelled = false;
    const duration = this._getExportDuration();
    if (!duration || duration <= 0) {
      const msg = 'No video loaded or duration is zero.';
      if (this.onError) this.onError(new Error(msg));
      return;
    }

    // Output target: prefer File System Access API (stream straight to disk —
    // critical at 4K/8K to avoid multi-GB JSZip memory). Fall back to JSZip.
    let dirHandle = null;
    if (window.showDirectoryPicker) {
      try {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        if (e && e.name === 'AbortError') return; // user cancelled
        console.warn('Directory picker failed, falling back to zip:', e);
      }
    }
    let zip = null, folder = null;
    if (!dirHandle) {
      if (typeof JSZip === 'undefined') {
        const msg = 'JSZip is not loaded and File System Access API is unavailable.';
        if (this.onError) this.onError(new Error(msg));
        return;
      }
      zip = new JSZip();
      folder = zip.folder('frames');
    }

    const totalFrames = Math.round(duration * framerate);
    const frameDuration = 1 / framerate;
    const padLen = String(totalFrames).length;

    // Pause video and mark export in progress so live render skips texture updates
    const wasPlaying = this.sampler.isPlaying;
    const frozenTime = wasPlaying ? null : this.sampler.getVideoTime();
    this.sampler.pause();
    this.renderer._exportInProgress = true;
    this._startExportClock();

    const gfx = this.p.createGraphics(width, height);
    if (gfx.pixelDensity) gfx.pixelDensity(1); // 1:1 pixels — selected size = file size
    const sourceCanvas = gfx.canvas || gfx.elt;

    // Worker pool: PNG-encode in parallel off the main thread.
    const poolSize = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const pool = new PngEncoderPool(poolSize);

    // Cap in-flight work so GPU/memory don't blow up while workers catch up.
    const maxInFlight = poolSize * 2;
    const inFlight = new Set();
    let completed = 0;
    let writeError = null;

    // Pre-roll one full loop so push offsets and ripples reach periodic steady state
    this._preRoll(totalFrames, frameDuration);

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (this._cancelled || writeError) break;

        const time = frozenTime != null ? frozenTime : Math.min(i * frameDuration, duration - 0.001);
        await this._seekAndWait(time);

        this._advanceExportFrame(frameDuration);
        this.renderer.updateForExport(frameDuration);
        this._renderFrameToGraphics(gfx, width, height, true);

        // Snapshot the rendered frame as a transferable bitmap (cheap, GPU-side).
        const bitmap = await createImageBitmap(sourceCanvas);
        const name = `frame_${String(i).padStart(padLen, '0')}.png`;

        // Encode in worker, then stream to disk (or stash in JSZip).
        const job = pool.encode(bitmap)
          .then(async (blob) => {
            if (dirHandle) {
              const fh = await dirHandle.getFileHandle(name, { create: true });
              const w = await fh.createWritable();
              await w.write(blob);
              await w.close();
            } else {
              folder.file(name, blob);
            }
            completed++;
            if (this.onProgress) this.onProgress(completed, totalFrames);
          })
          .catch((err) => { writeError = err; })
          .finally(() => { inFlight.delete(job); });
        inFlight.add(job);

        // Backpressure: if too many frames are in-flight, wait for one to finish.
        if (inFlight.size >= maxInFlight) {
          await Promise.race(inFlight);
        }
        await this._yieldToUI();
      }

      // Drain remaining encodes/writes.
      await Promise.all(inFlight);
      if (writeError) throw writeError;

      if (zip && !this._cancelled) {
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        this._downloadBlob(zipBlob, `tabscape-pngseq-${width}x${height}-${VideoExporter._exportTimestamp()}.zip`);
      }
    } catch (err) {
      console.error('PNG sequence export failed:', err);
      if (this.onError) this.onError(err);
    } finally {
      pool.terminate();
      gfx.remove();
      this._stopExportClock();
      this.renderer._exportInProgress = false;
      if (wasPlaying) this.sampler.play(); else this.sampler.pause();
      if (this.onComplete) this.onComplete();
    }
  }

  // ─── MP4 ───────────────────────────────────────────────────────

  /**
   * Export every video frame as an MP4 file using WebCodecs + mp4-muxer.
   * @param {object} opts
   * @param {number} opts.framerate  - Frames per second
   * @param {number} opts.width      - Output width in pixels
   * @param {number} opts.height     - Output height in pixels
   */
  async exportMP4({ framerate = 30, width = 2048, height = 2048 } = {}) {
    // Scale down to fit H.264 pixel budget (Level 5.1 ≈ 9,437,184 px)
    const maxPixels = 9_400_000;
    if (width * height > maxPixels) {
      const ratio = Math.sqrt(maxPixels / (width * height));
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);
    }
    // WebCodecs requires even dimensions
    width = Math.round(width / 2) * 2;
    height = Math.round(height / 2) * 2;

    if (typeof VideoEncoder === 'undefined') {
      const msg = 'Browser does not support WebCodecs (required for MP4 export). Use Chrome or Edge.';
      if (this.onError) this.onError(new Error(msg));
      return;
    }

    // Dynamically import mp4-muxer
    let Muxer, ArrayBufferTarget;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
      Muxer = mod.Muxer;
      ArrayBufferTarget = mod.ArrayBufferTarget;
    } catch (e) {
      const msg = 'Failed to load MP4 muxer library: ' + e.message;
      if (this.onError) this.onError(new Error(msg));
      return;
    }

    this._cancelled = false;
    const duration = this._getExportDuration();
    if (!duration || duration <= 0) {
      const msg = 'No video loaded or duration is zero.';
      if (this.onError) this.onError(new Error(msg));
      return;
    }

    const totalFrames = Math.round(duration * framerate);
    const frameDuration = 1 / framerate;

    // Pause video and mark export in progress so live render skips texture updates
    const wasPlaying = this.sampler.isPlaying;
    const frozenTime = wasPlaying ? null : this.sampler.getVideoTime();
    this.sampler.pause();
    this.renderer._exportInProgress = true;
    this._startExportClock();

    // Create offscreen buffer
    const gfx = this.p.createGraphics(width, height);
    if (gfx.pixelDensity) gfx.pixelDensity(1); // 1:1 pixels — selected size = file size

    // Find a supported H.264 codec config, progressively downscale if needed
    let encoderConfig = await this._pickH264Config(width, height, framerate);
    while (!encoderConfig && width > 640) {
      width = Math.floor(width * 0.9 / 2) * 2;
      height = Math.floor(height * 0.9 / 2) * 2;
      encoderConfig = await this._pickH264Config(width, height, framerate);
    }
    if (!encoderConfig) {
      const msg = `Browser cannot encode H.264 at ${width}x${height}. Try a smaller resolution or use PNG Sequence.`;
      if (this.onError) this.onError(new Error(msg));
      gfx.remove();
      return;
    }

    // Set up muxer
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: {
        codec: 'avc',
        width,
        height,
      },
      fastStart: 'in-memory',
    });

    // Set up encoder
    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encoderError = e; },
    });
    encoder.configure(encoderConfig);

    // Pre-roll one full loop so push offsets and ripples reach periodic steady state
    this._preRoll(totalFrames, frameDuration);

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (this._cancelled || encoderError) break;

        const time = frozenTime != null ? frozenTime : Math.min(i * frameDuration, duration - 0.001);
        await this._seekAndWait(time);

        // Advance ripples on deterministic clock, then drive mode update
        this._advanceExportFrame(frameDuration);
        this.renderer.updateForExport(frameDuration);
        this._renderFrameToGraphics(gfx, width, height, false);

        const canvas = gfx.canvas || gfx.elt;
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round(i * frameDuration * 1_000_000), // microseconds
        });
        encoder.encode(frame, { keyFrame: i % (framerate * 2) === 0 });
        frame.close();

        if (this.onProgress) this.onProgress(i + 1, totalFrames);

        // Yield to UI
        await this._yieldToUI();
      }

      if (encoderError) throw encoderError;

      await encoder.flush();
      muxer.finalize();

      if (!this._cancelled) {
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        this._downloadBlob(blob, `tabscape-mp4-${width}x${height}-${VideoExporter._exportTimestamp()}.mp4`);
      }
    } catch (err) {
      console.error('MP4 export failed:', err);
      if (this.onError) this.onError(err);
    } finally {
      try { encoder.close(); } catch (_) {}
      gfx.remove();
      this._stopExportClock();
      this.renderer._exportInProgress = false;
      if (wasPlaying) this.sampler.play(); else this.sampler.pause();
      if (this.onComplete) this.onComplete();
    }
  }

  // ─── GIF ─────────────────────────────────────────────────────

  /**
   * Export the visualization as an optimized GIF using gif.js.
   * Uses Web Workers for parallel quantization, Floyd-Steinberg dithering,
   * and frame-skipping for size optimization.
   * @param {object} opts
   * @param {number} opts.framerate  - Frames per second (recommended 10-15 for GIF)
   * @param {number} opts.width      - Output width in pixels (recommended ≤720)
   * @param {number} opts.height     - Output height in pixels (recommended ≤720)
   */
  async exportGIF({ framerate = 10, width = 480, height = 480 } = {}) {
    if (typeof GIF === 'undefined') {
      const msg = 'gif.js is not loaded. Cannot export GIF.';
      if (this.onError) this.onError(new Error(msg));
      return;
    }

    this._cancelled = false;
    const duration = this._getExportDuration();
    if (!duration || duration <= 0) {
      const msg = 'No video loaded or duration is zero.';
      if (this.onError) this.onError(new Error(msg));
      return;
    }

    const totalFrames = Math.round(duration * framerate);
    const frameDuration = 1 / framerate;
    // GIF frame delay is in centiseconds (1/100s)
    const delay = Math.round(1000 / framerate);

    // Pause video and mark export in progress so live render skips texture updates
    const wasPlaying = this.sampler.isPlaying;
    const frozenTime = wasPlaying ? null : this.sampler.getVideoTime();
    this.sampler.pause();
    this.renderer._exportInProgress = true;
    this._startExportClock();

    // Create offscreen buffer
    const gfx = this.p.createGraphics(width, height);
    if (gfx.pixelDensity) gfx.pixelDensity(1); // 1:1 pixels — selected size = file size

    // Fetch the worker script and create a same-origin blob URL to avoid CORS issues
    if (!VideoExporter._gifWorkerBlobUrl) {
      try {
        const workerUrl = 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js';
        const resp = await fetch(workerUrl);
        const text = await resp.text();
        const blob = new Blob([text], { type: 'application/javascript' });
        VideoExporter._gifWorkerBlobUrl = URL.createObjectURL(blob);
      } catch (e) {
        const msg = 'Failed to load gif.js worker script: ' + e.message;
        if (this.onError) this.onError(new Error(msg));
        gfx.remove();
        this._stopExportClock();
        this.renderer._exportInProgress = false;
      if (wasPlaying) this.sampler.play(); else this.sampler.pause();
        return;
      }
    }

    const gif = new GIF({
      workers: Math.min(navigator.hardwareConcurrency || 4, 8),
      workerScript: VideoExporter._gifWorkerBlobUrl,
      quality: 10,        // 1 = best quality/slow, 30 = fast/lower quality
      width,
      height,
      dither: 'FloydSteinberg',
      transparent: null,
    });

    // Pre-roll one full loop so push offsets and ripples reach periodic steady state
    this._preRoll(totalFrames, frameDuration);

    try {
      // Phase 1: Render and add frames
      for (let i = 0; i < totalFrames; i++) {
        if (this._cancelled) break;

        const time = frozenTime != null ? frozenTime : Math.min(i * frameDuration, duration - 0.001);
        await this._seekAndWait(time);

        // Advance ripples on deterministic clock, then drive mode update
        this._advanceExportFrame(frameDuration);
        this.renderer.updateForExport(frameDuration);
        this._renderFrameToGraphics(gfx, width, height, false);

        // Get the raw canvas element and copy its pixel data for gif.js
        const srcCanvas = gfx.canvas || gfx.elt;
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = width;
        frameCanvas.height = height;
        const frameCtx = frameCanvas.getContext('2d');
        frameCtx.imageSmoothingEnabled = true;
        frameCtx.imageSmoothingQuality = 'high';
        frameCtx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, width, height);

        gif.addFrame(frameCanvas, { delay, copy: false, dispose: 2 });

        if (this.onProgress) this.onProgress(i + 1, totalFrames);

        await this._yieldToUI();
      }

      if (this._cancelled) {
        gif.abort();
        return;
      }

      // Phase 2: Encode — gif.js quantizes + encodes in workers
      await new Promise((resolve, reject) => {
        gif.on('finished', (blob) => {
          this._downloadBlob(blob, `tabscape-gif-${width}x${height}-${VideoExporter._exportTimestamp()}.gif`);
          resolve();
        });

        gif.on('abort', () => resolve());

        // gif.js doesn't have an error event, but wrap for safety
        try {
          gif.render();
        } catch (e) {
          reject(e);
        }
      });
    } catch (err) {
      console.error('GIF export failed:', err);
      if (this.onError) this.onError(err);
    } finally {
      gfx.remove();
      this._stopExportClock();
      this.renderer._exportInProgress = false;
      if (wasPlaying) this.sampler.play(); else this.sampler.pause();
      if (this.onComplete) this.onComplete();
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────

  /** Get the RippleManager via the active mode (if RippleMode). */
  _getRippleManager() {
    return this.renderer._activeMode && this.renderer._activeMode._rippleManager;
  }

  /**
   * Switch RippleManager to deterministic export clock and
   * call rm.update() so ripple radii use the export timeline.
   */
  _startExportClock() {
    const rm = this._getRippleManager();
    if (rm) rm.startExportClock();
  }

  _advanceExportFrame(frameDuration) {
    const rm = this._getRippleManager();
    if (rm) {
      rm.advanceExportClock(frameDuration);
      const rippleSpeed = (typeof stateManager !== 'undefined' ? stateManager.get('rippleSpeed') : null) || 300;
      rm.update(rippleSpeed);
    }
  }

  _stopExportClock() {
    const rm = this._getRippleManager();
    if (rm) rm.clearExportClock();
  }

  /**
   * Run the simulation without capturing frames until push offsets / springs
   * converge to their periodic steady state (seamless loop).
   * Uses the faster decay rate between push decay and spring damping.
   */
  _preRoll(totalFrames, frameDuration) {
    const state = typeof stateManager !== 'undefined' ? stateManager.getRef() : {};
    const pushDecay = state.pushDecay || 0.92;
    const springDamping = state.springDamping || 0.87;
    // Use whichever decays slower (closer to 1) — it needs the most passes
    const decay = Math.max(pushDecay, springDamping);
    // Number of passes so initial-state influence < 0.1%:
    //   decay^(passes * totalFrames) < 0.001
    const passes = Math.max(1, Math.ceil(
      Math.log(0.001) / (totalFrames * Math.log(decay))
    ));
    const total = passes * totalFrames;
    for (let i = 0; i < total; i++) {
      this._advanceExportFrame(frameDuration);
      this.renderer.updateForExport(frameDuration);
    }
  }

  /** Use loopDuration if set, otherwise fall back to video duration. */
  _getExportDuration() {
    const loopDur = typeof stateManager !== 'undefined' ? stateManager.get('loopDuration') : 0;
    if (loopDur && loopDur > 0) return loopDur;
    return this.sampler.getVideoDuration();
  }

  /** Human-readable timestamp for export filenames: YYYY-MM-DD-HHmmss */
  static _exportTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  /**
   * Find a supported H.264 encoder configuration for the given dimensions.
   * Tries High profile first, then falls back to Baseline.
   * @returns {object|null} VideoEncoder config or null if unsupported
   */
  async _pickH264Config(width, height, framerate) {
    const candidates = [
      'avc1.640033', // High, Level 5.1  — up to ~4K
      'avc1.640028', // High, Level 4.0
      'avc1.42001f', // Baseline, Level 3.1
    ];

    // Scale bitrate with framerate so high-fps exports don't look mushy.
    // Baseline 8 Mbps tuned for 30 fps — scale linearly, clamp to a sane ceiling.
    const bitrate = Math.min(40_000_000, Math.round(8_000_000 * (framerate / 30)));

    for (const codec of candidates) {
      const config = {
        codec,
        width,
        height,
        bitrate,
        framerate,
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) return support.config;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Seek the video to `time` and wait for the 'seeked' event.
   * Has a 5-second safety timeout.
   */
  _seekAndWait(time) {
    return new Promise((resolve) => {
      const video = this.sampler.video;
      if (!video || !video.elt) {
        resolve();
        return;
      }

      const el = video.elt;
      // Ensure video stays paused during seeking (some browsers auto-resume)
      el.pause();

      const onSeeked = () => {
        clearTimeout(timer);
        el.removeEventListener('seeked', onSeeked);
        // Force-refresh pixel data for this frame
        this.sampler.prepareFrameForExport();
        resolve();
      };

      const timer = setTimeout(() => {
        el.removeEventListener('seeked', onSeeked);
        // Still try to refresh even on timeout
        this.sampler.prepareFrameForExport();
        resolve();
      }, 5000);

      el.addEventListener('seeked', onSeeked);
      el.currentTime = time;
    });
  }

  /**
   * Clear the offscreen buffer, optionally set a background, and render the grid.
   */
  _renderFrameToGraphics(gfx, w, h, transparent) {
    gfx.clear();
    if (!transparent) {
      gfx.background(stateManager.get('backgroundColor') || '#FFFEF7');
    }
    this.renderer._exportTransparent = transparent;
    this.renderer.renderToTarget(gfx, w, h);
    this.renderer._exportTransparent = false;
  }

  /**
   * Promise wrapper for canvas.toBlob.
   */
  _canvasToBlob(canvas, mimeType) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('toBlob returned null'));
        },
        mimeType
      );
    });
  }

  /**
   * Create an object URL, trigger a download, then revoke.
   */
  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Yield to the browser event loop so the UI can update.
   */
  _yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ─── PNG Encoder Worker Pool ─────────────────────────────────────
// Encodes ImageBitmaps to PNG blobs in parallel off the main thread.
const _PNG_WORKER_SRC = `
self.onmessage = async (e) => {
  const { id, bitmap } = e.data;
  try {
    const off = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = off.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await off.convertToBlob({ type: 'image/png' });
    self.postMessage({ id, blob });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
`;

class PngEncoderPool {
  constructor(size) {
    const url = URL.createObjectURL(new Blob([_PNG_WORKER_SRC], { type: 'application/javascript' }));
    this._url = url;
    this._workers = [];
    this._idle = [];
    this._waiters = [];
    this._pending = new Map(); // id -> { resolve, reject }
    this._nextId = 0;
    for (let i = 0; i < size; i++) {
      const w = new Worker(url);
      w.onmessage = (e) => {
        const { id, blob, error } = e.data;
        const slot = this._pending.get(id);
        if (slot) {
          this._pending.delete(id);
          if (error) slot.reject(new Error(error)); else slot.resolve(blob);
        }
        this._idle.push(w);
        const next = this._waiters.shift();
        if (next) next();
      };
      this._workers.push(w);
      this._idle.push(w);
    }
  }

  async _acquire() {
    if (this._idle.length) return this._idle.pop();
    await new Promise(r => this._waiters.push(r));
    return this._idle.pop();
  }

  async encode(bitmap) {
    const w = await this._acquire();
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      w.postMessage({ id, bitmap }, [bitmap]);
    });
  }

  terminate() {
    this._workers.forEach(w => w.terminate());
    this._workers.length = 0;
    this._idle.length = 0;
    URL.revokeObjectURL(this._url);
  }
}
