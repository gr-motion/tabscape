/**
 * GridRenderer - Base class providing grid layout, mode management,
 * smooth parameter interpolation, and SVG export.
 * Rendering is handled by WebGLGridRenderer (GPU only).
 */
class GridRenderer {
  constructor(p5Instance) {
    this.p = p5Instance;
    this.shapes = [];
    this.time = 0;
    this._noiseEvolutionPhase = 0;
    this._lastNoiseEvolutionTick = 0;
    this._lastNoiseEvolutionRenderTime = 0;

    // Cache for grid offset
    this._gridOffset = { x: 0, y: 0 };

    // Squircle path cache
    this._squircleCache = null;
    this._squircleCacheKey = '';

    // Canvas2D context — used for blit from WebGL
    this._ctx = null;
    this._dpr = 1;

    // Cached position arrays
    this._posX = null;
    this._posY = null;
    this._lastGridKey = '';

    // Per-shape push offsets for motion effects (persists and decays)
    this._pushOffsets = [];
    this._lastGridSize = 0;

    // Per-shape scale values (written by active mode)
    this._scaleValues = [];

    // Active effect mode (AttractorMode)
    this._activeMode = null;

    // Pause state
    this._isPaused = false;
    this._frozenBasePush = [];

    // Manual scale offsets (modified by click+drag when paused)
    this._manualScaleOffsets = [];

    // Smooth state: exponential interpolation toward target for selected parameters
    this._smoothState = {};
    this._smoothParams = {
      scaleMin: 8,
      scaleMax: 8,
      imageBrightnessScaleMin: 8,
      imageBrightnessScaleMax: 8,
      brightnessVariance: 8,
      sizeFade: 8,
      sizeFadeCurve: 8,
      hmOrigAmount: 8,
    };

    // Mask processor (set by App.js)
    this._maskProcessor = null;
  }

  /**
   * Set paused state
   */
  setPaused(paused) {
    if (paused && !this._isPaused) {
      this._frozenBasePush = this._pushOffsets.map(p => ({ x: p.x, y: p.y }));
    } else if (!paused && this._isPaused) {
      this._frozenBasePush = [];
    }
    this._isPaused = paused;
    if (this._activeMode) {
      this._activeMode.setPaused(paused);
    }
  }

  /**
   * Set the active effect mode
   */
  setMode(mode) {
    if (this._activeMode) {
      this._activeMode.deactivate();
    }
    for (let i = 0; i < this._pushOffsets.length; i++) {
      this._pushOffsets[i].x = 0;
      this._pushOffsets[i].y = 0;
      this._scaleValues[i] = 1;
    }
    this._activeMode = mode;
    if (mode) {
      mode.activate(this.getGridInfo());
    }
  }

  /**
   * Get current grid layout info for mode computations
   */
  getGridInfo() {
    const p = this.p;
    const state = stateManager.getRef();
    const cols = state.gridDensity || 60;
    // Cube size + grid extent are keyed to the unpadded composition
    // (layoutCore) so motion padding doesn't shift cube positions out from
    // under the cursor — must match what WebGLGridRenderer renders with.
    const layoutW = (this._layoutCore && this._layoutCore.w) || p.width;
    const layoutH = (this._layoutCore && this._layoutCore.h) || p.height;
    const cubeHeight = layoutW / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1;
    const spacingY = cubeHeight * 0.1;
    const rows = Math.ceil(layoutH / (cubeHeight + spacingY)) + 1;
    const gridSize = cols * rows;

    const totalWidth = cols * cubeWidth + (cols - 1) * spacingX;
    const totalHeight = rows * cubeHeight + (rows - 1) * spacingY;

    const gridOffsetX = state.gridOffsetX ?? 50;
    const gridOffsetY = state.gridOffsetY ?? 50;
    const offsetX = (p.width - totalWidth) * (gridOffsetX / 100);
    const offsetY = (p.height - totalHeight) * (gridOffsetY / 100);

    return {
      cols, rows, gridSize,
      cubeWidth, cubeHeight, spacingX, spacingY,
      offsetX, offsetY,
      canvasWidth: p.width, canvasHeight: p.height
    };
  }

