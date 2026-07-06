/**
 * AttractorMode - Cursor-driven or noise-null-driven repulsion with spring physics
 * Shapes near the force source(s) are repulsed outward and scaled, with springy
 * overshoot from damped springs. Push offsets are driven by springs (usesDecay = false).
 */
class AttractorMode extends BaseMode {
  constructor(cursorTracker) {
    super();
    this.usesDecay = false;
    this._cursorTracker = cursorTracker;
    this._time = 0;
    this._springPushX = null;
    this._springPushY = null;
    this._springScale = null;
    this._isPaused = false;
    this._canvasWidth = 0;
    this._canvasHeight = 0;

    // Create noise instances for up to 8 nulls (each with a different seed)
    this._noiseInstances = [];
    for (let i = 0; i < 8; i++) {
      this._noiseInstances.push(new SimplexNoise(42 + i * 137));
    }
    // Pulse ring state
    this._pulses = [];
    this._nullPulseTimers = new Float32Array(6);

    // Previous null positions for computing null velocity in noise mode
    this._prevNullX = new Float32Array(6);
    this._prevNullY = new Float32Array(6);
    this._nullVelX = new Float32Array(6);
    this._nullVelY = new Float32Array(6);
    this._hasNullPrev = false;
  }

  activate(gridInfo) {
    this._canvasWidth = gridInfo.canvasWidth;
    this._canvasHeight = gridInfo.canvasHeight;
    this._time = 0;

    const size = gridInfo.gridSize;
    this._springPushX = new SpringArray(size);
    this._springPushY = new SpringArray(size);
    this._springScale = new SpringArray(size);
  }

  deactivate() {
    this._springPushX = null;
    this._springPushY = null;
    this._springScale = null;
    this._pulses = [];
    this._nullPulseTimers.fill(0);
    this._hasNullPrev = false;
    this._nullVelX.fill(0);
    this._nullVelY.fill(0);
  }

