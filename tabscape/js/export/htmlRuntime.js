/**
 * Tabscape HTML export runtime.
 *
 * This file is NOT loaded by the app. HTMLExporter fetches it as text and
 * inlines it into the exported .html, after the motion classes (SimplexNoise,
 * CursorTracker, RippleManager, BaseMode, RippleMode, AttractorMode).
 *
 * Rendering: one squircle base shape (the app's own SDF shader; the corner
 * SDF is rebuilt here from the Figma squircle maths) drawn as WebGL2
 * instances. Each instance only carries position, scale and a texel index,
 * so the whole grid is a single draw call.
 *
 * Colours come from a compact texture model: a low-res keyframe atlas the
 * shader interpolates in space and time, plus animated grain. The ring mask
 * (with Perlin noise + evolution) is computed live; custom masks are stored
 * once per cell.
 *
 * Expects window.__TABSCAPE__ = { meta, vert, frag, uniforms, textures, state,
 * motion } and base64(gzip(payload)) in <script id="tsmedia">.
 */
(async function () {
  'use strict';
  const D = window.__TABSCAPE__;
  const M = D.meta;
  const cols = M.cols, rows = M.rows, N = cols * rows;

  // ── Payload: [texture keyframes][valid cells][static mask?] ──
  const mediaEl = document.getElementById('tsmedia');
  const bin = atob(mediaEl.textContent.trim());
  mediaEl.remove();
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const payload = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const TX = M.tex, T = TX.gw * TX.gh;
  let po = 0;
  const texEnc = M.hasTexture ? payload.subarray(po, po += T * TX.K * 3) : null;
  const valid = payload.subarray(po, po += N);
  const staticMask = M.hasStaticMask ? payload.subarray(po, po += N) : null;
  // Keyframe atlas (gw x gh*K, RGBA): undo planar layout + temporal deltas.
  let atlas = null;
  if (texEnc) {
    atlas = new Uint8Array(T * TX.K * 4);
    let o = 0;
    for (let ch = 0; ch < 3; ch++) {
      for (let k = 0; k < TX.K; k++) {
        for (let t = 0; t < T; t++) {
          const prev = k > 0 ? atlas[((k - 1) * T + t) * 4 + ch] : 0;
          atlas[(k * T + t) * 4 + ch] = (prev + texEnc[o++]) & 255;
        }
      }
    }
    for (let i = 0; i < T * TX.K; i++) atlas[i * 4 + 3] = 255;
  }

  // Squircle corner SDF (same construction as WebGLGridRenderer._buildCornerSDFTexture:
  // box 4x4, radius 1, smoothing 1 -> two cubics per corner, no arc).
  const buildCornerSDF = () => {
    const R = 128, SEG = 64;
    const toRad = (d) => d * Math.PI / 180;
    const rad = 1, sm = 1, p = 2;
    const arcMeasure = 90 * (1 - sm);
    const arcLen = Math.sin(toRad(arcMeasure / 2)) * rad * Math.SQRT2;
    const alpha = (90 - arcMeasure) / 2;
    const p34 = rad * Math.tan(toRad(alpha / 2));
    const beta = 45 * sm;
    const c = p34 * Math.cos(toRad(beta)), d = c * Math.tan(toRad(beta));
    const b = (p - arcLen - c - d) / 3, a = 2 * b;
    const pts = [];
    const cubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG, m = 1 - t;
        const x = m * m * m * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3;
        const y = m * m * m * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3;
        pts.push({ x: 4 - x, y });
      }
    };
    const x0 = 4 - p, y0 = 0;
    cubic(x0, y0, x0 + a, 0, x0 + a + b, 0, x0 + a + b + c, d);
    const x1 = x0 + a + b + c + arcLen, y1 = d + arcLen;
    cubic(x1, y1, x1 + d, y1 + c, x1 + d, y1 + b + c, x1 + d, y1 + a + b + c);
    const poly = [{ x: 0, y: 0 }, ...pts, { x: 0, y: 0 }];
    const pip = (px, py) => {
      let ins = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi)) ins = !ins;
      }
      return ins;
    };
    const out = new Uint8Array(R * R * 4);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const vx = i / (R - 1) * 2, vy = j / (R - 1) * 2;
      let min = Infinity;
      for (let k = 0; k < pts.length - 1; k++) {
        const p0 = pts[k], p1 = pts[k + 1], dx = p1.x - p0.x, dy = p1.y - p0.y, l2 = dx * dx + dy * dy;
        if (l2 < 1e-12) continue;
        const t = Math.max(0, Math.min(1, ((vx - p0.x) * dx + (vy - p0.y) * dy) / l2));
        const qx = p0.x + t * dx - vx, qy = p0.y + t * dy - vy, d2 = qx * qx + qy * qy;
        if (d2 < min) min = d2;
      }
      const dist = Math.sqrt(min) * (pip(vx, vy) ? 1 : -1);
      out[(j * R + i) * 4] = Math.round(Math.max(0, Math.min(1, (dist + 2) / 4)) * 255);
      out[(j * R + i) * 4 + 3] = 255;
    }
    return { w: R, h: R, data: out };
  };

  // ── Canvas / GL ──
  const canvas = document.getElementById('tabscape');
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) { document.body.textContent = 'WebGL2 is required.'; return; }

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, D.vert));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, D.frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  // Restore every uniform captured from the app
  const U = {};
  const uloc = (name) => (name in U) ? U[name] : (U[name] = gl.getUniformLocation(prog, name));
  for (const [name, { k, v }] of Object.entries(D.uniforms)) {
    const l = uloc(name); if (!l) continue;
    if (k === 'f') gl.uniform1f(l, v);
    else if (k === 'f2') gl.uniform2fv(l, v);
    else if (k === 'f3') gl.uniform3fv(l, v);
    else if (k === 'f4') gl.uniform4fv(l, v);
    else if (k === 'i') gl.uniform1i(l, v);
  }

  // Textures
  const makeTex = (unit, filter) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    return t;
  };
  const sdf = buildCornerSDF();
  for (let unit = 1; unit <= 8; unit++) {
    const info = D.textures[unit];
    if (unit === 8) {
      makeTex(8, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sdf.w, sdf.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, sdf.data);
      continue;
    }
    makeTex(unit, (unit === 4 || unit === 7) ? gl.NEAREST : gl.LINEAR);
    if (!info) continue;
    if (info.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, info.w, info.h, 0, gl.RGBA, gl.FLOAT, new Float32Array(info.data));
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, info.w, info.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(info.data));
  }
  // Unit 0 = texture keyframe atlas (LINEAR = bilinear between texels)
  makeTex(0, gl.LINEAR);
  if (atlas) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TX.gw, TX.gh * TX.K, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  makeTex(9, gl.NEAREST);
  gl.uniform1i(uloc('u_srcTexture'), 0);
  gl.uniform1i(uloc('u_prevTexture'), 9);
  gl.uniform1f(uloc('u_loopFade'), 0);
  gl.uniform1f(uloc('u_frameBlend'), 1);
  gl.uniform2f(uloc('u_atlasScale'), cols / (TX.d * TX.gw), rows / (TX.d * TX.gh));
  gl.uniform2f(uloc('u_cells'), cols, rows);
  gl.uniform1i(uloc('u_hasTexture'), M.hasTexture ? 1 : 0);
  gl.uniform2f(uloc('u_resolution'), M.canvasW, M.canvasH);

  // Geometry: one unit quad (the base tab) + per-instance attributes
  const INST = 8;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_position');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  const inst = new Float32Array(N * INST);
  gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
  [['a_offset', 2, 0], ['a_texUV', 2, 8], ['a_gridUV', 2, 16], ['a_manualScale', 1, 24], ['a_imageScale', 1, 28]]
    .forEach(([name, size, off]) => {
      const loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, INST * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    });
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // Static per-cell data
  const cellStepX = M.cubeWidth + M.spacingX, cellStepY = M.cubeHeight + M.spacingY;
  const halfCW = M.cubeWidth / 2, halfCH = M.cubeHeight / 2;
  const homeX = new Float32Array(N), homeY = new Float32Array(N);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    homeX[i] = M.offsetX + (r % 2 === 1 ? cellStepX * 0.5 : 0) + c * cellStepX + halfCW;
    homeY[i] = M.offsetY + r * cellStepY + halfCH;
  }

  // ── Live ring mask (mirrors MaskProcessor.computeRingMask) ──
  // p5-style Perlin noise with a seeded table: same character as the app,
  // not the same random pattern (the app's table is random per session).
  const perlin = (() => {
    let a = 0x9e3779b9;
    const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const P = new Float32Array(4096);
    for (let i = 0; i < 4096; i++) P[i] = rnd();
    return P;
  })();
  const sc = (i) => 0.5 * (1 - Math.cos(i * Math.PI));
  const noise3 = (x, y, z) => {
    x = Math.abs(x); y = Math.abs(y); z = Math.abs(z);
    let xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let xf = x - xi, yf = y - yi, zf = z - zi, r = 0, amp = 0.5;
    for (let o = 0; o < 4; o++) {
      let of = xi + (yi << 4) + (zi << 8);
      const rx = sc(xf), ry = sc(yf);
      let n1 = perlin[of & 4095]; n1 += rx * (perlin[(of + 1) & 4095] - n1);
      let n2 = perlin[(of + 16) & 4095]; n2 += rx * (perlin[(of + 17) & 4095] - n2);
      n1 += ry * (n2 - n1);
      of += 256;
      n2 = perlin[of & 4095]; n2 += rx * (perlin[(of + 1) & 4095] - n2);
      let n3 = perlin[(of + 16) & 4095]; n3 += rx * (perlin[(of + 17) & 4095] - n3);
      n2 += ry * (n3 - n2);
      n1 += sc(zf) * (n2 - n1);
      r += n1 * amp; amp *= 0.5;
      xi <<= 1; xf *= 2; yi <<= 1; yf *= 2; zi <<= 1; zf *= 2;
      if (xf >= 1) { xi++; xf--; } if (yf >= 1) { yi++; yf--; } if (zf >= 1) { zi++; zf--; }
    }
    return r;
  };
  const ringBuf = new Float32Array(N);
  const innerLUT = new Float32Array(64), outerLUT = new Float32Array(64);
  const ringMask = (evo) => {
    const st = state;
    const ringScale = M.layoutW / 1400;
    const radius = (st.maskRingRadius ?? 200) * ringScale;
    const half = (st.maskRingThickness ?? 100) * ringScale / 2;
    const inW = (st.maskInnerSoftness ?? 100) / 100 * half, outW = (st.maskOuterSoftness ?? 100) / 100 * half;
    const innerN = (st.maskRingInnerNoise ?? 0) * ringScale, outerN = (st.maskRingOuterNoise ?? 0) * ringScale;
    const noisy = innerN > 0 || outerN > 0;
    if (noisy) {
      const ns = st.maskRingNoiseScale ?? 0.5, so = (st.maskNoiseSeed ?? 0) * 7.31;
      for (let b = 0; b < 64; b++) {
        const ang = b * (2 * Math.PI / 64) - Math.PI, nx = Math.cos(ang) * ns, ny = Math.sin(ang) * ns;
        innerLUT[b] = (noise3(nx + 50 + so, ny + 50 + so, evo) - 0.5) * 2;
        outerLUT[b] = (noise3(nx + 150 + so, ny + 150 + so, evo + 17.3) - 0.5) * 2;
      }
    }
    const cx = W / 2, cy = H / 2;
    for (let i = 0; i < N; i++) {
      const dx = homeX[i] - cx, dy = homeY[i] - cy, dist = Math.sqrt(dx * dx + dy * dy);
      let ie = radius - half, oe = radius + half;
      if (noisy && dist > 0.001) {
        const b = Math.round((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 64) % 64;
        ie += innerLUT[b] * innerN; oe += outerLUT[b] * outerN;
      }
      const is = ie - inW * 0.7, iend = ie + inW * 0.3, os = oe - outW * 0.3, oend = oe + outW * 0.7;
      let v = 0;
      if (dist >= iend && dist <= os) v = 1;
      else if (dist >= is && dist < iend && inW > 0) { const t = (dist - is) / inW; v = t * t * (3 - 2 * t); }
      else if (dist > os && dist <= oend && outW > 0) { const t = (oend - dist) / outW; v = t * t * (3 - 2 * t); }
      ringBuf[i] = v;
    }
    return ringBuf;
  };

  // ── State + motion timeline ──
  const state = Object.assign({}, D.state);
  const motion = D.motion;
  const bezierY = (x, p1x, p1y, p2x, p2y) => {
    const cubic = (t, a, b, c, d) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 20; i++) {
      const cx = cubic(t, 0, p1x, p2x, 1);
      if (Math.abs(cx - x) < 0.001) break;
      if (cx < x) lo = t; else hi = t;
      t = (hi + lo) / 2;
    }
    return cubic(t, 0, p1y, p2y, 1);
  };
  const parseEase = (e) => {
    if (!e || e === 'linear') return null;
    if (e === 'ease-in-out') return [0.42, 0, 0.58, 1];
    const p = String(e).split(',').map(s => parseFloat(s.trim()));
    return p.length === 4 && p.every(Number.isFinite) ? p : null;
  };
  const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  const mix = (a, b, t) => {
    const an = parseFloat(a), bn = parseFloat(b);
    if (Number.isFinite(an) && Number.isFinite(bn) && String(a).trim() !== '' && String(b).trim() !== '') return an + (bn - an) * t;
    if (isHex(a) && isHex(b)) {
      const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
      return '#' + [1, 3, 5].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0')).join('');
    }
    return t < 1 ? a : b;
  };
  const sampleTrack = (tr, time) => {
    const k = tr.keyframes;
    if (k.length === 1 || time <= k[0].time) return k[0].value;
    if (time >= k[k.length - 1].time) return k[k.length - 1].value;
    for (let i = 0; i < k.length - 1; i++) {
      const a = k[i], b = k[i + 1];
      if (time < a.time || time > b.time) continue;
      const span = b.time - a.time;
      let t = span <= 0 ? 1 : (time - a.time) / span;
      const bz = parseEase(a.easing);
      if (bz) t = bezierY(t, bz[0], bz[1], bz[2], bz[3]);
      let v = mix(a.value, b.value, t);
      if (typeof v === 'number' && tr.step) v = Math.round(v / tr.step) * tr.step;
      return v;
    }
    return k[k.length - 1].value;
  };
  let motionTime = motion ? (motion.currentTime || 0) : 0;
  const applyMotion = () => {
    if (!motion) return;
    for (const tr of motion.tracks) state[tr.key] = sampleTrack(tr, motionTime);
  };

  // ── Physics (mirrors GridRenderer._updateCore / getGridInfo) ──
  rippleManager = new RippleManager();
  const modes = { ripple: new RippleMode(rippleManager, cursorTracker), attractor: new AttractorMode(cursorTracker) };
  let activeModeName = null, activeMode = null;
  let push = [], scaleValues = [], lastGridSize = 0;
  const smoothParams = { scaleMin: 8, scaleMax: 8, brightnessVariance: 8 };
  const smooth = {};
  const W = M.canvasW, H = M.canvasH;

  const getGridInfo = () => {
    const c = state.gridDensity || 60;
    const ch = M.layoutW / (c * 4.4), cw = ch * 4, sx = ch * 0.1, sy = ch * 0.1;
    const r = Math.ceil(M.layoutH / (ch + sy)) + 1;
    const tw = c * cw + (c - 1) * sx, th = r * ch + (r - 1) * sy;
    const gx = state.gridOffsetX ?? 50, gy = state.gridOffsetY ?? 50;
    return { cols: c, rows: r, gridSize: c * r, cubeWidth: cw, cubeHeight: ch, spacingX: sx, spacingY: sy,
      offsetX: (W - tw) * (gx / 100), offsetY: (H - th) * (gy / 100), canvasWidth: W, canvasHeight: H };
  };
  const setMode = (name) => {
    if (activeMode) activeMode.deactivate();
    for (let i = 0; i < push.length; i++) { push[i].x = 0; push[i].y = 0; scaleValues[i] = 1; }
    activeModeName = name;
    activeMode = name === 'attractor' ? modes.attractor : modes.ripple;
    activeMode.activate(getGridInfo());
  };
  const updatePhysics = (dt) => {
    const c = state.gridDensity || 60;
    const chU = W / (c * 4.4);
    const gridSize = c * (Math.ceil(H / (chU * 1.1)) + 1);
    if (gridSize !== lastGridSize) {
      push = []; scaleValues = [];
      for (let i = 0; i < gridSize; i++) { push.push({ x: 0, y: 0 }); scaleValues.push(1); }
      lastGridSize = gridSize;
    }
    if (activeMode.usesDecay !== false) {
      const step = Math.pow(state.pushDecay || 0.92, dt * 60);
      for (let i = 0; i < push.length; i++) { push[i].x *= step; push[i].y *= step; }
    }
    for (const key in smoothParams) {
      const target = parseFloat(state[key]);
      if (isNaN(target)) continue;
      smooth[key] = smooth[key] == null ? target : smooth[key] + (target - smooth[key]) * Math.min(1, smoothParams[key] * dt);
    }
    activeMode.update(dt, state, getGridInfo(), push, scaleValues);
  };
  const sm = (key, fallback) => smooth[key] != null ? smooth[key] : (parseFloat(state[key]) || fallback);

  // ── Layout + input ──
  let dpr = 1, rect = { x: 0, y: 0, w: 1, h: 1 };
  const layout = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = window.innerWidth, vh = window.innerHeight;
    // Fit the composition (not the motion padding around it) to the window,
    // like the app: the padding spills past the viewport edges.
    const s = Math.min(vw / M.layoutW, vh / M.layoutH);
    const padX = (W - M.layoutW) / 2, padY = (H - M.layoutH) / 2;
    rect = { w: W * s, h: H * s, x: (vw - M.layoutW * s) / 2 - padX * s, y: (vh - M.layoutH * s) / 2 - padY * s };
    canvas.style.width = rect.w + 'px'; canvas.style.height = rect.h + 'px';
    canvas.style.left = rect.x + 'px'; canvas.style.top = rect.y + 'px';
    canvas.width = Math.round(rect.w * dpr); canvas.height = Math.round(rect.h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  window.addEventListener('resize', layout);
  layout();

  let mouseX = -1e5, mouseY = -1e5, paused = false;
  const toCanvas = (e) => ({ x: (e.clientX - rect.x) / rect.w * W, y: (e.clientY - rect.y) / rect.h * H });
  const inside = (p) => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
  window.addEventListener('pointermove', (e) => { const p = toCanvas(e); mouseX = p.x; mouseY = p.y; });
  // Like the app: active whenever the pointer is over the canvas (checked per
  // frame), inactive once it leaves the page.
  document.addEventListener('pointerleave', () => { mouseX = mouseY = -1e5; cursorTracker.setActive(false); });
  window.addEventListener('blur', () => cursorTracker.setActive(false));
  window.addEventListener('pointerdown', (e) => {
    const p = toCanvas(e); mouseX = p.x; mouseY = p.y;
    if (!paused && inside(p)) activeMode.onMousePressed(p.x, p.y, state);
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    paused = !paused;
    Object.values(modes).forEach(m => m.setPaused(paused));
    rippleManager.setPaused(paused);
    if (paused) cursorTracker.freeze(); else cursorTracker.unfreeze();
  });

  // ── Frame loop ──
  const bg = D.state.backgroundColor || '#FFFEF7';
  const bgR = parseInt(bg.slice(1, 3), 16) / 255, bgG = parseInt(bg.slice(3, 5), 16) / 255, bgB = parseInt(bg.slice(5, 7), 16) / 255;
  const pushScale = M.layoutW / W;
  let last = performance.now(), texTime = 0, evoPhase = 0;
  applyMotion();
  setMode(state.effectMode === 'attractor' ? 'attractor' : 'ripple');

  // Small public handle: tweak motion params live, e.g. tabscape.state.cursorRadius = 400
  window.tabscape = { state, get pushOffsets() { return push; }, get paused() { return paused; } };

  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (!paused) {
      if (motion && motion.duration > 0) {
        motionTime = (motionTime + dt) % motion.duration;
        applyMotion();
        const wanted = state.effectMode === 'attractor' ? 'attractor' : 'ripple';
        if (wanted !== activeModeName) setMode(wanted);
      }
      cursorTracker.update(mouseX, mouseY, dt);
      if (inside({ x: mouseX, y: mouseY }) && !cursorTracker.isActive) cursorTracker.setActive(true);
      if (rippleManager.hasActiveRipples()) rippleManager.update(state.rippleSpeed || 300);
      updatePhysics(dt);
      texTime += dt;
      evoPhase += dt * Math.max(0, Math.min(1, parseFloat(state.maskNoiseEvolutionSpeed) || 0));
    }

    // Texture model time: keyframe k is centred at (k + 0.5) / K of the loop.
    if (TX.K > 1) {
      let kp = (texTime % M.duration) / M.duration * TX.K - 0.5;
      kp = ((kp % TX.K) + TX.K) % TX.K;
      gl.uniform4f(uloc('u_kf'), TX.K, kp, TX.gh, TX.amp);
    } else {
      gl.uniform4f(uloc('u_kf'), 1, 0, TX.gh, TX.amp);
    }
    gl.uniform1f(uloc('u_time'), texTime);
    const mask = M.maskMode === 'tabloop' ? ringMask(evoPhase) : null;
    const mScale = M.maskMax / 255;

    // Motion-driven uniforms (may be keyframed)
    const sMin = sm('scaleMin', 100) / 100;
    const sMax = Math.max(sMin, sm('scaleMax', 150) / 100);
    gl.uniform1f(uloc('u_motionScaleMin'), sMin);
    gl.uniform1f(uloc('u_motionScaleMax'), sMax);
    gl.uniform1f(uloc('u_brightnessVariance'), (smooth.brightnessVariance ?? (state.brightnessVariance || 0)) / 100);
    gl.uniform1i(uloc('u_scaleHueShiftEnabled'), (state.scaleHueRange ?? 0) > 0 ? 1 : 0);
    gl.uniform1f(uloc('u_scaleHueRange'), state.scaleHueRange ?? 60);

    // Instances: one copy of the base tab per cell (position, scale, texel)
    let count = 0;
    for (let r = 0; r < rows; r++) {
      const gridV = rows > 1 ? r / (rows - 1) : 0.5;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!valid[i]) continue;
        const m = mask ? mask[i] : staticMask ? staticMask[i] * mScale : 1;
        if (m <= 0) continue;
        const p = push[i];
        const px = p ? p.x : 0, py = p ? p.y : 0;
        const influence = Math.min(1, Math.sqrt(px * px + py * py) / 50);
        const s = (sMin + (sMax - sMin) * influence) * m;
        if (s < 0.001) continue;
        const off = count * INST;
        inst[off] = homeX[i] + px * pushScale;
        inst[off + 1] = homeY[i] + py * pushScale;
        inst[off + 2] = M.hasTexture ? (c + 0.5) / cols : -1;
        inst[off + 3] = M.hasTexture ? (r + 0.5) / rows : -1;
        inst[off + 4] = cols > 1 ? c / (cols - 1) : 0.5;
        inst[off + 5] = gridV;
        inst[off + 6] = 1;
        inst[off + 7] = s;
        count++;
      }
    }

    gl.clearColor(bgR, bgG, bgB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count > 0) {
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, count * INST));
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})().catch((err) => {
  console.error(err);
  document.body.textContent = 'Tabscape export failed to start: ' + (err && err.message);
});
