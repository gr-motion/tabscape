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

  async export({ framerate = 15, targetBytes = 150 * 1024 } = {}) {
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
    // Only the lookup gradients the fragment shader will actually read
    // (curve LUT + duo-tone textures are never sampled). Stored as plain
    // numbers: they gzip far better than base64.
    const uv = (name) => (uniforms[name] ? uniforms[name].v : 0);
    const remap = uv('u_colorRemapEnabled') === 1, gradMap = uv('u_gradientMapEnabled') === 1;
    const needed = {
      1: remap && ((gradMap && uv('u_paletteMode') === 0) || (uv('u_intEnabled') === 1 && uv('u_intAmount') > 0)),
      2: remap && gradMap && uv('u_paletteMode') === 1,
      3: remap && uv('u_hgmEnabled') === 1,
    };
    for (const [unit, t] of Object.entries(renderer.getHTMLExportTextures())) {
      if (!needed[unit] || t.float) continue;
      textures[unit] = { w: t.w, h: t.h, data: Array.from(t.data) };
    }

    // ── Mask: normalise, fold in cells that must never draw ──
    // valid = 0 when the cell falls outside the texture or samples a
    // transparent texel; both end up as mask 0 so the runtime needs no
    // separate visibility data.
    let maskMax = 1;
    if (masks) {
      maskMax = 0;
      for (let i = 0; i < masks.length; i++) if (masks[i] > maskMax) maskMax = masks[i];
      if (!(maskMax > 0)) maskMax = 1;
    }
    const maskQ = new Uint8Array(totalFrames * N);
    for (let f = 0; f < totalFrames; f++) {
      for (let i = 0; i < N; i++) {
        let v = masks ? Math.round(Math.max(0, masks[f * N + i]) / maskMax * 255) : 255;
        if (probe.texReady && (!valid[i] || colors[(f * N + i) * 4 + 3] < 128)) v = 0;
        maskQ[f * N + i] = v;
      }
    }
    const colorAnimated = !HTMLExporter._allFramesEqual(colors, N * 4, totalFrames);
    const maskAnimated = !HTMLExporter._allFramesEqual(maskQ, N, totalFrames);

    // ── Code + data bundle (gzipped, self-extracting) ──
    const p = renderer.p;
    const meta = {
      cols: probe.cols, rows: probe.rows,
      cubeWidth: probe.cubeWidth, cubeHeight: probe.cubeHeight,
      spacingX: probe.cubeHeight * 0.1, spacingY: probe.cubeHeight * 0.1,
      offsetX: probe.offsetX, offsetY: probe.offsetY,
      layoutW: probe.layoutW, layoutH: probe.layoutH,
      canvasW: p.width, canvasH: p.height,
      hasTexture: !!probe.texReady,
      maskMax,
      media: null,
    };
    const animatedMedia = colorAnimated || maskAnimated;
    meta.media = animatedMedia
      ? { kind: 'video', mime: 'video/mp4', scale: 2 }
      : { kind: 'image', mime: 'image/png', scale: 1 };

    const data = {
      meta,
      vert: HTMLExporter._minifyGLSL(HTMLExporter._injectMaskIntoVertex(VERT_SRC)),
      frag: HTMLExporter._minifyGLSL(FRAG_SRC),
      uniforms,
      textures,
      state: HTMLExporter._primitiveState(stateManager.getAll()),
      motion: this._serializeMotion(),
    };
    const code = 'window.__TABSCAPE__=' + JSON.stringify(data) + ';\n' +
      HTMLExporter._stripJS(motionSrcs.join('\n')) + '\n' + HTMLExporter._stripJS(runtimeSrc);
    const bundleB64 = HTMLExporter._bytesToB64(await HTMLExporter._gzip(new TextEncoder().encode(code)));
    const shell = HTMLExporter._buildDocument(bundleB64, '', data.state.backgroundColor);

    // ── Media atlas ──
    let mediaBytes;
    if (this.onProgress) this.onProgress(totalFrames, totalFrames, 'Encoding');
    if (!animatedMedia) {
      mediaBytes = await HTMLExporter._encodePNG(HTMLExporter._atlasFrame(colors, maskQ, 0, 0, probe.cols, probe.rows, 1));
    } else {
      // Spend what's left of the size target on the video (base64 adds 4/3).
      const budget = Math.max(8 * 1024, (targetBytes - shell.length - 64) * 3 / 4);
      const fps = totalFrames / duration;
      const atlasAt = (f) => HTMLExporter._atlasFrame(colors, maskQ, colorAnimated ? f : 0, maskAnimated ? f : 0, probe.cols, probe.rows, 2);
      let bitrate = Math.max(8000, Math.floor(budget * 8 / duration * 0.92));
      for (let attempt = 0; attempt < 5; attempt++) {
        mediaBytes = await HTMLExporter._encodeH264(atlasAt, totalFrames, fps, bitrate);
        if (mediaBytes.length <= budget || bitrate <= 8000) break;
        bitrate = Math.max(8000, Math.floor(bitrate * (budget / mediaBytes.length) * 0.9));
        if (this.onProgress) this.onProgress(totalFrames, totalFrames, 'Encoding');
      }
    }

    return HTMLExporter._buildDocument(bundleB64, HTMLExporter._bytesToB64(mediaBytes), data.state.backgroundColor);
  }

  /** Atlas image: top = cell colours (alpha forced opaque), bottom = mask as grey. */
  static _atlasFrame(colors, maskQ, cf, mf, cols, rows, scale) {
    const W = cols * scale, H = rows * 2 * scale, N = cols * rows;
    const img = new Uint8ClampedArray(W * H * 4);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c, ci = (cf * N + i) * 4, m = maskQ[mf * N + i];
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = c * scale + dx;
        const top = ((r * scale + dy) * W + x) * 4;
        img[top] = colors[ci]; img[top + 1] = colors[ci + 1]; img[top + 2] = colors[ci + 2]; img[top + 3] = 255;
        const bot = (((rows + r) * scale + dy) * W + x) * 4;
        img[bot] = m; img[bot + 1] = m; img[bot + 2] = m; img[bot + 3] = 255;
      }
    }
    return new ImageData(img, W, H);
  }

  static async _encodePNG(imageData) {
    const c = document.createElement('canvas');
    c.width = imageData.width; c.height = imageData.height;
    c.getContext('2d').putImageData(imageData, 0, 0);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  static async _encodeH264(frameAt, totalFrames, fps, bitrate) {
    if (typeof VideoEncoder === 'undefined') throw new Error('This browser does not support WebCodecs (needed for H.264). Use Chrome or Edge.');
    const first = frameAt(0);
    const width = first.width, height = first.height;
    let cfg = null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']) {
      const c = { codec, width, height, bitrate, framerate: fps, bitrateMode: 'variable', avc: { format: 'avc' } };
      try { const sup = await VideoEncoder.isConfigSupported(c); if (sup.supported) { cfg = sup.config; break; } } catch (_) {}
    }
    if (!cfg) throw new Error('This browser cannot encode H.264 at ' + width + 'x' + height + '.');
    const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' });
    let err = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
    enc.configure(cfg);
    const frameDur = 1e6 / fps;
    for (let f = 0; f < totalFrames; f++) {
      const img = f === 0 ? first : frameAt(f);
      const vf = new VideoFrame(new Uint8Array(img.data.buffer), {
        format: 'RGBA', codedWidth: width, codedHeight: height,
        timestamp: Math.round(f * frameDur), duration: Math.round(frameDur),
      });
      // Single keyframe: the loop restarts at 0, no seeking needed.
      enc.encode(vf, { keyFrame: f === 0 });
      vf.close();
      if (err) throw err;
      if (enc.encodeQueueSize > 30) await new Promise(r => setTimeout(r, 0));
    }
    await enc.flush();
    enc.close();
    if (err) throw err;
    muxer.finalize();
    return new Uint8Array(target.buffer);
  }

  /** Multiply tab scale by the per-cell mask stored in the atlas' bottom half. */
  static _injectMaskIntoVertex(src) {
    const decl = 'uniform float u_imgScaleMax;';
    const line = 'float iScale = a_imageScale;';
    if (!src.includes(decl) || !src.includes(line)) throw new Error('Vertex shader layout changed');
    return src
      .replace(decl, decl + '\nuniform vec2 u_gridDim;\nuniform float u_maskMax;\nuniform float u_maskFloor;')
      .replace(line, line + `
  {
    vec2 cell = floor(a_gridUV * max(u_gridDim - 1.0, vec2(1.0)) + 0.5);
    float m = texture(u_srcTexture, vec2((cell.x + 0.5) / u_gridDim.x, 0.5 + (cell.y + 0.5) / u_gridDim.y * 0.5)).r;
    iScale *= max(0.0, (m - u_maskFloor) / (1.0 - u_maskFloor)) * u_maskMax;
  }`);
  }

  static _minifyGLSL(src) {
    return src.split('\n')
      .map(l => l.replace(/\/\/.*$/, '').trim())
      .filter(l => l.length > 0)
      .map(l => l.startsWith('#') ? l + '\n' : l)
      .join(' ')
      .replace(/\s+\n\s*/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?([{}();,=+\-*/<>!?:|&]) ?/g, '$1');
  }

  /** Conservative JS shrink: drop comment-only lines and indentation. */
  static _stripJS(src) {
    const out = [];
    let inBlock = false;
    for (const raw of src.split('\n')) {
      const l = raw.trim();
      if (inBlock) { if (l.includes('*/')) inBlock = false; continue; }
      if (l.startsWith('/*')) { if (!l.includes('*/')) inBlock = true; continue; }
      if (l.startsWith('//') || l === '') continue;
      out.push(l);
    }
    return out.join('\n');
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

  static _buildDocument(bundleB64, mediaB64, bg) {
    bg = bg || '#FFFEF7';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tabscape</title>' +
      '<style>html,body{margin:0;height:100%;overflow:hidden;background:' + bg + '}#tabscape{position:absolute;display:block;touch-action:none}</style>' +
      '</head><body><canvas id="tabscape"></canvas>' +
      '<script id="tsmedia" type="text/plain">' + mediaB64 + '</script>' +
      '<script>(async()=>{const b=atob("' + bundleB64 + '"),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);' +
      'const t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();(0,eval)(t)})()</script>' +
      '</body></html>';
  }
}
