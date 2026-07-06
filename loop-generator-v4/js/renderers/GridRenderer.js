/**
 * GridRenderer - Renders a grid of shapes
 * Extensible for different shape types and animation effects
 */
class GridRenderer {
  constructor(p5Instance) {
    this.p = p5Instance;
    this.shapes = [];
    this.time = 0;

    // Cache for grid offset (for cursor calculations)
    this._gridOffset = { x: 0, y: 0 };

    // Per-shape push offsets for velocity-based effects (persists and decays)
    this._pushOffsets = [];
    this._prevRingInfluence = null; // Float32Array, tracks per-shape ring influence for delta-based push
    this._lastGridSize = 0;

    // Pre-computed ring influence caches (Opt 4)
    this._ringInfluenceCache = null;
    this._ringScaleCache = null;

    // Reusable objects to avoid per-shape allocations in hot loop
    this._ringResult = { scaleInfluence: 0, scaleValue: 1 };
    this._shapeOptions = {
      fillColor: '', row: 0, col: 0, index: 0,
      centerX: 0, centerY: 0, normX: 0, normY: 0,
      origColor: '', imageBrightness: 1,
      imageBrightnessToScale: false, imageBrightnessScaleMin: 0, imageBrightnessScaleMax: 1,
      imageSaturation: 0, imageSaturationToScale: false,
      imageSaturationScaleMin: 0, imageSaturationScaleMax: 1, state: null,
      // RGB channels — avoid hex parsing in hot path (Opt 3)
      sampleR: 0, sampleG: 0, sampleB: 0,
      rawVideoR: 0, rawVideoG: 0, rawVideoB: 0,
      hasVideoRGB: false
    };

    // Squircle path cache — Map-based with LRU eviction (avoids recomputing identical paths)
    this._squircleCache = new Map();
    this._squircleCacheMaxSize = 50;

    // Canvas2D context — lazily resolved from p5's drawingContext
    this.ctx = null;
    this._dpr = 1; // pixel density ratio, updated in _ensureCtx
    // Native Path2D cache (same keys as _squircleCache)
    this._path2dCache = new Map();

    // Cached position arrays — avoid recomputing in draw loop (Opt 5)
    this._posX = null;
    this._posY = null;

    // Cached normCoords array — avoid allocating every frame (Opt 6)
    this._normCoords = null;

    // Persistent merged state object — avoid Object.assign every frame (Opt 7)
    this._mergedState = {};

    // Hex lookup table is static: GridRenderer._hexLUT (Opt 8)

    // Pre-computed noise lookup tables for gradient ring (by angle bucket)
    this._noiseAngleBuckets = 64;
    this._innerNoiseLUT = new Float32Array(64);
    this._outerNoiseLUT = new Float32Array(64);

    // Pause state - when true, rendering should not modify any state
    this._isPaused = false;
    // Frozen baseline push offsets (captured at pause time)
    this._frozenBasePush = [];

    // Manual scale offsets (persistent, modified by click+drag when paused)
    this._manualScaleOffsets = [];

    // Smooth state: exponential interpolation toward target for selected parameters
    this._smoothState = {};
    this._smoothParams = {
      ringRadius: 8,
      ringThickness: 8,
      ringInnerSoftness: 8,
      ringOuterSoftness: 8,
      scaleMin: 8,
      scaleMax: 8,
      scaleVariation: 8,
      colourPosition: 10,
      hmOrigAmount: 8,
    };
  }

  /**
   * Set paused state - when paused, render will not modify any state
   */
  setPaused(paused) {
    if (paused && !this._isPaused) {
      // Capture current push offsets as baseline when pausing
      this._frozenBasePush = this._pushOffsets.map(p => ({ x: p.x, y: p.y }));
    } else if (!paused && this._isPaused) {
      // Clear frozen baseline when unpausing
      this._frozenBasePush = [];
    }
    this._isPaused = paused;
  }

  /**
   * Update the grid based on current state
   */
  update() {
    this.time += this.p.deltaTime / 1000;

    const state = stateManager.getRef();
    const cols = state.gridDensity || 60;
    const cubeHeightU = this.p.width / (cols * 4.4);
    const rows = Math.ceil(this.p.height / (cubeHeightU * 1.1)) + 1;
    const gridSize = cols * rows;

    // Initialize or resize push offsets array
    if (gridSize !== this._lastGridSize) {
      this._pushOffsets = [];
      this._manualScaleOffsets = [];
      this._prevRingInfluence = new Float32Array(gridSize);
      this._path2dCache.clear();
      for (let i = 0; i < gridSize; i++) {
        this._pushOffsets.push({ x: 0, y: 0 });
        this._manualScaleOffsets.push(1.0); // Multiplier: 1.0 = no adjustment
      }
      this._lastGridSize = gridSize;
    }

    // Apply decay to push offsets
    const decay = state.pushDecay || 0.92;
    for (let i = 0; i < this._pushOffsets.length; i++) {
      this._pushOffsets[i].x *= decay;
      this._pushOffsets[i].y *= decay;
    }

    // Advance smooth state toward target values (exponential ease)
    const dt = this.p.deltaTime / 1000;
    for (const key in this._smoothParams) {
      const target = state[key];
      if (target == null) continue;
      const speed = this._smoothParams[key];
      const current = this._smoothState[key];
      if (current == null) {
        this._smoothState[key] = target;
      } else {
        this._smoothState[key] = current + (target - current) * Math.min(1, speed * dt);
      }
    }
  }