  /**
   * Apply manual scale at a position (click+drag when paused)
   */
  applyManualScale(mouseX, mouseY, isGrow, deltaTime) {
    const state = stateManager.getRef();
    const cols = state.gridDensity || 60;
    const layoutW = (this._layoutCore && this._layoutCore.w) || this.p.width;
    const cubeHeight = layoutW / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1;
    const spacingY = cubeHeight * 0.1;
    const rows = Math.ceil(this.p.height / (cubeHeight + spacingY)) + 1;
    const radius = 150;
    const rate = isGrow ? 2.0 : -2.0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        if (index >= this._posX.length) continue;
        const cx = this._posX[index] + cubeWidth / 2;
        const cy = this._posY[index] + cubeHeight / 2;
        const dx = mouseX - cx;
        const dy = mouseY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < radius) {
          const falloff = 1 - (dist / radius);
          const current = this._manualScaleOffsets[index] ?? 1;
          this._manualScaleOffsets[index] = Math.max(0.01, current + rate * falloff * deltaTime);
        }
      }
    }
  }

  /**
   * Reset manual scale offsets
   */
  resetManualScaleOffsets() {
    for (let i = 0; i < this._manualScaleOffsets.length; i++) {
      this._manualScaleOffsets[i] = 1.0;
    }
  }

  /**
   * Update the grid based on current state (live / interactive path).
   * Skipped during export — export drives timing via updateForExport().
   */
  update() {
    if (this._exportInProgress) return;
    const deltaTime = this.p.deltaTime / 1000;
    this._updateCore(deltaTime);
  }

  /**
   * Export-driven update: uses exact frame duration so motion speed is
   * deterministic and resolution-independent.
   */
  updateForExport(frameDuration) {
    this._updateCore(frameDuration);
  }

  /**
   * Shared update logic for both live and export paths.
   * Always uses live canvas dimensions for spatial calculations so that
   * pixel-based parameters (cursorRadius, noiseStrength, etc.) produce
   * consistent proportions. The renderer's pushScale handles mapping
   * offsets to the export resolution.
   */
  _updateCore(deltaTime) {
    this.time += deltaTime;

    const state = stateManager.getRef();
    const cols = state.gridDensity || 60;
    const cubeHeightU = this.p.width / (cols * 4.4);
    const rows = Math.ceil(this.p.height / (cubeHeightU * 1.1)) + 1;
    const gridSize = cols * rows;

    // Initialize or resize push offsets and scale values arrays
    if (gridSize !== this._lastGridSize) {
      this._pushOffsets = [];
      this._scaleValues = [];
      this._manualScaleOffsets = [];
      for (let i = 0; i < gridSize; i++) {
        this._pushOffsets.push({ x: 0, y: 0 });
        this._scaleValues.push(1);
        this._manualScaleOffsets.push(1.0);
      }
      this._lastGridSize = gridSize;
    }

    // Apply decay to push offsets only if the active mode uses decay.
    // pushDecay is authored as a per-frame multiplier at the live rAF rate
    // (~60 Hz). Normalize to that reference so motion is framerate-independent:
    // 60 fps → unchanged, 120 fps → sqrt(decay) per step (real sub-frame motion),
    // 30 fps → decay^2 per step.
    if (!this._activeMode || this._activeMode.usesDecay !== false) {
      const decay = state.pushDecay || 0.92;
      const decayStep = Math.pow(decay, deltaTime * 60);
      for (let i = 0; i < this._pushOffsets.length; i++) {
        this._pushOffsets[i].x *= decayStep;
        this._pushOffsets[i].y *= decayStep;
      }
    }

    // Advance smooth state toward target values (exponential ease)
    for (const key in this._smoothParams) {
      const target = parseFloat(state[key]);
      if (target == null || isNaN(target)) continue;
      const speed = this._smoothParams[key];
      const current = this._smoothState[key];
      if (current == null) {
        this._smoothState[key] = target;
      } else {
        this._smoothState[key] = current + (target - current) * Math.min(1, speed * deltaTime);
      }
    }

    // Delegate to active mode
    if (this._activeMode) {
      const gridInfo = this.getGridInfo();
      this._activeMode.update(deltaTime, state, gridInfo, this._pushOffsets, this._scaleValues);
    }
  }

  /**
   * Get smoothed value for a parameter, falling back to raw state value.
   */
  _smooth(key, rawValue) {
    return this._smoothState[key] != null ? this._smoothState[key] : rawValue;
  }

  _getMaskEvolutionPhase(state) {
    const speed = Math.max(0, Math.min(1, parseFloat(state.maskNoiseEvolutionSpeed) || 0));

    if (this._exportInProgress) {
      const renderTime = Math.max(0, this.time || 0);
      const delta = Math.max(0, Math.min(0.1, renderTime - this._lastNoiseEvolutionRenderTime));
      this._lastNoiseEvolutionRenderTime = renderTime;
      this._lastNoiseEvolutionTick = 0;
      this._noiseEvolutionPhase += delta * speed;
      return this._noiseEvolutionPhase;
    }

    const now = performance.now();
    if (!this._lastNoiseEvolutionTick) {
      this._lastNoiseEvolutionTick = now;
      this._lastNoiseEvolutionRenderTime = this.time;
      return this._noiseEvolutionPhase;
    }

    const delta = Math.max(0, Math.min(0.1, (now - this._lastNoiseEvolutionTick) / 1000));
    this._lastNoiseEvolutionTick = now;
    this._lastNoiseEvolutionRenderTime = this.time;
    this._noiseEvolutionPhase += delta * speed;
    return this._noiseEvolutionPhase;
  }

  /**
   * Render the grid to the main canvas (delegated to WebGLGridRenderer)
   */
  render() {
    this._renderCore(this.p, this.p.width, this.p.height);
  }

  /**
   * Render to an arbitrary target (overridden by WebGLGridRenderer)
   */
  renderToTarget(target, width, height) {
    this._renderCore(target, width, height);
  }

  /**
   * Get Canvas2D context from a p5 drawing target (used for WebGL blit)
   */
  _getCtx(g) {
    const ctx = g.drawingContext;
    this._dpr = g.pixelDensity ? g.pixelDensity() : 1;
    return ctx;
  }

  _renderCore() {
    // GPU rendering handled by WebGLGridRenderer
  }

  _hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  // ── Squircle / SVG Path Utilities ──────────────────────────

  /**
   * Compute Figma squircle corner parameters.
   */
  static _figmaCornerParams(cornerRadius, cornerSmoothing, roundingAndSmoothingBudget) {
    const toRad = (deg) => (deg * Math.PI) / 180;

    let p = (1 + cornerSmoothing) * cornerRadius;

    const maxSmoothing = roundingAndSmoothingBudget / cornerRadius - 1;
    cornerSmoothing = Math.min(cornerSmoothing, maxSmoothing);
    p = Math.min(p, roundingAndSmoothingBudget);

    const arcMeasure = 90 * (1 - cornerSmoothing);
    const arcSectionLength =
      Math.sin(toRad(arcMeasure / 2)) * cornerRadius * Math.sqrt(2);

    const angleAlpha = (90 - arcMeasure) / 2;
    const p3ToP4Distance = cornerRadius * Math.tan(toRad(angleAlpha / 2));

    const angleBeta = 45 * cornerSmoothing;
    const c = p3ToP4Distance * Math.cos(toRad(angleBeta));
    const d = c * Math.tan(toRad(angleBeta));

    const b = (p - arcSectionLength - c - d) / 3;
    const a = 2 * b;

    return { a, b, c, d, p, arcSectionLength, cornerRadius };
  }

  /**
   * Generate the squircle SVG path string using the Figma algorithm.
   */
  static _figmaSvgPath(width, height, cornerRadius, cornerSmoothing) {
    const roundingAndSmoothingBudget = Math.min(width, height) / 2;
    cornerRadius = Math.min(cornerRadius, roundingAndSmoothingBudget);

    if (cornerRadius <= 0) {
      return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
    }

    const params = this._figmaCornerParams(cornerRadius, cornerSmoothing, roundingAndSmoothingBudget);
    const { a, b, c, d, p, arcSectionLength, cornerRadius: R } = params;

    const r = (v) => v.toFixed(4);

    let path = `M ${r(width - p)} 0`;

    path += ` c ${r(a)} 0 ${r(a + b)} 0 ${r(a + b + c)} ${r(d)}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(arcSectionLength)} ${r(arcSectionLength)}`;
    path += ` c ${r(d)} ${r(c)} ${r(d)} ${r(b + c)} ${r(d)} ${r(a + b + c)}`;

    path += ` L ${r(width)} ${r(height - p)}`;

    path += ` c 0 ${r(a)} 0 ${r(a + b)} ${r(-d)} ${r(a + b + c)}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(-arcSectionLength)} ${r(arcSectionLength)}`;
    path += ` c ${r(-c)} ${r(d)} ${r(-(b + c))} ${r(d)} ${r(-(a + b + c))} ${r(d)}`;

    path += ` L ${r(p)} ${r(height)}`;

    path += ` c ${r(-a)} 0 ${r(-(a + b))} 0 ${r(-(a + b + c))} ${r(-d)}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(-arcSectionLength)} ${r(-arcSectionLength)}`;
    path += ` c ${r(-d)} ${r(-c)} ${r(-d)} ${r(-(b + c))} ${r(-d)} ${r(-(a + b + c))}`;

    path += ` L 0 ${r(p)}`;

    path += ` c 0 ${r(-a)} 0 ${r(-(a + b))} ${r(d)} ${r(-(a + b + c))}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(arcSectionLength)} ${r(-arcSectionLength)}`;
    path += ` c ${r(c)} ${r(-d)} ${r(b + c)} ${r(-d)} ${r(a + b + c)} ${r(-d)}`;

    path += ' Z';
    return path;
  }

  /**
   * Parse an SVG path string into absolute command objects.
   */
  static _svgPathToCommands(d, ox, oy) {
    const cmds = [];
    const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
    if (!tokens) return cmds;

    let i = 0;
    let curX = 0, curY = 0;

    const num = () => parseFloat(tokens[i++]);

    while (i < tokens.length) {
      const cmd = tokens[i++];

      if (cmd === 'M') {
        curX = num(); curY = num();
        cmds.push({ type: 'move', x: curX + ox, y: curY + oy });
      } else if (cmd === 'L') {
        curX = num(); curY = num();
        cmds.push({ type: 'line', x: curX + ox, y: curY + oy });
      } else if (cmd === 'c') {
        const dx1 = num(), dy1 = num();
        const dx2 = num(), dy2 = num();
        const dx = num(), dy = num();
        cmds.push({
          type: 'cubic',
          cp1x: curX + dx1 + ox, cp1y: curY + dy1 + oy,
          cp2x: curX + dx2 + ox, cp2y: curY + dy2 + oy,
          x: curX + dx + ox, y: curY + dy + oy,
        });
        curX += dx; curY += dy;
      } else if (cmd === 'a') {
        const rx = num(), ry = num();
        const xRot = num(), largeArc = num(), sweep = num();
        const dx = num(), dy = num();
        const endX = curX + dx, endY = curY + dy;

        const arcBeziers = GridRenderer._arcToCubicBeziers(
          curX, curY, endX, endY, rx, ry, xRot, largeArc, sweep
        );
        for (const bez of arcBeziers) {
          cmds.push({
            type: 'cubic',
            cp1x: bez.cp1x + ox, cp1y: bez.cp1y + oy,
            cp2x: bez.cp2x + ox, cp2y: bez.cp2y + oy,
            x: bez.x + ox, y: bez.y + oy,
          });
        }
        curX = endX; curY = endY;
      } else if (cmd === 'l') {
        const dx = num(), dy = num();
        curX += dx; curY += dy;
        cmds.push({ type: 'line', x: curX + ox, y: curY + oy });
      } else if (cmd === 'Z' || cmd === 'z') {
        // Close path
      }
    }
    return cmds;
  }

  /**
   * Convert SVG arc to cubic bezier curves.
   */
  static _arcToCubicBeziers(x1, y1, x2, y2, rx, ry, xAxisRotation, largeArcFlag, sweepFlag) {
    if (Math.abs(x1 - x2) < 1e-6 && Math.abs(y1 - y2) < 1e-6) return [];
    if (rx < 1e-6 || ry < 1e-6) return [];

    const toRad = (deg) => (deg * Math.PI) / 180;
    const phi = toRad(xAxisRotation);
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    let rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;

    const lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1) {
      const sqrtLambda = Math.sqrt(lambda);
      rx *= sqrtLambda; ry *= sqrtLambda;
      rxSq = rx * rx; rySq = ry * ry;
    }

    let sq = Math.max(0, (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq));
    sq = Math.sqrt(sq);
    if (largeArcFlag === sweepFlag) sq = -sq;

    const cxp = sq * rx * y1p / ry;
    const cyp = -sq * ry * x1p / rx;

    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    const vectorAngle = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
      let ang = Math.acos(Math.max(-1, Math.min(1, dot / len)));
      if (ux * vy - uy * vx < 0) ang = -ang;
      return ang;
    };

    const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dtheta = vectorAngle(
      (x1p - cxp) / rx, (y1p - cyp) / ry,
      (-x1p - cxp) / rx, (-y1p - cyp) / ry
    );

    if (sweepFlag === 0 && dtheta > 0) dtheta -= 2 * Math.PI;
    if (sweepFlag === 1 && dtheta < 0) dtheta += 2 * Math.PI;

    const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
    const segAngle = dtheta / segments;
    const results = [];

    for (let s = 0; s < segments; s++) {
      const t1 = theta1 + s * segAngle;
      const t2 = t1 + segAngle;
      const alpha = (4 / 3) * Math.tan(segAngle / 4);

      const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
      const cos2 = Math.cos(t2), sin2 = Math.sin(t2);

      const ep1x = rx * cos1, ep1y = ry * sin1;
      const ep2x = rx * cos2, ep2y = ry * sin2;

      const ecp1x = ep1x - alpha * rx * sin1;
      const ecp1y = ep1y + alpha * ry * cos1;
      const ecp2x = ep2x + alpha * rx * sin2;
      const ecp2y = ep2y - alpha * ry * cos2;

      const transform = (px, py) => ({
        x: cosPhi * px - sinPhi * py + cx,
        y: sinPhi * px + cosPhi * py + cy,
      });

      const p1 = transform(ecp1x, ecp1y);
      const p2 = transform(ecp2x, ecp2y);
      const end = transform(ep2x, ep2y);

      results.push({
        cp1x: p1.x, cp1y: p1.y,
        cp2x: p2.x, cp2y: p2.y,
        x: end.x, y: end.y,
      });
    }

    return results;
  }

  // ── SVG Export ─────────────────────────────────────────────

  /**
   * Export current grid state to SVG — mirrors the full GPU pipeline.
   */
  exportSVG() {
    const p = this.p;
    const state = stateManager.getAll();

    const cols = state.gridDensity || 60;
    const cubeHeight = p.width / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1;
    const spacingY = cubeHeight * 0.1;
    const rows = Math.ceil(p.height / (cubeHeight + spacingY)) + 1;
    const cornerRadius = 25;
    const bgHex = state.backgroundColor || '#FFFEF7';
    const bgLum = (parseInt(bgHex.slice(1,3),16)*0.299 + parseInt(bgHex.slice(3,5),16)*0.587 + parseInt(bgHex.slice(5,7),16)*0.114) / 255;
    const fillColor = bgLum > 0.5 ? '#000000' : '#ffffff';

    const hasImage = imageSampler && imageSampler.hasImage();
    const textureVisible = state.textureVisible !== false;

    // Scale settings
    const imageBrightnessScaleMin = (state.imageBrightnessScaleMin ?? 100) / 100;
    const imageBrightnessScaleMax = (state.imageBrightnessScaleMax ?? 100) / 100;
    const brightnessVariance = (state.brightnessVariance ?? 50) / 100;
    const motionScaleMin = (state.scaleMin ?? 100) / 100;
    // Motion Scale is additive-only: clamp to ≥ Base Scale.
    const motionScaleMax = Math.max(motionScaleMin, (state.scaleMax ?? 150) / 100);

    // Hue offset & scale→hue
    const imageHueOffset = state.imageHueOffset ?? 0;
    const scaleHueShiftEnabled = (state.scaleHueRange ?? 0) > 0;
    const scaleHueRange = state.scaleHueRange ?? 60;

    // Color remap
    const colorRemapMode = state.colorRemapMode || 'none';
    const hasPalette = typeof paletteProcessor !== 'undefined' && paletteProcessor;

    // PostFade
    const postFadeEnabled = state.postFadeEnabled || false;
    const postFadeDriver = state.postFadeDriver || 'luminance';
    const postFadeTarget = state.postFadeTarget || '#C4C3BB';
    const postFadeStart = (parseFloat(state.postFadeStart) || 0) / 100;
    const postFadeEnd = (parseFloat(state.postFadeEnd) || 30) / 100;
    const postFadeStrength = (state.postFadeStrength ?? 100) / 100;
    const postFadeCurve = (state.postFadeCurve ?? 100) / 100;
    const postFadeOffset = (state.postFadeOffset ?? 0) / 360;
    let pfTargetR, pfTargetG, pfTargetB;
    if (postFadeEnabled) {
      const pt = this._hexToRgb(postFadeTarget);
      pfTargetR = pt.r / 255; pfTargetG = pt.g / 255; pfTargetB = pt.b / 255;
    }

    // SizeFade
    const sizeFade = (state.sizeFade ?? 100) / 100;
    const bgR = parseInt(bgHex.slice(1,3),16) / 255;
    const bgG = parseInt(bgHex.slice(3,5),16) / 255;
    const bgB = parseInt(bgHex.slice(5,7),16) / 255;

    // Grid layout
    const canvasWidth = p.width;
    const canvasHeight = p.height;
    const totalWidth = cols * cubeWidth + (cols - 1) * spacingX;
    const totalHeight = rows * cubeHeight + (rows - 1) * spacingY;
    const gridOffsetX = state.gridOffsetX ?? 50;
    const gridOffsetY = state.gridOffsetY ?? 50;
    const offsetX = (canvasWidth - totalWidth) * (gridOffsetX / 100);
    const offsetY = (canvasHeight - totalHeight) * (gridOffsetY / 100);

    // Cache texture samples
    if (hasImage) {
      const texPosX = 50 - (state.texturePositionX ?? 0);
      const texPosY = 50 - (state.texturePositionY ?? 0);
      const texScale = state.textureScale ?? 100;
      imageSampler.setTransform(texPosX, texPosY, texScale, texScale, state.textureRotation ?? 0);
      imageSampler.setGridViewport(offsetX, offsetY, totalWidth, totalHeight, canvasWidth, canvasHeight);
      imageSampler.cacheGridColors(cols, rows, canvasWidth, canvasHeight);
    }

    // Sync PaletteProcessor
    if (colorRemapMode !== 'none' && hasPalette) {
      paletteProcessor.syncFromState();
    }

    // Compute masks
    const maskMode = state.maskMode || 'tabloop';
    let maskValues = null;
    // Cache positions for mask computation
    const gridSize = cols * rows;
    const posX = new Float32Array(gridSize);
    const posY = new Float32Array(gridSize);
    const cellStepX = cubeWidth + spacingX;
    const cellStepY = cubeHeight + spacingY;
    for (let row = 0; row < rows; row++) {
      const baseX = offsetX + (row % 2 === 1 ? cellStepX * 0.5 : 0);
      const yPos = offsetY + row * cellStepY;
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        posX[i] = baseX + col * cellStepX;
        posY[i] = yPos;
      }
    }
    if (maskMode === 'tabloop' && this._maskProcessor) {
      const layoutW = (this._layoutCore && this._layoutCore.w) || canvasWidth;
      const layoutH = (this._layoutCore && this._layoutCore.h) || canvasHeight;
      const maskEvolutionPhase = this._getMaskEvolutionPhase(state);
      maskValues = this._maskProcessor.computeRingMask(
        cols, rows, posX, posY, cubeWidth, cubeHeight,
        canvasWidth, canvasHeight, state, layoutW, layoutH, maskEvolutionPhase
      );
    } else if ((maskMode === 'custom' || maskMode === 'library') && this._maskProcessor &&
               typeof maskSampler !== 'undefined' && maskSampler && maskSampler.hasImage()) {
      const channel = state.maskChannel || 'luminance';
      const maskInvert = state.maskInvert || false;
      const syncMask = state.maskSyncWithTexture !== false;
      const maskPosX = syncMask ? (state.texturePositionX ?? 0) : (state.maskPositionX ?? 0);
      const maskPosY = syncMask ? (state.texturePositionY ?? 0) : (state.maskPositionY ?? 0);
      const maskScale = syncMask ? (state.textureScale ?? 100) : (state.maskScale ?? 100);
      const maskRotation = syncMask ? (state.textureRotation ?? 0) : (state.maskRotation ?? 0);
      maskSampler.setTransform(50 - maskPosX, 50 - maskPosY, maskScale, maskScale, maskRotation);
      maskSampler.setGridViewport(offsetX + cubeWidth / 2, offsetY + cubeHeight / 2, Math.max(1, totalWidth - cubeWidth), Math.max(1, totalHeight - cubeHeight), canvasWidth, canvasHeight);
      maskValues = this._maskProcessor.computeCustomMask(
        cols, rows, posX, posY, cubeWidth, cubeHeight,
        canvasWidth, canvasHeight, maskSampler, channel, maskInvert,
        (state.maskSoftness ?? 0) / 100, state, this._getMaskEvolutionPhase(state)
      );
    }

    // Compute the actual bounding box of the grid, including overshoot from
    // motion scaling (cells can grow up to ~motionScaleMax). The grid is often
    // wider/taller than the canvas (extra row, centered), so a viewBox locked
    // to canvas dims clips the edges.
    const overshoot = Math.max(1, motionScaleMax, imageBrightnessScaleMax, imageBrightnessScaleMin);
    const padX = (cubeWidth * overshoot - cubeWidth) / 2 + cubeWidth * 0.05;
    const padY = (cubeHeight * overshoot - cubeHeight) / 2 + cubeHeight * 0.05;
    const minX = Math.min(0, offsetX - padX);
    const minY = Math.min(0, offsetY - padY);
    const maxX = Math.max(canvasWidth, offsetX + totalWidth + padX);
    const maxY = Math.max(canvasHeight, offsetY + totalHeight + padY);
    const vbW = maxX - minX;
    const vbH = maxY - minY;

    const svgParts = [];
    svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>\n`);
    svgParts.push(`<svg width="${vbW.toFixed(2)}" height="${vbH.toFixed(2)}" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}" xmlns="http://www.w3.org/2000/svg">\n`);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;

        const centerX = posX[index] + cubeWidth / 2;
        const centerY = posY[index] + cubeHeight / 2;

        // Sample texture
        let sr = 0, sg = 0, sb = 0;
        let imageBrightness = 1;
        let shapeFillColor = fillColor;

        if (hasImage) {
          const sample = imageSampler.getCachedColor(index);
          if (!sample) continue;
          // Skip transparent pixels (matches GPU: texSample.a < 0.5)
          if ((sample.a ?? 255) < 128) continue;
          imageBrightness = isFinite(sample.brightness) ? sample.brightness : 0;
          sr = sample.r ?? 0; sg = sample.g ?? 0; sb = sample.b ?? 0;
          if (textureVisible) shapeFillColor = sample.hex;
        }

        // ── Scale computation (matches GPU pipeline) ──
        // Motion scale: interpolate scaleMin→scaleMax by push magnitude
        const po = this._pushOffsets[index];
        const pushMag = po ? Math.sqrt(po.x * po.x + po.y * po.y) : 0;
        const influence = Math.min(1, pushMag / 50);
        let imageScale = motionScaleMin + (motionScaleMax - motionScaleMin) * influence;

        // Mask
        if (maskValues) {
          imageScale *= maskValues[index];
        }

        // Scale Dark/Light (applied in vertex shader on GPU)
        if (hasImage) {
          imageScale *= imageBrightnessScaleMin + (imageBrightnessScaleMax - imageBrightnessScaleMin) * imageBrightness;
        }

        // Brightness variance (applied later to color, not scale)

        const pushX = this._pushOffsets[index] ? this._pushOffsets[index].x : 0;
        const pushY = this._pushOffsets[index] ? this._pushOffsets[index].y : 0;
        const manualScale = this._manualScaleOffsets[index] ?? 1;

        if (imageScale * manualScale < 0.001) continue;
        if (!isFinite(centerX) || !isFinite(centerY)) continue;

        // ── Color pipeline (matches GPU fragment shader) ──

        // Brightness variance: applied before colour processing
        if (brightnessVariance !== 0) {
          const ts = imageScale * manualScale;
          const scaleRange = Math.max(motionScaleMax - motionScaleMin, 0.001);
          const t = Math.max(0, Math.min(1, (ts - motionScaleMin) / scaleRange));
          if (brightnessVariance < 0) {
            const inv = 1 - t;
            const darken = inv * inv * (-brightnessVariance);
            const brighten = t * t * (-brightnessVariance) * 0.5;
            const bm = (1 - darken) + brighten;
            sr *= bm; sg *= bm; sb *= bm;
          } else {
            const bm = 1 + t * brightnessVariance * 2;
            sr *= bm; sg *= bm; sb *= bm;
          }
        }

        // Hue offset
        if (hasImage && imageHueOffset !== 0) {
          const hsl = imageSampler._rgbToHsl(sr, sg, sb);
          if (hsl.s < 5) hsl.s = Math.max(hsl.s, Math.abs(imageHueOffset) / 180 * 30);
          hsl.h = ((hsl.h + imageHueOffset) % 360 + 360) % 360;
          const shifted = imageSampler._hslToRgb(hsl.h, hsl.s, hsl.l);
          sr = shifted.r; sg = shifted.g; sb = shifted.b;
        }

        // Scale → Hue
        if (scaleHueShiftEnabled && scaleHueRange > 0) {
          const hsl = imageSampler._rgbToHsl(sr, sg, sb);
          const scaleCentered = (imageScale - 0.5) * 2;
          hsl.h = ((hsl.h + scaleCentered * scaleHueRange) % 360 + 360) % 360;
          const shifted = imageSampler._hslToRgb(hsl.h, hsl.s, hsl.l);
          sr = shifted.r; sg = shifted.g; sb = shifted.b;
        }

        // PaletteProcessor (full pipeline or duotone)
        if (colorRemapMode === 'full' && hasPalette) {
          const normX = cols > 1 ? col / (cols - 1) : 0.5;
          const normY = rows > 1 ? row / (rows - 1) : 0.5;
          const rgb = paletteProcessor.processColorRGB(normX, normY, imageBrightness, sr, sg, sb, index);
          sr = Math.max(0, Math.min(255, rgb.r));
          sg = Math.max(0, Math.min(255, rgb.g));
          sb = Math.max(0, Math.min(255, rgb.b));
        } else if (colorRemapMode === 'duotone' && hasPalette) {
          const rgb = paletteProcessor.processDuotoneRGB(sr, sg, sb);
          sr = Math.max(0, Math.min(255, rgb.r));
          sg = Math.max(0, Math.min(255, rgb.g));
          sb = Math.max(0, Math.min(255, rgb.b));
        } else if (colorRemapMode === 'tritone' && hasPalette) {
          const rgb = paletteProcessor.processTritoneRGB(sr, sg, sb);
          sr = Math.max(0, Math.min(255, rgb.r));
          sg = Math.max(0, Math.min(255, rgb.g));
          sb = Math.max(0, Math.min(255, rgb.b));
        }

        // PostFade
        if (postFadeEnabled) {
          const r01 = sr / 255, g01 = sg / 255, b01 = sb / 255;
          let blend = 0;
          if (postFadeDriver === 'size') {
            const totalScale = imageScale * manualScale;
            const eMin = motionScaleMin * imageBrightnessScaleMin;
            const range = motionScaleMax - eMin;
            const norm = range > 0 ? Math.max(0, Math.min(1, (totalScale - eMin) / range)) : 1;
            const t = postFadeEnd > postFadeStart
              ? Math.max(0, Math.min(1, (norm - postFadeStart) / (postFadeEnd - postFadeStart)))
              : (norm >= postFadeEnd ? 1 : 0);
            blend = postFadeStrength * (1 - Math.pow(t, postFadeCurve));
          } else {
            const hsl = imageSampler._rgbToHsl(sr, sg, sb);
            const rawDriver = postFadeDriver === 'saturation' ? hsl.s / 100
                       : postFadeDriver === 'hue' ? hsl.h / 360
                       : hsl.l / 100;
            const driverVal = (rawDriver + postFadeOffset) % 1;
            const mid = (postFadeStart + postFadeEnd) / 2;
            const halfWidth = (postFadeEnd - postFadeStart) / 2;
            if (halfWidth > 0) {
              const dist = Math.abs(driverVal - mid);
              blend = dist >= halfWidth ? 0 : postFadeStrength * (1 - dist / halfWidth);
            }
          }
          if (blend > 0) {
            sr = sr / 255 + (pfTargetR - r01) * blend;
            sg = sg / 255 + (pfTargetG - g01) * blend;
            sb = sb / 255 + (pfTargetB - b01) * blend;
            sr = Math.max(0, Math.min(1, sr)) * 255;
            sg = Math.max(0, Math.min(1, sg)) * 255;
            sb = Math.max(0, Math.min(1, sb)) * 255;
          }
        }

        // SizeFade: tiny tabs fade to background
        {
          const ns = Math.max(0, Math.min(1, imageScale * manualScale));
          sr = (bgR + (sr / 255 - bgR) * ns) * 255;
          sg = (bgG + (sg / 255 - bgG) * ns) * 255;
          sb = (bgB + (sb / 255 - bgB) * ns) * 255;
          sr = Math.max(0, Math.min(255, sr));
          sg = Math.max(0, Math.min(255, sg));
          sb = Math.max(0, Math.min(255, sb));
        }

        shapeFillColor = imageSampler
          ? imageSampler._rgbToHex(Math.round(sr), Math.round(sg), Math.round(sb))
          : `rgb(${Math.round(sr)},${Math.round(sg)},${Math.round(sb)})`;

        const pathD = this._getSquirclePath(cubeWidth * imageScale, cubeHeight * imageScale, cornerRadius);

        let el = `  <path d="${pathD}"`;
        el += ` transform="translate(${(centerX + pushX).toFixed(2)}, ${(centerY + pushY).toFixed(2)}) scale(${manualScale.toFixed(4)})"`;
        el += ` fill="${shapeFillColor}" stroke="none"`;
        el += `/>\n`;
        svgParts.push(el);
      }
    }

    svgParts.push(`</svg>`);
    return svgParts.join('');
  }

  /**
   * Generate SVG path data for a squircle centered at origin
   */
  _getSquirclePath(w, h, radiusPercent) {
    const hw = w / 2;
    const hh = h / 2;

    if (radiusPercent <= 0) {
      return `M ${(-hw).toFixed(2)} ${(-hh).toFixed(2)} L ${hw.toFixed(2)} ${(-hh).toFixed(2)} L ${hw.toFixed(2)} ${hh.toFixed(2)} L ${(-hw).toFixed(2)} ${hh.toFixed(2)} Z`;
    }

    const minDim = Math.min(w, h);
    const cornerRadius = Math.min((radiusPercent / 100) * minDim, minDim / 2);

    const topLeftPath = GridRenderer._figmaSvgPath(w, h, cornerRadius, 1.0);
    const cmds = GridRenderer._svgPathToCommands(topLeftPath, -hw, -hh);
    let d = '';
    for (const cmd of cmds) {
      if (cmd.type === 'move') {
        d += `M ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
      } else if (cmd.type === 'line') {
        d += ` L ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
      } else if (cmd.type === 'cubic') {
        d += ` C ${cmd.cp1x.toFixed(2)} ${cmd.cp1y.toFixed(2)}, ${cmd.cp2x.toFixed(2)} ${cmd.cp2y.toFixed(2)}, ${cmd.x.toFixed(2)} ${cmd.y.toFixed(2)}`;
      }
    }
    d += ' Z';
    return d;
  }

}
