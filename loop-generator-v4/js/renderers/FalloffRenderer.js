/**
 * FalloffRenderer - Visualizes the cursor falloff area
 * Shows radius circle and velocity indicators
 */
class FalloffRenderer {
  constructor(p5Instance) {
    this.p = p5Instance;
  }

  /**
   * Render the falloff visualization
   */
  render() {
    if (!cursorTracker.isActive) return;

    const p = this.p;
    const state = stateManager.getAll();

    if (!state.showFalloffCircle) return;

    const pos = cursorTracker.smoothPosition;
    const radius = state.cursorRadius || 200;
    const velocity = cursorTracker.smoothVelocity;
    const speed = cursorTracker.smoothSpeed;

    p.push();

    // Draw falloff circle with gradient effect
    this._drawFalloffCircle(pos.x, pos.y, radius, state);

    // Draw velocity indicator
    if (speed > 10) {
      this._drawVelocityIndicator(pos.x, pos.y, velocity, speed);
    }

    // Draw center point
    this._drawCenterPoint(pos.x, pos.y, speed);

    p.pop();
  }

  _drawFalloffCircle(x, y, radius, state) {
    const p = this.p;
    const falloffType = state.cursorFalloff || 'smooth';

    // Draw multiple rings to show falloff gradient
    const rings = 5;
    for (let i = rings; i >= 0; i--) {
      const t = i / rings;
      const ringRadius = radius * t;

      // Calculate opacity based on falloff type
      let alpha;
      switch (falloffType) {
        case 'linear':
          alpha = (1 - t) * 60;
          break;
        case 'quadratic':
          alpha = (1 - t * t) * 60;
          break;
        case 'smooth':
          alpha = (1 - t * t * (3 - 2 * t)) * 60;
          break;
        case 'exponential':
          alpha = Math.exp(-t * 3) * 60;
          break;
        default:
          alpha = (1 - t) * 60;
      }

      p.noFill();
      p.stroke(255, 255, 255, alpha);
      p.strokeWeight(1);
      p.ellipse(x, y, ringRadius * 2, ringRadius * 2);
    }

    // Outer boundary circle
    p.noFill();
    p.stroke(255, 255, 255, 100);
    p.strokeWeight(1.5);
    p.ellipse(x, y, radius * 2, radius * 2);
  }

  _drawVelocityIndicator(x, y, velocity, speed) {
    const p = this.p;

    // Normalize and scale velocity for display
    const maxLength = 50;
    const normalizedSpeed = Math.min(speed / 500, 1);
    const length = normalizedSpeed * maxLength;

    const angle = Math.atan2(velocity.y, velocity.x);

    p.push();
    p.translate(x, y);
    p.rotate(angle);

    // Velocity line
    p.stroke(255, 255, 255, 150);
    p.strokeWeight(2);
    p.line(0, 0, length, 0);

    // Arrow head
    p.fill(255, 255, 255, 150);
    p.noStroke();
    p.triangle(
      length + 8, 0,
      length - 4, -5,
      length - 4, 5
    );

    p.pop();
  }

  _drawCenterPoint(x, y, speed) {
    const p = this.p;

    // Pulse based on speed
    const pulseSize = 6 + Math.min(speed / 100, 4);

    // Outer glow
    p.noStroke();
    p.fill(255, 255, 255, 30);
    p.ellipse(x, y, pulseSize * 3, pulseSize * 3);

    // Inner point
    p.fill(255, 255, 255, 200);
    p.ellipse(x, y, pulseSize, pulseSize);
  }
}