  /**
   * Render the grid
   */
  render() {
    const p = this.p;
    const rawState = stateManager.getRef();
    // Persistent merged state — copy raw then overlay smooth keys (Opt 7)
    const state = this._mergedState;
    const rawKeys = Object.keys(rawState);
    for (let i = 0; i < rawKeys.length; i++) {
      state[rawKeys[i]] = rawState[rawKeys[i]];
    }
    for (const key in this._smoothState) {
      state[key] = this._smoothState[key];
    }

    // Grid density drives all grid dimensions
    // Shape is 4:1 ratio, spacing = 10% of height, row offset always 50%
    const cols = state.gridDensity || 60;
    const cubeHeight = p.width / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1;
    const spacingY = cubeHeight * 0.1;
    const rows = Math.ceil(p.height / (cubeHeight + spacingY)) + 1;
    const cornerRadius = 25;
    const inverted = state.invertColors || false;
    const brandColors = (state.brandColors ?? 0) / 100;
    const fillColor = inverted ? '#FFFEF7' : '#0E0E0C';
    // Pre-parsed fill color RGB — avoids hex parsing in hot path (Opt 3)
    const fillR = inverted ? 255 : 14;
    const fillG = inverted ? 254 : 14;
    const fillB = inverted ? 247 : 12;

    // Image sampler settings
    const imageSamplerEnabled = state.imageSamplerEnabled && imageSampler && imageSampler.hasImage();
    const imageColorOpacity = (state.imageColorOpacity ?? 100) / 100;
    const imageBrightnessToScale = state.imageBrightnessToScale || false;
    const imageBrightnessScaleMin = (state.imageBrightnessScaleMin ?? 0) / 100;
    const imageBrightnessScaleMax = (state.imageBrightnessScaleMax ?? 100) / 100;
    const imageSaturationToScale = state.imageSaturationToScale || false;
    const imageSaturationScaleMin = (state.imageSaturationScaleMin ?? 0) / 100;
    const imageSaturationScaleMax = (state.imageSaturationScaleMax ?? 100) / 100;

    // Update image sampler settings
    if (imageSampler) {
      if (state.imageMappingMode) {
        imageSampler.setMappingMode(state.imageMappingMode);
      }
      imageSampler.setTransform(
        state.imagePositionX ?? 50,
        state.imagePositionY ?? 50,
        state.imageScaleX ?? 100,
        state.imageScaleY ?? 100,
        state.imageRotation ?? 0
      );
    }

    // Cache image colors if enabled
    if (imageSamplerEnabled) {
      imageSampler.cacheGridColors(cols, rows);
    }

    // Sync palette processor from UI state once per frame
    const isColourModeActive = state.colorMode || false;
    if (isColourModeActive && typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      paletteProcessor.syncFromState();
    }

    // Pre-compute noise lookup tables for gradient ring (avoids p.noise() per shape)
    const ringInnerNoise = state.ringInnerNoise ?? 0;
    const ringOuterNoise = state.ringOuterNoise ?? 0;
    if (ringInnerNoise > 0 || ringOuterNoise > 0) {
      const noiseScale = state.ringNoiseScale ?? 2;
      const noiseSeed = state.ringNoiseSeed ?? 0;
      const seedOff = noiseSeed * 7.31;
      const buckets = this._noiseAngleBuckets;
      const step = (2 * Math.PI) / buckets;
      for (let i = 0; i < buckets; i++) {
        const angle = i * step - Math.PI; // -PI to PI
        const nx = Math.cos(angle) * noiseScale;
        const ny = Math.sin(angle) * noiseScale;
        if (ringInnerNoise > 0) {
          this._innerNoiseLUT[i] = (p.noise(nx + 50 + seedOff, ny + 50 + seedOff) - 0.5) * 2;
        }
        if (ringOuterNoise > 0) {
          this._outerNoiseLUT[i] = (p.noise(nx + 150 + seedOff, ny + 150 + seedOff) - 0.5) * 2;
        }
      }
    }
    this._ringInnerNoise = ringInnerNoise;
    this._ringOuterNoise = ringOuterNoise;

    // Calculate total grid size for centering
    const totalWidth = cols * cubeWidth + (cols - 1) * spacingX;
    const totalHeight = rows * cubeHeight + (rows - 1) * spacingY;

    // Center offset — shift right by half the UI panel width so artwork
    // centers in the visible area rather than the full canvas
    const canvasWidth = p.width;
    const canvasHeight = p.height;
    const panelEl = document.getElementById('parameter-panel');
    const panelShift = 0;
    const offsetX = (canvasWidth - totalWidth) / 2 + panelShift;
    const offsetY = (canvasHeight - totalHeight) / 2;

    // Store grid offset for cursor calculations
    this._gridOffset.x = offsetX;
    this._gridOffset.y = offsetY;

    // ── Pre-computation pass (Opt 2 + Opt 4) ──────────────────────────
    // Batch-compute ring influence, push offsets, and normCoords for all
    // cells in a single cache-friendly pass before the draw loop.
    const gridSize = cols * rows;
    if (!this._ringInfluenceCache || this._ringInfluenceCache.length !== gridSize) {
      this._ringInfluenceCache = new Float32Array(gridSize);
      this._ringScaleCache = new Float32Array(gridSize);
      this._posX = new Float32Array(gridSize);
      this._posY = new Float32Array(gridSize);
      this._normCoords = new Float32Array(gridSize * 2);
    }

    const scaleMin = (state.scaleMin ?? 100) / 100;
    const scaleMax = (state.scaleMax ?? 150) / 100;
    const velocityPushAmount = state.velocityPushAmount ?? 40;
    const ringRadius = state.ringRadius ?? 150;
    const thickness = state.ringThickness ?? 40;
    const innerSoft = (state.ringInnerSoftness ?? 50) / 100;
    const outerSoft = (state.ringOuterSoftness ?? 50) / 100;
    const halfThick = thickness / 2;
    const baseInnerEdge = ringRadius - halfThick;
    const baseOuterEdge = ringRadius + halfThick;
    // Centered feather — half extends beyond edge, half eats into band
    const innerFalloffWidth = innerSoft * halfThick;
    const outerFalloffWidth = outerSoft * halfThick;
    const ringCX = canvasWidth / 2 + panelShift;
    const ringCY = canvasHeight / 2;

    // Opt 2: normCoords for noise texture pre-computation (reuse cached array)
    const hasPalette = isColourModeActive && typeof paletteProcessor !== 'undefined' && paletteProcessor && paletteProcessor.hasSettings();
    const normCoords = hasPalette ? this._normCoords : null;

    const cellStepX = cubeWidth + spacingX;
    const cellStepY = cubeHeight + spacingY;
    const rowOffset = cellStepX * 0.5;

    for (let row = 0; row < rows; row++) {
      const baseX = offsetX + (row % 2 === 1 ? rowOffset : 0);
      const yPos = offsetY + row * cellStepY;
      const centerY = yPos + cubeHeight / 2;

      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const xPos = baseX + col * cellStepX;
        const centerX = xPos + cubeWidth / 2;

        // Cache positions for draw loop (Opt 5)
        this._posX[index] = xPos;
        this._posY[index] = yPos;

        // Opt 2: store normCoords for noise texture
        if (normCoords) {
          normCoords[index * 2] = centerX / canvasWidth;
          normCoords[index * 2 + 1] = centerY / canvasHeight;
        }

        // Opt 4: ring influence computation
        const dx = centerX - ringCX;
        const dy = centerY - ringCY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let innerEdge = baseInnerEdge;
        let outerEdge = baseOuterEdge;
        if ((ringInnerNoise > 0 || ringOuterNoise > 0) && dist > 0.001) {
          const angle = Math.atan2(dy, dx);
          const bucketIdx = Math.round((angle + Math.PI) / (2 * Math.PI) * this._noiseAngleBuckets) % this._noiseAngleBuckets;
          if (ringInnerNoise > 0) innerEdge += this._innerNoiseLUT[bucketIdx] * ringInnerNoise;
          if (ringOuterNoise > 0) outerEdge += this._outerNoiseLUT[bucketIdx] * ringOuterNoise;
        }

        let ringInfluence = 0;
        const innerFeatherStart = innerEdge - innerFalloffWidth * 0.7;
        const innerFeatherEnd   = innerEdge + innerFalloffWidth * 0.3;
        const outerFeatherStart = outerEdge - outerFalloffWidth * 0.3;
        const outerFeatherEnd   = outerEdge + outerFalloffWidth * 0.7;

        if (dist >= innerFeatherEnd && dist <= outerFeatherStart) {
          // Fully inside the hard band
          ringInfluence = 1;
        } else if (dist >= innerFeatherStart && dist < innerFeatherEnd && innerFalloffWidth > 0) {
          // Inner feather: centered on inner edge
          const t = (dist - innerFeatherStart) / innerFalloffWidth;
          ringInfluence = t * t * (3 - 2 * t);
        } else if (dist > outerFeatherStart && dist <= outerFeatherEnd && outerFalloffWidth > 0) {
          // Outer feather: centered on outer edge
          const t = (outerFeatherEnd - dist) / outerFalloffWidth;
          ringInfluence = t * t * (3 - 2 * t);
        }

        this._ringInfluenceCache[index] = ringInfluence;
        this._ringScaleCache[index] = scaleMin + (scaleMax - scaleMin) * ringInfluence;

        // Delta-based velocity push
        const prevInfluence = this._prevRingInfluence ? this._prevRingInfluence[index] : 0;
        const deltaInfluence = Math.abs(ringInfluence - prevInfluence);
        if (!this._isPaused && this._prevRingInfluence) {
          this._prevRingInfluence[index] = ringInfluence;
        }
        if (!this._isPaused && deltaInfluence > 0.001 && this._pushOffsets[index] && dist > 0.001) {
          const pushStrength = deltaInfluence * velocityPushAmount * 5;
          const normDx = dx / dist;
          const normDy = dy / dist;
          this._pushOffsets[index].x += normDx * pushStrength;
          this._pushOffsets[index].y += normDy * pushStrength;
        }
      }
    }

    // Opt 2: build noise texture from pre-computed normCoords
    if (hasPalette) {
      paletteProcessor.buildNoiseTexture(cols, rows, normCoords);
    }

    // Hue convergence: swap histogram buffers (uses previous frame's processed colors)
    if (hasPalette) {
      paletteProcessor.beginConvergenceFrame();
    }

    // ── Draw loop (positions from pre-pass cache, Opt 5) ──────────────
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;

        const x = this._posX[index];
        const y = this._posY[index];
        const centerX = x + cubeWidth / 2;
        const centerY = y + cubeHeight / 2;

        // Opt 3: sample image color as RGB — skip hex parsing
        let sampleR = fillR, sampleG = fillG, sampleB = fillB;
        let rawVideoR = 0, rawVideoG = 0, rawVideoB = 0;
        let hasVideoRGB = false;
        let imageBrightness = 1;
        let imageSaturation = 0;
        let shapeFillColor = fillColor;

        if (imageSamplerEnabled) {
          const sample = imageSampler.getCachedColor(index);
          if (sample) {
            imageBrightness = sample.brightness;
            imageSaturation = sample.saturation ?? 0;

            if (isColourModeActive) {
              let sr = sample.r, sg = sample.g, sb = sample.b;
              if (state.invertImage) { sr = 255 - sr; sg = 255 - sg; sb = 255 - sb; }
              const hueOff = state.imageHueOffset || 0;
              if (hueOff !== 0) {
                const hsl = PaletteProcessor.rgbToHsl(sr, sg, sb);
                hsl.h = (hsl.h + hueOff + 360) % 360;
                const shifted = PaletteProcessor.hslToRgb(hsl.h, hsl.s, hsl.l);
                sr = shifted.r; sg = shifted.g; sb = shifted.b;
              }
              rawVideoR = sr;
              rawVideoG = sg;
              rawVideoB = sb;
              hasVideoRGB = true;

              if (imageColorOpacity >= 1) {
                sampleR = sr;
                sampleG = sg;
                sampleB = sb;
              } else if (imageColorOpacity > 0) {
                sampleR = fillR + (sr - fillR) * imageColorOpacity;
                sampleG = fillG + (sg - fillG) * imageColorOpacity;
                sampleB = fillB + (sb - fillB) * imageColorOpacity;
              }
            }
          }
        }