  /**
   * Pre-compute push offsets and scale values using spring physics
   */
  update(deltaTime, state, gridInfo, pushOffsets, scaleValues) {
    if (this._isPaused) return;

    const dt = Math.min(deltaTime, 0.1);

    // Read parameters
    const repulsion = state.attractorRepulsion ?? 3000;
    const radius = state.cursorRadius ?? 250;
    const damping = state.springDamping ?? 0.87;
    const strength = state.springStrength ?? 502;
    const scaleMin = (state.scaleMin ?? 0) / 100;
    // Motion Scale is additive-only: clamp to ≥ Base Scale so motion never shrinks tabs.
    const scaleMax = Math.max(scaleMin, (state.scaleMax ?? 50) / 100);
    const forceDriver = state.forceDriver ?? 'cursor';
    const pulseRate = state.autoRippleRate ?? 0;
    const pulseSpeed = state.rippleSpeed ?? 300;
    const pulseWidth = state.rippleWidth ?? 100;
    const pulseNorm = (state.pulseStrength ?? 50) / 100;
    const velocityPush = state.velocityPushAmount ?? 40;

    this._canvasWidth = gridInfo.canvasWidth;
    this._canvasHeight = gridInfo.canvasHeight;

    // Ensure springs are sized correctly
    const size = gridInfo.gridSize;
    if (this._springPushX.length !== size) {
      this._springPushX.resize(size);
      this._springPushY.resize(size);
      this._springScale.resize(size);
    }

    const { cols, rows, cubeWidth, cubeHeight, spacingX, spacingY, offsetX, offsetY } = gridInfo;
    const radiusSq = radius * radius;

    // Build list of force source positions + per-source velocity
    const sources = [];
    const sourceVelX = [];
    const sourceVelY = [];

    if (forceDriver === 'noise' || forceDriver === 'null') {
      // ── Null-driven mode ──
      const nullMode = state.nullMode ?? 'noise';

      this._time += dt;

      if (forceDriver === 'null' && nullMode === 'position') {
        // Position mode: single fixed null at user-specified coordinates
        const px = (state.nullPositionX ?? 50) / 100 * this._canvasWidth;
        const py = (state.nullPositionY ?? 50) / 100 * this._canvasHeight;
        sources.push({ x: px, y: py });
        sourceVelX.push(0);
        sourceVelY.push(0);
      } else {
        // Noise mode: autonomous wandering nulls
        const nullCount = state.noiseNullCount ?? 1;
        const noiseFreq = state.noiseNullFreq ?? 1;
        const noiseStrength = state.noiseNullStrength ?? 500;
        const loopDuration = state.loopDuration ?? 0;

        for (let n = 0; n < nullCount; n++) {
          const seed = n * 137.5;
          const noise = this._noiseInstances[n];
          let nx, ny;

          if (loopDuration > 0) {
            // Cyclic noise: trace a circle through noise space so start = end
            const phase = (this._time % loopDuration) / loopDuration * Math.PI * 2;
            const radius = noiseFreq * 2;
            nx = noise.noise2D(Math.cos(phase) * radius + seed, Math.sin(phase) * radius) * noiseStrength;
            ny = noise.noise2D(seed, Math.cos(phase + 1.5) * radius + Math.sin(phase + 1.5) * radius) * noiseStrength;
          } else {
            const t = this._time * noiseFreq * 0.1;
            nx = noise.noise2D(t, seed) * noiseStrength;
            ny = noise.noise2D(seed, t + 100) * noiseStrength;
          }

          const px = this._canvasWidth / 2 + nx;
          const py = this._canvasHeight / 2 + ny;
          sources.push({ x: px, y: py });

          // Compute null velocity from frame delta
          if (this._hasNullPrev && dt > 0) {
            this._nullVelX[n] = (px - this._prevNullX[n]) / dt;
            this._nullVelY[n] = (py - this._prevNullY[n]) / dt;
          }
          sourceVelX.push(this._nullVelX[n]);
          sourceVelY.push(this._nullVelY[n]);
          this._prevNullX[n] = px;
          this._prevNullY[n] = py;
        }
        this._hasNullPrev = true;
      }
    } else {
      // ── Cursor-driven ──
      const ct = this._cursorTracker;
      if (ct && ct.getIsActive()) {
        const pos = ct.getSmoothPosition();
        const vel = ct.getSmoothVelocity();
        sources.push({ x: pos.x, y: pos.y });
        sourceVelX.push(vel.x);
        sourceVelY.push(vel.y);
      }
    }

    // Spawn pulse rings from each source at staggered intervals
    if (pulseRate > 0 && sources.length > 0) {
      const loopDuration = state.loopDuration ?? 0;

      if (loopDuration > 0) {
        // Deterministic spawning: fixed times within the loop for seamless export
        const pulsesPerLoop = Math.max(1, Math.round(pulseRate * loopDuration));
        const loopTime = this._time % loopDuration;

        for (let n = 0; n < sources.length; n++) {
          for (let r = 0; r < pulsesPerLoop; r++) {
            const spawnTime = (r + n * 0.37) / pulsesPerLoop * loopDuration;
            const prevTime = ((loopTime - dt) % loopDuration + loopDuration) % loopDuration;
            if ((prevTime < spawnTime && loopTime >= spawnTime) ||
                (prevTime > loopTime && (prevTime < spawnTime || loopTime >= spawnTime))) {
              this._pulses.push({ x: sources[n].x, y: sources[n].y, radius: 0 });
            }
          }
        }
      } else {
        // Timer-based spawning with jitter (non-looping)
        const baseInterval = 1 / pulseRate;
        for (let n = 0; n < sources.length; n++) {
          this._nullPulseTimers[n] += dt;
          const jitter = baseInterval * 0.3 * Math.sin(n * 137.5 + this._time * 0.7);
          if (this._nullPulseTimers[n] >= baseInterval + jitter) {
            this._nullPulseTimers[n] = 0;
            this._pulses.push({ x: sources[n].x, y: sources[n].y, radius: 0 });
          }
        }
      }
    }

    // Expand pulse rings and remove expired ones
    for (let p = this._pulses.length - 1; p >= 0; p--) {
      this._pulses[p].radius += pulseSpeed * dt;
      if (this._pulses[p].radius > 2000) this._pulses.splice(p, 1);
    }

    const hasPulses = this._pulses.length > 0;

    // Set spring targets for each grid cell
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;

        let cx = offsetX + col * (cubeWidth + spacingX) + cubeWidth / 2;
        let cy = offsetY + row * (cubeHeight + spacingY) + cubeHeight / 2;
        if (row % 2 === 1) {
          cx += (cubeWidth + spacingX) * 0.5;
        }

        // Accumulate push from all sources, track max falloff for scale
        let totalPushX = 0;
        let totalPushY = 0;
        let maxFalloff = 0;

        for (let s = 0; s < sources.length; s++) {
          const ddx = cx - sources[s].x;
          const ddy = cy - sources[s].y;
          const distSq = ddx * ddx + ddy * ddy;

          if (distSq < radiusSq && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const normDist = dist / radius;

            // Smoothstep falloff
            const t2 = 1 - normDist;
            const falloff = t2 * t2 * (3 - 2 * t2);

            if (falloff > maxFalloff) maxFalloff = falloff;

            // Repulsion push: direction away from source
            const normDdx = ddx / dist;
            const normDdy = ddy / dist;
            const pushStr = repulsion * falloff / radius;
            totalPushX += normDdx * pushStr;
            totalPushY += normDdy * pushStr;

            // Velocity push: push in the direction the source is moving
            if (velocityPush > 0) {
              const vx = sourceVelX[s] || 0;
              const vy = sourceVelY[s] || 0;
              const speed = Math.sqrt(vx * vx + vy * vy);
              if (speed > 5) {
                const normSpeed = Math.min(1, speed / 800);
                const velPush = falloff * velocityPush * normSpeed;
                totalPushX += (vx / speed) * velPush;
                totalPushY += (vy / speed) * velPush;
              }
            }
          }
        }

        // Pulse ring boost: expanding O-shaped spring target impulse
        let pulsePushX = 0, pulsePushY = 0, pulseScaleBoost = 0;
        if (hasPulses) {
          for (let p = 0; p < this._pulses.length; p++) {
            const pulse = this._pulses[p];
            const pdx = cx - pulse.x;
            const pdy = cy - pulse.y;
            const pDist = Math.sqrt(pdx * pdx + pdy * pdy);
            const distFromRing = Math.abs(pDist - pulse.radius);

            if (distFromRing < pulseWidth) {
              const ringInfluence = 1 - (distFromRing / pulseWidth);
              const decayFactor = Math.exp(-pulse.radius * 2 / 1000);
              const influence = ringInfluence * decayFactor * pulseNorm;

              if (pDist > 0.01) {
                pulsePushX += (pdx / pDist) * influence * repulsion * 0.5;
                pulsePushY += (pdy / pDist) * influence * repulsion * 0.5;
              }
              if (influence > pulseScaleBoost) pulseScaleBoost = influence;
            }
          }
        }

        const finalPushX = totalPushX + pulsePushX;
        const finalPushY = totalPushY + pulsePushY;
        const finalFalloff = Math.min(1, maxFalloff + pulseScaleBoost);

        if (finalFalloff > 0 || pulsePushX !== 0 || pulsePushY !== 0) {
          this._springPushX.setTarget(index, finalPushX);
          this._springPushY.setTarget(index, finalPushY);
          this._springScale.setTarget(index, scaleMin + (scaleMax - scaleMin) * finalFalloff);
        } else {
          this._springPushX.setTarget(index, 0);
          this._springPushY.setTarget(index, 0);
          this._springScale.setTarget(index, scaleMin);
        }
      }
    }

    // Tick all springs
    this._springPushX.update(damping, strength, dt);
    this._springPushY.update(damping, strength, dt);
    this._springScale.update(damping, strength, dt);

    // Write spring values to shared arrays
    for (let i = 0; i < size; i++) {
      if (pushOffsets[i]) {
        pushOffsets[i].x = this._springPushX.getCurrent(i);
        pushOffsets[i].y = this._springPushY.getCurrent(i);
      }
      scaleValues[i] = this._springScale.getCurrent(i);
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
    const clampedSv = Math.max(0.01, sv);
    p.scale(clampedSv);

    const scaleMin = (state.scaleMin ?? 0) / 100;
    const scaleMax = Math.max(scaleMin, (state.scaleMax ?? 50) / 100);
    const range = scaleMax - scaleMin;
    const influence = range > 0 ? Math.max(0, Math.min(1, (clampedSv - scaleMin) / range)) : 0;
    return { scaleValue: clampedSv, scaleInfluence: influence };
  }

  /**
   * Compute scale for SVG export
   */
  computeScale(centerX, centerY, index, state, scaleValues) {
    const sv = scaleValues[index] !== undefined ? scaleValues[index] : 1;
    const clampedSv = Math.max(0.01, sv);
    const scaleMin = (state.scaleMin ?? 0) / 100;
    const scaleMax = Math.max(scaleMin, (state.scaleMax ?? 50) / 100);
    const range = scaleMax - scaleMin;
    const influence = range > 0 ? Math.max(0, Math.min(1, (clampedSv - scaleMin) / range)) : 0;
    return { scale: clampedSv, influence: influence };
  }

  setPaused(paused) {
    this._isPaused = paused;
  }

  onMousePressed(x, y, state) {
    // Spawn a pulse ring at click position
    this._pulses.push({ x, y, radius: 0 });
  }

  getParameterIds() {
    return ['attractorNoiseFreq', 'attractorNoiseStrength', 'attractorRepulsion',
            'springDamping', 'springStrength'];
  }
}
