/**
 * WebGLGridRenderer - GPU-powered grid renderer using WebGL2 instanced drawing.
 * Full color pipeline on GPU: texture sampling, PaletteProcessor, postFade, sizeFade.
 */

const INST_FLOATS = 8; // offset(2) + texUV(2) + gridUV(2) + manualScale(1) + imageScale(1)
const INST_STRIDE = INST_FLOATS * 4;

class WebGLGridRenderer extends GridRenderer {
  constructor(p5Instance) {
    super(p5Instance);
    this._webglAvailable = false;
    this._glCanvas = null;
    this._gl = null;
    this._program = null;
    this._vao = null;
    this._instanceBuffer = null;
    this._instanceData = null;
    this._instanceCapacity = 0;
    this._quadVBO = null;
    this._uniforms = {};
    this._lastWidth = 0;
    this._lastHeight = 0;

    // Textures
    this._srcTexture = null;
    this._gradientTex = null;   // unit 1: custom gradient
    this._heatmapTex = null;    // unit 2: heatmap gradient
    this._hueGradMapTex = null; // unit 3: hue gradient map
    this._curveLUTTex = null;   // unit 4: curve LUT
    this._duotoneWarmTex = null; // unit 5: duo tone warm gradient
    this._duotoneCoolTex = null; // unit 6: duo tone cool gradient
    this._loopStartTex = null;  // unit 7: loop-start snapshot for crossfade
    this._cornerSDFTex = null;  // unit 8: squircle corner SDF (Figma smoothing=1)
    this._prevFrameTex = null;  // unit 9: previous video frame for slow playback blending
    this._copyFramebuffer = null;
    this._hasPrevFrameTex = false;
    this._lastBlendFrameId = null;
    this._lastBlendVideoTime = 0;
    this._frameBlendStart = 0;
    this._frameBlendDuration = 0.1;

    this._gradientsDirty = true;
    this._curveLUTDirty = true;

    // Hue convergence state
    this._dominantHue = 0;
    this._hasHueHist = false;
    this._hueHistA = new Float32Array(12);
    this._hueHistB = new Float32Array(12);

    this._initWebGL();
  }

  // ── Init ──────────────────────────────────────────────────

