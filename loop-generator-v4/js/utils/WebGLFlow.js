/**
 * WebGLFlow - GPU-accelerated optical flow using WebGL
 * Uses gradient-based Lucas-Kanade method computed on GPU
 */
class WebGLFlow {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.programs = {};
    this.textures = {};
    this.framebuffers = {};
    this.isInitialized = false;

    // Flow output
    this.flowData = null;
    this.width = 0;
    this.height = 0;
  }

  /**
   * Initialize WebGL context and shaders
   */
  init(width, height) {
    // Create offscreen canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.width = width;
    this.height = height;

    // Get WebGL context
    this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
    if (!this.gl) {
      console.error('WebGL not supported');
      return false;
    }

    const gl = this.gl;

    // Enable floating point textures if available
    const ext = gl.getExtension('OES_texture_float');
    const ext2 = gl.getExtension('OES_texture_float_linear');

    // Compile shaders
    this._createShaderProgram('flow', this._getVertexShader(), this._getFlowFragmentShader());

    // Create textures for previous and current frame
    this.textures.prevFrame = this._createTexture(width, height);
    this.textures.currFrame = this._createTexture(width, height);
    this.textures.flowOutput = this._createTexture(width, height);

    // Create framebuffer for flow output
    this.framebuffers.flow = this._createFramebuffer(this.textures.flowOutput);

    // Create full-screen quad
    this._createQuad();

    this.isInitialized = true;
    return true;
  }

  /**
   * Resize the flow calculator
   */
  resize(width, height) {
    if (this.width === width && this.height === height) return;

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    const gl = this.gl;
    gl.viewport(0, 0, width, height);

    // Recreate textures at new size
    this._deleteTexture(this.textures.prevFrame);
    this._deleteTexture(this.textures.currFrame);
    this._deleteTexture(this.textures.flowOutput);

    this.textures.prevFrame = this._createTexture(width, height);
    this.textures.currFrame = this._createTexture(width, height);
    this.textures.flowOutput = this._createTexture(width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.flow);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures.flowOutput, 0);
  }

  /**
   * Calculate optical flow between current and previous frame
   * @param {HTMLVideoElement|HTMLCanvasElement|ImageData} source - Current frame
   * @returns {Float32Array} Flow data (RGBA: dx, dy, magnitude, confidence)
   */
  calculate(source) {
    if (!this.isInitialized) {
      // Initialize with source dimensions
      const w = source.videoWidth || source.width;
      const h = source.videoHeight || source.height;
      if (!this.init(w, h)) return null;
    }

    const gl = this.gl;
    const sourceWidth = source.videoWidth || source.width;
    const sourceHeight = source.videoHeight || source.height;

    // Resize if needed
    if (sourceWidth !== this.width || sourceHeight !== this.height) {
      this.resize(sourceWidth, sourceHeight);
    }

    // Swap textures: current becomes previous
    const temp = this.textures.prevFrame;
    this.textures.prevFrame = this.textures.currFrame;
    this.textures.currFrame = temp;

    // Upload current frame to texture
    gl.bindTexture(gl.TEXTURE_2D, this.textures.currFrame);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // Render flow calculation to framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers.flow);
    gl.viewport(0, 0, this.width, this.height);

    gl.useProgram(this.programs.flow);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.currFrame);
    gl.uniform1i(gl.getUniformLocation(this.programs.flow, 'uCurrFrame'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.prevFrame);
    gl.uniform1i(gl.getUniformLocation(this.programs.flow, 'uPrevFrame'), 1);

    // Set uniforms
    gl.uniform2f(gl.getUniformLocation(this.programs.flow, 'uResolution'), this.width, this.height);

    // Draw quad
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Read back flow data
    if (!this.flowData || this.flowData.length !== this.width * this.height * 4) {
      this.flowData = new Uint8Array(this.width * this.height * 4);
    }
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.flowData);

    return this.flowData;
  }

  /**
   * Get flow vector at a specific grid cell
   * @param {number} col - Column
   * @param {number} row - Row
   * @param {number} cols - Total columns
   * @param {number} rows - Total rows
   * @returns {Object} { dx, dy, magnitude, angle, hasFlow }
   */
  getFlowAtCell(col, row, cols, rows) {
    if (!this.flowData) {
      return { dx: 0, dy: 0, magnitude: 0, angle: 0, hasFlow: false };
    }

    // Map grid cell to pixel coordinates
    const px = Math.floor((col + 0.5) / cols * this.width);
    const py = Math.floor((row + 0.5) / rows * this.height);

    // Sample a small region and average
    const sampleRadius = Math.max(1, Math.floor(Math.min(this.width / cols, this.height / rows) / 4));
    let totalDx = 0, totalDy = 0, count = 0;

    for (let sy = -sampleRadius; sy <= sampleRadius; sy++) {
      for (let sx = -sampleRadius; sx <= sampleRadius; sx++) {
        const x = Math.max(0, Math.min(this.width - 1, px + sx));
        const y = Math.max(0, Math.min(this.height - 1, py + sy));
        const idx = (y * this.width + x) * 4;

        // Flow is encoded as: R = dx + 128, G = dy + 128, B = magnitude, A = confidence
        const dx = (this.flowData[idx] - 128) / 4; // Scale factor
        const dy = (this.flowData[idx + 1] - 128) / 4;
        const confidence = this.flowData[idx + 3] / 255;

        if (confidence > 0.1) {
          totalDx += dx;
          totalDy += dy;
          count++;
        }
      }
    }

    if (count === 0) {
      return { dx: 0, dy: 0, magnitude: 0, angle: 0, hasFlow: false };
    }

    const dx = totalDx / count;
    const dy = totalDy / count;
    const magnitude = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    return {
      dx,
      dy,
      magnitude,
      angle,
      hasFlow: magnitude > 0.5
    };
  }

  // Shader source code
  _getVertexShader() {
    return `
      attribute vec2 aPosition;
      varying vec2 vTexCoord;
      void main() {
        vTexCoord = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
  }

  _getFlowFragmentShader() {
    return `
      precision highp float;

      uniform sampler2D uCurrFrame;
      uniform sampler2D uPrevFrame;
      uniform vec2 uResolution;

      varying vec2 vTexCoord;

      // Convert RGB to grayscale
      float luminance(vec3 color) {
        return dot(color, vec3(0.299, 0.587, 0.114));
      }

      void main() {
        vec2 texel = 1.0 / uResolution;

        // Sample current and previous frame
        float curr = luminance(texture2D(uCurrFrame, vTexCoord).rgb);
        float prev = luminance(texture2D(uPrevFrame, vTexCoord).rgb);

        // Calculate spatial gradients using Sobel operator
        float currL = luminance(texture2D(uCurrFrame, vTexCoord + vec2(-texel.x, 0.0)).rgb);
        float currR = luminance(texture2D(uCurrFrame, vTexCoord + vec2(texel.x, 0.0)).rgb);
        float currT = luminance(texture2D(uCurrFrame, vTexCoord + vec2(0.0, -texel.y)).rgb);
        float currB = luminance(texture2D(uCurrFrame, vTexCoord + vec2(0.0, texel.y)).rgb);

        // Spatial gradients
        float Ix = (currR - currL) * 0.5;
        float Iy = (currB - currT) * 0.5;

        // Temporal gradient
        float It = curr - prev;

        // Simple Lucas-Kanade style calculation
        // For a single pixel, we use the gradient constraint
        // and assume small motion

        // Avoid division by zero
        float gradMag = Ix * Ix + Iy * Iy;
        float minGrad = 0.0001;

        float dx = 0.0;
        float dy = 0.0;
        float confidence = 0.0;

        if (gradMag > minGrad) {
          // Estimate flow using gradient descent direction
          // This is a simplified single-pixel estimate
          float factor = -It / (gradMag + 0.001);
          dx = Ix * factor;
          dy = Iy * factor;

          // Clamp to reasonable range
          dx = clamp(dx, -20.0, 20.0);
          dy = clamp(dy, -20.0, 20.0);

          // Confidence based on gradient magnitude and temporal change
          confidence = min(1.0, sqrt(gradMag) * 10.0) * min(1.0, abs(It) * 5.0);
        }

        float magnitude = sqrt(dx * dx + dy * dy);

        // Encode output: R = dx + 128, G = dy + 128, B = magnitude, A = confidence
        // Scale dx/dy by 4 to fit in 0-255 range
        gl_FragColor = vec4(
          (dx * 4.0 + 128.0) / 255.0,
          (dy * 4.0 + 128.0) / 255.0,
          min(magnitude / 20.0, 1.0),
          confidence
        );
      }
    `;
  }

  // WebGL helper methods
  _createShaderProgram(name, vertexSrc, fragmentSrc) {
    const gl = this.gl;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexSrc);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
      return;
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentSrc);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
      return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      return;
    }

    this.programs[name] = program;
  }

  _createTexture(width, height) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  _deleteTexture(texture) {
    if (texture) {
      this.gl.deleteTexture(texture);
    }
  }

  _createFramebuffer(texture) {
    const gl = this.gl;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return fb;
  }

  _createQuad() {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]), gl.STATIC_DRAW);

    // Set up attribute for all programs
    for (const name in this.programs) {
      const program = this.programs[name];
      gl.useProgram(program);
      const posLoc = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }
  }

  /**
   * Clean up WebGL resources
   */
  dispose() {
    if (!this.gl) return;

    const gl = this.gl;

    for (const name in this.textures) {
      gl.deleteTexture(this.textures[name]);
    }
    for (const name in this.framebuffers) {
      gl.deleteFramebuffer(this.framebuffers[name]);
    }
    for (const name in this.programs) {
      gl.deleteProgram(this.programs[name]);
    }

    this.canvas = null;
    this.gl = null;
    this.isInitialized = false;
  }
}

// Singleton instance
let webglFlow = null;
