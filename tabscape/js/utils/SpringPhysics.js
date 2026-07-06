/**
 * SpringArray - Flat typed-array damped spring system for zero-allocation updates
 * Each element has a current value, velocity, and target value
 */
class SpringArray {
  constructor(size = 0) {
    this.current = new Float32Array(size);
    this.velocity = new Float32Array(size);
    this.target = new Float32Array(size);
    this.length = size;
  }

  /**
   * Resize arrays, preserving existing data where possible
   */
  resize(n) {
    if (n === this.length) return;
    const oldCurrent = this.current;
    const oldVelocity = this.velocity;
    const oldTarget = this.target;
    this.current = new Float32Array(n);
    this.velocity = new Float32Array(n);
    this.target = new Float32Array(n);
    const copyLen = Math.min(n, this.length);
    this.current.set(oldCurrent.subarray(0, copyLen));
    this.velocity.set(oldVelocity.subarray(0, copyLen));
    this.target.set(oldTarget.subarray(0, copyLen));
    this.length = n;
  }

  /**
   * Reset all values to zero
   */
  reset() {
    this.current.fill(0);
    this.velocity.fill(0);
    this.target.fill(0);
  }

  /**
   * Set target value for element i
   */
  setTarget(i, v) {
    this.target[i] = v;
  }

  /**
   * Get current value for element i
   */
  getCurrent(i) {
    return this.current[i];
  }

  /**
   * Update all springs: damped spring integration.
   * `damping` is authored as a per-frame multiplier at the live rAF rate
   * (~60 Hz); we normalize to that reference so high-fps export subdivides
   * the motion rather than over-damping it.
   * @param {number} damping - Velocity damping per ~1/60s frame (0.5-0.99)
   * @param {number} strength - Spring stiffness (50-1000)
   * @param {number} dt - Delta time in seconds
   */
  update(damping, strength, dt) {
    const cur = this.current;
    const vel = this.velocity;
    const tgt = this.target;
    const n = this.length;
    const dampingStep = Math.pow(damping, dt * 60);
    for (let i = 0; i < n; i++) {
      const force = (tgt[i] - cur[i]) * strength;
      vel[i] = (vel[i] + force * dt) * dampingStep;
      cur[i] += vel[i] * dt;
    }
  }
}