  _initWebGL() {
    const canvas = document.createElement('canvas');
    this._glCanvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true,
    });
    if (!gl) { console.warn('WebGL2 unavailable — Canvas 2D fallback'); this._glCanvas = null; return; }

    this._gl = gl;
    this._webglAvailable = true;
    this._program = this._createProgram(gl, VERT_SRC, FRAG_SRC);
    if (!this._program) { this._webglAvailable = false; return; }
    gl.useProgram(this._program);

    // Cache ALL uniform locations
    const uNames = [
      'u_resolution','u_cornerRadius','u_cellAspect','u_cellSize','u_cornerSDF',
      'u_srcTexture','u_loopStartTexture','u_loopFade','u_prevTexture','u_frameBlend','u_hasTexture','u_textureVisible','u_bgLuminance',
      'u_imageHueOffset',
      'u_scaleHueShiftEnabled','u_scaleHueRange',
      'u_brightnessVariance',
      'u_imgScaleMin','u_imgScaleMax',
      // Palette
      'u_colorRemapEnabled','u_colorSpace','u_gradientMapEnabled','u_paletteMode',
      'u_noiseScale','u_noiseOctaves','u_noisePersist','u_noiseLac','u_noiseSeedX','u_noiseSeedY',
      'u_customGradient','u_heatmapGradient','u_hueGradMapTex','u_curveLUT',
      'u_hueLayerEnabled','u_hueLayerOffset','u_hueLayerOpacity','u_hueLayerBlend',
      'u_intEnabled','u_intAmount','u_intQuant','u_intOrigDriver','u_intOutDriver','u_intMix',
      'u_hr1Enabled','u_hr1Strength','u_hr1Start','u_hr1End','u_hr1Falloff','u_hr1SatOff','u_hr1LightOff',
      'u_hr2Enabled','u_hr2Strength','u_hr2Start','u_hr2End','u_hr2Target','u_hr2Falloff','u_hr2SatOff','u_hr2LightOff',
      'u_hgmEnabled','u_hgmStrength','u_hgmPhase','u_hgmPreserveLight',
      'u_hcStrength','u_dominantHue',
      'u_gradeEnabled','u_gradeTemp','u_gradeTint','u_gradeSat','u_gradeExp',
      'u_gradeContrast','u_gradeHigh','u_gradeShadow','u_gradeBlend',
      'u_imgBright','u_imgContrast','u_imgVibrancy',
      'u_hueExEnabled','u_hueExStart','u_hueExEnd',
      // PostFade
      'u_postFadeEnabled','u_postFadeDriver','u_postFadeTarget',
      'u_postFadeBlendMode','u_postFadeOffset',
      'u_postFadeStart','u_postFadeEnd','u_postFadeStrength',
      // SizeFade
      'u_sizeFade','u_sizeFadeCurve','u_bgColor','u_motionScaleMin','u_motionScaleMax',
      // Duo Tone
      'u_duotoneEnabled','u_duotoneWarmGradient','u_duotoneCoolGradient',
      // Tri Tone
      'u_tritoneEnabled','u_tritoneC1','u_tritoneC2','u_tritoneC3','u_tritoneGrey','u_tritoneFadeGrey',
    ];
    // Color fade arrays
    for (let i = 0; i < 4; i++) {
      uNames.push(`u_cf${i}Enabled`,`u_cf${i}Driver`,`u_cf${i}Start`,`u_cf${i}End`,
        `u_cf${i}Strength`,`u_cf${i}Target`,`u_cf${i}Blend`,`u_cf${i}HueOff`);
    }
    for (const n of uNames) this._uniforms[n] = gl.getUniformLocation(this._program, n);

    // Attributes
    const aPos = gl.getAttribLocation(this._program, 'a_position');
    const aOff = gl.getAttribLocation(this._program, 'a_offset');
    const aTex = gl.getAttribLocation(this._program, 'a_texUV');
    const aGrid = gl.getAttribLocation(this._program, 'a_gridUV');
    const aMS = gl.getAttribLocation(this._program, 'a_manualScale');
    const aIS = gl.getAttribLocation(this._program, 'a_imageScale');

    // VAO
    this._vao = gl.createVertexArray();
    gl.bindVertexArray(this._vao);

    // Quad
    this._quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5,-0.5, 0.5,-0.5, -0.5,0.5, 0.5,0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Instance buffer
    this._instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
    const S = INST_STRIDE;
    const setup = (loc, size, offset) => {
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, offset);
      gl.vertexAttribDivisor(loc, 1);
    };
    setup(aOff, 2, 0);   // offset
    setup(aTex, 2, 8);   // texUV
    setup(aGrid, 2, 16); // gridUV
    setup(aMS, 1, 24);   // manualScale
    setup(aIS, 1, 28);   // imageScale

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Create textures (NEAREST for source to match CPU nearest-neighbor sampling)
    this._srcTexture = this._createTex(gl, gl.NEAREST);
    this._gradientTex = this._createTex(gl, gl.LINEAR);
    this._heatmapTex = this._createTex(gl, gl.LINEAR);
    this._hueGradMapTex = this._createTex(gl, gl.LINEAR);
    this._curveLUTTex = this._createTex(gl, gl.NEAREST);
    this._duotoneWarmTex = this._createTex(gl, gl.LINEAR);
    this._duotoneCoolTex = this._createTex(gl, gl.LINEAR);
    this._loopStartTex = this._createTex(gl, gl.NEAREST);
    this._cornerSDFTex = this._buildCornerSDFTexture(gl);
    this._prevFrameTex = this._createTex(gl, gl.NEAREST);
    this._exportTexture = null; // lazily created on first export
    this._exportInProgress = false;
  }

  _buildCornerSDFTexture(gl) {
    const R = 128;
    // Build squircle corner polyline from Figma path (box 4x4, r=1, smoothing=1).
    // Top-right corner bbox is x∈[2,4], y∈[0,2]. Translate to corner-local v = (4-x, y).
    const cmds = GridRenderer._svgPathToCommands(
      GridRenderer._figmaSvgPath(4, 4, 1, 1), 0, 0
    );
    const pts = [];
    let cx = 0, cy = 0;
    const SEG = 64;
    for (const c of cmds) {
      if (c.type === 'move') { cx = c.x; cy = c.y; continue; }
      if (c.type === 'line') { cx = c.x; cy = c.y; continue; }
      if (c.type === 'cubic') {
        const midX = (cx + c.x) / 2, midY = (cy + c.y) / 2;
        if (midX >= 2 && midX <= 4 && midY >= 0 && midY <= 2) {
          for (let i = 0; i <= SEG; i++) {
            const t = i / SEG, mt = 1 - t;
            const x = mt*mt*mt*cx + 3*mt*mt*t*c.cp1x + 3*mt*t*t*c.cp2x + t*t*t*c.x;
            const y = mt*mt*mt*cy + 3*mt*mt*t*c.cp1y + 3*mt*t*t*c.cp2y + t*t*t*c.y;
            pts.push({ x: 4 - x, y: y });
          }
        }
        cx = c.x; cy = c.y;
      }
    }
    // Close a tip-side polygon: (0,0) → (curve from (2,0) to (0,2)) → (0,0)
    const tipPoly = [{ x: 0, y: 0 }, ...pts, { x: 0, y: 0 }];
    const pip = (px, py) => {
      let inside = false;
      for (let i = 0, j = tipPoly.length - 1; i < tipPoly.length; j = i++) {
        const xi = tipPoly[i].x, yi = tipPoly[i].y;
        const xj = tipPoly[j].x, yj = tipPoly[j].y;
        if (((yi > py) !== (yj > py)) &&
            (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    };
    const data = new Uint8Array(R * R);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const vx = (i / (R - 1)) * 2;
        const vy = (j / (R - 1)) * 2;
        let minD2 = Infinity;
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k], bb = pts[k + 1];
          const dx = bb.x - a.x, dy = bb.y - a.y;
          const len2 = dx*dx + dy*dy;
          if (len2 < 1e-12) continue;
          let t = ((vx - a.x) * dx + (vy - a.y) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const qx = a.x + t*dx, qy = a.y + t*dy;
          const d2 = (vx - qx)*(vx - qx) + (vy - qy)*(vy - qy);
          if (d2 < minD2) minD2 = d2;
        }
        const dist = Math.sqrt(minD2);
        const signed = pip(vx, vy) ? +dist : -dist;
        const norm = Math.max(0, Math.min(1, (signed + 2) / 4));
        data[j * R + i] = Math.round(norm * 255);
      }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, R, R, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  _ensureExportTexture(gl) {
    if (!this._exportTexture) {
      this._exportTexture = this._createTex(gl, gl.NEAREST);
    }
  }

  _createTex(gl, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    return tex;
  }

  _createProgram(gl, vSrc, fSrc) {
    const vs = this._compileShader(gl, gl.VERTEX_SHADER, vSrc);
    const fs = this._compileShader(gl, gl.FRAGMENT_SHADER, fSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(p)); gl.deleteProgram(p); return null;
    }
    return p;
  }

  _compileShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(s)); gl.deleteShader(s); return null;
    }
    return s;
  }

  resize(w, h) {
    if (!this._glCanvas || !this._gl) return;
    // During export we force DPR=1 so the chosen export size means actual
    // pixels (a "16K" selection produces a 16K file, not 32K).
    const d = this._forceDpr1 ? 1 : (window.devicePixelRatio || 1);
    this._dpr = d;
    const pw = Math.round(w * d), ph = Math.round(h * d);
    if (this._glCanvas.width !== pw || this._glCanvas.height !== ph) {
      this._glCanvas.width = pw; this._glCanvas.height = ph;
      this._gl.viewport(0, 0, pw, ph);
    }
    this._lastWidth = w; this._lastHeight = h;
  }

  _ensureInstanceCapacity(n) {
    if (n <= this._instanceCapacity) return;
    const cap = Math.ceil(n * 1.25);
    this._instanceData = new Float32Array(cap * INST_FLOATS);
    this._instanceCapacity = cap;
    const gl = this._gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this._instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  // ── Texture Management ────────────────────────────────────

  _uploadSourceTexture(gl, targetTexture) {
    // Upload from ImageSampler's pixel buffer — guarantees identical pixel data
    // to the CPU path (same color space, same brightness/contrast applied).
    if (!imageSampler || !imageSampler._pixelBuffer || !imageSampler._bufferWidth) return false;
    const tex = targetTexture || this._srcTexture;

    // Account for pixel density — the buffer is (width*d) × (height*d) pixels
    const d = imageSampler._pixelDensity || 1;
    const w = imageSampler._bufferWidth * d;
    const h = imageSampler._bufferHeight * d;
    if (w === 0 || h === 0) return false;

    // Verify buffer size matches expected dimensions
    const expectedSize = w * h * 4;
    if (imageSampler._pixelBuffer.length < expectedSize) {
      // Pixel density doesn't apply — use raw dimensions
      const rawW = imageSampler._bufferWidth;
      const rawH = imageSampler._bufferHeight;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rawW, rawH, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageSampler._pixelBuffer);
      this._texWidth = rawW; this._texHeight = rawH;
      return true;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageSampler._pixelBuffer);
    this._texWidth = w; this._texHeight = h;
    return true;
  }

  _copySourceToPrevFrame(gl) {
    if (!this._srcTexture || !this._prevFrameTex || !this._texWidth || !this._texHeight) return false;

    const fb = this._copyFramebuffer || (this._copyFramebuffer = gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._srcTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return false;
    }

    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this._prevFrameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this._texWidth, this._texHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this._texWidth, this._texHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  _getVideoFrameId(videoEl, currentTime) {
    if (videoEl && videoEl.getVideoPlaybackQuality) {
      const quality = videoEl.getVideoPlaybackQuality();
      if (quality && Number.isFinite(quality.totalVideoFrames) && quality.totalVideoFrames > 0) {
        return quality.totalVideoFrames;
      }
    }
    return Math.round((currentTime || 0) * 24);
  }

  _buildGradientData(stops, width) {
    const data = new Uint8Array(width * 4);
    if (!stops || stops.length === 0) { data.fill(128); return data; }
    for (let i = 0; i < width; i++) {
      const t = width > 1 ? i / (width - 1) : 0.5;
      let r, g, b;
      if (t <= stops[0].pos) { r = stops[0].r; g = stops[0].g; b = stops[0].b; }
      else if (t >= stops[stops.length - 1].pos) {
        const last = stops[stops.length - 1]; r = last.r; g = last.g; b = last.b;
      } else {
        let lo = 0;
        for (let j = 0; j < stops.length - 1; j++) {
          if (t >= stops[j].pos && t <= stops[j + 1].pos) { lo = j; break; }
        }
        const hi = lo + 1;
        const range = stops[hi].pos - stops[lo].pos;
        const f = range > 0 ? (t - stops[lo].pos) / range : 0;
        r = stops[lo].r + (stops[hi].r - stops[lo].r) * f;
        g = stops[lo].g + (stops[hi].g - stops[lo].g) * f;
        b = stops[lo].b + (stops[hi].b - stops[lo].b) * f;
      }
      const o = i * 4;
      data[o] = Math.round(Math.max(0, Math.min(255, r)));
      data[o+1] = Math.round(Math.max(0, Math.min(255, g)));
      data[o+2] = Math.round(Math.max(0, Math.min(255, b)));
      data[o+3] = 255;
    }
    return data;
  }

  _rebuildGradientTextures(gl) {
    if (!paletteProcessor) return;
    const upload1D = (tex, unit, data, w) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    };
    // Custom gradient
    const cStops = paletteProcessor._sortedStopsRGB;
    upload1D(this._gradientTex, 1, this._buildGradientData(cStops, 512), 512);
    // Heatmap
    const hColors = paletteProcessor._heatmapColorsRGB;
    if (hColors && hColors.length > 0) {
      const hStops = hColors.map((c, i) => ({ pos: i / (hColors.length - 1 || 1), r: c.r, g: c.g, b: c.b }));
      upload1D(this._heatmapTex, 2, this._buildGradientData(hStops, 256), 256);
    }
    // Hue gradient map
    const hgStops = paletteProcessor._hueGradMapStopsRGB;
    if (hgStops && hgStops.length > 0) {
      upload1D(this._hueGradMapTex, 3, this._buildGradientData(hgStops, 256), 256);
    }
    // Duo tone gradients
    const dtWarm = paletteProcessor._duotoneWarmStopsRGB;
    if (dtWarm && dtWarm.length > 0) {
      upload1D(this._duotoneWarmTex, 5, this._buildGradientData(dtWarm, 256), 256);
    }
    const dtCool = paletteProcessor._duotoneCoolStopsRGB;
    if (dtCool && dtCool.length > 0) {
      upload1D(this._duotoneCoolTex, 6, this._buildGradientData(dtCool, 256), 256);
    }
    this._gradientsDirty = false;
  }

  _rebuildCurveLUT(gl) {
    if (!paletteProcessor || !paletteProcessor._curveLUTs) return;
    const luts = paletteProcessor._curveLUTs;
    if (!luts.master || !luts.red || !luts.green || !luts.blue) return;
    // Use Float32 texture for full precision (matches CPU Float32Array lookups)
    const data = new Float32Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      data[i*4]   = luts.red[i] ?? (i / 255);
      data[i*4+1] = luts.green[i] ?? (i / 255);
      data[i*4+2] = luts.blue[i] ?? (i / 255);
      data[i*4+3] = luts.master[i] ?? (i / 255);
    }
    gl.activeTexture(gl.TEXTURE0 + 4);
    gl.bindTexture(gl.TEXTURE_2D, this._curveLUTTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 256, 1, 0, gl.RGBA, gl.FLOAT, data);
    this._curveLUTDirty = false;
  }

  // ── Helpers ───────────────────────────────────────────────

  static _blendIdx(m) {
    const T = { 'normal':0,'multiply':1,'screen':2,'overlay':3,'soft-light':4,'hard-light':5,
      'darken':6,'lighten':7,'color-dodge':8,'color-burn':9,'add':10,'difference':11,
      'hue':12,'saturation':13,'color':14,'luminosity':15,
      'vivid-light':16,'linear-light':17,'linear-burn':18,'subtract':19,'divide':20,
      'exclusion':21,'average':22,'grain-extract':23,'grain-merge':24 };
    return T[m] ?? 0;
  }

  static _driverIdx(d) {
    return d === 'saturation' ? 1 : d === 'hue' ? 2 : d === 'size' ? 3 : d === 'uniform' ? 4 : 0;
  }

  // ── Hue Convergence (CPU-side) ────────────────────────────

  _computeDominantHue() {
    // Swap histogram buffers
    const tmp = this._hueHistA;
    this._hueHistA = this._hueHistB;
    this._hueHistB = tmp;
    this._hueHistB.fill(0);

    // Find peak in previous frame's histogram
    let maxVal = 0, maxBucket = 0;
    for (let i = 0; i < 12; i++) {
      if (this._hueHistA[i] > maxVal) { maxVal = this._hueHistA[i]; maxBucket = i; }
    }
    if (maxVal === 0) return;

    const targetHue = maxBucket * 30 + 15;
    if (!this._hasHueHist) {
      this._dominantHue = targetHue;
      this._hasHueHist = true;
    } else {
      let diff = targetHue - this._dominantHue;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this._dominantHue = ((this._dominantHue + diff * 0.15) % 360 + 360) % 360;
    }
  }

  // Build hue histogram from a small sample of the source texture
  _sampleHueHistogram() {
    if (!imageSampler || !imageSampler._pixelBuffer) return;
    const buf = imageSampler._pixelBuffer;
    const w = imageSampler._bufferWidth, h = imageSampler._bufferHeight;
    if (!buf || w === 0 || h === 0) return;
    const hist = this._hueHistB;
    const steps = 16;
    for (let sy = 0; sy < steps; sy++) {
      for (let sx = 0; sx < steps; sx++) {
        const px = Math.floor(sx / steps * w);
        const py = Math.floor(sy / steps * h);
        const idx = (py * w + px) * 4;
        const r = buf[idx] / 255, g = buf[idx+1] / 255, b = buf[idx+2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const d = mx - mn, l = (mx + mn) / 2;
        const sat = d < 0.001 ? 0 : (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn));
        if (sat < 0.05) continue;
        let hue = 0;
        if (d > 0.001) {
          if (mx === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          else if (mx === g) hue = ((b - r) / d + 2) / 6;
          else hue = ((r - g) / d + 4) / 6;
        }
        hist[Math.floor(hue * 360 / 30) % 12] += sat;
      }
    }
  }

  // ── Core Render ───────────────────────────────────────────

  _renderCore(g, canvasWidth, canvasHeight, overrideSourceTexture) {
    if (!this._webglAvailable) return;

    const gl = this._gl;
    const u = this._uniforms;
    if (canvasWidth !== this._lastWidth || canvasHeight !== this._lastHeight)
      this.resize(canvasWidth, canvasHeight);

    const state = stateManager.getRef();
    const cols = state.gridDensity || 60;
    // Layout dims drive cube size / push scale. During export we render at a
    // padded canvas (to capture motion overshoot) but want geometry keyed to
    // the live preview size — see _layoutOverride.
    const layoutW = (this._layoutOverride && this._layoutOverride.w)
                 || (this._layoutCore && this._layoutCore.w)
                 || canvasWidth;
    const layoutH = (this._layoutOverride && this._layoutOverride.h)
                 || (this._layoutCore && this._layoutCore.h)
                 || canvasHeight;
    const cubeHeight = layoutW / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1, spacingY = cubeHeight * 0.1;
    // Rows fill the layout (composition), not the canvas, so the motion
    // padding stays empty until cubes are pushed into it.
    let rows = Math.ceil(layoutH / (cubeHeight + spacingY)) + 1;
    // Cap rows to match the push offsets array (sized for live preview grid)
    if (this._pushOffsets && this._pushOffsets.length > 0) {
      const maxRows = Math.floor(this._pushOffsets.length / cols);
      if (rows > maxRows) rows = maxRows;
    }
    const bgHex = state.backgroundColor || '#FFFEF7';
    const bgR = parseInt(bgHex.slice(1,3),16)/255, bgG = parseInt(bgHex.slice(3,5),16)/255, bgB = parseInt(bgHex.slice(5,7),16)/255;
    const bgLuminance = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
    const hasImage = imageSampler && imageSampler.hasImage();
    const imgScaleMin = this._smooth('imageBrightnessScaleMin', state.imageBrightnessScaleMin ?? 100) / 100;
    const imgScaleMax = this._smooth('imageBrightnessScaleMax', state.imageBrightnessScaleMax ?? 50) / 100;
    const motionScaleMin = this._smooth('scaleMin', state.scaleMin ?? 100) / 100;
    // Motion Scale is additive-only: clamp to ≥ Base Scale.
    const motionScaleMax = Math.max(motionScaleMin, this._smooth('scaleMax', state.scaleMax ?? 150) / 100);
    const colorRemapMode = state.colorRemapMode || 'none';

    // Grid layout
    const totalWidth = cols * cubeWidth + (cols - 1) * spacingX;
    const totalHeight = rows * cubeHeight + (rows - 1) * spacingY;
    const gridOffsetX = state.gridOffsetX ?? 50, gridOffsetY = state.gridOffsetY ?? 50;
    const offsetX = (canvasWidth - totalWidth) * (gridOffsetX / 100);
    const offsetY = (canvasHeight - totalHeight) * (gridOffsetY / 100);
    this._gridOffset.x = offsetX; this._gridOffset.y = offsetY;

    // Sampler viewport math should treat the layout canvas (live preview
    // dims) as the reference frame so image/mask UV mapping matches the live
    // render — the padded export canvas adds margins around the grid but the
    // texture/mask itself still maps to the grid area as if no padding existed.
    const samplerOffsetX = offsetX - (canvasWidth - layoutW) / 2;
    const samplerOffsetY = offsetY - (canvasHeight - layoutH) / 2;

    // Upload source texture
    let texReady = false;
    if (hasImage) {
      // Set up texture transform and cache grid colors for video buffer update
      const texPosX = 50 - (state.texturePositionX ?? 0);
      const texPosY = 50 - (state.texturePositionY ?? 0);
      const texScale = state.textureScale ?? 100;
      imageSampler.setTransform(texPosX, texPosY, texScale, texScale, 0);
      imageSampler.setGridViewport(samplerOffsetX, samplerOffsetY, totalWidth, totalHeight, layoutW, layoutH);
      if (overrideSourceTexture) {
        // Export path: upload current pixel buffer to the export texture
        texReady = this._uploadSourceTexture(gl, overrideSourceTexture);
      } else if (this._exportInProgress) {
        // Live render during export: skip update, keep existing _srcTexture
        texReady = !!this._texWidth;
      } else {
        // Normal live path
        if (imageSampler.isVideo && imageSampler.video && imageSampler.video.elt.readyState >= 2) {
          // Upload video element directly to GPU — avoids expensive CPU pixel copy
          const vid = imageSampler.video.elt;
          const ct = imageSampler.getVideoTime();
          const frameId = this._getVideoFrameId(vid, ct);
          const maxRate = state.extendScope ? 3 : 1;
          const rate = Math.max(0.45, Math.min(maxRate, parseFloat(state.texturePlaybackSpeed) || 1));
          if (rate < 0.999 && this._lastBlendFrameId != null && frameId !== this._lastBlendFrameId) {
            this._hasPrevFrameTex = this._copySourceToPrevFrame(gl);
            this._frameBlendStart = performance.now();
            const videoDelta = Math.abs(ct - this._lastBlendVideoTime) || (1 / 24);
            const lowSpeedBoost = rate < 0.4
              ? 1 + ((0.4 - rate) / 0.3) * 0.65
              : 1;
            this._frameBlendDuration = Math.max(0.08, Math.min(1.2, (videoDelta / rate) * lowSpeedBoost));
          }
          const t0 = performance.now();
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this._srcTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vid);
          const tTex = performance.now() - t0;
          this._texWidth = vid.videoWidth;
          this._texHeight = vid.videoHeight;
          texReady = true;

          // Update CPU pixel buffer at reduced rate for color caching
          let tCpu = 0;
          if (!this._lastCpuBufferTime || Math.abs(ct - this._lastCpuBufferTime) > 0.1) {
            const t1 = performance.now();
            imageSampler.updateVideoBuffer();
            tCpu = performance.now() - t1;
            imageSampler._lastFrameTime = ct;
            this._lastCpuBufferTime = ct;
          }

          // Log frame timings every 60 frames
          if (!this._vidPerfCount) this._vidPerfCount = 0;
          if (!this._vidPerfSum) this._vidPerfSum = { tex: 0, cpu: 0, total: 0 };
          this._vidPerfCount++;
          this._vidPerfSum.tex += tTex;
          this._vidPerfSum.cpu += tCpu;
          if (this._vidPerfCount >= 60) {
            console.log('[Video Perf] 60 frames avg:', {
              texUpload: (this._vidPerfSum.tex / 60).toFixed(2) + 'ms',
              cpuBuffer: (this._vidPerfSum.cpu / 60).toFixed(2) + 'ms',
              videoW: vid.videoWidth, videoH: vid.videoHeight,
              readyState: vid.readyState,
              paused: vid.paused,
              currentTime: vid.currentTime.toFixed(2),
            });
            this._vidPerfCount = 0;
            this._vidPerfSum = { tex: 0, cpu: 0, total: 0 };
          }
          this._lastBlendFrameId = frameId;
          this._lastBlendVideoTime = ct;
        } else {
          // Static image or video not ready: use pixel buffer path
          if (imageSampler.isVideo) {
            const ct = imageSampler.getVideoTime();
            if (Math.abs(ct - imageSampler._lastFrameTime) > 0.016 || !imageSampler._pixelBuffer) {
              imageSampler.updateVideoBuffer();
              imageSampler._lastFrameTime = ct;
            }
          }
          texReady = this._uploadSourceTexture(gl);
        }
      }
    }

    // Sync PaletteProcessor and rebuild gradient textures if dirty
    if (colorRemapMode !== 'none' && typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      // Check dirty flag before sync (syncFromState clears it)
      if (paletteProcessor._dirty) { this._gradientsDirty = true; this._curveLUTDirty = true; }
      paletteProcessor.syncFromState();
      if (this._gradientsDirty || !this._gradientTex) this._rebuildGradientTextures(gl);
      if (this._curveLUTDirty || !this._curveLUTTex) this._rebuildCurveLUT(gl);
    }

    // Duo tone: ensure gradient textures are always fresh when enabled
    if (colorRemapMode === 'duotone' && typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      if (!paletteProcessor._duotoneWarmStopsRGB) paletteProcessor.syncFromState();
      const dtW = paletteProcessor._duotoneWarmStopsRGB;
      const dtC = paletteProcessor._duotoneCoolStopsRGB;
      if (dtW && dtW.length > 0) {
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this._duotoneWarmTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._buildGradientData(dtW, 256));
      }
      if (dtC && dtC.length > 0) {
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this._duotoneCoolTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._buildGradientData(dtC, 256));
      }
    }

    // Hue convergence
    const hcStrength = paletteProcessor ? (paletteProcessor._numHueConvergenceStrength || 0) : 0;
    if (hcStrength > 0) {
      this._sampleHueHistogram();
      this._computeDominantHue();
    }

    // Cache grid positions
    const gridSize = cols * rows;
    const cellStepX = cubeWidth + spacingX, cellStepY = cubeHeight + spacingY;
    const rowOffsetVal = cellStepX * 0.5;
    const gridKey = `${cols}|${rows}|${canvasWidth}|${canvasHeight}|${gridOffsetX}|${gridOffsetY}`;
    if (this._lastGridKey !== gridKey || !this._posX || this._posX.length !== gridSize) {
      this._posX = new Float32Array(gridSize);
      this._posY = new Float32Array(gridSize);
      this._lastGridKey = gridKey;
      for (let row = 0; row < rows; row++) {
        const bx = offsetX + (row % 2 === 1 ? rowOffsetVal : 0);
        const yp = offsetY + row * cellStepY;
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          this._posX[i] = bx + col * cellStepX;
          this._posY[i] = yp;
        }
      }
    }

    // Mask
    const maskMode = state.maskMode || 'tabloop';
    let maskValues = null;
    if (maskMode === 'tabloop' && this._maskProcessor) {
      const maskEvolutionPhase = this._getMaskEvolutionPhase(state);
      maskValues = this._maskProcessor.computeRingMask(cols, rows, this._posX, this._posY, cubeWidth, cubeHeight, canvasWidth, canvasHeight, state, layoutW, layoutH, maskEvolutionPhase);
    } else if (maskMode === 'custom') {
      const hasMaskProc = !!this._maskProcessor;
      const hasMaskSampler = typeof maskSampler !== 'undefined' && !!maskSampler;
      const maskHasImage = hasMaskSampler && maskSampler.hasImage();
      const maskIsLoaded = hasMaskSampler && maskSampler.isLoaded;
      if (!this._maskLogDone) {
        console.log('[Mask Debug]', { maskMode, hasMaskProc, hasMaskSampler, maskHasImage, maskIsLoaded,
          maskChannel: state.maskChannel, maskInvert: state.maskInvert,
          bufferW: hasMaskSampler ? maskSampler._bufferWidth : 'N/A',
          bufferH: hasMaskSampler ? maskSampler._bufferHeight : 'N/A',
          pixelBuffer: hasMaskSampler ? !!maskSampler._pixelBuffer : 'N/A'
        });
        this._maskLogDone = true;
        setTimeout(() => { this._maskLogDone = false; }, 2000);
      }
      if (hasMaskProc && maskHasImage) {
        const syncMask = state.maskSyncWithTexture !== false;
        const maskPosX = syncMask ? (state.texturePositionX ?? 0) : (state.maskPositionX ?? 0);
        const maskPosY = syncMask ? (state.texturePositionY ?? 0) : (state.maskPositionY ?? 0);
        const maskScale = syncMask ? (state.textureScale ?? 100) : (state.maskScale ?? 100);
        maskSampler.setTransform(50 - maskPosX, 50 - maskPosY, maskScale, maskScale, 0);
        maskSampler.setGridViewport(samplerOffsetX, samplerOffsetY, totalWidth, totalHeight, layoutW, layoutH);
        maskValues = this._maskProcessor.computeCustomMask(cols, rows, this._posX, this._posY, cubeWidth, cubeHeight, layoutW, layoutH, maskSampler, state.maskChannel || 'luminance', state.maskInvert || false, (state.maskSoftness ?? 0) / 100);
        if (!this._maskValLogDone) {
          const vals = maskValues;
          let min = 1, max = 0, sum = 0;
          for (let i = 0; i < Math.min(vals.length, cols * rows); i++) {
            if (vals[i] < min) min = vals[i];
            if (vals[i] > max) max = vals[i];
            sum += vals[i];
          }
          console.log('[Mask Values]', { min: min.toFixed(3), max: max.toFixed(3), avg: (sum / (cols * rows)).toFixed(3), count: cols * rows });
          this._maskValLogDone = true;
          setTimeout(() => { this._maskValLogDone = false; }, 2000);
        }
      }
    }

    // UV transform params
    // Texture UV math is in the LAYOUT frame (live preview dims) — using the
    // padded canvas dims here would shift the image's effective aspect during
    // export and letterbox/crop the texture.
    const vpOU = layoutW > 0 ? samplerOffsetX / layoutW : 0;
    const vpOV = layoutH > 0 ? samplerOffsetY / layoutH : 0;
    const vpSU = layoutW > 0 ? totalWidth / layoutW : 1;
    const vpSV = layoutH > 0 ? totalHeight / layoutH : 1;
    const texPosX = state.texturePositionX ?? 0;
    const texPosY = state.texturePositionY ?? 0;
    const texScaleVal = state.textureScale ?? 100;
    const posShiftU = texPosX / 100, posShiftV = texPosY / 100;
    const scaleInv = 100 / texScaleVal;
    const imgAspect = (this._texWidth && this._texHeight) ? this._texWidth / this._texHeight : 1;
    const canvasAspect = layoutW / (layoutH || 1);
    const mappingMode = imageSampler ? (imageSampler.mappingMode || 'fit') : 'fit';

    // Fit mode precompute
    let fitUScale = 1, fitUOff = 0, fitVScale = 1, fitVOff = 0, fitMode = 0;
    if (mappingMode === 'fit') {
      if (imgAspect > canvasAspect) {
        fitVScale = canvasAspect / imgAspect;
        fitVOff = (1 - fitVScale) / 2;
        fitMode = 1; // letterbox V
      } else {
        fitUScale = imgAspect / canvasAspect;
        fitUOff = (1 - fitUScale) / 2;
        fitMode = 2; // pillarbox U
      }
    }

    // ── Build instance buffer ──
    this._ensureInstanceCapacity(gridSize);
    const data = this._instanceData;
    let count = 0;
    const halfCW = cubeWidth / 2, halfCH = cubeHeight / 2;
    // Scale push offsets when rendering at a different resolution (e.g. video export)
    const pushScale = layoutW / this.p.width;

    for (let row = 0; row < rows; row++) {
      const gridV = rows > 1 ? row / (rows - 1) : 0.5;
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const gridU = cols > 1 ? col / (cols - 1) : 0.5;

        // Scale — influence uses raw push magnitude, position uses scaled
        const po = this._pushOffsets[index];
        const rawPushX = po ? po.x : 0, rawPushY = po ? po.y : 0;
        const pushX = rawPushX * pushScale, pushY = rawPushY * pushScale;
        const manualScale = this._manualScaleOffsets[index] ?? 1;
        const pushMag = Math.sqrt(rawPushX * rawPushX + rawPushY * rawPushY);
        const influence = Math.min(1, pushMag / 50);
        let imageScale = motionScaleMin + (motionScaleMax - motionScaleMin) * influence;
        if (maskValues) imageScale *= maskValues[index];
        // Note: Scale Dark/Light applied in vertex shader
        if (imageScale * manualScale < 0.001) continue;

        // Compute texture UV
        let texU = -1, texV = -1;
        if (texReady) {
          let uv_u = vpOU + gridU * vpSU;
          let uv_v = vpOV + gridV * vpSV;
          {
          // Scale around canvas center first, then apply position offset
          uv_u = (uv_u - 0.5) * scaleInv + 0.5 + posShiftU;
          uv_v = (uv_v - 0.5) * scaleInv + 0.5 + posShiftV;

          let valid = true;
          if (mappingMode !== 'tile' && (uv_u < 0 || uv_u > 1 || uv_v < 0 || uv_v > 1)) valid = false;

          if (valid && mappingMode === 'fit') {
            if (fitMode === 1) { // letterbox V
              if (uv_v < fitVOff || uv_v > 1 - fitVOff) valid = false;
              else uv_v = (uv_v - fitVOff) / fitVScale;
            } else if (fitMode === 2) { // pillarbox U
              if (uv_u < fitUOff || uv_u > 1 - fitUOff) valid = false;
              else uv_u = (uv_u - fitUOff) / fitUScale;
            }
          } else if (mappingMode === 'tile') {
            uv_u = ((uv_u % 1) + 1) % 1;
            uv_v = ((uv_v % 1) + 1) % 1;
          }

          if (!valid) continue;
          texU = uv_u;
          texV = uv_v;
          } // end mask clip else
        }

        // Pack
        const cx = this._posX[index] + halfCW + pushX;
        const cy = this._posY[index] + halfCH + pushY;
        const off = count * INST_FLOATS;
        data[off]   = cx;
        data[off+1] = cy;
        data[off+2] = texU;
        data[off+3] = texV;
        data[off+4] = gridU;
        data[off+5] = gridV;
        data[off+6] = manualScale;
        data[off+7] = imageScale;
        count++;
      }
    }
    // Cache geometry for SVG export — exportSVG samples the just-rendered
    // framebuffer at each cube center, so it needs the same instance data.
    this._lastInstanceCount = count;
    this._lastCubeWidth = cubeWidth;
    this._lastCubeHeight = cubeHeight;
    this._lastCanvasWidth = canvasWidth;
    this._lastCanvasHeight = canvasHeight;



    // ── Draw ──
    const clearA = this._exportTransparent ? 0 : 1;
    gl.clearColor(bgR * clearA, bgG * clearA, bgB * clearA, clearA);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;

    gl.useProgram(this._program);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, overrideSourceTexture || this._srcTexture);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this._gradientTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this._heatmapTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this._hueGradMapTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this._curveLUTTex);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this._duotoneWarmTex);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this._duotoneCoolTex);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this._loopStartTex);
    gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D, this._cornerSDFTex);
    gl.activeTexture(gl.TEXTURE9); gl.bindTexture(gl.TEXTURE_2D, this._prevFrameTex);

    // Upload loop crossfade texture directly from clone video element
    let loopFade = (typeof app !== 'undefined' && app._loopFadeAmount) || 0;
    if (loopFade > 0 && typeof app !== 'undefined' && app._fadeClone && app._fadeClone.readyState >= 2) {
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this._loopStartTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, app._fadeClone);
    } else if (loopFade > 0) {
      loopFade = 0; // clone not ready — don't blend
    }

    // Sampler uniforms
    let frameBlend = 1;
    if (!overrideSourceTexture && this._hasPrevFrameTex && this._frameBlendStart && this._frameBlendDuration > 0) {
      const rawBlend = Math.max(0, Math.min(1, (performance.now() - this._frameBlendStart) / (this._frameBlendDuration * 1000)));
      frameBlend = rawBlend * rawBlend * (3 - 2 * rawBlend);
      if (frameBlend >= 1) this._hasPrevFrameTex = false;
    }
    gl.uniform1i(u.u_srcTexture, 0);
    gl.uniform1i(u.u_loopStartTexture, 7);
    gl.uniform1f(u.u_loopFade, loopFade);
    gl.uniform1i(u.u_prevTexture, 9);
    gl.uniform1f(u.u_frameBlend, frameBlend);
    gl.uniform1i(u.u_customGradient, 1);
    gl.uniform1i(u.u_heatmapGradient, 2);
    gl.uniform1i(u.u_hueGradMapTex, 3);
    gl.uniform1i(u.u_curveLUT, 4);
    gl.uniform1i(u.u_duotoneWarmGradient, 5);
    gl.uniform1i(u.u_duotoneCoolGradient, 6);
    gl.uniform1i(u.u_cornerSDF, 8);

    // Shape uniforms
    gl.uniform2f(u.u_resolution, canvasWidth, canvasHeight);
    const minDim = Math.min(cubeWidth, cubeHeight);
    gl.uniform1f(u.u_cornerRadius, Math.min((25 / 100) * minDim, minDim / 2) / (minDim / 2));
    gl.uniform2f(u.u_cellAspect, cubeWidth / cubeHeight, 1.0);
    gl.uniform2f(u.u_cellSize, cubeWidth, cubeHeight);

    // Texture / color state
    gl.uniform1i(u.u_hasTexture, texReady ? 1 : 0);
    gl.uniform1i(u.u_textureVisible, (state.textureVisible !== false) ? 1 : 0);
    gl.uniform1f(u.u_bgLuminance, bgLuminance);
    gl.uniform1f(u.u_imageHueOffset, (state.imageHueOffset ?? 0));

    // Scale-to-color
    gl.uniform1i(u.u_scaleHueShiftEnabled, (state.scaleHueRange ?? 0) > 0 ? 1 : 0);
    gl.uniform1f(u.u_brightnessVariance, this._smooth('brightnessVariance', state.brightnessVariance ?? 0) / 100);
    gl.uniform1f(u.u_scaleHueRange, state.scaleHueRange ?? 60);
    gl.uniform1f(u.u_imgScaleMin, imgScaleMin);
    gl.uniform1f(u.u_imgScaleMax, imgScaleMax);

    // PaletteProcessor uniforms
    const pp = (colorRemapMode !== 'none' && typeof paletteProcessor !== 'undefined') ? paletteProcessor : null;
    gl.uniform1i(u.u_colorRemapEnabled, (colorRemapMode === 'full' && pp) ? 1 : 0);
    gl.uniform1i(u.u_colorSpace, (pp && pp.settings && pp.settings.colorSpace === 'oklch') ? 1 : 0);
    gl.uniform1i(u.u_gradientMapEnabled, (pp && pp.settings && pp.settings.gradientMapEnabled) ? 1 : 0);
    gl.uniform1i(u.u_paletteMode, (pp && pp.settings && pp.settings.activeMode === 'mode2') ? 1 : 0);

    if (pp) {
      gl.uniform1f(u.u_noiseScale, pp._numNoiseScale || 3);
      gl.uniform1i(u.u_noiseOctaves, pp._numNoiseOctaves || 4);
      gl.uniform1f(u.u_noisePersist, pp._numNoisePersist || 0.5);
      gl.uniform1f(u.u_noiseLac, pp._numNoiseLac || 2);
      gl.uniform1f(u.u_noiseSeedX, pp._numNoiseSeedX || 0);
      gl.uniform1f(u.u_noiseSeedY, pp._numNoiseSeedY || 0);

      const s = pp.settings || {};
      // Hue layer
      gl.uniform1i(u.u_hueLayerEnabled, s.hueLayerEnabled ? 1 : 0);
      gl.uniform1f(u.u_hueLayerOffset, pp._numHueLayerOffset || 0);
      gl.uniform1f(u.u_hueLayerOpacity, pp._numHueLayerOpacity || 0);
      gl.uniform1i(u.u_hueLayerBlend, WebGLGridRenderer._blendIdx(s.hueLayerBlend || 'normal'));

      // Interference
      gl.uniform1i(u.u_intEnabled, s.origInterferenceEnabled ? 1 : 0);
      gl.uniform1f(u.u_intAmount, pp._numHmOrigAmount || 0);
      gl.uniform1i(u.u_intQuant, pp._numHmOrigQuant || 0);
      gl.uniform1i(u.u_intOrigDriver, WebGLGridRenderer._driverIdx(s.hmOrigDriver || 'luminance'));
      gl.uniform1i(u.u_intOutDriver, WebGLGridRenderer._driverIdx(s.hmOutputDriver || 'hue'));
      const mixMap = {'offset':0,'multiply':1,'wrap':2,'xor':3};
      gl.uniform1i(u.u_intMix, mixMap[s.hmOrigMix] ?? 0);

      // Hue remap 1
      gl.uniform1i(u.u_hr1Enabled, s.hueRemapEnabled ? 1 : 0);
      gl.uniform1f(u.u_hr1Strength, pp._numHueRemapStrength || 0);
      gl.uniform1f(u.u_hr1Start, pp._numHueRemapStart || 0);
      gl.uniform1f(u.u_hr1End, pp._numHueRemapEnd || 0);
      gl.uniform1f(u.u_hr1Falloff, pp._numHueRemapFalloff || 0);
      gl.uniform1f(u.u_hr1SatOff, pp._numHueRemapSatOffset || 0);
      gl.uniform1f(u.u_hr1LightOff, pp._numHueRemapLightOffset || 0);

      // Hue remap 2
      gl.uniform1i(u.u_hr2Enabled, s.hueRemap2Enabled ? 1 : 0);
      gl.uniform1f(u.u_hr2Strength, pp._numHueRemap2Strength || 0);
      gl.uniform1f(u.u_hr2Start, pp._numHueRemap2Start || 0);
      gl.uniform1f(u.u_hr2End, pp._numHueRemap2End || 0);
      gl.uniform1f(u.u_hr2Target, pp._numHueRemap2Target || 0);
      gl.uniform1f(u.u_hr2Falloff, pp._numHueRemap2Falloff || 0);
      gl.uniform1f(u.u_hr2SatOff, pp._numHueRemap2SatOffset || 0);
      gl.uniform1f(u.u_hr2LightOff, pp._numHueRemap2LightOffset || 0);

      // Hue gradient map
      gl.uniform1i(u.u_hgmEnabled, s.hueGradMapEnabled ? 1 : 0);
      gl.uniform1f(u.u_hgmStrength, pp._numHueGradMapStrength || 0);
      gl.uniform1f(u.u_hgmPhase, pp._numHueGradMapPhase || 0);
      gl.uniform1i(u.u_hgmPreserveLight, s.hueGradMapPreserveLight ? 1 : 0);

      // Hue convergence
      gl.uniform1f(u.u_hcStrength, hcStrength);
      gl.uniform1f(u.u_dominantHue, this._dominantHue);

      // Color grade
      gl.uniform1i(u.u_gradeEnabled, s.colorGradeEnabled ? 1 : 0);
      gl.uniform1f(u.u_gradeTemp, pp._numGradeTemp || 0);
      gl.uniform1f(u.u_gradeTint, pp._numGradeTint || 0);
      gl.uniform1f(u.u_gradeSat, pp._numGradeSat ?? 1);
      gl.uniform1f(u.u_gradeExp, pp._numGradeExp || 0);
      gl.uniform1f(u.u_gradeContrast, pp._numGradeContrast || 0);
      gl.uniform1f(u.u_gradeHigh, pp._numGradeHigh || 0);
      gl.uniform1f(u.u_gradeShadow, pp._numGradeShadow || 0);
      gl.uniform1i(u.u_gradeBlend, WebGLGridRenderer._blendIdx(s.gradeBlend || 'normal'));

      // Image adjust
      gl.uniform1f(u.u_imgBright, pp._numImgAdjBrightness || 0);
      gl.uniform1f(u.u_imgContrast, pp._numImgAdjContrast || 0);
      gl.uniform1f(u.u_imgVibrancy, pp._numImgAdjVibrancy || 0);

      // Color fades
      const cfKeys = [
        ['colorFadeEnabled','colorFadeDriver','_numCfFadeStart','_numCfFadeEnd','_numCfStrength','_cfTargetR','_cfTargetG','_cfTargetB','cfBlendMode','cfHueOffset'],
        ['colorFade2Enabled','colorFade2Driver','_numCf2FadeStart','_numCf2FadeEnd','_numCf2Strength','_cf2TargetR','_cf2TargetG','_cf2TargetB','cf2BlendMode','cf2HueOffset'],
        ['colorFade3Enabled','colorFade3Driver','_numCf3FadeStart','_numCf3FadeEnd','_numCf3Strength','_cf3TargetR','_cf3TargetG','_cf3TargetB','cf3BlendMode','cf3HueOffset'],
        ['colorFade4Enabled','colorFade4Driver','_numCf4FadeStart','_numCf4FadeEnd','_numCf4Strength','_cf4TargetR','_cf4TargetG','_cf4TargetB','cf4BlendMode','cf4HueOffset'],
      ];
      // Default drivers differ per fade: 1&2='luminance', 3='saturation', 4='hue'
      const cfDriverDefaults = ['luminance', 'luminance', 'saturation', 'hue'];
      for (let i = 0; i < 4; i++) {
        const k = cfKeys[i];
        gl.uniform1i(u[`u_cf${i}Enabled`], s[k[0]] ? 1 : 0);
        gl.uniform1i(u[`u_cf${i}Driver`], WebGLGridRenderer._driverIdx(s[k[1]] || cfDriverDefaults[i]));
        gl.uniform1f(u[`u_cf${i}Start`], pp[k[2]] || 0);
        gl.uniform1f(u[`u_cf${i}End`], pp[k[3]] || 0);
        gl.uniform1f(u[`u_cf${i}Strength`], pp[k[4]] || 0);
        gl.uniform3f(u[`u_cf${i}Target`], (pp[k[5]]||0)/255, (pp[k[6]]||0)/255, (pp[k[7]]||0)/255);
        gl.uniform1i(u[`u_cf${i}Blend`], WebGLGridRenderer._blendIdx(s[k[8]] || 'normal'));
        gl.uniform1f(u[`u_cf${i}HueOff`], (parseFloat(s[k[9]]) || 0) / 360);
      }

      // Hue exclusion
      gl.uniform1i(u.u_hueExEnabled, s.hueExcludeEnabled ? 1 : 0);
      gl.uniform1f(u.u_hueExStart, pp._numHueExcludeStart || 0);
      gl.uniform1f(u.u_hueExEnd, pp._numHueExcludeEnd || 0);
    }

    // Duo Tone
    gl.uniform1i(u.u_duotoneEnabled, colorRemapMode === 'duotone' ? 1 : 0);

    // Tri Tone
    gl.uniform1i(u.u_tritoneEnabled, colorRemapMode === 'tritone' ? 1 : 0);
    if (colorRemapMode === 'tritone') {
      const ppTri = (typeof paletteProcessor !== 'undefined' && paletteProcessor) ? paletteProcessor : null;
      if (ppTri && !ppTri._tritoneColor1RGB) ppTri.syncFromState();
      const c1 = ppTri ? ppTri._tritoneColor1RGB : { r: 255, g: 42, b: 127 };
      const c2 = ppTri ? ppTri._tritoneColor2RGB : { r: 143, g: 119, b: 248 };
      const c3 = ppTri ? ppTri._tritoneColor3RGB : { r: 72, g: 190, b: 197 };
      const gr = ppTri ? ppTri._tritoneGreyRGB : { r: 204, g: 204, b: 199 };
      const fg = ppTri ? ppTri._tritoneFadeGrey : 0;
      gl.uniform3f(u.u_tritoneC1, c1.r/255, c1.g/255, c1.b/255);
      gl.uniform3f(u.u_tritoneC2, c2.r/255, c2.g/255, c2.b/255);
      gl.uniform3f(u.u_tritoneC3, c3.r/255, c3.g/255, c3.b/255);
      gl.uniform3f(u.u_tritoneGrey, gr.r/255, gr.g/255, gr.b/255);
      gl.uniform1f(u.u_tritoneFadeGrey, fg);
    }

    // PostFade
    const pfe = state.postFadeEnabled || false;
    gl.uniform1i(u.u_postFadeEnabled, pfe ? 1 : 0);
    if (pfe) {
      gl.uniform1i(u.u_postFadeDriver, WebGLGridRenderer._driverIdx(state.postFadeDriver || 'luminance'));
      const pfHex = state.postFadeTarget || '#C4C3BB';
      const pt = { r: parseInt(pfHex.slice(1,3),16), g: parseInt(pfHex.slice(3,5),16), b: parseInt(pfHex.slice(5,7),16) };
      gl.uniform3f(u.u_postFadeTarget, pt.r/255, pt.g/255, pt.b/255);
      gl.uniform1i(u.u_postFadeBlendMode, WebGLGridRenderer._blendIdx(state.postFadeBlendMode || 'normal'));
      gl.uniform1f(u.u_postFadeOffset, (state.postFadeOffset ?? 0) / 360);
      // Keep these for the non-size drivers
      gl.uniform1f(u.u_postFadeStart, (parseFloat(state.postFadeStart) || 0) / 100);
      gl.uniform1f(u.u_postFadeEnd, (parseFloat(state.postFadeEnd) || 100) / 100);
      gl.uniform1f(u.u_postFadeStrength, (state.postFadeStrength ?? 100) / 100);
    }

    // SizeFade
    gl.uniform1f(u.u_sizeFade, this._smooth('sizeFade', state.sizeFade ?? 100) / 100);
    gl.uniform1f(u.u_sizeFadeCurve, this._smooth('sizeFadeCurve', state.sizeFadeCurve ?? 100) / 100);
    gl.uniform3f(u.u_bgColor, bgR, bgG, bgB);
    gl.uniform1f(u.u_motionScaleMin, motionScaleMin);
    gl.uniform1f(u.u_motionScaleMax, motionScaleMax);
    // Upload + draw
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * INST_FLOATS));
    gl.bindVertexArray(this._vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);

    // Blit — fill the destination canvas's full pixel buffer (or a centered
    // letterbox region if an explicit dest rect was set on the renderer).
    const ctx = this._getCtx(g);
    const destCanvas = (g && g.canvas) || (g && g.elt) || this.p.canvas;
    const fullW = destCanvas ? destCanvas.width : canvasWidth * this._dpr;
    const fullH = destCanvas ? destCanvas.height : canvasHeight * this._dpr;
    const dr = this._destRect;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (dr) {
      ctx.drawImage(this._glCanvas, 0, 0, this._glCanvas.width, this._glCanvas.height,
                    dr.x, dr.y, dr.w, dr.h);
    } else {
      ctx.drawImage(this._glCanvas, 0, 0, this._glCanvas.width, this._glCanvas.height,
                    0, 0, fullW, fullH);
    }
    ctx.restore();
  }

  /**
   * Tiled full-resolution render. Returns a Uint8ClampedArray of RGBA pixels
   * in top-left origin (ready for ImageData), un-premultiplied.
   *
   * GPU renderbuffers are capped (commonly 4096/8192/16384 depending on
   * hardware), so a one-shot render above the cap lands in a corner of the
   * oversized buffer. We render in sub-tiles that fit within the cap and
   * composite the pixels into the full-size buffer.
   */
  renderToPixels(width, height) {
    if (!this._webglAvailable) return null;
    this._ensureExportTexture(this._gl);
    const gl = this._gl;

    const gpuMax = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096;
    const tileCap = Math.min(4096, gpuMax);
    const tilesX = Math.ceil(width / tileCap);
    const tilesY = Math.ceil(height / tileCap);
    const baseTileW = Math.ceil(width / tilesX);
    const baseTileH = Math.ceil(height / tilesY);

    const prevW = this._lastWidth, prevH = this._lastHeight;
    this._forceDpr1 = true;

    // Scale the live composition proportionally into the export canvas so
    // cube geometry matches its on-screen relationship to the padded canvas.
    const liveRenderW = (this.p && this.p.width) || width;
    const liveLayoutW = (this._layoutCore && this._layoutCore.w) || liveRenderW;
    const liveLayoutH = (this._layoutCore && this._layoutCore.h) || ((this.p && this.p.height) || height);
    const scale = width / liveRenderW;
    this._layoutOverride = { w: liveLayoutW * scale, h: liveLayoutH * scale };

    // Stub target: _renderCore calls _getCtx / drawImage on it, but we
    // ignore that output entirely — pixels come from gl.readPixels below.
    const stubCanvas = (this._exportStubCanvas ||= document.createElement('canvas'));
    if (stubCanvas.width !== 1) stubCanvas.width = 1;
    if (stubCanvas.height !== 1) stubCanvas.height = 1;
    const stubTarget = {
      canvas: stubCanvas, elt: stubCanvas,
      drawingContext: stubCanvas.getContext('2d'),
      pixelDensity: () => 1,
    };

    const finalPixels = new Uint8ClampedArray(width * height * 4);

    for (let tyi = 0; tyi < tilesY; tyi++) {
      for (let txi = 0; txi < tilesX; txi++) {
        const tx0 = txi * baseTileW;
        const ty0 = tyi * baseTileH;
        const thisTileW = Math.min(baseTileW, width - tx0);
        const thisTileH = Math.min(baseTileH, height - ty0);

        this.resize(thisTileW, thisTileH);
        // Fake logical dims so _renderCore's auto-resize check doesn't fire
        // and snap the WebGL canvas back to the full export size.
        this._lastWidth = width;
        this._lastHeight = height;
        gl.disable(gl.SCISSOR_TEST);
        // Shift viewport so tile fb captures sub-region [tx0, ty0]..[tx0+w, ty0+h]
        // of the logical composition. Y math accounts for shader's ndc.y flip
        // and WebGL's bottom-up framebuffer.
        gl.viewport(-tx0, ty0 + thisTileH - height, width, height);

        this._renderCore(stubTarget, width, height, this._exportTexture);

        const tilePx = new Uint8Array(thisTileW * thisTileH * 4);
        gl.readPixels(0, 0, thisTileW, thisTileH, gl.RGBA, gl.UNSIGNED_BYTE, tilePx);

        for (let y = 0; y < thisTileH; y++) {
          const srcY = thisTileH - 1 - y;
          const srcBase = srcY * thisTileW * 4;
          const dstBase = ((ty0 + y) * width + tx0) * 4;
          for (let x = 0; x < thisTileW; x++) {
            const si = srcBase + x * 4;
            const di = dstBase + x * 4;
            const a = tilePx[si + 3];
            if (a > 0 && a < 255) {
              const inv = 255 / a;
              finalPixels[di]     = Math.min(255, Math.round(tilePx[si]     * inv));
              finalPixels[di + 1] = Math.min(255, Math.round(tilePx[si + 1] * inv));
              finalPixels[di + 2] = Math.min(255, Math.round(tilePx[si + 2] * inv));
            } else {
              finalPixels[di]     = tilePx[si];
              finalPixels[di + 1] = tilePx[si + 1];
              finalPixels[di + 2] = tilePx[si + 2];
            }
            finalPixels[di + 3] = a;
          }
        }
      }
    }

    this._layoutOverride = null;
    this._forceDpr1 = false;
    this.resize(prevW, prevH);

    return finalPixels;
  }

  renderToTarget(target, width, height) {
    if (!this._webglAvailable) return;
    const pixels = this.renderToPixels(width, height);
    if (!pixels) return;
    // Write to target's 2D canvas via putImageData. Works for both p5.Graphics
    // (target.drawingContext is a 2D context) and our plain-canvas stubs.
    const destCanvas = (target && target.canvas) || (target && target.elt);
    const ctx = (target && target.drawingContext) || (destCanvas && destCanvas.getContext && destCanvas.getContext('2d'));
    if (!ctx || !destCanvas) return;
    // Always composite via a temp canvas at the render size, then drawImage
    // into destCanvas. Handles both density-1 targets (1:1 copy) and retina
    // p5.Graphics backed by a 2× canvas (scales up to fill the full dest).
    const tmp = (this._exportTmpCanvas ||= document.createElement('canvas'));
    if (tmp.width !== width) tmp.width = width;
    if (tmp.height !== height) tmp.height = height;
    tmp.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, destCanvas.width, destCanvas.height);
    ctx.restore();
  }

  /**
   * Vector SVG export with GPU-accurate fills. Renders the scene at the live
   * canvas size, reads the framebuffer, and samples the rendered pixel at
   * each cube's centre to determine its fill color. This sidesteps the SVG
   * color-pipeline drift problem — the shader is the single source of truth.
   */
  exportSVG() {
    if (!this._webglAvailable) return '';
    const gl = this._gl;
    const cw = (this.p && this.p.width) || this._lastCanvasWidth || 0;
    const ch = (this.p && this.p.height) || this._lastCanvasHeight || 0;
    if (cw <= 0 || ch <= 0) return '';

    // Render at native canvas size with the normal (opaque) background so
    // sampled colors include any sizeFade/postFade blend with the bg.
    const prevW = this._lastWidth, prevH = this._lastHeight;
    this._forceDpr1 = true;
    this.resize(cw, ch);
    this._renderCore(this.p, cw, ch);
    this._forceDpr1 = false;

    const pixW = this._glCanvas.width;
    const pixH = this._glCanvas.height;
    const px = new Uint8Array(pixW * pixH * 4);
    gl.readPixels(0, 0, pixW, pixH, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // restore live size after readback
    this.resize(prevW, prevH);

    const data = this._instanceData;
    const count = this._lastInstanceCount || 0;
    const cubeW = this._lastCubeWidth || 0;
    const cubeH = this._lastCubeHeight || 0;
    if (count === 0 || cubeW <= 0) return '';

    const sx = pixW / cw, sy = pixH / ch;
    const sample = (x, y) => {
      const ix = Math.max(0, Math.min(pixW - 1, Math.round(x * sx)));
      // GL framebuffer is bottom-up — flip Y when sampling.
      const iy = Math.max(0, Math.min(pixH - 1, Math.round(pixH - 1 - y * sy)));
      const off = (iy * pixW + ix) * 4;
      return [px[off], px[off+1], px[off+2]];
    };
    const toHex = (r, g, b) =>
      '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

    // viewBox: pad for motion overshoot so cubes pushed past canvas edges are
    // not clipped. Mirrors the old SVG export's bounds calc.
    const state = stateManager.getRef();
    // Motion Scale is additive-only: clamp to ≥ Base Scale.
    const motionMax = Math.max((state.scaleMin ?? 100) / 100, (state.scaleMax ?? 150) / 100);
    const brightMin = (state.imageBrightnessScaleMin ?? 100) / 100;
    const brightMax = (state.imageBrightnessScaleMax ?? 100) / 100;
    const hasTexture = typeof imageSampler !== 'undefined' && imageSampler && imageSampler.hasImage();
    const overshoot = Math.max(1, motionMax, brightMin, brightMax);

    // Populate per-cell color cache so we can mirror the shader's transparent
    // discard (texSample.a < 0.5) and read brightness for Scale Dark/Light.
    // The WebGL live render path doesn't cache colors itself.
    let svgCols = 0, svgRows = 0;
    if (hasTexture) {
      svgCols = state.gridDensity || 60;
      const cubeHeight = cw / (svgCols * 4.4);
      const cubeHeightWithSpacing = cubeHeight + cubeHeight * 0.1;
      svgRows = Math.max(1, Math.ceil(ch / cubeHeightWithSpacing) + 1);
      imageSampler.cacheGridColors(svgCols, svgRows, cw, ch);
    }
    const padX = (cubeW * overshoot - cubeW) / 2 + cubeW * 0.05;
    const padY = (cubeH * overshoot - cubeH) / 2 + cubeH * 0.05;
    const minX = -padX, minY = -padY;
    const vbW = cw + 2 * padX, vbH = ch + 2 * padY;

    const cornerRadius = 25;
    const parts = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>\n`);
    parts.push(`<svg width="${vbW.toFixed(2)}" height="${vbH.toFixed(2)}" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">\n`);

    for (let i = 0; i < count; i++) {
      const off = i * INST_FLOATS;
      const cx = data[off];
      const cy = data[off + 1];
      const manualScale = data[off + 6];
      let imageScale = data[off + 7];

      // Mirror vertex shader: discard transparent texels and apply Scale Dark/Light.
      // Instance order skips masked-out cells, so derive the grid-cache index from
      // the cached gridUV (col/(cols-1), row/(rows-1)) rather than using `i`.
      if (hasTexture && svgCols > 0 && svgRows > 0) {
        const gridU = data[off + 4];
        const gridV = data[off + 5];
        const col = svgCols > 1 ? Math.round(gridU * (svgCols - 1)) : 0;
        const row = svgRows > 1 ? Math.round(gridV * (svgRows - 1)) : 0;
        const gridIndex = row * svgCols + col;
        const samp = imageSampler.getCachedColor(gridIndex);
        if (samp) {
          if ((samp.a ?? 255) < 128) continue;
          const br = isFinite(samp.brightness) ? samp.brightness : 0;
          imageScale *= brightMin + (brightMax - brightMin) * br;
        }
      }

      const totalScale = imageScale * manualScale;
      if (totalScale < 0.001) continue;
      if (cx < 0 || cx >= cw || cy < 0 || cy >= ch) continue;

      const [r, g, b] = sample(cx, cy);
      const fill = toHex(r, g, b);
      const d = this._getSquirclePath(cubeW * imageScale, cubeH * imageScale, cornerRadius);
      parts.push(`  <path d="${d}" transform="translate(${cx.toFixed(2)}, ${cy.toFixed(2)}) scale(${manualScale.toFixed(4)})" fill="${fill}" stroke="none"/>\n`);
    }
    parts.push(`</svg>`);
    return parts.join('');
  }

  dispose() {
    const gl = this._gl; if (!gl) return;
    [this._vao && gl.deleteVertexArray(this._vao),
     this._quadVBO && gl.deleteBuffer(this._quadVBO),
     this._instanceBuffer && gl.deleteBuffer(this._instanceBuffer),
     this._program && gl.deleteProgram(this._program),
     this._srcTexture && gl.deleteTexture(this._srcTexture),
     this._gradientTex && gl.deleteTexture(this._gradientTex),
     this._heatmapTex && gl.deleteTexture(this._heatmapTex),
     this._hueGradMapTex && gl.deleteTexture(this._hueGradMapTex),
     this._curveLUTTex && gl.deleteTexture(this._curveLUTTex),
     this._duotoneWarmTex && gl.deleteTexture(this._duotoneWarmTex),
     this._duotoneCoolTex && gl.deleteTexture(this._duotoneCoolTex),
     this._loopStartTex && gl.deleteTexture(this._loopStartTex),
     this._prevFrameTex && gl.deleteTexture(this._prevFrameTex),
     this._copyFramebuffer && gl.deleteFramebuffer(this._copyFramebuffer),
     this._cornerSDFTex && gl.deleteTexture(this._cornerSDFTex)];
    this._gl = null; this._glCanvas = null; this._webglAvailable = false;
  }
}


