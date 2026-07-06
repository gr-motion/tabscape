/**
 * RippleMode - Cursor-driven or noise-null-driven scaling + click-triggered ripple rings
 * Shapes scale when cursor/nulls move nearby; clicking spawns expanding ripple rings.
 * Push offsets use accumulate-and-decay pattern (usesDecay = true).
 */
class RippleMode extends BaseMode {
  constructor(rippleManager, cursorTracker) {
    super();
    this.usesDecay = true;
    this._rippleManager = rippleManager;
    this._cursorTracker = cursorTracker;
    this._isPaused = false;
    this._time = 0;

    // Create noise instances for up to 8 nulls (each with a different seed)
    this._noiseInstances = [];
    for (let i = 0; i < 8; i++) {
      this._noiseInstances.push(new SimplexNoise(42 + i * 137));
    }
    this._nullTimers = new Float32Array(8);
    this._canvasWidth = 0;
    this._canvasHeight = 0;
  }

  /**
   * Pre-compute push offsets and scale values for all grid cells
   */
  update(deltaTime, state, gridInfo, pushOffsets, scaleValues) {
    if (this._isPaused) return;

    const ct = this._cursorTracker;
    const rm = this._rippleManager;
    const dt = Math.min(deltaTime, 0.1);

    // Read parameters
    const cursorRadius = state.cursorRadius ?? 200;
    const cursorFalloff = state.cursorFalloff ?? 'smooth';
    const cursorStrength = (state.pulseStrength ?? 50) / 100;
    const rippleWidth = state.rippleWidth ?? 110;
    const rippleDecay = state.rippleDecay ?? 2;
    const scaleMin = (state.scaleMin ?? 0) / 100;
    // Motion Scale is additive-only: clamp to ≥ Base Scale.
    const scaleMax = Math.max(scaleMin, (state.scaleMax ?? 50) / 100);
    const velocityPushAmount = state.velocityPushAmount ?? 40;
    const autoRippleRate = state.autoRippleRate ?? 0;
    const forceDriver = state.forceDriver ?? 'cursor';

    this._canvasWidth = gridInfo.canvasWidth;
    this._canvasHeight = gridInfo.canvasHeight;

    const { cols, rows, cubeWidth, cubeHeight, spacingX, spacingY, offsetX, offsetY } = gridInfo;

    if (forceDriver === 'noise' || forceDriver === 'null') {
      // ── Null-driven mode ──
      const nullMode = state.nullMode ?? 'noise';
      const nulls = [];

      this._time += dt;

      if (forceDriver === 'null' && nullMode === 'position') {
        // Position mode: single fixed null at user-specified coordinates
        const px = (state.nullPositionX ?? 50) / 100 * this._canvasWidth;
        const py = (state.nullPositionY ?? 50) / 100 * this._canvasHeight;
        nulls.push({ x: px, y: py });
      } else {
        // Noise mode: autonomous wandering nulls
        const nullCount = state.noiseNullCount ?? 1;
        const freq = state.noiseNullFreq ?? 1;
        const noiseStrength = state.noiseNullStrength ?? 500;
        const loopDuration = state.loopDuration ?? 0;

        if (loopDuration > 0) {
          // Cyclic noise: trace a circle through noise space so start = end
          // Scale radius by loopDuration so null speed stays constant regardless of loop length
          const phase = (this._time % loopDuration) / loopDuration * Math.PI * 2;
          const radius = freq * 2 * (loopDuration / 10); // normalized to 10s reference
          for (let n = 0; n < nullCount; n++) {
            const seed = n * 137.5;
            const noise = this._noiseInstances[n];
            const nx = noise.noise2D(Math.cos(phase) * radius + seed, Math.sin(phase) * radius) * noiseStrength;
            const ny = noise.noise2D(seed, Math.cos(phase + 1.5) * radius + Math.sin(phase + 1.5) * radius) * noiseStrength;
            nulls.push({
              x: this._canvasWidth / 2 + nx,
              y: this._canvasHeight / 2 + ny
            });
          }
        } else {
          // Linear noise (non-looping)
          const t = this._time * freq * 0.1;
          for (let n = 0; n < nullCount; n++) {
            const seed = n * 137.5;
            const noise = this._noiseInstances[n];
            const nx = noise.noise2D(t, seed) * noiseStrength;
            const ny = noise.noise2D(seed, t + 100) * noiseStrength;
            nulls.push({
              x: this._canvasWidth / 2 + nx,
              y: this._canvasHeight / 2 + ny
            });
          }
        }
      }

      // Compute null velocities from frame-to-frame position deltas
      if (!this._prevNullPositions) this._prevNullPositions = [];
      const nullVelocities = [];
      for (let n = 0; n < nulls.length; n++) {
        const prev = this._prevNullPositions[n];
        if (prev && dt > 0) {
          const vx = (nulls[n].x - prev.x) / dt;
          const vy = (nulls[n].y - prev.y) / dt;
          nullVelocities.push({ vx, vy, speed: Math.sqrt(vx * vx + vy * vy) });
        } else {
          nullVelocities.push({ vx: 0, vy: 0, speed: 0 });
        }
        this._prevNullPositions[n] = { x: nulls[n].x, y: nulls[n].y };
      }

      // Auto-spawn ripples from each null
      if (autoRippleRate > 0) {
        const loopDuration = state.loopDuration ?? 0;

        if (loopDuration > 0) {
          // Deterministic ripple spawning: fixed times within the loop
          const ripplesPerLoop = Math.max(1, Math.round(autoRippleRate * loopDuration));
          const loopTime = this._time % loopDuration;

          for (let n = 0; n < nulls.length; n++) {
            for (let r = 0; r < ripplesPerLoop; r++) {
              // Each ripple has a fixed spawn time, staggered per null
              const spawnTime = (r + n * 0.37) / ripplesPerLoop * loopDuration;
              const prevTime = ((loopTime - dt) % loopDuration + loopDuration) % loopDuration;
              // Check if we just crossed this spawn time
              if ((prevTime < spawnTime && loopTime >= spawnTime) ||
                  (prevTime > loopTime && (prevTime < spawnTime || loopTime >= spawnTime))) {
                this._rippleManager.addRipple(nulls[n].x, nulls[n].y);
              }
            }
          }
        } else {
          // Timer-based ripple spawning (non-looping)
          const baseInterval = 1 / autoRippleRate;
          for (let n = 0; n < nulls.length; n++) {
            this._nullTimers[n] += dt;
            const jitter = baseInterval * 0.3 * Math.sin(n * 137.5 + this._time * 0.7);
            if (this._nullTimers[n] >= baseInterval + jitter) {
              this._nullTimers[n] = 0;
              this._rippleManager.addRipple(nulls[n].x, nulls[n].y);
            }
          }
        }
      }

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;

          let cx = offsetX + col * (cubeWidth + spacingX) + cubeWidth / 2;
          let cy = offsetY + row * (cubeHeight + spacingY) + cubeHeight / 2;
          if (row % 2 === 1) cx += (cubeWidth + spacingX) * 0.5;

          // Accumulate influence from all nulls
          let maxInfluence = 0;
          for (let n = 0; n < nulls.length; n++) {
            const dx = cx - nulls[n].x;
            const dy = cy - nulls[n].y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist >= cursorRadius || dist < 0.001) continue;

            const falloff = ct.getFalloffAt(nulls[n].x, nulls[n].y, cx, cy, cursorRadius, cursorFalloff);
            const nv = nullVelocities[n];
            const normalizedSpeed = Math.min(1, nv.speed / 800);
            const speedGate = Math.min(1, normalizedSpeed * 3.33);
            const influence = falloff * cursorStrength * speedGate;
            if (influence > maxInfluence) maxInfluence = influence;

            // Push in null's movement direction (like cursor push)
            if (nv.speed > 5 && falloff > 0.01 && pushOffsets[index]) {
              const normVx = nv.vx / nv.speed;
              const normVy = nv.vy / nv.speed;
              const pushMag = falloff * cursorStrength * normalizedSpeed * velocityPushAmount;
              pushOffsets[index].x += normVx * pushMag;
              pushOffsets[index].y += normVy * pushMag;
            }
          }

          // Ripple influence (still works with clicks)
          let rippleInfluence = 0;
          if (rm.hasActiveRipples()) {
            rippleInfluence = rm.getInfluence(cx, cy, rippleWidth, rippleDecay);
          }

          const influence = Math.min(1, Math.max(maxInfluence, rippleInfluence));
          scaleValues[index] = scaleMin + (scaleMax - scaleMin) * influence;

          // Ripple radial push
          if (rippleInfluence > 0.01 && pushOffsets[index]) {
            const rippleData = rm.getRippleData(cx, cy, rippleWidth, 0, rippleDecay);
            for (const rd of rippleData) {
              if (rd.influence > 0.01) {
                const pushStr = rd.influence * velocityPushAmount * 0.5;
                pushOffsets[index].x += Math.cos(rd.angle) * pushStr;
                pushOffsets[index].y += Math.sin(rd.angle) * pushStr;
              }
            }
          }
        }
      }
    } else {
      // ── Cursor-driven (original behavior) ──
      const cursorPos = ct.getSmoothPosition();
      const cursorActive = ct.getIsActive();
      const normalizedSpeed = ct.getNormalizedSpeed(800);
      const smoothVel = ct.getSmoothVelocity();
      const speed = ct.getSmoothSpeed();
      // Speed gate: shapes only scale when cursor is moving
      const speedGate = Math.min(1, normalizedSpeed * 3.33);
      // Normalized velocity direction
      const hasVelocity = speed > 5;
      const normVx = hasVelocity ? smoothVel.x / speed : 0;
      const normVy = hasVelocity ? smoothVel.y / speed : 0;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;

          let cx = offsetX + col * (cubeWidth + spacingX) + cubeWidth / 2;
          let cy = offsetY + row * (cubeHeight + spacingY) + cubeHeight / 2;
          if (row % 2 === 1) cx += (cubeWidth + spacingX) * 0.5;

          // Cursor falloff
          let cursorInfluence = 0;
          let rawFalloff = 0;
          if (cursorActive) {
            rawFalloff = ct.getFalloffAt(cursorPos.x, cursorPos.y, cx, cy, cursorRadius, cursorFalloff);
            cursorInfluence = rawFalloff * cursorStrength * speedGate;
          }

          // Ripple influence
          let rippleInfluence = 0;
          if (rm.hasActiveRipples()) {
            rippleInfluence = rm.getInfluence(cx, cy, rippleWidth, rippleDecay);
          }

          const influence = Math.min(1, Math.max(cursorInfluence, rippleInfluence));
          scaleValues[index] = scaleMin + (scaleMax - scaleMin) * influence;

          // Push offsets: velocity-based push in cursor direction
          // Matches old formula: falloff * strength * normalizedSpeed * velocityPushAmount
          if (cursorActive && hasVelocity && rawFalloff > 0.01 && pushOffsets[index]) {
            const pushMagnitude = rawFalloff * cursorStrength * normalizedSpeed * velocityPushAmount;
            pushOffsets[index].x += normVx * pushMagnitude;
            pushOffsets[index].y += normVy * pushMagnitude;
          }

          // Ripple radial push
          if (rippleInfluence > 0.01 && pushOffsets[index]) {
            const rippleData = rm.getRippleData(cx, cy, rippleWidth, 0, rippleDecay);
            for (const rd of rippleData) {
              if (rd.influence > 0.01) {
                const pushStr = rd.influence * velocityPushAmount * 0.5;
                pushOffsets[index].x += Math.cos(rd.angle) * pushStr;
                pushOffsets[index].y += Math.sin(rd.angle) * pushStr;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Apply per-shape effect during rendering
   */
  applyEffect(options, w, h, state, p, pushOffsets, scaleValues) {
    const index = options.index;
    if (pushOffsets[index]) {
      p.translate(pushOffsets[index].x, pushOffsets[index].y);
    }
    const sv = scaleValues[index] !== undefined ? scaleValues[index] : 1;
    p.scale(sv);

    const scaleMin = (state.scaleMin ?? 0) / 100;
    const scaleMax = Math.max(scaleMin, (state.scaleMax ?? 50) / 100);
    const range = scaleMax - scaleMin;
    const influence = range > 0 ? Math.max(0, Math.min(1, (sv - scaleMin) / range)) : 0;
    return { scaleValue: sv, scaleInfluence: influence };
  }

  /**
   * Compute scale for SVG export
   */
  computeScale(centerX, centerY, index, state, scaleValues) {
    const sv = scaleValues[index] !== undefined ? scaleValues[index] : 1;
    const scaleMin = (state.scaleMin ?? 0) / 100;
    const scaleMax = Math.max(scaleMin, (state.scaleMax ?? 50) / 100);
    const range = scaleMax - scaleMin;
    const influence = range > 0 ? Math.max(0, Math.min(1, (sv - scaleMin) / range)) : 0;
    return { scale: sv, influence: influence };
  }

  onMousePressed(x, y, state) {
    this._rippleManager.addRipple(x, y);
  }

  setPaused(paused) {
    this._isPaused = paused;
  }

  activate(gridInfo) {
    this._canvasWidth = gridInfo.canvasWidth;
    this._canvasHeight = gridInfo.canvasHeight;
  }

  deactivate() {
    this._rippleManager.clear();
  }

  getParameterIds() {
    return ['cursorRadius', 'cursorFalloff', 'springStrength',
            'rippleSpeed', 'rippleWidth', 'rippleDecay'];
  }
}
