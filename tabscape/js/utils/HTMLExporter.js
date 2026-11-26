/**
 * HTMLExporter - exports the current Tabscape composition as one
 * self-contained, interactive .html file.
 *
 * What goes into the file:
 *   - One base tab shape: the app's own squircle SDF shader + corner SDF
 *     texture. Every tab is an instance of it with position / scale / colour
 *     index, drawn in a single instanced WebGL2 call.
 *   - Baked per-cell data for the texture loop: the source texel each cell
 *     samples (RGBA) and its mask value, for every baked frame (gzip + base64).
 *   - Every colour-pipeline uniform and lookup texture, so palette / remap /
 *     fades match the live render.
 *   - The live motion engine (RippleMode, AttractorMode, CursorTracker,
 *     RippleManager...) so cursor, clicks and auto drivers work as in the app.
 *   - Motion-group keyframes from the timeline (motion mode), interpolated
 *     live with the same easing curves.
 */
class HTMLExporter {
  constructor({ renderer, imageSampler, animationController = null }) {
    this.renderer = renderer;
    this.sampler = imageSampler;
    this.animationController = animationController;
    this._cancelled = false;
    this.onProgress = null; // (done, total, label) => void
  }

  cancel() { this._cancelled = true; }

  static get MOTION_SOURCES() {
    return [
      'js/utils/SimplexNoise.js',
      'js/utils/SpringPhysics.js',
      'js/utils/CursorTracker.js',
      'js/utils/RippleManager.js',
      'js/modes/BaseMode.js',
      'js/modes/RippleMode.js',
      'js/modes/AttractorMode.js',
    ];
  }

  // Keys driven live in the HTML (Motion group) — never baked.
  static get EXCLUDED_MOTION_KEYS() { return ['loopTrim', 'loopDuration']; }

  async export({ framerate = 15 } = {}) {
    this._cancelled = false;
    const renderer = this.renderer;
    const sampler = this.sampler;
    const state = stateManager.getRef();

    // Fetch sources first so a network problem fails fast, before baking.
    const [runtimeSrc, ...motionSrcs] = await Promise.all(
      ['js/export/htmlRuntime.js', ...HTMLExporter.MOTION_SOURCES].map(async (path) => {
        const resp = await fetch(path, { cache: 'no-cache' });
        if (!resp.ok) throw new Error('Could not load ' + path);
        return resp.text();
      })
    );

    // ── How many frames to bake ──
    const hasVideo = !!(sampler && sampler.hasVideo && sampler.hasVideo());
    const maskMode = state.maskMode || 'tabloop';
    const evoSpeed = Math.max(0, Math.min(1, parseFloat(state.maskNoiseEvolutionSpeed) || 0));
    const maskEvolves = maskMode === 'tabloop' && evoSpeed > 0 &&
      ((state.maskRingInnerNoise || 0) > 0 || (state.maskRingOuterNoise || 0) > 0);
    const duration = (parseFloat(state.loopDuration) > 0) ? parseFloat(state.loopDuration) : 10;
    const animated = hasVideo || maskEvolves;

    // Probe one frame for grid size so we can budget the frame count.
    const probe = renderer.bakeHTMLFrame();
    if (!probe) throw new Error('Renderer is not ready');
    const N = probe.cols * probe.rows;
    let totalFrames = animated ? Math.max(2, Math.round(duration * framerate)) : 1;
    const MAX_BYTES = 160 * 1024 * 1024; // raw, before gzip
    if (totalFrames * N * 5 > MAX_BYTES) totalFrames = Math.max(2, Math.floor(MAX_BYTES / (N * 5)));

    const colors = new Uint8Array(totalFrames * N * 4);
    const masks = probe.mask ? new Float32Array(totalFrames * N) : null;
    const valid = probe.valid;

    // ── Bake ──
    const helper = new VideoExporter({ p5Instance: renderer.p, renderer, imageSampler: sampler });
    const wasPlaying = !!(sampler && sampler.isPlaying);
    const prevVideoTime = hasVideo ? sampler.getVideoTime() : 0;
    const prevTime = renderer.time;
    const prevPhase = renderer._noiseEvolutionPhase;
    const prevPhaseTime = renderer._lastNoiseEvolutionRenderTime;
    if (hasVideo) sampler.pause();
    renderer._exportInProgress = true;
    try {
      for (let f = 0; f < totalFrames; f++) {
        if (this._cancelled) throw new Error('cancelled');
        const t = animated ? (f / totalFrames) * duration : 0;
        if (hasVideo) await helper._seekAndWait(helper._getSamplerTimeForExport(t));
        // Deterministic mask evolution: phase = t * speed
        renderer.time = t;
        renderer._lastNoiseEvolutionRenderTime = t;
        renderer._noiseEvolutionPhase = t * evoSpeed;
        const bake = renderer.bakeHTMLFrame();
        if (!bake || bake.cols * bake.rows !== N) throw new Error('Grid changed during export');
        colors.set(bake.rgba, f * N * 4);
        if (masks && bake.mask) masks.set(bake.mask, f * N);
        if (this.onProgress) this.onProgress(f + 1, totalFrames, 'Baking');
        await new Promise(r => setTimeout(r, 0));
      }
    } finally {
      renderer._exportInProgress = false;
      renderer.time = prevTime;
      renderer._noiseEvolutionPhase = prevPhase;
      renderer._lastNoiseEvolutionRenderTime = prevPhaseTime;
      if (hasVideo) {
        await helper._seekAndWait(prevVideoTime);
        if (wasPlaying) sampler.play();
      }
    }

    // Colour pipeline state from a normal live render
    renderer.render();
    const uniforms = renderer.snapshotUniforms();
    const textures = {};
    for (const [unit, t] of Object.entries(renderer.getHTMLExportTextures())) {
      textures[unit] = { w: t.w, h: t.h, float: !!t.float, data: HTMLExporter._bytesToB64(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength)) };
    }

