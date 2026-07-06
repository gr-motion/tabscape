/**
 * CursorTracker - Tracks cursor position, velocity, and acceleration
 * Provides smoothed values for use in animations
 */
class CursorTracker {
  constructor() {
    // Current state
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.acceleration = { x: 0, y: 0 };

    // Previous frame state (for calculations)
    this._prevPosition = { x: 0, y: 0 };
    this._prevVelocity = { x: 0, y: 0 };

    // Smoothed values (for smoother animations)
    this.smoothPosition = { x: 0, y: 0 };
    this.smoothVelocity = { x: 0, y: 0 };

    // Computed values
    this.speed = 0;
    this.smoothSpeed = 0;
    this.direction = 0; // angle in radians

    // Settings
    this.smoothing = 0.2; // Lower = smoother, higher = more responsive
    this.velocityScale = 1;

    // State flags
    this.isActive = false; // Is cursor over canvas?
    this.isMoving = false;
    this._moveTimeout = null;
    this._firstUpdate = true; // Track first update for initialization

    // History for trails/effects
    this.positionHistory = [];
    this.historyLength = 20;

    // Frozen state for pause feature
    this._isFrozen = false;
    this._frozenState = null;
  }

  /**
   * Freeze current state - subsequent reads return frozen values
   */
  freeze() {
    this._isFrozen = true;
    this._frozenState = {
      position: { ...this.position },
      velocity: { ...this.velocity },
      smoothPosition: { ...this.smoothPosition },
      smoothVelocity: { ...this.smoothVelocity },
      speed: this.speed,
      smoothSpeed: this.smoothSpeed,
      direction: this.direction,
      isActive: this.isActive
    };
  }

  /**
   * Unfreeze - return to live values
   */
  unfreeze() {
    this._isFrozen = false;
    this._frozenState = null;
  }

  /**
   * Check if frozen
   */
  get isFrozen() {
    return this._isFrozen;
  }

  /**
   * Update with new cursor position - call every frame
   * @param {number} x - Current x position
   * @param {number} y - Current y position
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(x, y, deltaTime) {
    // Clamp deltaTime to avoid huge jumps
    deltaTime = Math.min(deltaTime, 0.1);

    // On first valid update, snap all positions to current
    if (this._firstUpdate && x !== 0 && y !== 0) {
      this._firstUpdate = false;
      this.position.x = x;
      this.position.y = y;
      this._prevPosition.x = x;
      this._prevPosition.y = y;
      this.smoothPosition.x = x;
      this.smoothPosition.y = y;
      return;
    }

    // Store previous values
    this._prevPosition.x = this.position.x;
    this._prevPosition.y = this.position.y;
    this._prevVelocity.x = this.velocity.x;
    this._prevVelocity.y = this.velocity.y;

    // Update position
    this.position.x = x;
    this.position.y = y;

    // Calculate velocity (pixels per second)
    if (deltaTime > 0) {
      this.velocity.x = ((x - this._prevPosition.x) / deltaTime) * this.velocityScale;
      this.velocity.y = ((y - this._prevPosition.y) / deltaTime) * this.velocityScale;

      // Calculate acceleration
      this.acceleration.x = (this.velocity.x - this._prevVelocity.x) / deltaTime;
      this.acceleration.y = (this.velocity.y - this._prevVelocity.y) / deltaTime;
    }

    // Calculate speed and direction
    this.speed = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
    if (this.speed > 0.1) {
      this.direction = Math.atan2(this.velocity.y, this.velocity.x);
    }

    // Smooth values using lerp
    this.smoothPosition.x = this._lerp(this.smoothPosition.x, this.position.x, this.smoothing);
    this.smoothPosition.y = this._lerp(this.smoothPosition.y, this.position.y, this.smoothing);
    this.smoothVelocity.x = this._lerp(this.smoothVelocity.x, this.velocity.x, this.smoothing);
    this.smoothVelocity.y = this._lerp(this.smoothVelocity.y, this.velocity.y, this.smoothing);
    this.smoothSpeed = Math.sqrt(this.smoothVelocity.x ** 2 + this.smoothVelocity.y ** 2);

    // Update movement state
    this._updateMovementState();

    // Update position history
    this._updateHistory();
  }

  /**
   * Set cursor as active (over canvas)
   * When becoming active, snap smooth position to current position
   */
  setActive(active) {
    const wasActive = this.isActive;
    this.isActive = active;

    // When cursor enters canvas, snap smooth position to current
    // to avoid lag from lerping from (0,0)
    if (active && !wasActive) {
      this.smoothPosition.x = this.position.x;
      this.smoothPosition.y = this.position.y;
    }
  }

  /**
   * Get normalized velocity (-1 to 1 range based on maxSpeed)
   * @param {number} maxSpeed - Speed that maps to 1
   */
  getNormalizedVelocity(maxSpeed = 1000) {
    const vel = this._isFrozen ? this._frozenState.smoothVelocity : this.smoothVelocity;
    return {
      x: Math.max(-1, Math.min(1, vel.x / maxSpeed)),
      y: Math.max(-1, Math.min(1, vel.y / maxSpeed))
    };
  }

