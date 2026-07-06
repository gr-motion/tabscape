/**
 * RealtimeRecorder - Records the live canvas as an MP4 video in real-time
 * using WebCodecs VideoEncoder + mp4-muxer.
 *
 * Usage:
 *   const recorder = new RealtimeRecorder();
 *   await recorder.start(canvas);          // begins recording
 *   // in draw loop: recorder.captureFrame(canvas);
 *   await recorder.stop();                 // finishes and downloads MP4
 */
class RealtimeRecorder {
  constructor() {
    this._state = 'idle'; // idle | recording | finalizing
    this._encoder = null;
    this._muxer = null;
    this._target = null;
    this._startTime = 0;
    this._frameCount = 0;
    this._encoderError = null;
    this._width = 0;
    this._height = 0;
    this._framerate = 60;

    // Callbacks
    this.onError = null;   // (error) => void
    this.onStop = null;    // () => void — called when recording ends (including auto-stop)
  }

  get isRecording() {
    return this._state === 'recording';
  }

  getElapsedSeconds() {
    if (this._state === 'idle') return 0;
    return (performance.now() - this._startTime) / 1000;
  }

  /**
   * Start recording the canvas as MP4.
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {number} opts.framerate - Target framerate (default 60)
   */
  async start(canvas, { framerate = 60 } = {}) {
    if (this._state !== 'idle') {
      console.warn('RealtimeRecorder: already recording or finalizing');
      return;
    }

    // Check browser support
    if (typeof VideoEncoder === 'undefined') {
      const err = new Error('Browser does not support WebCodecs. Use Chrome or Edge for recording.');
      if (this.onError) this.onError(err);
      return;
    }

    // Scale down to fit H.264 pixel budget (Level 5.1 ≈ 9,437,184 px)
    const maxPixels = 9_400_000;
    let w = canvas.width, h = canvas.height;
    if (w * h > maxPixels) {
      const ratio = Math.sqrt(maxPixels / (w * h));
      w = Math.floor(w * ratio);
      h = Math.floor(h * ratio);
    }
    this._width = Math.floor(w / 2) * 2;
    this._height = Math.floor(h / 2) * 2;
    this._canvasWidth = canvas.width;
    this._canvasHeight = canvas.height;
    this._framerate = framerate;

    // Pick H.264 codec, progressively downscale if needed
    let encoderConfig = await this._pickH264Config(this._width, this._height, framerate);
    while (!encoderConfig && this._width > 640) {
      this._width = Math.floor(this._width * 0.9 / 2) * 2;
      this._height = Math.floor(this._height * 0.9 / 2) * 2;
      encoderConfig = await this._pickH264Config(this._width, this._height, framerate);
    }
    if (!encoderConfig) {
      const err = new Error(`Cannot encode H.264 at ${this._width}x${this._height}. Try a smaller canvas.`);
      if (this.onError) this.onError(err);
      return;
    }

    // Dynamically import mp4-muxer
    let Muxer, ArrayBufferTarget;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
      Muxer = mod.Muxer;
      ArrayBufferTarget = mod.ArrayBufferTarget;
    } catch (e) {
      const err = new Error('Failed to load MP4 muxer library: ' + e.message);
      if (this.onError) this.onError(err);
      return;
    }

    // Set up muxer
    this._target = new ArrayBufferTarget();
    this._muxer = new Muxer({
      target: this._target,
      video: {
        codec: 'avc',
        width: this._width,
        height: this._height,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    // Set up encoder
    this._encoderError = null;
    this._encoder = new VideoEncoder({
      output: (chunk, meta) => this._muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        this._encoderError = e;
        console.error('RealtimeRecorder encoder error:', e);
      },
    });
    this._encoder.configure(encoderConfig);

    this._frameCount = 0;
    this._startTime = performance.now();
    this._state = 'recording';

    console.log(`RealtimeRecorder: started at ${this._width}x${this._height} @ ${framerate}fps`);
  }

  /**
   * Capture the current canvas frame. Call this at the end of every draw().
   * Returns immediately (no-op) when not recording.
   * @param {HTMLCanvasElement} canvas
   */
  captureFrame(canvas) {
    if (this._state !== 'recording') return;

    // Auto-stop on encoder error
    if (this._encoderError) {
      this.stop();
      return;
    }

    // Check dimensions still match (canvas resize detection)
    if (canvas.width !== this._canvasWidth || canvas.height !== this._canvasHeight) {
      console.warn('RealtimeRecorder: canvas resized during recording, stopping');
      this.stop();
      return;
    }

    // Backpressure: skip frame if encoder is falling behind
    if (this._encoder.encodeQueueSize > 10) {
      return;
    }

    try {
      const timestamp = Math.round((performance.now() - this._startTime) * 1000); // microseconds
      // Scale or crop frame to encoder dimensions
      const frameInit = { timestamp };
      if (canvas.width !== this._width || canvas.height !== this._height) {
        frameInit.displayWidth = this._width;
        frameInit.displayHeight = this._height;
      }
      const frame = new VideoFrame(canvas, frameInit);
      const keyFrame = this._frameCount % (this._framerate * 2) === 0; // keyframe every 2s
      this._encoder.encode(frame, { keyFrame });
      frame.close();
      this._frameCount++;
    } catch (e) {
      console.error('RealtimeRecorder: frame capture failed:', e);
    }
  }

  /**
   * Stop recording, finalize the MP4, and trigger download.
   * @returns {Blob|null} The MP4 blob, or null on error
   */
  async stop() {
    if (this._state !== 'recording') return null;
    this._state = 'finalizing';

    let blob = null;
    try {
      await this._encoder.flush();
      this._muxer.finalize();

      blob = new Blob([this._target.buffer], { type: 'video/mp4' });
      this._downloadBlob(blob, `tabscape-recording-${this._width}x${this._height}-${RealtimeRecorder._exportTimestamp()}.mp4`);

      console.log(`RealtimeRecorder: saved ${this._frameCount} frames, ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
    } catch (err) {
      console.error('RealtimeRecorder: finalize failed:', err);
      if (this.onError) this.onError(err);
    } finally {
      try { this._encoder.close(); } catch (_) {}
      this._encoder = null;
      this._muxer = null;
      this._target = null;
      this._state = 'idle';
      if (this.onStop) this.onStop();
    }

    return blob;
  }

  // ─── Internal helpers ─────────────────────────────────────────

  /** Human-readable timestamp for export filenames: YYYY-MM-DD-HHmmss */
  static _exportTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  async _pickH264Config(width, height, framerate) {
    const candidates = [
      'avc1.640033', // High, Level 5.1
      'avc1.640028', // High, Level 4.0
      'avc1.42001f', // Baseline, Level 3.1
    ];
    for (const codec of candidates) {
      const config = {
        codec,
        width,
        height,
        bitrate: 20_000_000, // 20 Mbps for high quality real-time
        framerate,
      };
      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) return support.config;
      } catch (_) {}
    }
    return null;
  }

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
}