    // ── Collapse static data ──
    const colorFrames = HTMLExporter._allFramesEqual(colors, N * 4, totalFrames) ? 1 : totalFrames;
    let maskFrames = 0, maskMax = 1, maskBytes = null;
    if (masks) {
      maskMax = 0;
      for (let i = 0; i < masks.length; i++) if (masks[i] > maskMax) maskMax = masks[i];
      maskMax = maskMax > 0 ? maskMax : 1;
      const q = new Uint8Array(masks.length);
      for (let i = 0; i < masks.length; i++) q[i] = Math.round(Math.max(0, masks[i]) / maskMax * 255);
      maskFrames = HTMLExporter._allFramesEqual(q, N, totalFrames) ? 1 : totalFrames;
      maskBytes = q.subarray(0, maskFrames * N);
    }

    const parts = [colors.subarray(0, colorFrames * N * 4)];
    if (maskBytes) parts.push(maskBytes);
    parts.push(valid);
    let size = 0; parts.forEach(p => size += p.length);
    const payload = new Uint8Array(size);
    let o = 0; parts.forEach(p => { payload.set(p, o); o += p.length; });
    if (this.onProgress) this.onProgress(totalFrames, totalFrames, 'Compressing');
    const blob = HTMLExporter._bytesToB64(await HTMLExporter._gzip(payload));

    // ── Meta ──
    const p = renderer.p;
    const meta = {
      cols: probe.cols, rows: probe.rows,
      cubeWidth: probe.cubeWidth, cubeHeight: probe.cubeHeight,
      spacingX: probe.cubeHeight * 0.1, spacingY: probe.cubeHeight * 0.1,
      offsetX: probe.offsetX, offsetY: probe.offsetY,
      layoutW: probe.layoutW, layoutH: probe.layoutH,
      canvasW: p.width, canvasH: p.height,
      hasTexture: !!probe.texReady,
      duration, colorFrames, maskFrames, maskMax,
    };

    const data = {
      meta,
      vert: VERT_SRC,
      frag: FRAG_SRC,
      uniforms,
      textures,
      state: HTMLExporter._primitiveState(stateManager.getAll()),
      motion: this._serializeMotion(),
      blob,
    };

    return HTMLExporter._buildDocument(data, motionSrcs, runtimeSrc);
  }

  /** Motion-group keyframe tracks, only when motion mode is on. */
  _serializeMotion() {
    const ac = this.animationController;
    if (!ac || !ac.motionEnabled) return null;
    const tracks = [];
    ac.registry.forEach((meta, key) => {
      const param = meta && meta.parameter;
      if (!param || param.group !== 'Motion') return;
      if (HTMLExporter.EXCLUDED_MOTION_KEYS.includes(key)) return;
      const frames = ac.keyframes[key];
      if (!ac.keyframingEnabled[key] || !Array.isArray(frames) || frames.length === 0) return;
      tracks.push({
        key,
        step: parseFloat(param.step) || 0,
        keyframes: frames.map(kf => ({ time: kf.time, value: kf.value, easing: kf.easing || 'linear' })),
      });
    });
    if (tracks.length === 0) return null;
    return { duration: ac.duration, currentTime: ac.currentTime, tracks };
  }

  static _primitiveState(all) {
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string' && v.length <= 64) out[k] = v;
    }
    return out;
  }

  static _allFramesEqual(arr, frameLen, frames) {
    for (let f = 1; f < frames; f++) {
      const off = f * frameLen;
      for (let i = 0; i < frameLen; i++) if (arr[off + i] !== arr[i]) return false;
    }
    return true;
  }

  static async _gzip(bytes) {
    if (typeof CompressionStream === 'undefined') throw new Error('This browser does not support CompressionStream');
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  static _bytesToB64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }

  static _buildDocument(data, motionSrcs, runtimeSrc) {
    // Keep "</script>" inside embedded text from closing the tag early.
    const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
    const bg = data.state.backgroundColor || '#FFFEF7';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tabscape</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: ${bg}; }
  #tabscape { position: absolute; display: block; touch-action: none; }
</style>
</head>
<body>
<canvas id="tabscape"></canvas>
<script>
window.__TABSCAPE__ = ${safe(JSON.stringify(data))};
</script>
<script>
${safe(motionSrcs.join('\n\n'))}

${safe(runtimeSrc)}
</script>
</body>
</html>
`;
  }
}
