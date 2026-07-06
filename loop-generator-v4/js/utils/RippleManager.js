/**
 * RippleManager - Manages ripple effects triggered by clicks
 * Each ripple expands outward from its origin point over time
 */
class RippleManager {
  constructor() {
    this.ripples = [];
    this.maxRipples = 10; // Limit concurrent ripples for performance
  }

  /**
   * Create a new ripple at the given position
   * @param {number} x - X position in canvas space
   * @param {number} y - Y position in canvas space
   */
  addRipple(x, y) {
    const ripple = {
      x: x,
      y: y,
      radius: 0,
      startTime: performance.now(),
      active: true
    };

    this.ripples.push(ripple);

    // Remove oldest ripple if we exceed max
    if (this.ripples.length > this.maxRipples) {
      this.ripples.shift();
    }
  }

  /**
   * Update all ripples based on elapsed time
   * @param {number} speed - Ripple expansion speed (pixels per second)
   * @param {number} maxRadius - Maximum radius before ripple is removed
   */
  update(speed, maxRadius = 2000) {
    const now = performance.now();

    this.ripples = this.ripples.filter(ripple => {
      const elapsed = (now - ripple.startTime) / 1000; // seconds
      ripple.radius = elapsed * speed;

      // Keep ripple active if within bounds
      return ripple.radius < maxRadius;
    });
  }

  /**
   * Get the ripple influence at a given position
   * Returns a value from 0-1 representing how much the ripple affects this point
   * @param {number} x - X position to check
   * @param {number} y - Y position to check
   * @param {number} rippleWidth - Base width of the ripple band
   * @param {number} decay - How quickly the ripple fades (higher = faster fade)
   * @param {number} stretch - Ring thickness stretch (-100 to 100). Negative = thicker horizontally, Positive = thicker vertically
   * @returns {number} Combined influence from all ripples (0-1)
   */
  getInfluence(x, y, rippleWidth = 100, decay = 2, stretch = 0) {
    let totalInfluence = 0;

    for (const ripple of this.ripples) {
      const dx = x - ripple.x;
      const dy = y - ripple.y;

      // Circular distance - outer edge is always circular
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Handle inside vs outside of ring separately for "O" shape:
      // - Outside: always use base width (circular outer edge)
      // - Inside: use directional width (elliptical inner edge)
      const isOutside = distance > ripple.radius;
      const distanceFromRing = Math.abs(distance - ripple.radius);

      let effectiveWidth;
      if (isOutside) {
        // Outside the ring - use base width for circular outer edge
        effectiveWidth = rippleWidth;
      } else {
        // Inside the ring - use directional width for elliptical inner edge
        effectiveWidth = this._getDirectionalWidth(dx, dy, distance, rippleWidth, stretch);
      }

      // Only affect points within the effective width
      if (distanceFromRing < effectiveWidth) {
        // Smooth falloff from ring center, normalized to the effective width
        const ringInfluence = 1 - (distanceFromRing / effectiveWidth);

        // Decay based on how far the ripple has traveled
        const decayFactor = Math.exp(-ripple.radius * decay / 1000);

        totalInfluence += ringInfluence * decayFactor;
      }
    }

    // Clamp to 0-1
    return Math.min(1, totalInfluence);
  }

  /**
   * Calculate directional ripple width based on angle
   * Creates an "O" shape - circular outside, elliptical inside
   * @param {number} dx - X distance from ripple center
   * @param {number} dy - Y distance from ripple center
   * @param {number} distance - Total distance from ripple center
   * @param {number} baseWidth - Base ripple width
   * @param {number} stretch - Stretch factor (-100 to 100)
   * @returns {number} Effective ripple width for this direction
   */
  _getDirectionalWidth(dx, dy, distance, baseWidth, stretch) {
    if (stretch === 0 || distance === 0) {
      return baseWidth;
    }

    // Calculate how "vertical" vs "horizontal" this direction is
    // verticalness: 0 = purely horizontal, 1 = purely vertical
    const verticalness = Math.abs(dy) / distance;

    // Convert stretch to width multipliers
    // At -100: horizontal is 2x wider, vertical is base
    // At +100: vertical is 2x wider, horizontal is base
    const maxMultiplier = 2;
    const stretchNorm = stretch / 100; // -1 to 1

    let widthH, widthV;
    if (stretchNorm < 0) {
      // Negative: thicker horizontally
      widthH = baseWidth * (1 + (-stretchNorm) * (maxMultiplier - 1));
      widthV = baseWidth;
    } else {
      // Positive: thicker vertically
      widthH = baseWidth;
      widthV = baseWidth * (1 + stretchNorm * (maxMultiplier - 1));
    }

    // Lerp between horizontal and vertical width based on direction
    return widthH + (widthV - widthH) * verticalness;
  }

  /**
   * Get detailed ripple data for a position (for more complex effects)
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} rippleWidth - Base width of the ripple band
   * @param {number} stretch - Ring thickness stretch (-100 to 100)
   * @returns {Array} Array of ripple data objects for each active ripple
   */
  getRippleData(x, y, rippleWidth = 100, stretch = 0) {
    const data = [];

    for (const ripple of this.ripples) {
      const dx = x - ripple.x;
      const dy = y - ripple.y;

      // Circular distance - outer edge is always circular
      const distance = Math.sqrt(dx * dx + dy * dy);
      const isOutside = distance > ripple.radius;
      const distanceFromRing = Math.abs(distance - ripple.radius);

      // Same logic as getInfluence - circular outside, elliptical inside
      let effectiveWidth;
      if (isOutside) {
        effectiveWidth = rippleWidth;
      } else {
        effectiveWidth = this._getDirectionalWidth(dx, dy, distance, rippleWidth, stretch);
      }

      if (distanceFromRing < effectiveWidth) {
        const ringInfluence = 1 - (distanceFromRing / effectiveWidth);
        const angle = Math.atan2(dy, dx);

        data.push({
          influence: ringInfluence,
          angle: angle,
          radius: ripple.radius,
          distance: distance,
          isInside: !isOutside
        });
      }
    }

    return data;
  }

  /**
   * Check if there are any active ripples
   */
  hasActiveRipples() {
    return this.ripples.length > 0;
  }

  /**
   * Clear all ripples
   */
  clear() {
    this.ripples = [];
  }

  /**
   * Get number of active ripples
   */
  getCount() {
    return this.ripples.length;
  }

  /**
   * Get serializable ripple data (for saving settings)
   * Captures each ripple's position and current radius.
   */
  getSerializable() {
    return this.ripples.map(r => ({ x: r.x, y: r.y, radius: r.radius }));
  }

  /**
   * Restore ripples from saved data.
   * Calculates a fake startTime so each ripple resumes expanding from its saved radius.
   * @param {Array} data - Array of { x, y, radius } objects
   * @param {number} speed - Current ripple speed (pixels per second)
   */
  restoreFromData(data, speed) {
    const now = performance.now();
    this.ripples = data.map(r => ({
      x: r.x,
      y: r.y,
      radius: r.radius,
      startTime: now - (r.radius / speed) * 1000,
      active: true
    }));
  }
}

// Singleton instance
let rippleManager = null;