// ════════════════════════════════════════════════════════════════
// GLSL VERTEX SHADER
// ════════════════════════════════════════════════════════════════

const VERT_SRC = `#version 300 es
precision highp float;
precision highp int;

in vec2 a_position;
in vec2 a_offset;
in vec2 a_texUV;
in vec2 a_gridUV;
in float a_manualScale;
in float a_imageScale;

uniform vec2 u_resolution;
uniform vec2 u_cellSize;
uniform sampler2D u_srcTexture;
uniform sampler2D u_loopStartTexture;
uniform float u_loopFade;
uniform sampler2D u_prevTexture;
uniform float u_frameBlend;
uniform int u_hasTexture;
uniform float u_imgScaleMin;
uniform float u_imgScaleMax;

out vec2 v_uv;
flat out vec2 v_texUV;
flat out vec2 v_gridUV;
flat out float v_imageScale;
flat out float v_manualScale;

vec4 sampleSourceTexture(vec2 uv) {
  vec4 current = texture(u_srcTexture, uv);
  if (u_frameBlend < 1.0) {
    return mix(texture(u_prevTexture, uv), current, u_frameBlend);
  }
  return current;
}

void main() {
  v_uv = a_position + 0.5;
  v_texUV = a_texUV;
  v_gridUV = a_gridUV;
  v_manualScale = a_manualScale;

  float iScale = a_imageScale;

  // Scale Dark / Scale Light: modulate scale by texture brightness
  if (u_hasTexture == 1 && a_texUV.x >= 0.0) {
    vec4 texSample = sampleSourceTexture(a_texUV);
    if (texSample.a < 0.5) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; } // discard transparent
    vec3 tc = texSample.rgb;
    if (u_loopFade > 0.0) {
      vec3 startTc = texture(u_loopStartTexture, a_texUV).rgb;
      tc = mix(tc, startTc, u_loopFade);
    }
    float br = dot(tc, vec3(0.299, 0.587, 0.114));
    iScale *= u_imgScaleMin + (u_imgScaleMax - u_imgScaleMin) * br;
  }
  v_imageScale = iScale;

  vec2 size = u_cellSize * iScale * a_manualScale;
  vec2 pos = a_offset + a_position * size;
  vec2 ndc = pos / u_resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;


// ════════════════════════════════════════════════════════════════
// GLSL FRAGMENT SHADER
// ════════════════════════════════════════════════════════════════

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
flat in vec2 v_texUV;
flat in vec2 v_gridUV;
flat in float v_imageScale;
flat in float v_manualScale;

// Shape
uniform float u_cornerRadius;
uniform vec2 u_cellAspect;
uniform sampler2D u_cornerSDF;

// Texture
uniform sampler2D u_srcTexture;
uniform sampler2D u_loopStartTexture;
uniform float u_loopFade;
uniform sampler2D u_prevTexture;
uniform float u_frameBlend;
uniform int u_hasTexture;
uniform int u_textureVisible;
uniform float u_bgLuminance;
uniform float u_imageHueOffset;

// Scale-to-color
uniform int u_scaleHueShiftEnabled;
uniform float u_scaleHueRange;
uniform float u_brightnessVariance;
uniform float u_imgScaleMin, u_imgScaleMax;

// Palette
uniform int u_colorRemapEnabled;
uniform int u_colorSpace;
uniform int u_gradientMapEnabled;
uniform int u_paletteMode;
uniform float u_noiseScale, u_noisePersist, u_noiseLac, u_noiseSeedX, u_noiseSeedY;
uniform int u_noiseOctaves;
uniform sampler2D u_customGradient;
uniform sampler2D u_heatmapGradient;
uniform sampler2D u_hueGradMapTex;
uniform sampler2D u_curveLUT;

uniform int u_hueLayerEnabled;
uniform float u_hueLayerOffset, u_hueLayerOpacity;
uniform int u_hueLayerBlend;

uniform int u_intEnabled;
uniform float u_intAmount;
uniform int u_intQuant, u_intOrigDriver, u_intOutDriver, u_intMix;

uniform int u_hr1Enabled;
uniform float u_hr1Strength, u_hr1Start, u_hr1End, u_hr1Falloff, u_hr1SatOff, u_hr1LightOff;
uniform int u_hr2Enabled;
uniform float u_hr2Strength, u_hr2Start, u_hr2End, u_hr2Target, u_hr2Falloff, u_hr2SatOff, u_hr2LightOff;

uniform int u_hgmEnabled;
uniform float u_hgmStrength, u_hgmPhase;
uniform int u_hgmPreserveLight;

uniform float u_hcStrength, u_dominantHue;

uniform int u_gradeEnabled;
uniform float u_gradeTemp, u_gradeTint, u_gradeSat, u_gradeExp, u_gradeContrast, u_gradeHigh, u_gradeShadow;
uniform int u_gradeBlend;

uniform float u_imgBright, u_imgContrast, u_imgVibrancy;

uniform int u_cf0Enabled, u_cf1Enabled, u_cf2Enabled, u_cf3Enabled;
uniform int u_cf0Driver, u_cf1Driver, u_cf2Driver, u_cf3Driver;
uniform float u_cf0Start, u_cf1Start, u_cf2Start, u_cf3Start;
uniform float u_cf0End, u_cf1End, u_cf2End, u_cf3End;
uniform float u_cf0Strength, u_cf1Strength, u_cf2Strength, u_cf3Strength;
uniform vec3 u_cf0Target, u_cf1Target, u_cf2Target, u_cf3Target;
uniform int u_cf0Blend, u_cf1Blend, u_cf2Blend, u_cf3Blend;
uniform float u_cf0HueOff, u_cf1HueOff, u_cf2HueOff, u_cf3HueOff;

uniform int u_hueExEnabled;
uniform float u_hueExStart, u_hueExEnd;

// Duo Tone
uniform int u_duotoneEnabled;
uniform sampler2D u_duotoneWarmGradient;
uniform sampler2D u_duotoneCoolGradient;
// Tri Tone
uniform int u_tritoneEnabled;
uniform vec3 u_tritoneC1;
uniform vec3 u_tritoneC2;
uniform vec3 u_tritoneC3;
uniform vec3 u_tritoneGrey;
uniform float u_tritoneFadeGrey;

// PostFade
uniform int u_postFadeEnabled, u_postFadeDriver, u_postFadeBlendMode;
uniform vec3 u_postFadeTarget;
uniform float u_postFadeStart, u_postFadeEnd, u_postFadeStrength, u_postFadeOffset;

// SizeFade
uniform float u_sizeFade, u_sizeFadeCurve;
uniform vec3 u_bgColor;
uniform float u_motionScaleMin, u_motionScaleMax;

out vec4 fragColor;

// ═══ Color Conversions (all 0-1 range internally) ═══════════

vec3 rgbToHsl(vec3 c) {
  float mx = max(max(c.r,c.g),c.b), mn = min(min(c.r,c.g),c.b);
  float d = mx - mn, l = (mx+mn)*0.5;
  if(d < 0.001) return vec3(0.0, 0.0, l);
  float s = l>0.5 ? d/(2.0-mx-mn) : d/(mx+mn);
  float h;
  if(mx==c.r) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0);
  else if(mx==c.g) h=(c.b-c.r)/d+2.0;
  else h=(c.r-c.g)/d+4.0;
  return vec3(h/6.0, s, l);
}

float _h2r(float p,float q,float t){
  if(t<0.0)t+=1.0;if(t>1.0)t-=1.0;
  if(t<1.0/6.0)return p+(q-p)*6.0*t;
  if(t<0.5)return q;
  if(t<2.0/3.0)return p+(q-p)*(2.0/3.0-t)*6.0;
  return p;
}

vec3 hslToRgb(vec3 h) {
  if(h.y<0.001)return vec3(h.z);
  float q=h.z<0.5?h.z*(1.0+h.y):h.z+h.y-h.z*h.y;
  float p=2.0*h.z-q;
  return vec3(_h2r(p,q,h.x+1.0/3.0),_h2r(p,q,h.x),_h2r(p,q,h.x-1.0/3.0));
}

vec3 rgbToHsv(vec3 c) {
  float mx=max(max(c.r,c.g),c.b),mn=min(min(c.r,c.g),c.b);
  float d=mx-mn, s=mx<0.001?0.0:d/mx;
  float h=0.0;
  if(d>0.001){
    if(mx==c.r) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0);
    else if(mx==c.g) h=(c.b-c.r)/d+2.0;
    else h=(c.r-c.g)/d+4.0;
    h/=6.0;
  }
  return vec3(h,s,mx);
}

vec3 hsvToRgb(vec3 h) {
  float H=h.x*6.0, S=h.y, V=h.z;
  float i=floor(H), f=H-i;
  float p=V*(1.0-S), q=V*(1.0-f*S), t=V*(1.0-(1.0-f)*S);
  int ii=int(i)%6;
  if(ii==0)return vec3(V,t,p);if(ii==1)return vec3(q,V,p);
  if(ii==2)return vec3(p,V,t);if(ii==3)return vec3(p,q,V);
  if(ii==4)return vec3(t,p,V);return vec3(V,p,q);
}

// OkLCH conversion
vec3 rgbToOklch(vec3 c) {
  // sRGB to linear
  vec3 lin = mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(vec3(0.04045), c));
  // Linear to OKLab
  float l=0.4122214708*lin.r+0.5363325363*lin.g+0.0514459929*lin.b;
  float m=0.2119034982*lin.r+0.6806995451*lin.g+0.1073969566*lin.b;
  float s=0.0883024619*lin.r+0.2817188376*lin.g+0.6299787005*lin.b;
  l=sign(l)*pow(abs(l),1.0/3.0); m=sign(m)*pow(abs(m),1.0/3.0); s=sign(s)*pow(abs(s),1.0/3.0);
  float L=0.2104542553*l+0.7936177850*m-0.0040720468*s;
  float A=1.9779984951*l-2.4285922050*m+0.4505937099*s;
  float B=0.0259040371*l+0.7827717662*m-0.8086757660*s;
  float C=sqrt(A*A+B*B);
  float h=atan(B,A)*180.0/3.14159265;
  if(h<0.0)h+=360.0;
  return vec3(h/360.0, C/0.4, L); // h[0-1], s[0-1], l[0-1]
}

vec3 oklchToRgb(vec3 hsl) {
  float L=hsl.z, C=hsl.y*0.4, hRad=hsl.x*6.28318530;
  float A=C*cos(hRad), B=C*sin(hRad);
  float ll=L+0.3963377774*A+0.2158037573*B;
  float m=L-0.1055613458*A-0.0638541728*B;
  float s=L-0.0894841775*A-1.2914855480*B;
  ll=ll*ll*ll; m=m*m*m; s=s*s*s;
  vec3 lin=vec3(4.0767416621*ll-3.3077115913*m+0.2309699292*s,
                -1.2684380046*ll+2.6097574011*m-0.3413193965*s,
                -0.0041960863*ll-0.7034186147*m+1.7076147010*s);
  return clamp(mix(lin*12.92, 1.055*pow(max(lin,vec3(0.0)),vec3(1.0/2.4))-0.055, step(vec3(0.0031308),lin)), 0.0, 1.0);
}

vec3 toP(vec3 c){return u_colorSpace==1?rgbToOklch(c):rgbToHsl(c);}
vec3 fromP(vec3 h){return u_colorSpace==1?oklchToRgb(h):hslToRgb(h);}

vec4 sampleSourceTexture(vec2 uv) {
  vec4 current = texture(u_srcTexture, uv);
  if (u_frameBlend < 1.0) {
    return mix(texture(u_prevTexture, uv), current, u_frameBlend);
  }
  return current;
}

// ═══ Simplex 3D Noise ══════════════════════════════════════

vec3 _mod289v(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 _mod289v4(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 _perm(vec4 x){return _mod289v4(((x*34.0)+1.0)*x);}
vec4 _tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise3(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz),l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy),i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx,x2=x0-i2+C.yyy,x3=x0-0.5;
  i=_mod289v(i);
  vec4 p=_perm(_perm(_perm(i.z+vec4(0,i1.z,i2.z,1))+i.y+vec4(0,i1.y,i2.y,1))+i.x+vec4(0,i1.x,i2.x,1));
  vec3 ns=0.142857142857*vec3(2.0,1.0,0.0)-vec3(0.0,0.5,1.0);
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z),y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy,y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy),b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0,s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy,a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x),p1=vec3(a0.zw,h.y),p2=vec3(a1.xy,h.z),p3=vec3(a1.zw,h.w);
  vec4 norm=_tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float fbm2d(vec2 p,int oct,float pers,float lac){
  float val=0.0,amp=1.0,maxA=0.0,freq=1.0;
  for(int i=0;i<8;i++){
    if(i>=oct)break;
    val+=amp*snoise3(vec3(p*freq,0.0));
    maxA+=amp; freq*=lac; amp*=pers;
  }
  return val/maxA;
}

// ═══ Blend Modes ═══════════════════════════════════════════

vec3 blendMode(vec3 b, vec3 t, int m) {
  if(m==0)return t;
  if(m==1)return b*t;
  if(m==2)return 1.0-(1.0-b)*(1.0-t);
  if(m==3)return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,b));
  if(m==4)return mix(b-(1.0-2.0*t)*b*(1.0-b), b+(2.0*t-1.0)*(sqrt(b)-b), step(0.5,t));
  if(m==5)return mix(2.0*b*t, 1.0-2.0*(1.0-b)*(1.0-t), step(0.5,t));
  if(m==6)return min(b,t);
  if(m==7)return max(b,t);
  if(m==8)return min(vec3(1.0), b/max(1.0-t, vec3(0.001)));
  if(m==9)return max(vec3(0.0), 1.0-(1.0-b)/max(t, vec3(0.001)));
  if(m==10)return min(vec3(1.0),b+t);
  if(m==11)return abs(b-t);
  if(m>=12 && m<=15){
    vec3 bH=toP(b), tH=toP(t);
    vec3 r;
    if(m==12) r=vec3(tH.x,bH.y,bH.z);
    else if(m==13) r=vec3(bH.x,tH.y,bH.z);
    else if(m==14) r=vec3(tH.x,tH.y,bH.z);
    else r=vec3(bH.x,bH.y,tH.z);
    return fromP(r);
  }
  if(m==16)return mix(max(vec3(0),1.0-(1.0-b)/(2.0*max(t,vec3(0.001)))), min(vec3(1),b/(2.0*max(1.0-t,vec3(0.001)))), step(0.5,t));
  if(m==17)return b+2.0*t-1.0;
  if(m==18)return b+t-1.0;
  if(m==19)return b-t;
  if(m==20)return b/max(t,vec3(0.001));
  if(m==21)return b+t-2.0*b*t;
  if(m==22)return (b+t)*0.5;
  if(m==23)return b-t+0.5;
  if(m==24)return b+t-0.5;
  return t;
}

// ═══ SDF ═══════════════════════════════════════════════════

// Squircle rounded-box SDF. At smoothing=1 the corner transition spans 2r along each edge.
// Distance to the curve inside the corner region is sampled from u_cornerSDF (precomputed, R8).
// SDF texture stores signed distance in units of r, mapped [-2..+2] -> [0..1].
float sdRB(vec2 p,vec2 b,float r){
  vec2 v=b-abs(p); // >0 inside on that axis
  float cornerSpan=2.0*r;
  // Deep interior — far from any edge
  if(v.x>=cornerSpan && v.y>=cornerSpan) return -min(v.x,v.y);
  // Straight-edge strips (beyond corner span on the other axis)
  if(v.x>=cornerSpan) return -v.y;
  if(v.y>=cornerSpan) return -v.x;
  // Corner region (and past-tip). Sample SDF texture for v in [0, 2r]^2.
  vec2 vc=clamp(v,0.0,cornerSpan);
  vec2 uv=vc/cornerSpan;
  float s=texture(u_cornerSDF,uv).r;
  float dCurve=(s*4.0-2.0)*r;
  // If we were clamped (past the tip with v<0), extend distance outward
  float extra=length(v-vc);
  return dCurve+extra;
}

// ═══ Color Fade Helper ════════════════════════════════════

vec3 colorFade(vec3 c, int drv, float start, float end, float str, vec3 tgt, int bm, float hOff, bool hOffAllDrivers) {
  vec3 hsl = toP(c);
  float raw;
  if(drv==1) raw=hsl.y; else if(drv==2) raw=hsl.x; else raw=hsl.z;
  // Fades 1-3: hueOffset only applies to hue driver. Fade 4: applies to all drivers.
  float dv = (drv==2 || hOffAllDrivers) ? fract(raw + hOff) : raw;
  float mid=(start+end)*0.5, hw=(end-start)*0.5;
  float bl=0.0;
  if(hw>0.0){float d=abs(dv-mid); bl=d>=hw?0.0:str*(1.0-d/hw);}
  if(bl<=0.0)return c;
  vec3 blended=blendMode(c,tgt,bm);
  return mix(c,blended,bl);
}

// ═══ Hue Remap Helper ════════════════════════════════════

vec3 hueRemap(vec3 c, float str, float start, float end, float target, float falloff, float satOff, float lightOff, bool useTarget) {
  if(str<=0.0||start>=end) return c;
  vec3 hsl=toP(c);
  float hue=hsl.x*360.0;
  float ss=start-falloff, se=end+falloff;
  if(hue<ss||hue>se) return c;
  float ef=1.0;
  if(hue<start) ef=(hue-ss)/max(falloff,0.001);
  else if(hue>end) ef=(se-hue)/max(falloff,0.001);
  ef=ef*ef*(3.0-2.0*ef); // smoothstep
  float newH;
  if(useTarget){
    float dH=target-hue;
    if(dH>180.0)dH-=360.0; if(dH<-180.0)dH+=360.0;
    newH=hue+dH*str*ef;
  } else {
    float mid=(start+end)*0.5;
    float t2;
    if(hue<=mid) t2=min(1.0,(mid-hue)/max(mid-start,0.001));
    else t2=min(1.0,(hue-mid)/max(end-mid,0.001));
    float push=str*ef*(1.0-t2);
    float tgtH=hue<=mid?0.0:120.0;
    newH=hue+(tgtH-hue)*push;
  }
  hsl.x=mod(newH,360.0)/360.0;
  hsl.y=clamp(hsl.y+satOff*ef/100.0, 0.0, 1.0);
  hsl.z=clamp(hsl.z+lightOff*ef/100.0, 0.0, 1.0);
  return fromP(hsl);
}

// ═══ Main ═════════════════════════════════════════════════

void main() {
  // SDF
  vec2 p=(v_uv-0.5)*u_cellAspect;
  vec2 hs=u_cellAspect*0.5;
  float r=u_cornerRadius*min(hs.x,hs.y);
  float d=sdRB(p,hs,r);
  float aa=fwidth(d)*1.5;
  float alpha=1.0-smoothstep(-aa,0.0,d);
  if(alpha<0.002)discard;

  // Default fill color
  vec3 defColor = u_bgLuminance > 0.5 ? vec3(0.0) : vec3(1.0);
  vec3 color = defColor;
  float brightness = 1.0;

  // ── Texture Sampling ──
  if(u_hasTexture==1 && v_texUV.x>=0.0) {
    vec4 tx = sampleSourceTexture(v_texUV);
    if (tx.a < 0.5) discard;
    vec3 tc = tx.rgb;
    if (u_loopFade > 0.0) {
      vec3 startTc = texture(u_loopStartTexture, v_texUV).rgb;
      tc = mix(tc, startTc, u_loopFade);
    }

    // Hue offset with greyscale colorization
    if(u_imageHueOffset!=0.0) {
      vec3 hsl=rgbToHsl(tc);
      if(hsl.y<0.05) hsl.y=max(hsl.y, abs(u_imageHueOffset)/180.0*0.3);
      hsl.x=fract(hsl.x + u_imageHueOffset/360.0);
      tc=hslToRgb(hsl);
    }

    brightness = dot(tc, vec3(0.299, 0.587, 0.114));
    color = u_textureVisible==1 ? tc : defColor;
  }

  // ── Brightness Variance: apply before colour processing pipeline ──
  if(u_brightnessVariance != 0.0) {
    float ts = v_imageScale * v_manualScale;
    float scaleRange = max(u_motionScaleMax - u_motionScaleMin, 0.001);
    float t = clamp((ts - u_motionScaleMin) / scaleRange, 0.0, 1.0);
    if(u_brightnessVariance < 0.0) {
      float inv = 1.0 - t;
      float darken = inv * inv * (-u_brightnessVariance);
      float brighten = t * t * (-u_brightnessVariance) * 0.5;
      color *= (1.0 - darken) + brighten;
    } else {
      color *= 1.0 + t * u_brightnessVariance * 2.0;
    }
  }

  vec3 origColor = color; // saved for interference

  // ── Hue Variance: shift hue based on scale above scaleMin ──
  if(u_scaleHueShiftEnabled==1) {
    vec3 hsl=rgbToHsl(color);
    float scaleRange = max(u_motionScaleMax - u_motionScaleMin, 0.001);
    float t = clamp((v_imageScale * v_manualScale - u_motionScaleMin) / scaleRange, 0.0, 1.0);
    hsl.x=fract(hsl.x + t * u_scaleHueRange / 360.0);
    color=hslToRgb(hsl);
  }

  // ── PaletteProcessor Pipeline ──
  if(u_colorRemapEnabled==1) {

    // 1. Base color
    if(u_gradientMapEnabled==1) {
      if(u_paletteMode==0) {
        // Noise mode
        vec2 np = v_gridUV * u_noiseScale + vec2(u_noiseSeedX, u_noiseSeedY);
        float n = fbm2d(np, u_noiseOctaves, u_noisePersist, u_noiseLac) * 0.5 + 0.5;
        color = texture(u_customGradient, vec2(clamp(n,0.0,1.0), 0.5)).rgb;
      } else {
        // Heatmap mode
        color = texture(u_heatmapGradient, vec2(clamp(brightness,0.0,1.0), 0.5)).rgb;
      }
    }

    // 2. Hue layer
    if(u_hueLayerEnabled==1 && u_hueLayerOpacity>0.0) {
      vec3 hsl=toP(clamp(color,0.0,1.0));
      hsl.x=fract(hsl.x + u_hueLayerOffset/360.0);
      vec3 shifted=fromP(hsl);
      vec3 bl=blendMode(color, shifted, u_hueLayerBlend);
      color=mix(color, bl, u_hueLayerOpacity);
    }

    // 3. Interference
    if(u_intEnabled==1 && u_intAmount>0.0) {
      vec3 origHsl=toP(origColor);
      float ov;
      if(u_intOrigDriver==1) ov=origHsl.y; else if(u_intOrigDriver==2) ov=origHsl.x; else ov=origHsl.z;
      vec3 curHsl=toP(color);
      float t2;
      if(u_intOutDriver==2) t2=curHsl.x; else if(u_intOutDriver==1) t2=curHsl.y; else t2=curHsl.z;
      float res;
      if(u_intMix==0) res=fract(t2+ov*u_intAmount);
      else if(u_intMix==1){float f=1.0+(ov*2.0-1.0)*u_intAmount; res=fract(t2*f);}
      else if(u_intMix==2){float raw=t2+ov*u_intAmount*3.0; float pr=mod(raw,2.0); res=pr<=1.0?pr:2.0-pr;}
      else {int steps=7;int tQ=int(t2*float(steps));int cQ=int(ov*float(steps));int x=tQ^cQ; res=t2*(1.0-u_intAmount)+float(x)/float(steps)*u_intAmount;}
      res=clamp(res,0.0,1.0);
      if(u_intQuant>0) res=floor(res*float(u_intQuant)+0.5)/float(u_intQuant);
      color=texture(u_customGradient, vec2(res, 0.5)).rgb;
    }

    // 4. Hue remap 1
    if(u_hr1Enabled==1) color=hueRemap(color, u_hr1Strength, u_hr1Start, u_hr1End, 0.0, u_hr1Falloff, u_hr1SatOff, u_hr1LightOff, false);

    // 5. Hue remap 2
    if(u_hr2Enabled==1) color=hueRemap(color, u_hr2Strength, u_hr2Start, u_hr2End, u_hr2Target, u_hr2Falloff, u_hr2SatOff, u_hr2LightOff, true);

    // 6. Hue gradient map
    if(u_hgmEnabled==1 && u_hgmStrength>0.0) {
      vec3 hsl=toP(clamp(color,0.0,1.0));
      float t2=fract(hsl.x + u_hgmPhase);
      vec3 mapped=texture(u_hueGradMapTex, vec2(t2, 0.5)).rgb;
      if(u_hgmPreserveLight==1){vec3 mh=toP(mapped);mapped=fromP(vec3(mh.x,mh.y,hsl.z));}
      color=mix(color, mapped, u_hgmStrength);
    }

    // 7. Hue convergence
    if(u_hcStrength>0.0) {
      vec3 hsl=toP(clamp(color,0.0,1.0));
      float dH=u_dominantHue/360.0-hsl.x;
      if(dH>0.5)dH-=1.0; if(dH<-0.5)dH+=1.0;
      hsl.x=fract(hsl.x+dH*u_hcStrength);
      color=fromP(hsl);
    }

    // 8. Color grade
    if(u_gradeEnabled==1) {
      vec3 gc=color*255.0;
      gc.r+=u_gradeTemp*0.6; gc.b-=u_gradeTemp*0.6;
      gc.g-=u_gradeTint*0.4; gc.r+=u_gradeTint*0.1; gc.b+=u_gradeTint*0.1;
      float em=pow(2.0,u_gradeExp); gc*=em;
      if(u_gradeContrast!=0.0){float cf=max(0.01,(100.0+u_gradeContrast)/100.0); gc=(gc/255.0-0.5)*cf+0.5; gc*=255.0;}
      float lum=dot(gc,vec3(0.299,0.587,0.114))/255.0;
      if(u_gradeHigh!=0.0){float mk=clamp((lum-0.5)*2.0,0.0,1.0); gc+=u_gradeHigh*0.6*mk;}
      if(u_gradeShadow!=0.0){float mk=clamp(1.0-lum*2.0,0.0,1.0); gc+=u_gradeShadow*0.6*mk;}
      if(u_gradeSat!=1.0){vec3 hs=toP(clamp(gc/255.0,0.0,1.0));hs.y=clamp(hs.y*u_gradeSat,0.0,1.0);gc=fromP(hs)*255.0;}
      // Curves — texel-centered lookup to match CPU Math.round() indexing
      gc=clamp(gc/255.0,0.0,1.0);
      // Map [0,1] → texel index via round(v*255), then to texel center (i+0.5)/256
      float cr=texture(u_curveLUT,vec2((floor(gc.r*255.0+0.5)+0.5)/256.0,0.5)).r;
      float cg=texture(u_curveLUT,vec2((floor(gc.g*255.0+0.5)+0.5)/256.0,0.5)).g;
      float cb=texture(u_curveLUT,vec2((floor(gc.b*255.0+0.5)+0.5)/256.0,0.5)).b;
      // Master curve applied to channel outputs
      gc=vec3(
        texture(u_curveLUT,vec2((floor(cr*255.0+0.5)+0.5)/256.0,0.5)).a,
        texture(u_curveLUT,vec2((floor(cg*255.0+0.5)+0.5)/256.0,0.5)).a,
        texture(u_curveLUT,vec2((floor(cb*255.0+0.5)+0.5)/256.0,0.5)).a
      );
      vec3 graded=gc;
      color=clamp(blendMode(color, graded, u_gradeBlend),0.0,1.0);
    }

    // 9. Image adjust
    if(u_imgBright!=0.0||u_imgContrast!=0.0||u_imgVibrancy!=0.0) {
      vec3 ac=color;
      if(u_imgBright!=0.0) ac+=u_imgBright*2.55/255.0;
      if(u_imgContrast!=0.0){float cf=max(0.01,(100.0+u_imgContrast)/100.0); ac=(ac-0.5)*cf+0.5;}
      if(u_imgVibrancy!=0.0){vec3 hs=toP(clamp(ac,0.0,1.0)); float w=1.0-hs.y*hs.y; hs.y=clamp(hs.y+u_imgVibrancy*w,0.0,1.0); ac=fromP(hs);}
      color=clamp(ac,0.0,1.0);
    }

    // 10. Color fades (fades 1-3 apply hueOffset to hue driver only; fade 4 applies to all)
    if(u_cf0Enabled==1) color=colorFade(color,u_cf0Driver,u_cf0Start,u_cf0End,u_cf0Strength,u_cf0Target,u_cf0Blend,u_cf0HueOff,false);
    if(u_cf1Enabled==1) color=colorFade(color,u_cf1Driver,u_cf1Start,u_cf1End,u_cf1Strength,u_cf1Target,u_cf1Blend,u_cf1HueOff,false);
    if(u_cf2Enabled==1) color=colorFade(color,u_cf2Driver,u_cf2Start,u_cf2End,u_cf2Strength,u_cf2Target,u_cf2Blend,u_cf2HueOff,false);
    if(u_cf3Enabled==1) color=colorFade(color,u_cf3Driver,u_cf3Start,u_cf3End,u_cf3Strength,u_cf3Target,u_cf3Blend,u_cf3HueOff,true);

    // 11. Hue exclusion
    if(u_hueExEnabled==1) {
      float zs=u_hueExStart, ze=u_hueExEnd, zSize=ze-zs;
      if(zSize>0.0 && zSize<360.0) {
        vec3 hsl=toP(clamp(color,0.0,1.0));
        float allowed=360.0-zSize;
        float t2=(hsl.x*360.0/360.0)*allowed;
        float newH=t2<zs?t2:t2+zSize;
        hsl.x=mod(newH,360.0)/360.0;
        color=fromP(hsl);
      }
    }
  } else if(u_duotoneEnabled==1) {
    // ── Duo Tone (replaces full palette pipeline) ──
    float warm = clamp((color.r + 0.5 * color.g) / 1.5, 0.0, 1.0);
    float cool = clamp((color.b + 0.5 * color.g) / 1.5, 0.0, 1.0);
    vec3 warmCol = texture(u_duotoneWarmGradient, vec2(warm, 0.5)).rgb;
    vec3 coolCol = texture(u_duotoneCoolGradient, vec2(cool, 0.5)).rgb;
    color = (warmCol + coolCol) * 0.5;
  } else if(u_tritoneEnabled==1) {
    // ── Tri Tone ──
    float L = dot(color, vec3(0.299, 0.587, 0.114));
    float ws = max(0.0, 1.0 - 2.0*L);
    float wh = max(0.0, 2.0*L - 1.0);
    float wm = 1.0 - ws - wh;
    vec3 toned = u_tritoneC1*ws + u_tritoneC2*wm + u_tritoneC3*wh;
    if(u_tritoneFadeGrey > 0.0) {
      float thr = 0.66;
      float t = L >= thr ? 0.0 : (1.0 - L/thr);
      float k = u_tritoneFadeGrey * t;
      toned = mix(toned, u_tritoneGrey, k);
    }
    color = toned;
  }

  // ── PostFade ──
  if(u_postFadeEnabled==1) {
    float bl;
    if(u_postFadeDriver==4) {
      // Soft threshold fade: darks go grey first, wide gradient into lights
      vec3 hsl=rgbToHsl(color);
      float threshold = u_postFadeEnd;
      // Blend is 1.0 at luminance=0, fades to 0.0 at luminance=threshold
      // Beyond threshold, no blend
      bl = threshold > 0.0 ? u_postFadeStrength * (1.0 - smoothstep(0.0, threshold, hsl.z)) : 0.0;
    } else if(u_postFadeDriver==3) {
      // Size fade: smooth gradient from full fade at scaleMin to none at scaleMax
      float ts=v_imageScale*v_manualScale;
      float fadeRange = max(u_motionScaleMax - u_motionScaleMin, 0.001);
      bl = u_postFadeStrength * (1.0 - smoothstep(u_motionScaleMin, u_motionScaleMin + fadeRange * 0.15, ts));
    } else {
      vec3 hsl=rgbToHsl(color);
      float raw=u_postFadeDriver==1?hsl.y:u_postFadeDriver==2?hsl.x:hsl.z;
      float dv=fract(raw+u_postFadeOffset);
      float mid=(u_postFadeStart+u_postFadeEnd)*0.5, hw=(u_postFadeEnd-u_postFadeStart)*0.5;
      bl=0.0;
      if(hw>0.0){float dd=abs(dv-mid);bl=dd>=hw?0.0:u_postFadeStrength*(1.0-dd/hw);}
    }
    if(bl>0.0) color=mix(color, blendMode(color,u_postFadeTarget,u_postFadeBlendMode), bl);
  }

  // ── SizeFade: tiny tabs fade to background ──
  {
    float ns = clamp(v_imageScale * v_manualScale, 0.0, 1.0);
    color=mix(u_bgColor,color,ns);
  }

  fragColor=vec4(color*alpha, alpha);
}
`;
