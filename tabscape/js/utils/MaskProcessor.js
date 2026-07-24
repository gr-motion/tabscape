/**
 * MaskProcessor - Computes per-cell mask values (0-1) for the grid.
 * Supports two modes: ring mask (tab loop) and custom image mask.
 */
class MaskProcessor {
  constructor(p5Instance) {
    this.p = p5Instance;
    this._maskValues = null;
    this._prevMaskValues = null;
    this._gridSize = 0;

    // Noise LUTs for ring mask (64 angle buckets)
    this._noiseAngleBuckets = 64;
    this._innerNoiseLUT = new Float32Array(64);
    this._outerNoiseLUT = new Float32Array(64);
  }

  /**
   * Ensure internal arrays match grid size
   */
  _ensureSize(gridSize) {
    if (this._gridSize !== gridSize || !this._maskValues) {
      this._maskValues = new Float32Array(gridSize);
      this._prevMaskValues = new Float32Array(gridSize);
      this._gridSize = gridSize;
    }
  }

  /**
   * Compute ring mask (ported from loop-generator-v4).
   * Returns Float32Array of mask values (0-1) per cell.
   */
  computeRingMask(cols, rows, posX, posY, cubeW, cubeH, canvasW, canvasH, state, layoutW, layoutH, noiseEvolution = 0) {
    const gridSize = cols * rows;
    this._ensureSize(gridSize);

    // Ring parameters are authored against a reference layout width so the
    // ring scales with the composition (tabs/texture) as the window resizes,
    // instead of floating at a fixed pixel radius.
    const REFERENCE_LAYOUT_W = 1400;
    const refW = (layoutW && layoutW > 0) ? layoutW : canvasW;
    const ringScale = refW / REFERENCE_LAYOUT_W;
    const ringRadius = (state.maskRingRadius ?? 200) * ringScale;
    const thickness = (state.maskRingThickness ?? 100) * ringScale;
    const innerSoft = (state.maskInnerSoftness ?? 100) / 100;
    const outerSoft = (state.maskOuterSoftness ?? 100) / 100;
    const halfThick = thickness / 2;
    const baseInnerEdge = ringRadius - halfThick;
    const baseOuterEdge = ringRadius + halfThick;
    const innerFalloffWidth = innerSoft * halfThick;
    const outerFalloffWidth = outerSoft * halfThick;
    const ringCX = canvasW / 2;
    const ringCY = canvasH / 2;

    // Pre-compute noise LUTs
    const ringInnerNoise = (state.maskRingInnerNoise ?? 0) * ringScale;
    const ringOuterNoise = (state.maskRingOuterNoise ?? 0) * ringScale;
    if (ringInnerNoise > 0 || ringOuterNoise > 0) {
      const noiseScale = state.maskRingNoiseScale ?? 0.5;
      const noiseSeed = state.maskNoiseSeed ?? 0;
      const seedOff = noiseSeed * 7.31;
      const buckets = this._noiseAngleBuckets;
      const step = (2 * Math.PI) / buckets;
      for (let i = 0; i < buckets; i++) {
        const angle = i * step - Math.PI;
        const nx = Math.cos(angle) * noiseScale;
        const ny = Math.sin(angle) * noiseScale;
        if (ringInnerNoise > 0) {
          this._innerNoiseLUT[i] = (this.p.noise(nx + 50 + seedOff, ny + 50 + seedOff, noiseEvolution) - 0.5) * 2;
        }
        if (ringOuterNoise > 0) {
          this._outerNoiseLUT[i] = (this.p.noise(nx + 150 + seedOff, ny + 150 + seedOff, noiseEvolution + 17.3) - 0.5) * 2;
        }
      }
    }

    // Per-cell ring influence
    for (let i = 0; i < gridSize; i++) {
      const centerX = posX[i] + cubeW / 2;
      const centerY = posY[i] + cubeH / 2;
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

      let influence = 0;
      const innerFeatherStart = innerEdge - innerFalloffWidth * 0.7;
      const innerFeatherEnd   = innerEdge + innerFalloffWidth * 0.3;
      const outerFeatherStart = outerEdge - outerFalloffWidth * 0.3;
      const outerFeatherEnd   = outerEdge + outerFalloffWidth * 0.7;

      if (dist >= innerFeatherEnd && dist <= outerFeatherStart) {
        influence = 1;
      } else if (dist >= innerFeatherStart && dist < innerFeatherEnd && innerFalloffWidth > 0) {
        const t = (dist - innerFeatherStart) / innerFalloffWidth;
        influence = t * t * (3 - 2 * t); // smoothstep
      } else if (dist > outerFeatherStart && dist <= outerFeatherEnd && outerFalloffWidth > 0) {
        const t = (outerFeatherEnd - dist) / outerFalloffWidth;
        influence = t * t * (3 - 2 * t); // smoothstep
      }

      this._maskValues[i] = influence;
    }

    return this._maskValues;
  }

