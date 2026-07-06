/**
 * BaseMode - Interface contract for effect modes
 * Each mode computes per-shape push offsets and scale values
 * that GridRenderer reads during rendering.
 */
class BaseMode {
  constructor() {
    /** @type {boolean} Whether this mode uses accumulate-and-decay pattern for push offsets */
    this.usesDecay = true;
  }

  /**
   * Pre-compute all push offsets and scale values for the current frame
   * @param {number} deltaTime - Seconds since last frame
   * @param {Object} state - StateManager snapshot
   * @param {Object} gridInfo - { cols, rows, gridSize, cubeWidth, cubeHeight, spacingX, spacingY, offsetX, offsetY, canvasWidth, canvasHeight }
   * @param {Array} pushOffsets - Shared push offsets array to write to
   * @param {Array} scaleValues - Shared scale values array to write to
   */
  update(deltaTime, state, gridInfo, pushOffsets, scaleValues) {
    // Override in subclasses
  }

  /**
   * Apply per-shape effect during rendering (translate/scale via p5)
   * @param {Object} options - Shape options including index, centerX, centerY
   * @param {number} w - Shape width
   * @param {number} h - Shape height
   * @param {Object} state - StateManager snapshot
   * @param {Object} p - p5 instance
   * @param {Array} pushOffsets - Pre-computed push offsets
   * @param {Array} scaleValues - Pre-computed scale values
   * @returns {{ scaleValue: number, scaleInfluence: number }}
   */
  applyEffect(options, w, h, state, p, pushOffsets, scaleValues) {
    const index = options.index;
    // Apply push offset translation
    if (pushOffsets[index]) {
      p.translate(pushOffsets[index].x, pushOffsets[index].y);
    }
    // Apply scale
    const sv = scaleValues[index] !== undefined ? scaleValues[index] : 1;
    p.scale(sv);
    return { scaleValue: sv, scaleInfluence: sv > 1 ? 1 : 0 };
  }

  /**
   * Compute scale for SVG export (no p5 transforms)
   * @param {number} centerX
   * @param {number} centerY
   * @param {number} index
   * @param {Object} state
   * @param {Array} scaleValues - Pre-computed scale values
   * @returns {{ scale: number, influence: number }}
   */
  computeScale(centerX, centerY, index, state, scaleValues) {
    const sv = scaleValues[index] !== undefined ? scaleValues[index] : 1;
    return { scale: sv, influence: sv > 1 ? 1 : 0 };
  }

  /**
   * Called when this mode becomes active
   * @param {Object} gridInfo
   */
  activate(gridInfo) {
    // Override in subclasses
  }

  /**
   * Called when this mode is deactivated
   */
  deactivate() {
    // Override in subclasses
  }

  /**
   * Handle mouse press events
   * @param {number} x - Canvas X
   * @param {number} y - Canvas Y
   * @param {Object} state
   */
  onMousePressed(x, y, state) {
    // Override in subclasses
  }

  /**
   * Set paused state
   * @param {boolean} paused
   */
  setPaused(paused) {
    // Override in subclasses
  }

  /**
   * Get parameter IDs this mode uses (for panel visibility)
   * @returns {string[]}
   */
  getParameterIds() {
    return [];
  }
}
