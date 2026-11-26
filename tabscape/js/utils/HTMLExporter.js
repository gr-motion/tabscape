/**
 * HTMLExporter - exports the current Tabscape composition as one small,
 * self-contained, interactive .html file (default size cap: 150 KB).
 *
 * What goes into the file:
 *   - One base tab shape: the app's squircle SDF shader. Every tab is an
 *     instance of it (position / scale / colour index) drawn in a single
 *     instanced WebGL2 call. The corner SDF is rebuilt by the runtime.
 *   - The texture as a compact model, not video: a low-res grid of colour
 *     keyframes that the shader interpolates smoothly in space (bilinear)
 *     and time (Catmull-Rom), plus animated grain matched to the detail the
 *     low-res grid can't hold. Resolution / keyframe rate are picked
 *     automatically to fit the size cap.
 *   - The ring mask is not stored at all: the runtime computes it live
 *     (ring + Perlin noise + evolution). Custom/library masks are stored
 *     once per cell.
 *   - Every colour-pipeline uniform and the lookup textures it reads.
 *   - The live motion engine (RippleMode, AttractorMode, CursorTracker,
 *     RippleManager...) and the Motion-group timeline keyframes.
 * Code + settings are gzipped into a self-extracting script.
 */
class HTMLExporter {
  constructor({ renderer, imageSampler, animationController = null }) {
    this.renderer = renderer;
    this.sampler = imageSampler;
    this.animationController = animationController;
    this._cancelled = false;
    this.onProgress = null; // (done, total) => void
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

  // Analysis sample rate. The exported file interpolates between keyframes,
  // so playback smoothness does not depend on it.
  static get BAKE_FPS() { return 10; }

  async export({ targetBytes = 150 * 1024 } = {}) {
    this._cancelled = false;
    const renderer = this.renderer;
    const sampler = this.sampler;
    const state = stateManager.getRef();
    const progress = (x) => { if (this.onProgress) this.onProgress(Math.min(1, x), 1); };

    const [runtimeSrc, ...motionSrcs] = await Promise.all(
      ['js/export/htmlRuntime.js', ...HTMLExporter.MOTION_SOURCES].map(async (path) => {
        const resp = await fetch(path, { cache: 'no-cache' });
        if (!resp.ok) throw new Error('Could not load ' + path);
        return resp.text();
      })
    );

    // ── Bake the texture loop (colours only; masks are live or static) ──
    const hasVideo = !!(sampler && sampler.hasVideo && sampler.hasVideo());
    const duration = (parseFloat(state.loopDuration) > 0) ? parseFloat(state.loopDuration) : 10;
    const probe = renderer.bakeHTMLFrame();
    if (!probe) throw new Error('Renderer is not ready');
    const cols = probe.cols, rows = probe.rows, N = cols * rows;
    const totalFrames = (hasVideo && probe.texReady) ? Math.max(2, Math.round(duration * HTMLExporter.BAKE_FPS)) : 1;
    const colors = new Uint8Array(totalFrames * N * 4);

    const helper = new VideoExporter({ p5Instance: renderer.p, renderer, imageSampler: sampler });
    const wasPlaying = !!(sampler && sampler.isPlaying);
    const prevVideoTime = hasVideo ? sampler.getVideoTime() : 0;
    if (hasVideo) sampler.pause();
    renderer._exportInProgress = true;
    try {
      for (let f = 0; f < totalFrames; f++) {
        if (this._cancelled) throw new Error('cancelled');
        if (totalFrames > 1) await helper._seekAndWait(helper._getSamplerTimeForExport((f / totalFrames) * duration));
        const bake = f === 0 && totalFrames === 1 ? probe : renderer.bakeHTMLFrame();
        if (!bake || bake.cols * bake.rows !== N) throw new Error('Grid changed during export');
        colors.set(bake.rgba, f * N * 4);
        progress((f + 1) / totalFrames * 0.85);
        await new Promise(r => setTimeout(r, 0));
      }
    } finally {
      renderer._exportInProgress = false;
      if (hasVideo) {
        await helper._seekAndWait(prevVideoTime);
        if (wasPlaying) sampler.play();
      }
    }

    // Cells that never draw: outside the texture or transparent texel.
    const valid = new Uint8Array(N);
    for (let i = 0; i < N; i++) valid[i] = (!probe.texReady || (probe.valid[i] && colors[i * 4 + 3] >= 128)) ? 1 : 0;

    // Static (custom / library) mask, once per cell. The ring mask is live.
    const maskMode = state.maskMode || 'tabloop';
    let staticMask = null, maskMax = 1;
    // Stored unwarped: the runtime applies the noise warp + evolution live.
    const baseMask = probe.maskBase || probe.mask;
    if (maskMode !== 'tabloop' && baseMask) {
      maskMax = 0;
      for (let i = 0; i < N; i++) if (baseMask[i] > maskMax) maskMax = baseMask[i];
      if (!(maskMax > 0)) maskMax = 1;
      staticMask = new Uint8Array(N);
      for (let i = 0; i < N; i++) staticMask[i] = Math.round(Math.max(0, baseMask[i]) / maskMax * 255);
    }

    // ── Colour pipeline from a normal live render ──
    renderer.render();
    const uniforms = renderer.snapshotUniforms();
    const textures = HTMLExporter._neededLookupTextures(renderer, uniforms);

    // ── Code bundle (gzipped, self-extracting) ──
    const p = renderer.p;
    const meta = {
      cols, rows,
      cubeWidth: probe.cubeWidth, cubeHeight: probe.cubeHeight,
      spacingX: probe.cubeHeight * 0.1, spacingY: probe.cubeHeight * 0.1,
      offsetX: probe.offsetX, offsetY: probe.offsetY,
      layoutW: probe.layoutW, layoutH: probe.layoutH,
      canvasW: p.width, canvasH: p.height,
      hasTexture: !!probe.texReady,
      duration, maskMode, maskMax, hasStaticMask: !!staticMask,
      tex: null, // filled by the texture model below
    };
    const data = {
      meta,
      vert: HTMLExporter._minifyGLSL(HTMLExporter._injectTextureModel(VERT_SRC)),
      frag: HTMLExporter._minifyGLSL(HTMLExporter._injectTextureModel(FRAG_SRC)),
      uniforms,
      textures,
      state: HTMLExporter._primitiveState(stateManager.getAll()),
      motion: this._serializeMotion(),
    };
    const bg = data.state.backgroundColor;
    const buildBundle = async () => HTMLExporter._bytesToB64(await HTMLExporter._gzip(new TextEncoder().encode(
      'window.__TABSCAPE__=' + JSON.stringify(data) + ';\n' +
      HTMLExporter._stripJS(motionSrcs.join('\n')) + '\n' + HTMLExporter._stripJS(runtimeSrc))));

    // ── Texture model sized to the cap ──
    const fixedParts = [valid, staticMask].filter(Boolean);
    meta.tex = { d: 1, gw: cols, gh: rows, K: 1, amp: 0 }; // provisional, for overhead estimate
    const overhead = HTMLExporter._buildDocument(await buildBundle(), '', bg).length + 512;
    const payloadBudget = Math.floor((targetBytes - overhead) * 3 / 4);
    if (payloadBudget < 1024) throw new Error('Target size is too small for this composition.');

    let texBytes = new Uint8Array(0);
    if (probe.texReady) {
      const model = await HTMLExporter._fitTextureModel(colors, totalFrames, cols, rows, valid, duration, payloadBudget, fixedParts, (x) => progress(0.85 + x * 0.13));
      meta.tex = model.meta;
      texBytes = model.bytes;
    }

    // ── Assemble, then verify the cap ──
    const payload = HTMLExporter._concat([texBytes, ...fixedParts]);
    const mediaB64 = HTMLExporter._bytesToB64(await HTMLExporter._gzip(payload));
    const html = HTMLExporter._buildDocument(await buildBundle(), mediaB64, bg);
    progress(1);
    if (html.length > targetBytes) {
      throw new Error('Export is ' + Math.round(html.length / 1024) + ' KB, above the ' + Math.round(targetBytes / 1024) + ' KB cap. Try a larger target size.');
    }
    return html;
  }

  // ── Texture model ──────────────────────────────────────────

  /**
   * Low-res keyframe atlas: K keyframes of gw x gh texels (each texel = d x d
   * cells), box-filtered in space and time. Picks the (d, keyframes/s) pair
   * with the lowest reconstruction error that fits the byte budget.
   */
  static async _fitTextureModel(colors, F, cols, rows, valid, duration, budget, fixedParts, onStep) {
    const animated = F > 1;
    const ds = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32].filter(d => d === 1 || d <= Math.max(cols, rows));
    const rates = animated ? [10, 7.5, 5, 4, 3, 2.5, 2, 1.5, 1, 0.75, 0.5, 0.35, 0.25, 0.15] : [0];
    const fixedLen = fixedParts.reduce((a, p) => a + p.length, 0);
    const sizeOf = async (bytes) => (await HTMLExporter._gzip(HTMLExporter._concat([bytes, ...fixedParts]))).length;

    let best = null;
    for (let di = 0; di < ds.length; di++) {
      const d = ds[di];
      onStep(di / ds.length);
      // Highest keyframe rate that fits for this spatial resolution.
      let fit = null;
      for (const rate of rates) {
        const K = animated ? Math.max(2, Math.min(F, Math.round(duration * rate))) : 1;
        if (fit && fit.K === K) continue;
        const gw = Math.ceil(cols / d), gh = Math.ceil(rows / d);
        if (gw * gh * K * 3 * 0.05 + fixedLen * 0.05 > budget) continue; // clearly too big, skip the gzip
        const model = HTMLExporter._buildKeyframes(colors, F, cols, rows, valid, d, K);
        const size = await sizeOf(HTMLExporter._encodeKeyframes(model));
        if (size <= budget) { fit = { model, size }; break; }
      }
      if (!fit) continue;
      const err = HTMLExporter._modelError(colors, F, cols, rows, valid, fit.model);
      if (!best || err.rms < best.err.rms) best = { ...fit, err };
      if (d === 1 && !animated) break; // full-res still image fits: done
      await new Promise(r => setTimeout(r, 0));
    }
    if (!best) throw new Error('Target size is too small for this texture.');
    const m = best.model;
    // Grain amplitude: residual std (uniform noise in [-1,1] has std 1/sqrt(3)).
    const amp = m.d > 1 || animated ? Math.min(0.25, best.err.rms * Math.sqrt(3) * 0.9) : 0;
    return {
      bytes: HTMLExporter._encodeKeyframes(m),
      meta: { d: m.d, gw: m.gw, gh: m.gh, K: m.K, amp },
    };
  }