  /**
   * Compute custom image mask.
   * Samples the mask image at each grid cell position.
   * Returns Float32Array of mask values (0-1) per cell.
   */
  computeCustomMask(cols, rows, posX, posY, cubeW, cubeH, canvasW, canvasH, sampler, channel, invert, softness = 0) {
    const gridSize = cols * rows;
    this._ensureSize(gridSize);

    // GPU-accelerated source blur for spatial softness (browser canvas filter
    // is GPU-backed). Mirrors how tabloop's softness feathers the mask edge,
    // but in image space so it works for arbitrary custom masks.
    const srcW = sampler._bufferWidth || 0;
    const srcH = sampler._bufferHeight || 0;
    const blurPx = softness > 0 && srcW > 0 && srcH > 0
      ? softness * Math.min(srcW, srcH) * 0.05
      : 0;
    let savedBuffer = null;
    if (blurPx >= 0.5) {
      const blurred = this._getBlurredMaskBuffer(sampler, blurPx);
      if (blurred) {
        savedBuffer = sampler._pixelBuffer;
        sampler._pixelBuffer = blurred;
        sampler._cacheValid = false;
      }
    }

    // Cache grid colors in the mask sampler
    sampler.cacheGridColors(cols, rows, canvasW, canvasH);

    // Debug: log pixel buffer state
    if (!this._maskCacheLogDone) {
      const buf = sampler._pixelBuffer;
      let nonZero = 0;
      if (buf) {
        for (let i = 0; i < Math.min(buf.length, 1000); i++) {
          if (buf[i] !== 0) nonZero++;
        }
      }
      const cache = sampler._colorCache;
      const firstSample = cache && cache[0] ? cache[0] : null;
      console.log('[MaskProcessor Debug]', {
        cacheLength: cache ? cache.length : 0,
        firstSample,
        pixelBufLength: buf ? buf.length : 0,
        pixelBufNonZero: nonZero,
        samplerMappingMode: sampler.mappingMode,
        viewportOU: sampler._viewportOffsetU,
        viewportOV: sampler._viewportOffsetV,
        viewportSU: sampler._viewportScaleU,
        viewportSV: sampler._viewportScaleV,
      });
      this._maskCacheLogDone = true;
      setTimeout(() => { this._maskCacheLogDone = false; }, 3000);
    }

    for (let i = 0; i < gridSize; i++) {
      const sample = sampler.getCachedColor(i);
      let value = 0;
      if (sample) {
        if (channel === 'alpha' && sample.a !== undefined) {
          value = sample.a / 255;
        } else {
          value = (0.299 * sample.r + 0.587 * sample.g + 0.114 * sample.b) / 255;
        }
      }
      if (invert) value = 1 - value;
      this._maskValues[i] = value;
    }

    // Restore the unblurred pixel buffer so other consumers (e.g. live image
    // sampling for the main grid) are unaffected.
    if (savedBuffer) {
      sampler._pixelBuffer = savedBuffer;
      sampler._cacheValid = false;
    }

    return this._maskValues;
  }

  /**
   * GPU-blur the mask source image (or current video frame) and return its
   * pixel buffer. Cached by source identity, dimensions, blur radius, and
   * (for video) frame counter so we only re-blur when something changes.
   */
  _getBlurredMaskBuffer(sampler, blurPx) {
    const w = sampler._bufferWidth, h = sampler._bufferHeight;
    if (!w || !h) return null;

    const src = sampler.isVideo ? (sampler.video && sampler.video.elt) : (sampler.image && (sampler.image.canvas || sampler.image.elt));
    if (!src) return null;

    const frameTag = sampler.isVideo ? (sampler._frameCount || 0) : 'img';
    const sourceRef = sampler.isVideo ? sampler.video : sampler.image;
    const key = `${frameTag}|${w}x${h}|${blurPx.toFixed(2)}`;
    if (this._blurKey === key && this._blurSourceRef === sourceRef && this._blurredBuffer) return this._blurredBuffer;

    if (!this._blurCanvas) this._blurCanvas = document.createElement('canvas');
    if (this._blurCanvas.width !== w) this._blurCanvas.width = w;
    if (this._blurCanvas.height !== h) this._blurCanvas.height = h;
    const ctx = this._blurCtx || (this._blurCtx = this._blurCanvas.getContext('2d', { willReadFrequently: true }));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `blur(${blurPx}px)`;
    try {
      ctx.drawImage(src, 0, 0, w, h);
    } catch (e) {
      ctx.restore();
      return null;
    }
    ctx.filter = 'none';
    ctx.restore();
    this._blurredBuffer = ctx.getImageData(0, 0, w, h).data;
    this._blurKey = key;
    this._blurSourceRef = sourceRef;
    return this._blurredBuffer;
  }

  /**
   * Apply delta-based velocity push when mask values change.
   * Pushes cells outward from center proportional to mask value change.
   */
  applyDeltaPush(pushOffsets, velocityPushAmount, posX, posY, cubeW, cubeH, canvasCX, canvasCY) {
    if (!this._maskValues || !this._prevMaskValues) return;

    for (let i = 0; i < this._gridSize; i++) {
      const prev = this._prevMaskValues[i];
      const curr = this._maskValues[i];
      const delta = Math.abs(curr - prev);

      if (delta > 0.001 && pushOffsets[i]) {
        const centerX = posX[i] + cubeW / 2;
        const centerY = posY[i] + cubeH / 2;
        const dx = centerX - canvasCX;
        const dy = centerY - canvasCY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.001) {
          const pushStrength = delta * velocityPushAmount * 5;
          pushOffsets[i].x += (dx / dist) * pushStrength;
          pushOffsets[i].y += (dy / dist) * pushStrength;
        }
      }

      this._prevMaskValues[i] = curr;
    }
  }
}
