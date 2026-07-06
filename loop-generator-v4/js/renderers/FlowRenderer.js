/**
 * FlowRenderer - Visualizes optical flow like TouchDesigner
 * Red = horizontal motion (dx), Green = vertical motion (dy)
 */
class FlowRenderer {
  constructor(p5Instance) {
    this.p = p5Instance;
    this.flowImage = null;
  }

  /**
   * Render the flow visualization (TouchDesigner style: R=dx, G=dy)
   */
  render() {
    const state = stateManager.getAll();

    if (!state.showFlowDebug) return;
    if (!imageSampler || !imageSampler.hasVideo()) return;
    if (!webglFlow || !webglFlow.flowData) return;

    const p = this.p;

    // Get video dimensions for display
    const video = imageSampler.video;
    if (!video) return;

    const videoAspect = video.width / video.height;
    const canvasAspect = p.width / p.height;
    let drawWidth, drawHeight, drawX, drawY;

    if (videoAspect > canvasAspect) {
      drawWidth = p.width;
      drawHeight = p.width / videoAspect;
      drawX = 0;
      drawY = (p.height - drawHeight) / 2;
    } else {
      drawHeight = p.height;
      drawWidth = p.height * videoAspect;
      drawX = (p.width - drawWidth) / 2;
      drawY = 0;
    }

    // Create or update flow visualization image
    const flowWidth = webglFlow.width;
    const flowHeight = webglFlow.height;

    if (!this.flowImage || this.flowImage.width !== flowWidth || this.flowImage.height !== flowHeight) {
      this.flowImage = p.createImage(flowWidth, flowHeight);
    }

    // Convert flow data to TouchDesigner-style RGB visualization
    this.flowImage.loadPixels();
    const flowData = webglFlow.flowData;
    const pixels = this.flowImage.pixels;

    for (let i = 0; i < flowWidth * flowHeight; i++) {
      const idx = i * 4;

      // Flow data is encoded as: R = dx + 128, G = dy + 128, B = magnitude, A = confidence
      const dxEncoded = flowData[idx];       // 0-255, 128 = no motion
      const dyEncoded = flowData[idx + 1];   // 0-255, 128 = no motion
      const magnitude = flowData[idx + 2];   // 0-255
      const confidence = flowData[idx + 3];  // 0-255

      // TouchDesigner style:
      // Red channel = horizontal motion (positive = right, centered at 128)
      // Green channel = vertical motion (positive = down, centered at 128)
      // Blue channel = 128 (neutral) or could show magnitude

      // Amplify the flow for visibility
      const amplify = 2.0;
      const dx = (dxEncoded - 128) * amplify;
      const dy = (dyEncoded - 128) * amplify;

      // Map to 0-255 range with 128 as center (no motion)
      const r = Math.max(0, Math.min(255, 128 + dx));
      const g = Math.max(0, Math.min(255, 128 + dy));
      const b = 128; // Neutral blue

      // Full opacity - show flow directly on black background
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }

    this.flowImage.updatePixels();

    // Draw the flow visualization (no blending - direct render on black)
    p.push();
    p.image(this.flowImage, drawX, drawY, drawWidth, drawHeight);
    p.pop();

    // Draw legend
    this._drawLegend();
  }

  _drawLegend() {
    const p = this.p;

    p.push();
    p.fill(0, 0, 0, 180);
    p.noStroke();
    p.rect(10, 10, 140, 80, 5);

    p.fill(255);
    p.textSize(11);
    p.textAlign(p.LEFT, p.TOP);
    p.text('Optical Flow', 15, 15);

    p.textSize(9);
    // Red = horizontal
    p.fill(255, 100, 100);
    p.rect(15, 32, 12, 12);
    p.fill(255);
    p.text('Red = Right', 32, 33);

    p.fill(100, 255, 100);
    p.rect(15, 48, 12, 12);
    p.fill(255);
    p.text('Green = Down', 32, 49);

    p.fill(180);
    p.text('Gray = No motion', 15, 67);

    p.pop();
  }
}