  static _buildKeyframes(colors, F, cols, rows, valid, d, K) {
    const gw = Math.ceil(cols / d), gh = Math.ceil(rows / d), T = gw * gh;
    const out = new Uint8Array(K * T * 3);
    const acc = new Float64Array(T * 4);
    for (let k = 0; k < K; k++) {
      acc.fill(0);
      const f0 = Math.floor(k * F / K), f1 = Math.max(f0 + 1, Math.floor((k + 1) * F / K));
      for (let f = f0; f < f1; f++) {
        const base = f * cols * rows * 4;
        for (let r = 0; r < rows; r++) {
          const ty = Math.floor(r / d) * gw;
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            if (!valid[i]) continue;
            const t = (ty + Math.floor(c / d)) * 4, o = base + i * 4;
            acc[t] += colors[o]; acc[t + 1] += colors[o + 1]; acc[t + 2] += colors[o + 2]; acc[t + 3]++;
          }
        }
      }
      // Fill empty texels from the global mean of this keyframe so bilinear
      // sampling near texture edges doesn't pull in black.
      let mr = 0, mg = 0, mb = 0, mn = 0;
      for (let t = 0; t < T; t++) { mr += acc[t * 4]; mg += acc[t * 4 + 1]; mb += acc[t * 4 + 2]; mn += acc[t * 4 + 3]; }
      mn = Math.max(1, mn);
      for (let t = 0; t < T; t++) {
        const n = acc[t * 4 + 3], o = (k * T + t) * 3;
        out[o] = Math.round(n ? acc[t * 4] / n : mr / mn);
        out[o + 1] = Math.round(n ? acc[t * 4 + 1] / n : mg / mn);
        out[o + 2] = Math.round(n ? acc[t * 4 + 2] / n : mb / mn);
      }
    }
    return { d, gw, gh, K, data: out };
  }

  /** Planar channels + temporal deltas: much friendlier to gzip. */
  static _encodeKeyframes(m) {
    const T = m.gw * m.gh, out = new Uint8Array(m.K * T * 3);
    let o = 0;
    for (let ch = 0; ch < 3; ch++) {
      for (let k = 0; k < m.K; k++) {
        for (let t = 0; t < T; t++) {
          const v = m.data[(k * T + t) * 3 + ch];
          const prev = k > 0 ? m.data[((k - 1) * T + t) * 3 + ch] : 0;
          out[o++] = (v - prev) & 255;
        }
      }
    }
    return out;
  }

  /** RMS error (0-1) of bilinear-space / linear-time reconstruction vs baked cells. */
  static _modelError(colors, F, cols, rows, valid, m) {
    const { d, gw, gh, K, data } = m, T = gw * gh;
    const step = Math.max(1, Math.floor(F / 24));
    let sum = 0, n = 0;
    const tap = (k, x, y, ch) => data[(k * T + y * gw + x) * 3 + ch];
    for (let f = 0; f < F; f += step) {
      const kp = F > 1 ? (f + 0.5) / F * K - 0.5 : 0;
      let k0 = Math.floor(kp); const kt = kp - k0;
      k0 = ((k0 % K) + K) % K; const k1 = (k0 + 1) % K;
      for (let r = 0; r < rows; r += 2) {
        const fy = Math.min(gh - 1, Math.max(0, (r + 0.5) / d - 0.5));
        const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
        for (let c = 0; c < cols; c += 2) {
          const i = r * cols + c;
          if (!valid[i]) continue;
          const fx = Math.min(gw - 1, Math.max(0, (c + 0.5) / d - 0.5));
          const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
          for (let ch = 0; ch < 3; ch++) {
            const bil = (k) => {
              const a = tap(k, x0, y0, ch) + (tap(k, x1, y0, ch) - tap(k, x0, y0, ch)) * tx;
              const b = tap(k, x0, y1, ch) + (tap(k, x1, y1, ch) - tap(k, x0, y1, ch)) * tx;
              return a + (b - a) * ty;
            };
            const v = bil(k0) + (bil(k1) - bil(k0)) * kt;
            const e = (v - colors[(f * cols * rows + i) * 4 + ch]) / 255;
            sum += e * e; n++;
          }
        }
      }
    }
    return { rms: n ? Math.sqrt(sum / n) : 0 };
  }

  /**
   * Replace the source-texture lookup in both shaders with the keyframe
   * model: bilinear in space (texture LINEAR), Catmull-Rom across keyframes,
   * plus per-cell grain that eases between random values over time.
   */
  static _injectTextureModel(src) {
    const re = /vec4 sampleSourceTexture\(vec2 uv\) \{[\s\S]*?\n\}/;
    if (!re.test(src)) throw new Error('Shader layout changed (sampleSourceTexture)');
    return src.replace(re, `uniform vec4 u_kf;
uniform vec2 u_atlasScale;
uniform vec2 u_cells;
uniform float u_time;
float tsHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 tsKey(float k, vec2 a) {
  k = mod(k, u_kf.x);
  return texture(u_srcTexture, vec2(a.x, (k + clamp(a.y, 0.5 / u_kf.z, 1.0 - 0.5 / u_kf.z)) / u_kf.x)).rgb;
}
vec4 sampleSourceTexture(vec2 uv) {
  vec2 a = uv * u_atlasScale;
  float i = floor(u_kf.y), t = u_kf.y - i;
  vec3 c0 = tsKey(i - 1.0, a), c1 = tsKey(i, a), c2 = tsKey(i + 1.0, a), c3 = tsKey(i + 2.0, a);
  vec3 c = 0.5 * (2.0 * c1 + (c2 - c0) * t + (2.0 * c0 - 5.0 * c1 + 4.0 * c2 - c3) * t * t + (3.0 * c1 - c0 - 3.0 * c2 + c3) * t * t * t);
  if (u_kf.w > 0.0) {
    vec2 cell = floor(uv * u_cells);
    float tt = u_time * 1.2;
    float f = floor(tt), s = tt - f;
    s = s * s * (3.0 - 2.0 * s);
    f = mod(f, 997.0);
    float n = mix(tsHash(vec3(cell, f)), tsHash(vec3(cell, f + 1.0)), s) * 2.0 - 1.0;
    c += n * u_kf.w;
  }
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`);
  }

  // ── Helpers ───────────────────────────────────────────────

  /** Lookup textures the fragment shader actually reads with these settings. */
  static _neededLookupTextures(renderer, uniforms) {
    const uv = (name) => (uniforms[name] ? uniforms[name].v : 0);
    const remap = uv('u_colorRemapEnabled') === 1, gradMap = uv('u_gradientMapEnabled') === 1;
    const duo = uv('u_duotoneEnabled') === 1;
    const needed = {
      1: remap && ((gradMap && uv('u_paletteMode') === 0) || uv('u_intEnabled') === 1),
      2: remap && gradMap && uv('u_paletteMode') === 1,
      3: remap && uv('u_hgmEnabled') === 1,
      4: remap && uv('u_gradeEnabled') === 1, // curve LUT (colour grade)
      5: duo, 6: duo,
    };
    const out = {};
    for (const [unit, t] of Object.entries(renderer.getHTMLExportTextures())) {
      if (!needed[unit]) continue;
      // Plain numbers gzip far better than base64.
      out[unit] = t.float
        ? { w: t.w, h: t.h, float: true, data: Array.from(t.data, v => Math.round(v * 1e5) / 1e5) }
        : { w: t.w, h: t.h, data: Array.from(t.data) };
    }
    return out;
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

  static _concat(parts) {
    let size = 0; parts.forEach(p => size += p.length);
    const out = new Uint8Array(size);
    let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
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