  /**
   * Get normalized speed (0 to 1 range)
   * @param {number} maxSpeed - Speed that maps to 1
   */
  getNormalizedSpeed(maxSpeed = 1000) {
    const speed = this._isFrozen ? this._frozenState.smoothSpeed : this.smoothSpeed;
    return Math.min(1, speed / maxSpeed);
  }

  /**
   * Get the current smooth velocity (respects frozen state)
   */
  getSmoothVelocity() {
    return this._isFrozen ? this._frozenState.smoothVelocity : this.smoothVelocity;
  }

  /**
   * Get the current smooth speed (respects frozen state)
   */
  getSmoothSpeed() {
    return this._isFrozen ? this._frozenState.smoothSpeed : this.smoothSpeed;
  }

  /**
   * Get the current smooth position (respects frozen state)
   */
  getSmoothPosition() {
    return this._isFrozen ? this._frozenState.smoothPosition : this.smoothPosition;
  }

  /**
   * Check if cursor is active (respects frozen state)
   */
  getIsActive() {
    return this._isFrozen ? this._frozenState.isActive : this.isActive;
  }

  /**
   * Calculate falloff value based on distance from cursor
   * @param {number} x - Point x
   * @param {number} y - Point y
   * @param {number} radius - Falloff radius
   * @param {string} type - Falloff type: 'linear', 'quadratic', 'smooth', 'exponential'
   * @returns {number} 0-1 value (1 = at cursor, 0 = outside radius)
   */
  getFalloff(x, y, radius, type = 'smooth') {
    const pos = this._isFrozen ? this._frozenState.smoothPosition : this.smoothPosition;
    const dx = x - pos.x;
    const dy = y - pos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance >= radius) return 0;

    const normalized = distance / radius;

    switch (type) {
      case 'linear':
        return 1 - normalized;
      case 'quadratic':
        return 1 - (normalized * normalized);
      case 'smooth':
        // Smooth hermite interpolation
        return 1 - (normalized * normalized * (3 - 2 * normalized));
      case 'exponential':
        return Math.exp(-normalized * 3);
      case 'fisheye':
        // Fisheye lens distortion curve - strong center, sharp falloff
        // Based on barrel distortion formula
        const r = normalized;
        const k = 2; // distortion strength
        return 1 - (r * r) / (1 + k * (1 - r * r));
      default:
        return 1 - normalized;
    }
  }

  /**
   * Get falloff value at a point from an arbitrary cursor position
   * @param {number} cursorX - Cursor x position
   * @param {number} cursorY - Cursor y position
   * @param {number} x - Point x
   * @param {number} y - Point y
   * @param {number} radius - Falloff radius
   * @param {string} type - Falloff type
   * @returns {number} 0-1 value (1 = at cursor, 0 = outside radius)
   */
  getFalloffAt(cursorX, cursorY, x, y, radius, type = 'smooth') {
    const dx = x - cursorX;
    const dy = y - cursorY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance >= radius) return 0;

    const normalized = distance / radius;

    switch (type) {
      case 'linear':
        return 1 - normalized;
      case 'quadratic':
        return 1 - (normalized * normalized);
      case 'smooth':
        return 1 - (normalized * normalized * (3 - 2 * normalized));
      case 'exponential':
        return Math.exp(-normalized * 3);
      case 'fisheye':
        const r = normalized;
        const k = 2;
        return 1 - (r * r) / (1 + k * (1 - r * r));
      default:
        return 1 - normalized;
    }
  }

  /**
   * Get direction from cursor to a point
   * @param {number} x - Point x
   * @param {number} y - Point y
   * @returns {Object} { angle, dx, dy, distance }
   */
  getDirectionTo(x, y) {
    const pos = this._isFrozen ? this._frozenState.smoothPosition : this.smoothPosition;
    const dx = x - pos.x;
    const dy = y - pos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    return { angle, dx, dy, distance };
  }

  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  _updateMovementState() {
    const movementThreshold = 0.5;

    if (this.speed > movementThreshold) {
      this.isMoving = true;

      // Clear existing timeout
      if (this._moveTimeout) {
        clearTimeout(this._moveTimeout);
      }

      // Set timeout to mark as not moving
      this._moveTimeout = setTimeout(() => {
        this.isMoving = false;
      }, 100);
    }
  }

  _updateHistory() {
    this.positionHistory.unshift({
      x: this.position.x,
      y: this.position.y,
      speed: this.speed
    });

    if (this.positionHistory.length > this.historyLength) {
      this.positionHistory.pop();
    }
  }

  /**
   * Reset all values
   */
  reset() {
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.acceleration = { x: 0, y: 0 };
    this.smoothPosition = { x: 0, y: 0 };
    this.smoothVelocity = { x: 0, y: 0 };
    this.speed = 0;
    this.smoothSpeed = 0;
    this.positionHistory = [];
  }
}

// Singleton instance
const cursorTracker = new CursorTracker();