        const opts = this._shapeOptions;
        opts.fillColor = shapeFillColor;
        opts.sampleR = sampleR;
        opts.sampleG = sampleG;
        opts.sampleB = sampleB;
        opts.rawVideoR = rawVideoR;
        opts.rawVideoG = rawVideoG;
        opts.rawVideoB = rawVideoB;
        opts.hasVideoRGB = hasVideoRGB;
        opts.row = row;
        opts.col = col;
        opts.index = index;
        opts.centerX = centerX;
        opts.centerY = centerY;
        opts.normX = centerX / canvasWidth;
        opts.normY = centerY / canvasHeight;
        opts.imageBrightness = imageBrightness;
        opts.imageBrightnessToScale = imageBrightnessToScale;
        opts.imageBrightnessScaleMin = imageBrightnessScaleMin;
        opts.imageBrightnessScaleMax = imageBrightnessScaleMax;
        opts.imageSaturation = imageSaturation;
        opts.imageSaturationToScale = imageSaturationToScale;
        opts.imageSaturationScaleMin = imageSaturationScaleMin;
        opts.imageSaturationScaleMax = imageSaturationScaleMax;
        opts.state = state;
        opts.brandColors = brandColors;
        this._drawShape(x, y, cubeWidth, cubeHeight, cornerRadius, opts);
      }
    }

    // Reset transform to p5's default DPR-scaled identity (Opt 9)
    const ctx = this._ensureCtx();
    const dpr = this._dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Draw individual shape - can be overridden for different effects
   */
  _drawShape(x, y, w, h, radius, options) {
    const ctx = this._ensureCtx();

    // Compute image-based scale factor (brightness, saturation)
    let imageScale = 1;

    if (options.imageBrightnessToScale) {
      imageScale *= options.imageBrightnessScaleMin +
        (options.imageBrightnessScaleMax - options.imageBrightnessScaleMin) * options.imageBrightness;
    }

    if (options.imageSaturationToScale) {
      imageScale *= options.imageSaturationScaleMin +
        (options.imageSaturationScaleMax - options.imageSaturationScaleMin) * options.imageSaturation;
    }

    // Get pre-computed ring scale
    const index = options.index;
    const cursorScale = this._ringScaleCache[index];

    // Manual scale multiplier (from click+drag when paused)
    const manualMultiplier = this._manualScaleOffsets[index];
    const manualScale = (manualMultiplier !== undefined && manualMultiplier !== 1.0 && isFinite(manualMultiplier)) ? manualMultiplier : 1;

    // Skip drawing when effectively invisible
    const combinedVisualScale = cursorScale * manualScale * imageScale;
    if (combinedVisualScale < 0.001) return;

    // Build transform manually instead of save/restore (Opt 9)
    // Base: translate to shape center, then apply ring scale + manual scale + push offset
    const cx = x + w / 2;
    const cy = y + h / 2;
    const pushX = this._pushOffsets[index] ? this._pushOffsets[index].x : 0;
    const pushY = this._pushOffsets[index] ? this._pushOffsets[index].y : 0;
    const combinedScale = cursorScale * manualScale;

    // setTransform(a, b, c, d, e, f) = scale then translate
    // Account for p5's pixel density (DPR) transform
    const dpr = this._dpr;
    ctx.setTransform(
      combinedScale * dpr, 0,
      0, combinedScale * dpr,
      (cx + pushX) * dpr,
      (cy + pushY) * dpr
    );

    // Apply any per-shape transformations (animation)
    this._applyShapeTransform(options);

    // Size fade: when colour mode is on, fade small shapes towards background
    const state = options.state;
    const isColourMode = state.colorMode || false;
    let finalFillColor = options.fillColor;

    if (isColourMode) {
      const totalScale = imageScale * cursorScale * manualScale;

      // Normalize scale: 0 = scaleMin, 1 = scaleMax
      const scaleMin = (state.scaleMin ?? 100) / 100;
      const scaleMax = (state.scaleMax ?? 150) / 100;
      const range = scaleMax - scaleMin;
      const normSize = range > 0 ? Math.max(0, Math.min(1, (totalScale - scaleMin) / range)) : 1;

      // RGB color pipeline — use raw RGB channels, skip hex parsing (Opt 3)
      let cr, cg, cb;

      if (typeof paletteProcessor !== 'undefined' && paletteProcessor && paletteProcessor.hasSettings()) {
        const rgb = paletteProcessor.processColorRGB(
          options.normX || 0,
          options.normY || 0,
          normSize,
          options.sampleR, options.sampleG, options.sampleB,
          index
        );
        cr = rgb.r; cg = rgb.g; cb = rgb.b;
      } else {
        cr = options.sampleR;
        cg = options.sampleG;
        cb = options.sampleB;
      }

      // Brand Colors overlay: map hue to brand palette gradient
      const brandColors = options.brandColors || 0;
      if (brandColors > 0 && paletteProcessor && paletteProcessor._hueGradMapStopsRGB) {
        const hsl = PaletteProcessor.rgbToHsl(
          Math.max(0, Math.min(255, cr)),
          Math.max(0, Math.min(255, cg)),
          Math.max(0, Math.min(255, cb))
        );
        const stops = paletteProcessor._hueGradMapStopsRGB;
        let t = hsl.h / 360;
        let mr, mg, mb;
        if (t <= stops[0].pos) {
          mr = stops[0].r; mg = stops[0].g; mb = stops[0].b;
        } else if (t >= stops[stops.length - 1].pos) {
          const last = stops[stops.length - 1];
          mr = last.r; mg = last.g; mb = last.b;
        } else {
          let lo = 0;
          for (let i = 0; i < stops.length - 1; i++) {
            if (t >= stops[i].pos && t <= stops[i + 1].pos) { lo = i; break; }
          }
          const hi = lo + 1;
          const range = stops[hi].pos - stops[lo].pos;
          const frac = range > 0 ? (t - stops[lo].pos) / range : 0;
          mr = stops[lo].r + (stops[hi].r - stops[lo].r) * frac;
          mg = stops[lo].g + (stops[hi].g - stops[lo].g) * frac;
          mb = stops[lo].b + (stops[hi].b - stops[lo].b) * frac;
        }
        // Preserve original lightness
        const mappedHsl = PaletteProcessor.rgbToHsl(mr, mg, mb);
        const preserved = PaletteProcessor.hslToRgb(mappedHsl.h, mappedHsl.s, hsl.l);
        cr = cr + (preserved.r - cr) * brandColors;
        cg = cg + (preserved.g - cg) * brandColors;
        cb = cb + (preserved.b - cb) * brandColors;
      }

      // Fade small shapes toward background colour (RGB lerp)
      const inverted = state.invertColors || false;
      const bgR = inverted ? 14 : 255;
      const bgG = inverted ? 14 : 254;
      const bgB = inverted ? 12 : 247;
      cr = bgR + (cr - bgR) * normSize;
      cg = bgG + (cg - bgG) * normSize;
      cb = bgB + (cb - bgB) * normSize;

      // Apply video color blend as final compositing step (Opt 3: use raw RGB)
      if (state.videoBlendEnabled && options.hasVideoRGB) {
        const blendAmount = (state.videoBlendAmount ?? 50) / 100;
        const blended = this._blendColorsRGB(cr, cg, cb, options.rawVideoR, options.rawVideoG, options.rawVideoB, state.videoBlendMode || 'multiply');
        cr = cr + (blended.r - cr) * blendAmount;
        cg = cg + (blended.g - cg) * blendAmount;
        cb = cb + (blended.b - cb) * blendAmount;
      }

      // Single hex conversion at end of RGB pipeline (Opt 8: LUT)
      finalFillColor = GridRenderer._rgbToHex(cr, cg, cb);
    }

    // Draw shape via Canvas2D
    ctx.fillStyle = finalFillColor;
    const sw = w * imageScale;
    const sh = h * imageScale;

    if (radius <= 0) {
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    } else {
      const path2d = this._getPath2D(sw, sh, radius);
      ctx.fill(path2d);
    }
  }

  /**
   * Draw a squircle (superellipse rounded rectangle) with iOS-style corner smoothing
   * Uses cubic bezier curves for continuous curvature corners
   * @param {number} w - Width of rectangle
   * @param {number} h - Height of rectangle
   * @param {number} radiusPercent - Corner radius as percentage (0-50)
   */
  _drawSquircle(w, h, radiusPercent) {
    const p5 = this.p;

    if (radiusPercent <= 0) {
      p5.rectMode(p5.CENTER);
      p5.rect(0, 0, w, h);
      return;
    }

    // Use cached path data when dimensions match — Map cache with rounded keys for hit rate
    const cacheKey = (Math.round(w * 100) << 20) ^ (Math.round(h * 100) << 6) ^ radiusPercent;
    let pathData = this._squircleCache.get(cacheKey);
    if (!pathData) {
      pathData = this._getSquirclePathData(w, h, radiusPercent);
      // LRU eviction: delete oldest entry when at capacity
      if (this._squircleCache.size >= this._squircleCacheMaxSize) {
        this._squircleCache.delete(this._squircleCache.keys().next().value);
      }
      this._squircleCache.set(cacheKey, pathData);
    }

    p5.beginShape();
    for (let i = 0; i < pathData.length; i++) {
      const cmd = pathData[i];
      if (cmd.type === 'move' || cmd.type === 'line') {
        p5.vertex(cmd.x, cmd.y);
      } else if (cmd.type === 'cubic') {
        p5.bezierVertex(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.x, cmd.y);
      }
    }
    p5.endShape(p5.CLOSE);
  }

  // ════════════════════════════════════════
  // Canvas2D helpers
  // ════════════════════════════════════════

  _ensureCtx() {
    if (!this.ctx) {
      this.ctx = this.p.drawingContext;
      this._dpr = this.p.pixelDensity();
    }
    return this.ctx;
  }

  _getPath2D(w, h, radiusPercent) {
    const cacheKey = (Math.round(w * 100) << 20) ^ (Math.round(h * 100) << 6) ^ radiusPercent;
    let path = this._path2dCache.get(cacheKey);
    if (path) return path;

    // Get command array (from existing squircle cache or compute)
    let pathData = this._squircleCache.get(cacheKey);
    if (!pathData) {
      pathData = this._getSquirclePathData(w, h, radiusPercent);
      if (this._squircleCache.size >= this._squircleCacheMaxSize) {
        this._squircleCache.delete(this._squircleCache.keys().next().value);
      }
      this._squircleCache.set(cacheKey, pathData);
    }

    path = new Path2D();
    for (let i = 0; i < pathData.length; i++) {
      const cmd = pathData[i];
      if (cmd.type === 'move') {
        path.moveTo(cmd.x, cmd.y);
      } else if (cmd.type === 'line') {
        path.lineTo(cmd.x, cmd.y);
      } else if (cmd.type === 'cubic') {
        path.bezierCurveTo(cmd.cp1x, cmd.cp1y, cmd.cp2x, cmd.cp2y, cmd.x, cmd.y);
      }
    }
    path.closePath();

    if (this._path2dCache.size >= this._squircleCacheMaxSize) {
      this._path2dCache.delete(this._path2dCache.keys().next().value);
    }
    this._path2dCache.set(cacheKey, path);
    return path;
  }

  _lerpColorRGB(r1, g1, b1, r2, g2, b2, t) {
    return {
      r: r1 + (r2 - r1) * t,
      g: g1 + (g2 - g1) * t,
      b: b1 + (b2 - b1) * t
    };
  }

  _blendColorsRGB(br, bg, bb, lr, lg, lb, mode) {
    let r1 = br / 255, g1 = bg / 255, b1 = bb / 255;
    let r2 = lr / 255, g2 = lg / 255, b2 = lb / 255;
    let ro, go, bo;

    switch (mode) {
      case 'multiply':
        ro = r1 * r2; go = g1 * g2; bo = b1 * b2;
        break;
      case 'screen':
        ro = 1 - (1 - r1) * (1 - r2); go = 1 - (1 - g1) * (1 - g2); bo = 1 - (1 - b1) * (1 - b2);
        break;
      case 'overlay':
        ro = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        go = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        bo = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
        break;
      case 'soft-light':
        ro = r2 < 0.5 ? r1 - (1 - 2 * r2) * r1 * (1 - r1) : r1 + (2 * r2 - 1) * (Math.sqrt(r1) - r1);
        go = g2 < 0.5 ? g1 - (1 - 2 * g2) * g1 * (1 - g1) : g1 + (2 * g2 - 1) * (Math.sqrt(g1) - g1);
        bo = b2 < 0.5 ? b1 - (1 - 2 * b2) * b1 * (1 - b1) : b1 + (2 * b2 - 1) * (Math.sqrt(b1) - b1);
        break;
      case 'hard-light':
        ro = r2 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        go = g2 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        bo = b2 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
        break;
      case 'vivid-light':
        ro = r2 <= 0.5 ? (r2 === 0 ? 0 : Math.max(0, 1 - (1 - r1) / (2 * r2))) : (r2 === 1 ? 1 : Math.min(1, r1 / (2 * (1 - r2))));
        go = g2 <= 0.5 ? (g2 === 0 ? 0 : Math.max(0, 1 - (1 - g1) / (2 * g2))) : (g2 === 1 ? 1 : Math.min(1, g1 / (2 * (1 - g2))));
        bo = b2 <= 0.5 ? (b2 === 0 ? 0 : Math.max(0, 1 - (1 - b1) / (2 * b2))) : (b2 === 1 ? 1 : Math.min(1, b1 / (2 * (1 - b2))));
        break;
      case 'linear-light':
        ro = r1 + 2 * r2 - 1; go = g1 + 2 * g2 - 1; bo = b1 + 2 * b2 - 1;
        break;
      case 'pin-light':
        ro = r2 < 0.5 ? Math.min(r1, 2 * r2) : Math.max(r1, 2 * r2 - 1);
        go = g2 < 0.5 ? Math.min(g1, 2 * g2) : Math.max(g1, 2 * g2 - 1);
        bo = b2 < 0.5 ? Math.min(b1, 2 * b2) : Math.max(b1, 2 * b2 - 1);
        break;
      case 'hard-mix':
        ro = (r1 + r2 >= 1) ? 1 : 0; go = (g1 + g2 >= 1) ? 1 : 0; bo = (b1 + b2 >= 1) ? 1 : 0;
        break;
      case 'darken':
        ro = Math.min(r1, r2); go = Math.min(g1, g2); bo = Math.min(b1, b2);
        break;
      case 'darker-color': {
        const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
        const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
        if (lum1 <= lum2) { ro = r1; go = g1; bo = b1; }
        else              { ro = r2; go = g2; bo = b2; }
        break;
      }
      case 'lighten':
        ro = Math.max(r1, r2); go = Math.max(g1, g2); bo = Math.max(b1, b2);
        break;
      case 'color-dodge':
        ro = r2 >= 1 ? 1 : Math.min(1, r1 / (1 - r2));
        go = g2 >= 1 ? 1 : Math.min(1, g1 / (1 - g2));
        bo = b2 >= 1 ? 1 : Math.min(1, b1 / (1 - b2));
        break;
      case 'color-burn':
        ro = r2 <= 0 ? 0 : Math.max(0, 1 - (1 - r1) / r2);
        go = g2 <= 0 ? 0 : Math.max(0, 1 - (1 - g1) / g2);
        bo = b2 <= 0 ? 0 : Math.max(0, 1 - (1 - b1) / b2);
        break;
      case 'linear-burn':
        ro = r1 + r2 - 1; go = g1 + g2 - 1; bo = b1 + b2 - 1;
        break;
      case 'add':
        ro = r1 + r2; go = g1 + g2; bo = b1 + b2;
        break;
      case 'subtract':
        ro = r1 - r2; go = g1 - g2; bo = b1 - b2;
        break;
      case 'divide':
        ro = r2 === 0 ? 1 : r1 / r2; go = g2 === 0 ? 1 : g1 / g2; bo = b2 === 0 ? 1 : b1 / b2;
        break;
      case 'difference':
        ro = Math.abs(r1 - r2); go = Math.abs(g1 - g2); bo = Math.abs(b1 - b2);
        break;
      case 'exclusion':
        ro = r1 + r2 - 2 * r1 * r2; go = g1 + g2 - 2 * g1 * g2; bo = b1 + b2 - 2 * b1 * b2;
        break;
      case 'xor':
        ro = ((Math.round(br) ^ Math.round(lr)) & 0xFF) / 255;
        go = ((Math.round(bg) ^ Math.round(lg)) & 0xFF) / 255;
        bo = ((Math.round(bb) ^ Math.round(lb)) & 0xFF) / 255;
        break;
      case 'average':
        ro = (r1 + r2) / 2; go = (g1 + g2) / 2; bo = (b1 + b2) / 2;
        break;
      case 'grain-extract':
        ro = r1 - r2 + 0.5; go = g1 - g2 + 0.5; bo = b1 - b2 + 0.5;
        break;
      case 'grain-merge':
        ro = r1 + r2 - 0.5; go = g1 + g2 - 0.5; bo = b1 + b2 - 0.5;
        break;
      case 'hue':
      case 'saturation':
      case 'color':
      case 'luminosity': {
        const bHsl = this._rgbToHsl(r1, g1, b1);
        const lHsl = this._rgbToHsl(r2, g2, b2);
        let h, s, l;
        if (mode === 'hue')             { h = lHsl[0]; s = bHsl[1]; l = bHsl[2]; }
        else if (mode === 'saturation') { h = bHsl[0]; s = lHsl[1]; l = bHsl[2]; }
        else if (mode === 'color')      { h = lHsl[0]; s = lHsl[1]; l = bHsl[2]; }
        else /* luminosity */           { h = bHsl[0]; s = bHsl[1]; l = lHsl[2]; }
        const rgb = this._hslToRgb(h, s, l);
        ro = rgb[0]; go = rgb[1]; bo = rgb[2];
        break;
      }
      default:
        ro = r2; go = g2; bo = b2;
    }

    return {
      r: Math.max(0, Math.min(255, ro * 255)),
      g: Math.max(0, Math.min(255, go * 255)),
      b: Math.max(0, Math.min(255, bo * 255))
    };
  }

  static _rgbToHex(r, g, b) {
    const ri = Math.round(Math.max(0, Math.min(255, r)));
    const gi = Math.round(Math.max(0, Math.min(255, g)));
    const bi = Math.round(Math.max(0, Math.min(255, b)));
    const lut = GridRenderer._hexLUT;
    return '#' + lut[ri] + lut[gi] + lut[bi];
  }

  /**
   * Compute Figma squircle corner parameters (a, b, c, d, p, arcSectionLength).
   * Based on https://github.com/phamfoo/figma-squircle (MIT license).
   * cornerSmoothing = 1.0 for full iOS-style smoothing.
   */
  static _figmaCornerParams(cornerRadius, cornerSmoothing, roundingAndSmoothingBudget) {
    const toRad = (deg) => (deg * Math.PI) / 180;

    let p = (1 + cornerSmoothing) * cornerRadius;

    // Clamp smoothing so corners don't overlap
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
   * Uses SVG arc commands (handled natively by SVG renderers).
   * Origin at top-left corner, coordinates are absolute.
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

    // Top-right corner
    path += ` c ${r(a)} 0 ${r(a + b)} 0 ${r(a + b + c)} ${r(d)}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(arcSectionLength)} ${r(arcSectionLength)}`;
    path += ` c ${r(d)} ${r(c)} ${r(d)} ${r(b + c)} ${r(d)} ${r(a + b + c)}`;

    // Right edge
    path += ` L ${r(width)} ${r(height - p)}`;

    // Bottom-right corner
    path += ` c 0 ${r(a)} 0 ${r(a + b)} ${r(-d)} ${r(a + b + c)}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(-arcSectionLength)} ${r(arcSectionLength)}`;
    path += ` c ${r(-c)} ${r(d)} ${r(-(b + c))} ${r(d)} ${r(-(a + b + c))} ${r(d)}`;

    // Bottom edge
    path += ` L ${r(p)} ${r(height)}`;

    // Bottom-left corner
    path += ` c ${r(-a)} 0 ${r(-(a + b))} 0 ${r(-(a + b + c))} ${r(-d)}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(-arcSectionLength)} ${r(-arcSectionLength)}`;
    path += ` c ${r(-d)} ${r(-c)} ${r(-d)} ${r(-(b + c))} ${r(-d)} ${r(-(a + b + c))}`;

    // Left edge
    path += ` L 0 ${r(p)}`;

    // Top-left corner
    path += ` c 0 ${r(-a)} 0 ${r(-(a + b))} ${r(d)} ${r(-(a + b + c))}`;
    path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(arcSectionLength)} ${r(-arcSectionLength)}`;
    path += ` c ${r(c)} ${r(-d)} ${r(b + c)} ${r(-d)} ${r(a + b + c)} ${r(-d)}`;

    path += ' Z';
    return path;
  }

  /**
   * Generate squircle path data as an array of {type, x, y, cp1x, cp1y, cp2x, cp2y} commands.
   * Uses Figma's squircle algorithm with 100% corner smoothing.
   * Arc segments are converted to cubic beziers for p5.js compatibility.
   * Origin is at center of rectangle.
   */
  _getSquirclePathData(w, h, radiusPercent) {
    const minDim = Math.min(w, h);
    const cornerRadius = Math.min((radiusPercent / 100) * minDim, minDim / 2);
    const hw = w / 2;
    const hh = h / 2;

    if (cornerRadius <= 0) {
      return [
        { type: 'move', x: -hw, y: -hh },
        { type: 'line', x: hw, y: -hh },
        { type: 'line', x: hw, y: hh },
        { type: 'line', x: -hw, y: hh },
      ];
    }

    // Generate Figma SVG path with origin at top-left, then parse and shift to center
    const svgPath = GridRenderer._figmaSvgPath(w, h, cornerRadius, 1.0);
    return GridRenderer._svgPathToCommands(svgPath, -hw, -hh);
  }

  /**
   * Parse an SVG path string (with relative c and a commands) into absolute command objects.
   * Applies an offset (ox, oy) to shift origin.
   * Converts SVG arc commands to cubic bezier approximations.
   */
  static _svgPathToCommands(d, ox, oy) {
    const cmds = [];
    // Tokenize: split into command letter + numbers
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
        // Relative cubic bezier
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
        // Relative arc — convert to cubic bezier
        const rx = num(), ry = num();
        const xRot = num(), largeArc = num(), sweep = num();
        const dx = num(), dy = num();
        const endX = curX + dx, endY = curY + dy;

        // Convert SVG arc endpoint parameterization to center parameterization
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
        // Close path — handled by p5's endShape(CLOSE)
      }
    }
    return cmds;
  }

  /**
   * Convert SVG arc (endpoint parameterization) to cubic bezier curves.
   * Standard algorithm from SVG spec + arc-to-bezier conversion.
   */
  static _arcToCubicBeziers(x1, y1, x2, y2, rx, ry, xAxisRotation, largeArcFlag, sweepFlag) {
    // Degenerate arc (zero length) — skip
    if (Math.abs(x1 - x2) < 1e-6 && Math.abs(y1 - y2) < 1e-6) return [];
    if (rx < 1e-6 || ry < 1e-6) return [];

    // Based on https://www.w3.org/TR/SVG/implnote.html#ArcConversionEndpointToCenter
    const toRad = (deg) => (deg * Math.PI) / 180;
    const phi = toRad(xAxisRotation);
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    // Step 1: Compute (x1', y1')
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    // Step 2: Compute (cx', cy')
    let rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;

    // Ensure radii are large enough
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

    // Step 3: Compute (cx, cy)
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    // Step 4: Compute theta1 and dtheta
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

    // Split arc into segments of at most 90 degrees
    const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
    const segAngle = dtheta / segments;
    const results = [];

    for (let s = 0; s < segments; s++) {
      const t1 = theta1 + s * segAngle;
      const t2 = t1 + segAngle;
      // Convert arc segment to cubic bezier
      const alpha = (4 / 3) * Math.tan(segAngle / 4);

      const cos1 = Math.cos(t1), sin1 = Math.sin(t1);
      const cos2 = Math.cos(t2), sin2 = Math.sin(t2);

      // Points on the ellipse (before rotation)
      const ep1x = rx * cos1, ep1y = ry * sin1;
      const ep2x = rx * cos2, ep2y = ry * sin2;

      // Control points (before rotation)
      const ecp1x = ep1x - alpha * rx * sin1;
      const ecp1y = ep1y + alpha * ry * cos1;
      const ecp2x = ep2x + alpha * rx * sin2;
      const ecp2y = ep2y - alpha * ry * cos2;

      // Apply rotation and translation
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

  /**
   * Apply gradient ring effect: push offset translation + ring-based scaling.
   * Ring influence and scale are pre-computed in render()'s pre-pass (Opt 4).
   */
  _applyGradientRing(options, w, h, state) {
    // Transform is now handled directly in _drawShape via setTransform (Opt 9)
    // This method only returns cached values for callers that need them
    const result = this._ringResult;
    const index = options.index;
    result.scaleInfluence = this._ringInfluenceCache[index];
    result.scaleValue = this._ringScaleCache[index];
    return result;
  }

  /**
   * Lerp between two hex colors using direct RGB math (no p5.Color allocations)
   * Returns a hex string '#RRGGBB'
   */
  _lerpColor(color1, color2, t) {
    const c1 = parseInt(typeof color1 === 'string' ? color1.slice(1) : '0E0E0C', 16);
    const c2 = parseInt(typeof color2 === 'string' ? color2.slice(1) : '0E0E0C', 16);
    const r1 = (c1 >> 16) & 0xFF, g1 = (c1 >> 8) & 0xFF, b1 = c1 & 0xFF;
    const r2 = (c2 >> 16) & 0xFF, g2 = (c2 >> 8) & 0xFF, b2 = c2 & 0xFF;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /**
   * Blend two hex colors using a Photoshop-style blend mode.
   * @param {string} baseHex - Base color '#RRGGBB'
   * @param {string} blendHex - Blend color '#RRGGBB'
   * @param {string} mode - Blend mode name
   * @returns {string} Result '#RRGGBB'
   */
  _blendColors(baseHex, blendHex, mode) {
    const cb = parseInt(baseHex.slice(1), 16);
    const cl = parseInt(blendHex.slice(1), 16);
    let br = (cb >> 16) & 0xFF, bg = (cb >> 8) & 0xFF, bb = cb & 0xFF;
    let lr = (cl >> 16) & 0xFF, lg = (cl >> 8) & 0xFF, lb = cl & 0xFF;

    // Normalize to 0-1
    let r1 = br / 255, g1 = bg / 255, b1 = bb / 255;
    let r2 = lr / 255, g2 = lg / 255, b2 = lb / 255;
    let ro, go, bo;

    switch (mode) {
      case 'multiply':
        ro = r1 * r2; go = g1 * g2; bo = b1 * b2;
        break;
      case 'screen':
        ro = 1 - (1 - r1) * (1 - r2); go = 1 - (1 - g1) * (1 - g2); bo = 1 - (1 - b1) * (1 - b2);
        break;
      case 'overlay':
        ro = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        go = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        bo = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
        break;
      case 'soft-light':
        ro = r2 < 0.5 ? r1 - (1 - 2 * r2) * r1 * (1 - r1) : r1 + (2 * r2 - 1) * (Math.sqrt(r1) - r1);
        go = g2 < 0.5 ? g1 - (1 - 2 * g2) * g1 * (1 - g1) : g1 + (2 * g2 - 1) * (Math.sqrt(g1) - g1);
        bo = b2 < 0.5 ? b1 - (1 - 2 * b2) * b1 * (1 - b1) : b1 + (2 * b2 - 1) * (Math.sqrt(b1) - b1);
        break;
      case 'hard-light':
        ro = r2 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        go = g2 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        bo = b2 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
        break;
      case 'vivid-light':
        ro = r2 <= 0.5 ? (r2 === 0 ? 0 : Math.max(0, 1 - (1 - r1) / (2 * r2))) : (r2 === 1 ? 1 : Math.min(1, r1 / (2 * (1 - r2))));
        go = g2 <= 0.5 ? (g2 === 0 ? 0 : Math.max(0, 1 - (1 - g1) / (2 * g2))) : (g2 === 1 ? 1 : Math.min(1, g1 / (2 * (1 - g2))));
        bo = b2 <= 0.5 ? (b2 === 0 ? 0 : Math.max(0, 1 - (1 - b1) / (2 * b2))) : (b2 === 1 ? 1 : Math.min(1, b1 / (2 * (1 - b2))));
        break;
      case 'linear-light':
        ro = r1 + 2 * r2 - 1; go = g1 + 2 * g2 - 1; bo = b1 + 2 * b2 - 1;
        break;
      case 'pin-light':
        ro = r2 < 0.5 ? Math.min(r1, 2 * r2) : Math.max(r1, 2 * r2 - 1);
        go = g2 < 0.5 ? Math.min(g1, 2 * g2) : Math.max(g1, 2 * g2 - 1);
        bo = b2 < 0.5 ? Math.min(b1, 2 * b2) : Math.max(b1, 2 * b2 - 1);
        break;
      case 'hard-mix':
        ro = (r1 + r2 >= 1) ? 1 : 0; go = (g1 + g2 >= 1) ? 1 : 0; bo = (b1 + b2 >= 1) ? 1 : 0;
        break;
      case 'darken':
        ro = Math.min(r1, r2); go = Math.min(g1, g2); bo = Math.min(b1, b2);
        break;
      case 'darker-color': {
        const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
        const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
        if (lum1 <= lum2) { ro = r1; go = g1; bo = b1; }
        else              { ro = r2; go = g2; bo = b2; }
        break;
      }
      case 'lighten':
        ro = Math.max(r1, r2); go = Math.max(g1, g2); bo = Math.max(b1, b2);
        break;
      case 'color-dodge':
        ro = r2 >= 1 ? 1 : Math.min(1, r1 / (1 - r2));
        go = g2 >= 1 ? 1 : Math.min(1, g1 / (1 - g2));
        bo = b2 >= 1 ? 1 : Math.min(1, b1 / (1 - b2));
        break;
      case 'color-burn':
        ro = r2 <= 0 ? 0 : Math.max(0, 1 - (1 - r1) / r2);
        go = g2 <= 0 ? 0 : Math.max(0, 1 - (1 - g1) / g2);
        bo = b2 <= 0 ? 0 : Math.max(0, 1 - (1 - b1) / b2);
        break;
      case 'linear-burn':
        ro = r1 + r2 - 1; go = g1 + g2 - 1; bo = b1 + b2 - 1;
        break;
      case 'add':
        ro = r1 + r2; go = g1 + g2; bo = b1 + b2;
        break;
      case 'subtract':
        ro = r1 - r2; go = g1 - g2; bo = b1 - b2;
        break;
      case 'divide':
        ro = r2 === 0 ? 1 : r1 / r2; go = g2 === 0 ? 1 : g1 / g2; bo = b2 === 0 ? 1 : b1 / b2;
        break;
      case 'difference':
        ro = Math.abs(r1 - r2); go = Math.abs(g1 - g2); bo = Math.abs(b1 - b2);
        break;
      case 'exclusion':
        ro = r1 + r2 - 2 * r1 * r2; go = g1 + g2 - 2 * g1 * g2; bo = b1 + b2 - 2 * b1 * b2;
        break;
      case 'xor':
        ro = ((br ^ lr) & 0xFF) / 255; go = ((bg ^ lg) & 0xFF) / 255; bo = ((bb ^ lb) & 0xFF) / 255;
        break;
      case 'average':
        ro = (r1 + r2) / 2; go = (g1 + g2) / 2; bo = (b1 + b2) / 2;
        break;
      case 'grain-extract':
        ro = r1 - r2 + 0.5; go = g1 - g2 + 0.5; bo = b1 - b2 + 0.5;
        break;
      case 'grain-merge':
        ro = r1 + r2 - 0.5; go = g1 + g2 - 0.5; bo = b1 + b2 - 0.5;
        break;
      case 'hue':
      case 'saturation':
      case 'color':
      case 'luminosity': {
        // HSL-based blend modes
        const bHsl = this._rgbToHsl(r1, g1, b1);
        const lHsl = this._rgbToHsl(r2, g2, b2);
        let h, s, l;
        if (mode === 'hue')        { h = lHsl[0]; s = bHsl[1]; l = bHsl[2]; }
        else if (mode === 'saturation') { h = bHsl[0]; s = lHsl[1]; l = bHsl[2]; }
        else if (mode === 'color')      { h = lHsl[0]; s = lHsl[1]; l = bHsl[2]; }
        else /* luminosity */           { h = bHsl[0]; s = bHsl[1]; l = lHsl[2]; }
        const rgb = this._hslToRgb(h, s, l);
        ro = rgb[0]; go = rgb[1]; bo = rgb[2];
        break;
      }
      default:
        ro = r2; go = g2; bo = b2;
    }

    const rr = Math.round(Math.max(0, Math.min(1, ro)) * 255);
    const rg = Math.round(Math.max(0, Math.min(1, go)) * 255);
    const rb = Math.round(Math.max(0, Math.min(1, bo)) * 255);
    return '#' + ((1 << 24) | (rr << 16) | (rg << 8) | rb).toString(16).slice(1);
  }

  _rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, l];
  }

  _hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1/3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1/3)];
  }

  /**
   * Apply per-shape transformations - override for animation effects
   */
  _applyShapeTransform(options) {
    // Base implementation does nothing
    // Subclasses can override for wave effects, rotations, etc.
  }

  /**
   * Get shape at grid position
   */
  getShapeAt(col, row) {
    const cols = stateManager.get('gridDensity') || 60;
    return this.shapes[row * cols + col];
  }

  /**
   * Reset all push offsets
   */
  resetPushOffsets() {
    for (let i = 0; i < this._pushOffsets.length; i++) {
      this._pushOffsets[i].x = 0;
      this._pushOffsets[i].y = 0;
    }
  }

  /**
   * Reset all manual scale offsets
   */
  resetManualScaleOffsets() {
    for (let i = 0; i < this._manualScaleOffsets.length; i++) {
      this._manualScaleOffsets[i] = 1.0;
    }
  }

  /**
   * Apply manual scale adjustment when paused with mouse held
   * @param {number} mouseX - Mouse X position
   * @param {number} mouseY - Mouse Y position
   * @param {boolean} isLeftButton - True for grow, false for shrink
   * @param {number} deltaTime - Time since last frame in seconds
   */
  applyManualScale(mouseX, mouseY, isLeftButton, deltaTime) {
    if (!this._isPaused) return;

    const state = stateManager.getAll();
    const cols = state.gridDensity || 60;
    const cubeHeight = this.p.width / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1;
    const spacingY = cubeHeight * 0.1;
    const rows = Math.ceil(this.p.height / (cubeHeight + spacingY)) + 1;
    const radius = state.ringRadius || 150;
    const falloffType = 'smooth';
    const scaleMin = (state.scaleMin ?? 100) / 100;
    const scaleMax = (state.scaleMax ?? 150) / 100;

    const gridSize = cols * rows;

    // Ensure arrays are sized for the current grid (update() doesn't run while paused)
    if (gridSize !== this._lastGridSize) {
      const oldOffsets = this._manualScaleOffsets;
      const oldPush = this._pushOffsets;
      this._manualScaleOffsets = [];
      this._pushOffsets = [];
      for (let i = 0; i < gridSize; i++) {
        this._manualScaleOffsets.push(oldOffsets[i] !== undefined ? oldOffsets[i] : 1.0);
        this._pushOffsets.push(oldPush[i] || { x: 0, y: 0 });
      }
      this._lastGridSize = gridSize;
    }

    // Rate of change per second (multiplier change)
    const adjustRate = 2.0; // Doubles/halves in ~0.5 seconds at full falloff

    // Calculate grid offset
    const totalWidth = cols * cubeWidth + (cols - 1) * spacingX;
    const totalHeight = rows * cubeHeight + (rows - 1) * spacingY;
    const offsetX = (this.p.width - totalWidth) / 2;
    const offsetY = (this.p.height - totalHeight) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;

        // Calculate shape center
        let x = offsetX + col * (cubeWidth + spacingX) + cubeWidth / 2;
        let y = offsetY + row * (cubeHeight + spacingY) + cubeHeight / 2;

        // Row offset always 50% on odd rows
        if (row % 2 === 1) {
          x += (cubeWidth + spacingX) * 0.5;
        }

        // Get falloff at this position
        const falloff = cursorTracker.getFalloffAt(mouseX, mouseY, x, y, radius, falloffType);

        if (falloff > 0) {
          // Calculate adjustment amount based on falloff and time
          const adjustment = falloff * adjustRate * deltaTime;

          if (isLeftButton) {
            // Grow - increase multiplier
            this._manualScaleOffsets[index] *= (1 + adjustment);
          } else {
            // Shrink - decrease multiplier
            this._manualScaleOffsets[index] *= (1 - adjustment);
          }

          // Clamp multiplier to keep final scale within bounds
          // If base scale * multiplier should stay in [scaleMin, scaleMax]
          // Assuming base scale can vary, we clamp the multiplier reasonably
          const minMultiplier = 0.01; // Don't go below 1% of original
          const maxMultiplier = scaleMax / scaleMin; // Allow scaling up to max from min
          this._manualScaleOffsets[index] = Math.max(minMultiplier, Math.min(maxMultiplier, this._manualScaleOffsets[index]));
        }
      }
    }
  }

  /**
   * Get manual scale multiplier for a shape
   */
  getManualScaleMultiplier(index) {
    if (index >= 0 && index < this._manualScaleOffsets.length) {
      return this._manualScaleOffsets[index];
    }
    return 1.0;
  }

  /**
   * Export current grid state to SVG
   * @returns {string} SVG content as string
   */
  exportSVG() {
    const p = this.p;
    const state = stateManager.getAll();

    // Grid density drives all grid dimensions (same as render)
    const cols = state.gridDensity || 60;
    const cubeHeight = p.width / (cols * 4.4);
    const cubeWidth = cubeHeight * 4;
    const spacingX = cubeHeight * 0.1;
    const spacingY = cubeHeight * 0.1;
    const rows = Math.ceil(p.height / (cubeHeight + spacingY)) + 1;
    const cornerRadius = 25;
    const inverted = state.invertColors || false;
    const fillColor = inverted ? '#FFFEF7' : '#0E0E0C';

    // Image sampler settings
    const imageSamplerEnabled = state.imageSamplerEnabled && imageSampler && imageSampler.hasImage();
    const imageColorOpacity = (state.imageColorOpacity ?? 100) / 100;
    const imageBrightnessToScale = state.imageBrightnessToScale || false;
    const imageBrightnessScaleMin = (state.imageBrightnessScaleMin ?? 0) / 100;
    const imageBrightnessScaleMax = (state.imageBrightnessScaleMax ?? 100) / 100;
    const imageSaturationToScale = state.imageSaturationToScale || false;
    const imageSaturationScaleMin = (state.imageSaturationScaleMin ?? 0) / 100;
    const imageSaturationScaleMax = (state.imageSaturationScaleMax ?? 100) / 100;

    // Canvas dimensions
    const canvasWidth = p.width;
    const canvasHeight = p.height;

    // Calculate total grid size for centering
    const totalWidth = cols * cubeWidth + (cols - 1) * spacingX;
    const totalHeight = rows * cubeHeight + (rows - 1) * spacingY;
    const offsetX = (canvasWidth - totalWidth) / 2;
    const offsetY = (canvasHeight - totalHeight) / 2;

    // Ensure image sampler settings are applied for export
    if (imageSampler) {
      if (state.imageMappingMode) {
        imageSampler.setMappingMode(state.imageMappingMode);
      }
      imageSampler.setTransform(
        state.imagePositionX ?? 50,
        state.imagePositionY ?? 50,
        state.imageScaleX ?? 100,
        state.imageScaleY ?? 100,
        state.imageRotation ?? 0
      );
    }

    // Ensure image colors are cached for export
    if (imageSamplerEnabled) {
      imageSampler.cacheGridColors(cols, rows);
    }

    // Sync palette processor from UI state for export
    const isColourModeExport = state.colorMode || false;
    if (isColourModeExport && typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      paletteProcessor.syncFromState();
    }

    // Build SVG using array for efficiency with large grids
    const svgParts = [];
    svgParts.push(`<?xml version="1.0" encoding="UTF-8"?>\n`);
    svgParts.push(`<svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">\n`);

    // Generate rectangles
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;

        let x = offsetX + col * (cubeWidth + spacingX);
        let y = offsetY + row * (cubeHeight + spacingY);

        if (row % 2 === 1) {
          x += (cubeWidth + spacingX) * 0.5;
        }

        const cellWidth = cubeWidth;
        const cellHeight = cubeHeight;
        const centerX = x + cubeWidth / 2;
        const centerY = y + cubeHeight / 2;

        // Calculate color
        let shapeFillColor = fillColor;
        let imageBrightness = 1;
        let imageSaturation = 0;
        let rawVideoColor = null;

        // Sample brightness/saturation for scale even when colour mode is off
        if (imageSamplerEnabled) {
          const sample = imageSampler.getCachedColor(index);
          if (sample) {
            imageBrightness = isFinite(sample.brightness) ? sample.brightness : 0;
            imageSaturation = isFinite(sample.saturation) ? sample.saturation : 0;

            // Only apply image colors when colour mode is active
            if (isColourModeExport) {
              let sr = sample.r, sg = sample.g, sb = sample.b;
              if (state.invertImage) { sr = 255 - sr; sg = 255 - sg; sb = 255 - sb; }
              const hueOff = state.imageHueOffset || 0;
              if (hueOff !== 0) {
                const hsl = PaletteProcessor.rgbToHsl(sr, sg, sb);
                hsl.h = (hsl.h + hueOff + 360) % 360;
                const shifted = PaletteProcessor.hslToRgb(hsl.h, hsl.s, hsl.l);
                sr = shifted.r; sg = shifted.g; sb = shifted.b;
              }
              const sHex = GridRenderer._rgbToHex(sr, sg, sb);
              rawVideoColor = sHex;

              // Get image color (with opacity applied)
              if (imageColorOpacity >= 1) {
                shapeFillColor = sHex;
              } else if (imageColorOpacity > 0) {
                shapeFillColor = this._lerpColorHex(fillColor, sHex, imageColorOpacity);
              }
            }
          }
        }

        // Image-based scales applied to path dimensions (not as transforms)
        // to guarantee scaling from local center
        let imageScale = 1;

        if (imageBrightnessToScale && imageSamplerEnabled) {
          imageScale *= imageBrightnessScaleMin +
            (imageBrightnessScaleMax - imageBrightnessScaleMin) * imageBrightness;
        }

        if (imageSaturationToScale && imageSamplerEnabled) {
          imageScale *= imageSaturationScaleMin +
            (imageSaturationScaleMax - imageSaturationScaleMin) * imageSaturation;
        }

        // Transform-based scales (cursor + manual)
        let transformScale = 1;

        const cursorScale = this._computeCursorScale(centerX, centerY, index, state);
        transformScale *= cursorScale.scale;

        if (this._manualScaleOffsets[index] !== undefined && this._manualScaleOffsets[index] !== 1.0) {
          transformScale *= this._manualScaleOffsets[index];
        }

        const totalScale = imageScale * transformScale;

        // Skip shapes with zero, NaN, or infinite scale
        if (!(totalScale > 0) || !isFinite(totalScale)) {
          continue;
        }

        // Ensure fill color is a valid string
        if (typeof shapeFillColor !== 'string') {
          shapeFillColor = fillColor;
        }

        // Get push offset (gradient ring velocity push)
        let pushX = 0, pushY = 0;
        if (this._pushOffsets[index]) {
          pushX = isFinite(this._pushOffsets[index].x) ? this._pushOffsets[index].x : 0;
          pushY = isFinite(this._pushOffsets[index].y) ? this._pushOffsets[index].y : 0;
        }

        // Push offsets are in unscaled coordinates (image-based scales are
        // applied to dimensions, not as transforms)
        const finalCenterX = centerX + pushX;
        const finalCenterY = centerY + pushY;

        // Build transform string
        const transforms = [];

        // Skip shapes with invalid coordinates
        if (!isFinite(finalCenterX) || !isFinite(finalCenterY)) {
          continue;
        }

        transforms.push(`translate(${finalCenterX.toFixed(2)}, ${finalCenterY.toFixed(2)})`);

        // Transform-based scale (cursor + manual only)
        if (transformScale !== 1) {
          transforms.push(`scale(${transformScale.toFixed(4)})`);
        }

        // Build SVG path with image-based scale applied to dimensions
        const pathD = this._getSquirclePath(cellWidth * imageScale, cellHeight * imageScale, cornerRadius);

        let el = `  <path d="${pathD}"`;

        if (transforms.length > 0) {
          el += ` transform="${transforms.join(' ')}"`;
        }

        // Size fade & palette processing: when colour mode is on
        let svgOpacity = 1;
        if (isColourModeExport) {
          const sMin = (state.scaleMin ?? 100) / 100;
          const sMax = (state.scaleMax ?? 150) / 100;
          const range = sMax - sMin;
          const normSize = range > 0 ? Math.max(0, Math.min(1, (totalScale - sMin) / range)) : 1;

          // Apply palette processing if loaded
          if (typeof paletteProcessor !== 'undefined' && paletteProcessor && paletteProcessor.hasSettings()) {
            shapeFillColor = paletteProcessor.processColor(
              centerX / canvasWidth,
              centerY / canvasHeight,
              normSize,
              shapeFillColor
            );
          }

          // Fade small shapes towards background colour
          const bgColor = inverted ? '#0E0E0C' : '#FFFEF7';
          shapeFillColor = this._lerpColorHex(bgColor, shapeFillColor, normSize);

          // // Opacity fade (alternative — uncomment to use transparency instead)
          // svgOpacity = normSize;
          // if (svgOpacity <= 0) continue;

          // Apply video color blend as final compositing step
          if (state.videoBlendEnabled && rawVideoColor) {
            const blendAmount = (state.videoBlendAmount ?? 50) / 100;
            const blended = this._blendColors(shapeFillColor, rawVideoColor, state.videoBlendMode || 'multiply');
            shapeFillColor = this._lerpColor(shapeFillColor, blended, blendAmount);
          }
        }

        el += ` fill="${shapeFillColor}" stroke="none"`;

        if (isColourModeExport && svgOpacity < 1) {
          el += ` opacity="${svgOpacity.toFixed(3)}"`;
        }

        el += `/>\n`;
        svgParts.push(el);
      }
    }

    svgParts.push(`</svg>`);

    return svgParts.join('');
  }

  /**
   * Compute cursor-based scale for SVG export
   * Replicates gradient ring logic but returns values instead of applying transforms (for SVG export)
   */
  _computeCursorScale(centerX, centerY, index, state) {
    const result = { scale: 1, influence: 0 };

    const scaleMin = (state.scaleMin ?? 100) / 100;
    const scaleMax = (state.scaleMax ?? 150) / 100;

    const ringRadius = state.ringRadius ?? 150;
    const thickness = state.ringThickness ?? 40;
    const innerSoft = (state.ringInnerSoftness ?? 50) / 100;
    const outerSoft = (state.ringOuterSoftness ?? 50) / 100;
    const innerNoise = state.ringInnerNoise ?? 0;
    const outerNoise = state.ringOuterNoise ?? 0;
    const noiseScale = state.ringNoiseScale ?? 2;
    const noiseSeed = state.ringNoiseSeed ?? 0;

    const cx = this.p.width / 2;
    const cy = this.p.height / 2;
    const dx = centerX - cx;
    const dy = centerY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const halfThick = thickness / 2;
    let innerEdge = ringRadius - halfThick;
    let outerEdge = ringRadius + halfThick;

    // Apply independent noise to inner and outer edges based on angle
    // Sample noise on a circle in 2D space for seamless wrapping
    if ((innerNoise > 0 || outerNoise > 0) && dist > 0.001) {
      const angle = Math.atan2(dy, dx);
      const nx = Math.cos(angle) * noiseScale;
      const ny = Math.sin(angle) * noiseScale;
      const seedOff = noiseSeed * 7.31;
      if (innerNoise > 0) {
        const n = (this.p.noise(nx + 50 + seedOff, ny + 50 + seedOff) - 0.5) * 2;
        innerEdge += n * innerNoise;
      }
      if (outerNoise > 0) {
        const n = (this.p.noise(nx + 150 + seedOff, ny + 150 + seedOff) - 0.5) * 2;
        outerEdge += n * outerNoise;
      }
    }

    // Centered feather — half extends beyond edge, half eats into band
    const innerFalloffWidth = innerSoft * halfThick;
    const outerFalloffWidth = outerSoft * halfThick;

    const innerFeatherStart = innerEdge - innerFalloffWidth * 0.7;
    const innerFeatherEnd   = innerEdge + innerFalloffWidth * 0.3;
    const outerFeatherStart = outerEdge - outerFalloffWidth * 0.3;
    const outerFeatherEnd   = outerEdge + outerFalloffWidth * 0.7;

    let ringInfluence = 0;
    if (dist >= innerFeatherEnd && dist <= outerFeatherStart) {
      ringInfluence = 1;
    } else if (dist >= innerFeatherStart && dist < innerFeatherEnd && innerFalloffWidth > 0) {
      const t = (dist - innerFeatherStart) / innerFalloffWidth;
      ringInfluence = t * t * (3 - 2 * t);
    } else if (dist > outerFeatherStart && dist <= outerFeatherEnd && outerFalloffWidth > 0) {
      const t = (outerFeatherEnd - dist) / outerFalloffWidth;
      ringInfluence = t * t * (3 - 2 * t);
    }

    result.scale = scaleMin + (scaleMax - scaleMin) * ringInfluence;
    result.influence = ringInfluence;
    return result;
  }

  /**
   * Lerp between two hex colors and return hex (for SVG export)
   */
  _lerpColorHex(color1, color2, t) {
    if (!isFinite(t)) t = 0;
    return this._lerpColor(color1, color2, t);
  }

  /**
   * Generate SVG path data for a squircle (smoothed corner rectangle)
   * Centered at origin (0,0)
   * @param {number} w - Width of rectangle
   * @param {number} h - Height of rectangle
   * @param {number} radiusPercent - Corner radius as percentage (0-50)
   * @returns {string} SVG path d attribute value
   */
  _getSquirclePath(w, h, radiusPercent) {
    const hw = w / 2;
    const hh = h / 2;

    if (radiusPercent <= 0) {
      return `M ${(-hw).toFixed(2)} ${(-hh).toFixed(2)} L ${hw.toFixed(2)} ${(-hh).toFixed(2)} L ${hw.toFixed(2)} ${hh.toFixed(2)} L ${(-hw).toFixed(2)} ${hh.toFixed(2)} Z`;
    }

    const minDim = Math.min(w, h);
    const cornerRadius = Math.min((radiusPercent / 100) * minDim, minDim / 2);

    // Generate path with origin at top-left, then translate to center
    const topLeftPath = GridRenderer._figmaSvgPath(w, h, cornerRadius, 1.0);

    // Parse the Figma path (top-left origin) and re-emit with center origin offset.
    // This also converts any arc commands to cubic beziers for wider SVG compatibility.
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

// Static hex lookup table for _rgbToHex (Opt 8)
GridRenderer._hexLUT = new Array(256);
for (let i = 0; i < 256; i++) {
  GridRenderer._hexLUT[i] = (i < 16 ? '0' : '') + i.toString(16);
}

/**
 * AnimatedGridRenderer - Grid with animation support and cursor interaction
 */
class AnimatedGridRenderer extends GridRenderer {
  constructor(p5Instance) {
    super(p5Instance);
    this.animationEnabled = false;
    this.animationType = 'none';
    this.animationSpeed = 1;
    this.animationAmount = 10;
  }

  _applyShapeTransform(options) {
    if (!this.animationEnabled) return;

    const ctx = this._ensureCtx();
    const { row, col, index } = options;

    switch (this.animationType) {
      case 'wave':
        const waveOffset = Math.sin(this.time * this.animationSpeed + index * 0.2) * this.animationAmount;
        ctx.translate(0, waveOffset);
        break;
      case 'pulse':
        const scale = 1 + Math.sin(this.time * this.animationSpeed + index * 0.1) * 0.1;
        ctx.scale(scale, scale);
        break;
      case 'rotate':
        const rotation = Math.sin(this.time * this.animationSpeed + index * 0.15) * (Math.PI / 8);
        ctx.rotate(rotation);
        break;
    }
  }

  setAnimation(type, speed = 1, amount = 10) {
    this.animationType = type;
    this.animationSpeed = speed;
    this.animationAmount = amount;
    this.animationEnabled = type !== 'none';
  }
}
