/**
 * SimplexNoise - 2D simplex noise implementation
 * Based on Stefan Gustavson's simplex noise algorithm (public domain)
 * Returns values in range -1 to 1
 */
class SimplexNoise {
  constructor(seed = 0) {
    this._perm = new Uint8Array(512);
    this._permMod12 = new Uint8Array(512);
    this.seed(seed);
  }

  /**
   * Re-seed the noise generator
   */
  seed(s) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle with simple hash
    for (let i = 255; i > 0; i--) {
      s = (s * 16807 + 0) % 2147483647;
      const j = s % (i + 1);
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this._perm[i] = p[i & 255];
      this._permMod12[i] = this._perm[i] % 12;
    }
  }

  /**
   * 2D simplex noise
   * @param {number} x
   * @param {number} y
   * @returns {number} Value in range -1 to 1
   */
  noise2D(x, y) {
    const G = SimplexNoise._G;
    const grad3 = SimplexNoise._grad3;
    const perm = this._perm;
    const permMod12 = this._permMod12;

    // Skew input space
    const s = (x + y) * SimplexNoise._F;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    // Determine simplex
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G;
    const y1 = y0 - j1 + G;
    const x2 = x0 - 1.0 + 2.0 * G;
    const y2 = y0 - 1.0 + 2.0 * G;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];

    // Corner contributions
    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0 * 3] * x0 + grad3[gi0 * 3 + 1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1 * 3] * x1 + grad3[gi1 * 3 + 1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2 * 3] * x2 + grad3[gi2 * 3 + 1] * y2);
    }

    // Scale to [-1, 1]
    return 70.0 * (n0 + n1 + n2);
  }
}

// Constants
SimplexNoise._F = 0.5 * (Math.sqrt(3.0) - 1.0);
SimplexNoise._G = (3.0 - Math.sqrt(3.0)) / 6.0;

// Gradient vectors for 2D (only x,y components of 3D gradients used)
SimplexNoise._grad3 = new Float32Array([
  1,1,0, -1,1,0, 1,-1,0, -1,-1,0,
  1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
  0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1
]);
