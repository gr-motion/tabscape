/**
 * ImageSampler - Samples colors from an image or video for use in the grid
 * Optimized for real-time video sampling using pixel buffer access
 */
class ImageSampler {
  constructor(p5Instance) {
    this.p = p5Instance;
    this.image = null;
    this.video = null;
    this.isLoaded = false;
    this.isVideo = false;
    this.mappingMode = 'fit'; // 'stretch', 'fit', 'tile'
    this._canvasAspect = 1; // canvas width/height, updated by cacheGridColors

    // Grid viewport — maps grid UV to canvas UV so image stays fixed when grid moves
    this._viewportOffsetU = 0;
    this._viewportOffsetV = 0;
    this._viewportScaleU = 1;
    this._viewportScaleV = 1;

    // Video state
    this.isPlaying = false;
    this.isLooping = true;
    this.videoDuration = 0;
    this.videoTime = 0;
    this.videoFramerate = 30;
    this._videoFramerateDetected = false;

    // Pixel buffer for optimized sampling
    this._pixelBuffer = null;
    this._bufferWidth = 0;
    this._bufferHeight = 0;
    this._pixelDensity = 1;

    // Cached color data for performance
    this._colorCache = [];
    this._cacheValid = false;
    this._lastGridCols = 0;
    this._lastGridRows = 0;

    // For video, track frame changes
    this._lastFrameTime = -1;
    this._frameCount = 0;

    // Motion detection
    this._prevBrightness = [];
    this._motionData = [];
    this._motionThreshold = 0.05; // Minimum brightness change to count as motion

    // Optical flow - gradient based (Lucas-Kanade style)
    this._flowVectors = [];
    this._prevPixelBuffer = null; // Store previous frame for gradient calculation
    this._flowWindowSize = 5; // Window size for gradient averaging

    // Transform settings
    this._positionX = 50; // 0-100, percentage offset (50 = centered)
    this._positionY = 50;
    this._scaleX = 100;   // 10-300, percentage (100 = 1:1)
    this._scaleY = 100;
    this._rotation = 0;   // -180 to 180 degrees

    // Palette mapping settings
    this._paletteMapEnabled = false;
    this._paletteMapMode = 'hueBucket'; // 'hueBucket' or 'quantize'
    this._paletteSatThreshold = 15; // Below this saturation = gray

    // Define the palette: 7 hues × 5 lightness levels
    // Base colors: gray #64737E, teal #48BEC5, green #52C584, olive #9BAD3B, coral #FD817C, candy #E35B6C, mauve #A06279
    this._paletteHues = [
      { name: 'gray', center: -1, range: null }, // Special: detected by saturation
      { name: 'teal', center: 183, range: [165, 210] },
      { name: 'green', center: 146, range: [100, 165] },
      { name: 'olive', center: 69, range: [40, 100] },
      { name: 'coral', center: 2, range: [355, 25] }, // Wraps around 0 - warm reds
      { name: 'candy', center: 352, range: [335, 355] }, // Pink-reds
      { name: 'mauve', center: 320, range: [280, 335] } // Pinks/purples
    ];

    // Lightness levels (0-100 scale, HSL lightness)
    this._paletteLightness = [85, 70, 50, 35, 20]; // 30% light, 60% light, 100%, 30% dark, 60% dark

    // Pre-computed palette colors (RGB hex) - 7 columns × 5 rows
    // Based on brand colors with calculated tints and shades
    this._paletteColors = [
      // Gray column - base #64737E
      ['#D4D9DD', '#9BA5AD', '#64737E', '#47525A', '#282F34'],
      // Teal column - base #48BEC5
      ['#B8E8EB', '#7ED4DA', '#48BEC5', '#2C8589', '#1A4F52'],
      // Green column - base #52C584
      ['#B5E6CA', '#84D6A7', '#52C584', '#3A8A5D', '#225237'],
      // Olive column - base #9BAD3B
      ['#DBE4AC', '#BDC972', '#9BAD3B', '#6D7A2A', '#414819'],
      // Coral column - base #FD817C
      ['#FED5D3', '#FEABA8', '#FD817C', '#C75A56', '#763533'],
      // Candy column - base #E35B6C
      ['#F5C5CB', '#ED9099', '#E35B6C', '#BC3244', '#711E29'],
      // Mauve column - base #A06279
      ['#D9C4CD', '#C093A3', '#A06279', '#714555', '#422832']
    ];
  }

  /**
   * Load media from a file or URL
   */
  loadMedia(source) {
    return new Promise((resolve, reject) => {
      this.clearMedia();

      let fileType = '';
      let url = '';

      if (source instanceof File) {
        fileType = source.type;
        url = URL.createObjectURL(source);
      } else if (typeof source === 'string') {
        url = source;
        const ext = source.split('.').pop().toLowerCase();
        if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) {
          fileType = 'video/' + ext;
        } else {
          fileType = 'image/';
        }
      }

      if (fileType.startsWith('video/')) {
        this._loadVideo(url, source instanceof File, resolve, reject);
      } else {
        this._loadImage(url, source instanceof File, resolve, reject);
      }
    });
  }

  loadImage(source) {
    return this.loadMedia(source);
  }

  _loadImage(url, isBlob, resolve, reject) {
    this.p.loadImage(url,
      (img) => {
        this.image = img;
        this.video = null;
        this.isLoaded = true;
        this.isVideo = false;
        this._loadPixelBuffer();
        if (isBlob) URL.revokeObjectURL(url);
        resolve(img);
      },
      (err) => {
        if (isBlob) URL.revokeObjectURL(url);
        reject(err);
      }
    );
  }

  _loadVideo(url, isBlob, resolve, reject) {
    const p = this.p;

    const video = p.createVideo(url, () => {
      this.video = video;
      this.image = null;
      this.isLoaded = true;
      this.isVideo = true;

      video.hide();
      video.volume(0);
      video.elt.muted = true;
      video.elt.playsInline = true;
      this.videoDuration = video.duration();

      if (this.isLooping) {
        video.elt.loop = true;
      }

      if (this.isPlaying) {
        this._safePlay(video);
        this._detectVideoFramerate();
        resolve(video);
      } else {
        // p5's createVideo auto-plays — explicitly pause
        video.pause();
        video.elt.pause();
        video.elt.autoplay = false;
        // Force browser to decode first frame so pixels aren't all black
        let resolved = false;
        const finishLoad = () => {
          if (resolved) return;
          resolved = true;
          this.updateVideoBuffer();
          this._lastFrameTime = -1; // force next cacheGridColors to refresh
          this._cacheValid = false;
          this._detectVideoFramerate();
          resolve(video);
        };
        video.elt.addEventListener('seeked', finishLoad, { once: true });
        video.elt.currentTime = 0;
        // Fallback if seeked doesn't fire (already at time 0)
        setTimeout(finishLoad, 200);
      }
    });

    video.elt.onerror = () => {
      if (isBlob) URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };
  }

  /**
   * Load pixels into buffer for fast access (for images)
   */
  _loadPixelBuffer() {
    if (!this.image) return;

    this.image.loadPixels();
    this._pixelBuffer = this.image.pixels;
    this._bufferWidth = this.image.width;
    this._bufferHeight = this.image.height;
    this._pixelDensity = this.image.pixelDensity ? this.image.pixelDensity() : 1;
  }

  /**
   * Update pixel buffer from video frame
   * Call this once per frame before sampling
   */
  updateVideoBuffer() {
    if (!this.isVideo || !this.video) return;

    this.video.loadPixels();
    if (!this.video.pixels || this.video.pixels.length === 0) return;

    const newPixels = this.video.pixels;
    const bufferSize = newPixels.length;

    // Store previous frame buffer for optical flow (swap buffers)
    if (this._pixelBuffer && this._pixelBuffer.length === bufferSize) {
      // Swap: current becomes previous
      this._prevPixelBuffer = this._pixelBuffer;
    }

    // Copy new pixels to our own buffer (don't keep reference to video.pixels)
    this._pixelBuffer = new Uint8ClampedArray(bufferSize);
    this._pixelBuffer.set(newPixels);

    // Use the intrinsic video stream dims, not the p5 element width which can
    // be the displayed/CSS size. Mismatch here makes the canvas-aspect fit
    // disagree with the shader's imgAspect and triggers fit-mode letterbox.
    this._bufferWidth = (this.video.elt && this.video.elt.videoWidth) || this.video.width;
    this._bufferHeight = (this.video.elt && this.video.elt.videoHeight) || this.video.height;
    this._pixelDensity = 1;
    this._frameCount++;
  }

  clearMedia() {
    if (this.video) {
      this.video.stop();
      this.video.remove();
    }
    this.image = null;
    this.video = null;
    this.isLoaded = false;
    this.isVideo = false;
    this.isPlaying = false;
    this.videoFramerate = 30;
    this._videoFramerateDetected = false;
    this._cacheValid = false;
    this._colorCache = [];
    this._pixelBuffer = null;
  }

  clearImage() {
    this.clearMedia();
  }

  /**
   * Detect video framerate using requestVideoFrameCallback.
   * Measures the time delta between two consecutive frames and snaps to a common rate.
   * Fires asynchronously once the video starts playing.
   */
  _detectVideoFramerate() {
    if (!this.video || !this.video.elt) return;
    const el = this.video.elt;
    if (!el.requestVideoFrameCallback) {
      this._videoFramerateDetected = true;
      return;
    }

    let firstTime = null;
    const onFrame1 = (now, metadata) => {
      if (this._videoFramerateDetected) return;
      firstTime = metadata.mediaTime;
      el.requestVideoFrameCallback(onFrame2);
    };
    const onFrame2 = (now, metadata) => {
      if (this._videoFramerateDetected) return;
      this._videoFramerateDetected = true;
      const delta = metadata.mediaTime - firstTime;
      if (delta > 0) {
        const fps = 1 / delta;
        const common = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
        this.videoFramerate = common.reduce((a, b) =>
          Math.abs(b - fps) < Math.abs(a - fps) ? b : a
        );
      }
    };
    el.requestVideoFrameCallback(onFrame1);
  }

  // Video controls
  _safePlay(video) {
    const playPromise = video.elt.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => { /* interrupted by pause — ignore */ });
    }
  }

  play() {
    if (this.video) {
      this._safePlay(this.video);
      this.isPlaying = true;
    }
  }

  pause() {
    if (this.video) {
      this.video.pause();
      this.isPlaying = false;
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  setLoop(shouldLoop) {
    this.isLooping = shouldLoop;
    if (this.video) {
      this.video.elt.loop = shouldLoop;
    }
  }

  seek(time) {
    if (this.video) {
      this.video.time(time);
      // When paused, the draw loop won't naturally pick up the new frame.
      // Listen for the browser's seeked event, then force a buffer refresh.
      const elt = this.video.elt;
      const onSeeked = () => {
        elt.removeEventListener('seeked', onSeeked);
        this.updateVideoBuffer();
        this._cacheValid = false;
        this._lastFrameTime = -1;
      };
      elt.addEventListener('seeked', onSeeked);
    }
  }

  seekPercent(percent) {
    if (this.video && this.videoDuration > 0) {
      this.seek(this.videoDuration * percent);
    }
  }

  getVideoTime() {
    if (this.video) {
      return this.video.time();
    }
    return 0;
  }

  getVideoDuration() {
    return this.videoDuration;
  }

  getVideoProgress() {
    if (this.videoDuration > 0) {
      return this.getVideoTime() / this.videoDuration;
    }
    return 0;
  }

  setMappingMode(mode) {
    if (this.mappingMode !== mode) {
      this.mappingMode = mode;
      this._cacheValid = false;
    }
  }

  setTransform(posX, posY, scaleX, scaleY, rotation) {
    if (this._positionX !== posX || this._positionY !== posY ||
        this._scaleX !== scaleX || this._scaleY !== scaleY ||
        this._rotation !== rotation) {
      this._positionX = posX;
      this._positionY = posY;
      this._scaleX = scaleX;
      this._scaleY = scaleY;
      this._rotation = rotation;
      this._cacheValid = false;
    }
  }

  /**
   * Set the grid viewport so image sampling is relative to the canvas, not the grid.
   * When the grid moves on screen, cells sample from their canvas position.
   * @param {number} offsetX - Grid left edge pixel position on canvas
   * @param {number} offsetY - Grid top edge pixel position on canvas
   * @param {number} totalWidth - Total grid width in pixels
   * @param {number} totalHeight - Total grid height in pixels
   * @param {number} canvasWidth - Canvas width in pixels
   * @param {number} canvasHeight - Canvas height in pixels
   */
  setGridViewport(offsetX, offsetY, totalWidth, totalHeight, canvasWidth, canvasHeight) {
    const ou = canvasWidth > 0 ? offsetX / canvasWidth : 0;
    const ov = canvasHeight > 0 ? offsetY / canvasHeight : 0;
    const su = canvasWidth > 0 ? totalWidth / canvasWidth : 1;
    const sv = canvasHeight > 0 ? totalHeight / canvasHeight : 1;
    if (this._viewportOffsetU !== ou || this._viewportOffsetV !== ov ||
        this._viewportScaleU !== su || this._viewportScaleV !== sv) {
      this._viewportOffsetU = ou;
      this._viewportOffsetV = ov;
      this._viewportScaleU = su;
      this._viewportScaleV = sv;
      this._cacheValid = false;
    }
  }

  /**
   * Apply position, scale, and rotation transforms to normalized u,v coordinates
   */
  _transformUV(u, v) {
    // Rotate around center (0.5, 0.5)
    if (this._rotation !== 0) {
      const rad = this._rotation * Math.PI / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = u - 0.5;
      const cy = v - 0.5;
      u = cx * cos + cy * sin + 0.5;
      v = -cx * sin + cy * cos + 0.5;
    }

    // Scale around center (100 = 1:1) — always anchored to canvas center
    const sx = this._scaleX / 100;
    const sy = this._scaleY / 100;
    u = (u - 0.5) / sx + 0.5;
    v = (v - 0.5) / sy + 0.5;

    // Position offset: applied after scale so scaling always originates from center
    u = u - (this._positionX - 50) / 100;
    v = v - (this._positionY - 50) / 100;

    return { u, v };
  }

  /**
   * Get pixel color directly from buffer (optimized)
   * @param {number} x - Pixel x coordinate
   * @param {number} y - Pixel y coordinate
   * @returns {Object} { r, g, b, a, brightness }
   */
  _getPixelFromBuffer(x, y) {
    if (!this._pixelBuffer) return null;

    // Clamp coordinates
    x = Math.max(0, Math.min(this._bufferWidth - 1, Math.floor(x)));
    y = Math.max(0, Math.min(this._bufferHeight - 1, Math.floor(y)));

    // Calculate pixel index (4 values per pixel: RGBA)
    // Account for pixel density
    const d = this._pixelDensity;
    const idx = 4 * (y * d * this._bufferWidth * d + x * d);

    let r = this._pixelBuffer[idx];
    let g = this._pixelBuffer[idx + 1];
    let b = this._pixelBuffer[idx + 2];
    const a = this._pixelBuffer[idx + 3];


    // Calculate brightness (0-1)
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;

    // Calculate saturation (0-1)
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const cMax = Math.max(rn, gn, bn);
    const cMin = Math.min(rn, gn, bn);
    const l = (cMax + cMin) / 2;
    const chroma = cMax - cMin;
    const saturation = chroma === 0 ? 0 : (l > 0.5 ? chroma / (2 - cMax - cMin) : chroma / (cMax + cMin));

    return { r, g, b, a, brightness, saturation };
  }

  /**
   * Sample color at a normalized position (0-1 range)
   */
  sampleAt(rawU, rawV) {
    if (!this.isLoaded || !this._pixelBuffer) return null;

    const { u, v } = this._transformUV(rawU, rawV);
    const w = this._bufferWidth;
    const h = this._bufferHeight;
    let x, y;

    switch (this.mappingMode) {
      case 'stretch':
        x = u * (w - 1);
        y = v * (h - 1);
        break;

      case 'fit': {
        const imgAspect = w / h;
        const canvasAspect = this._canvasAspect;

        if (imgAspect > canvasAspect) {
          // Image is wider relative to canvas — fit by width, letterbox vertically
          const vScale = canvasAspect / imgAspect;
          const offsetV = (1 - vScale) / 2;
          if (v < offsetV || v > 1 - offsetV) return null;
          x = u * (w - 1);
          y = ((v - offsetV) / vScale) * (h - 1);
        } else {
          // Image is taller relative to canvas — fit by height, pillarbox horizontally
          const uScale = imgAspect / canvasAspect;
          const offsetU = (1 - uScale) / 2;
          if (u < offsetU || u > 1 - offsetU) return null;
          x = ((u - offsetU) / uScale) * (w - 1);
          y = v * (h - 1);
        }
        break;
      }

      case 'tile':
        x = (u % 1) * (w - 1);
        y = (v % 1) * (h - 1);
        break;

      default:
        x = u * (w - 1);
        y = v * (h - 1);
    }

    return this._getPixelFromBuffer(x, y);
  }

  /**
   * Sample color for a grid position
   */
  sampleForGrid(col, row, totalCols, totalRows) {
    if (!this.isLoaded) return null;

    const u = totalCols > 1 ? col / (totalCols - 1) : 0.5;
    const v = totalRows > 1 ? row / (totalRows - 1) : 0.5;

    const sample = this.sampleAt(u, v);
    if (!sample) return null;

    sample.hex = this._rgbToHex(sample.r, sample.g, sample.b);

    return sample;
  }

  /**
   * Pre-cache colors for the entire grid (optimized batch sampling)
   */
  cacheGridColors(cols, rows, canvasWidth, canvasHeight) {
    if (!this.isLoaded) {
      this._colorCache = [];
      this._cacheValid = false;
      return;
    }

    // Update canvas aspect ratio for fit mode
    if (canvasWidth && canvasHeight) {
      this._canvasAspect = canvasWidth / canvasHeight;
    }

    // For video, update pixel buffer and invalidate cache each frame
    if (this.isVideo) {
      const currentTime = this.getVideoTime();
      const delta = Math.abs(currentTime - this._lastFrameTime);
      const needsUpdate = delta > 0.016 || !this._pixelBuffer;
      if (needsUpdate) {
        this.updateVideoBuffer();
        this._cacheValid = false;
        this._lastFrameTime = currentTime;
      }
    }

    // Check if hueOffset changed (invalidate cache if so)
    const curHueOffset = (typeof stateManager !== 'undefined' ? stateManager.get('imageHueOffset') : 0) || 0;
    if (curHueOffset !== this._lastHueOffset) {
      this._cacheValid = false;
      this._lastHueOffset = curHueOffset;
    }

    // Check if cache is still valid
    if (this._cacheValid &&
        this._lastGridCols === cols &&
        this._lastGridRows === rows) {
      return;
    }

    // Pre-allocate array for better performance
    const totalCells = cols * rows;
    if (this._colorCache.length !== totalCells) {
      this._colorCache = new Array(totalCells);
    }

    this._lastGridCols = cols;
    this._lastGridRows = rows;

    // Batch sample all grid positions
    const w = this._bufferWidth;
    const h = this._bufferHeight;

    for (let row = 0; row < rows; row++) {
      const gridV = rows > 1 ? row / (rows - 1) : 0.5;

      for (let col = 0; col < cols; col++) {
        const gridU = cols > 1 ? col / (cols - 1) : 0.5;
        const index = row * cols + col;

        // Map from grid-relative UV to canvas-relative UV
        // so the image stays fixed when the grid moves
        const rawU = this._viewportOffsetU + gridU * this._viewportScaleU;
        const rawV = this._viewportOffsetV + gridV * this._viewportScaleV;

        // Apply position/scale/rotation transforms
        const { u, v } = this._transformUV(rawU, rawV);

        // Calculate pixel coordinates based on mapping mode
        let x, y;
        let valid = true;

        // Check bounds after transform (except tile mode which wraps)
        if (this.mappingMode !== 'tile' && (u < 0 || u > 1 || v < 0 || v > 1)) {
          valid = false;
        }

        switch (this.mappingMode) {
          case 'stretch':
            x = u * (w - 1);
            y = v * (h - 1);
            break;

          case 'fit': {
            const imgAspect = w / h;
            const cAspect = this._canvasAspect;
            if (imgAspect > cAspect) {
              // Image wider relative to canvas — fit by width, letterbox vertically
              const vScale = cAspect / imgAspect;
              const offsetV = (1 - vScale) / 2;
              if (v < offsetV || v > 1 - offsetV) {
                valid = false;
              } else {
                x = u * (w - 1);
                y = ((v - offsetV) / vScale) * (h - 1);
              }
            } else {
              // Image taller relative to canvas — fit by height, pillarbox horizontally
              const uScale = imgAspect / cAspect;
              const offsetU = (1 - uScale) / 2;
              if (u < offsetU || u > 1 - offsetU) {
                valid = false;
              } else {
                x = ((u - offsetU) / uScale) * (w - 1);
                y = v * (h - 1);
              }
            }
            break;
          }

          case 'tile':
            x = (u % 1) * (w - 1);
            y = (v % 1) * (h - 1);
            break;

          default:
            x = u * (w - 1);
            y = v * (h - 1);
        }

        if (valid) {
          const pixel = this._getPixelFromBuffer(x, y);
          if (pixel) {
            // Store original brightness and saturation before any color mapping
            const originalBrightness = pixel.brightness;
            const originalSaturation = pixel.saturation;

            // Apply hue offset to raw colors
            if (curHueOffset !== 0) {
              const hsl = this._rgbToHsl(pixel.r, pixel.g, pixel.b);
              // Greyscale pixels have ~0 saturation so hue rotation is a no-op.
              // Inject saturation proportional to offset magnitude so they colorize.
              if (hsl.s < 5) {
                const offsetStrength = Math.abs(curHueOffset) / 180;
                hsl.s = Math.max(hsl.s, offsetStrength * 30);
              }
              hsl.h = (hsl.h + curHueOffset + 360) % 360;
              const shifted = this._hslToRgb(hsl.h, hsl.s, hsl.l);
              pixel.r = shifted.r;
              pixel.g = shifted.g;
              pixel.b = shifted.b;
            }

            // Apply palette mapping if enabled (modifies r, g, b, hex)
            if (this._paletteMapEnabled) {
              const mapped = this.mapToPalette(pixel.r, pixel.g, pixel.b);
              pixel.r = mapped.r;
              pixel.g = mapped.g;
              pixel.b = mapped.b;
              pixel.hex = mapped.hex;
            } else {
              pixel.hex = this._rgbToHex(pixel.r, pixel.g, pixel.b);
            }

            // Preserve original brightness and saturation for scale calculations
            pixel.brightness = originalBrightness;
            pixel.saturation = originalSaturation;
          }
          this._colorCache[index] = pixel;
        } else {
          this._colorCache[index] = null;
        }
      }
    }

    this._cacheValid = true;
  }

  getCachedColor(index) {
    if (!this._cacheValid || index >= this._colorCache.length) {
      return null;
    }
    return this._colorCache[index];
  }

  invalidateCache() {
    this._cacheValid = false;
  }

  _rgbToHex(r, g, b) {
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Convert RGB to HSL
   * @returns {Object} { h: 0-360, s: 0-100, l: 0-100 }
   */
  _rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let h = 0, s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  /**
   * Convert HSL to RGB
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-100)
   * @param {number} l - Lightness (0-100)
   * @returns {Object} { r, g, b } (0-255)
   */
  _hslToRgb(h, s, l) {
    h /= 360;
    s /= 100;
    l /= 100;

    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  /**
   * Convert hex color to RGB
   */
  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  /**
   * Set palette mapping options
   */
  setPaletteMapping(enabled, mode, satThreshold) {
    this._paletteMapEnabled = enabled;
    if (mode) this._paletteMapMode = mode;
    if (satThreshold !== undefined) this._paletteSatThreshold = satThreshold;
    this._cacheValid = false; // Invalidate cache when settings change
  }

  /**
   * Map a color to the palette
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   * @returns {Object} { r, g, b, hex } - Palette-mapped color
   */
  mapToPalette(r, g, b) {
    if (!this._paletteMapEnabled) {
      return { r, g, b, hex: this._rgbToHex(r, g, b) };
    }

    const hsl = this._rgbToHsl(r, g, b);

    if (this._paletteMapMode === 'hueBucket') {
      return this._mapHueBucket(hsl);
    } else {
      return this._mapQuantize(hsl);
    }
  }

  /**
   * Hue Bucket mode: snap hue to nearest bucket, map lightness to 5 levels
   */
  _mapHueBucket(hsl) {
    let hueIndex = 0; // Default to gray

    // Check if it's a gray (low saturation)
    if (hsl.s >= this._paletteSatThreshold) {
      // Find the closest hue bucket by checking ranges first, then distance
      let foundInRange = false;

      for (let i = 1; i < this._paletteHues.length; i++) {
        const bucket = this._paletteHues[i];
        const range = bucket.range;

        // Handle hue wrap-around for ranges that cross 0 (e.g., coral: 355-25)
        let inRange = false;
        if (range[0] > range[1]) {
          // Wraps around 0° (e.g., 355 to 25 means 355-360 and 0-25)
          inRange = hsl.h >= range[0] || hsl.h <= range[1];
        } else {
          inRange = hsl.h >= range[0] && hsl.h <= range[1];
        }

        if (inRange) {
          hueIndex = i;
          foundInRange = true;
          break;
        }
      }

      // If no range matched, find closest by distance to center
      if (!foundInRange) {
        let minDist = Infinity;
        for (let i = 1; i < this._paletteHues.length; i++) {
          const bucket = this._paletteHues[i];
          let dist = Math.abs(hsl.h - bucket.center);
          if (dist > 180) dist = 360 - dist; // Handle wrap-around

          if (dist < minDist) {
            minDist = dist;
            hueIndex = i;
          }
        }
      }
    }

    // Map lightness to 5 levels
    const lightnessIndex = this._getLightnessIndex(hsl.l);

    // Get the palette color
    const hex = this._paletteColors[hueIndex][lightnessIndex];
    const rgb = this._hexToRgb(hex);

    return { r: rgb.r, g: rgb.g, b: rgb.b, hex };
  }

  /**
   * Quantize mode: independently quantize hue and lightness
   */
  _mapQuantize(hsl) {
    let hueIndex = 0;

    // Check if it's a gray
    if (hsl.s >= this._paletteSatThreshold) {
      // Quantize hue to 6 chromatic buckets (skip gray at index 0)
      // Map 0-360 degrees to 6 buckets
      const hueNorm = ((hsl.h + 15) % 360) / 360; // Offset to center buckets
      hueIndex = 1 + Math.floor(hueNorm * 6) % 6;
    }

    // Quantize lightness to 5 levels
    const lightnessIndex = this._getLightnessIndex(hsl.l);

    const hex = this._paletteColors[hueIndex][lightnessIndex];
    const rgb = this._hexToRgb(hex);

    return { r: rgb.r, g: rgb.g, b: rgb.b, hex };
  }

  /**
   * Get lightness index (0-4) from HSL lightness (0-100)
   */
  _getLightnessIndex(l) {
    // Palette lightness levels: [85, 70, 50, 35, 20]
    // Find closest
    if (l >= 77) return 0;      // Very light
    if (l >= 60) return 1;      // Light
    if (l >= 42) return 2;      // Mid
    if (l >= 27) return 3;      // Dark
    return 4;                    // Very dark
  }

  getDimensions() {
    if (!this.isLoaded) return null;
    return {
      width: this._bufferWidth,
      height: this._bufferHeight
    };
  }

  hasImage() {
    return this.isLoaded;
  }

  hasVideo() {
    return this.isLoaded && this.isVideo;
  }

  /**
   * Force-refresh pixel data for the current video frame.
   * Bypasses the 16ms time-threshold in cacheGridColors() so every
   * sought frame during export gets fresh pixel data.
   */
  prepareFrameForExport() {
    if (this.isVideo && this.video) {
      this.updateVideoBuffer();
      this._cacheValid = false;
      this._lastFrameTime = this.getVideoTime();
    }
  }

  /**
   * Set motion detection threshold
   * @param {number} threshold - Brightness change threshold (0-1)
   */
  setMotionThreshold(threshold) {
    this._motionThreshold = threshold;
  }

  /**
   * Detect motion between current and previous frame
   * Must be called after cacheGridColors()
   * @returns {Array} Motion data for each cell { hasMotion, delta, brightness }
   */
  detectMotion() {
    if (!this.isVideo || !this._cacheValid) {
      return this._motionData;
    }

    const totalCells = this._colorCache.length;

    // Initialize arrays if needed
    if (this._prevBrightness.length !== totalCells) {
      this._prevBrightness = new Array(totalCells).fill(0);
      this._motionData = new Array(totalCells);
      for (let i = 0; i < totalCells; i++) {
        this._motionData[i] = { hasMotion: false, delta: 0, brightness: 0 };
      }
    }

    // Compare current brightness to previous
    for (let i = 0; i < totalCells; i++) {
      const sample = this._colorCache[i];
      const currentBrightness = sample ? sample.brightness : 0;
      const prevBrightness = this._prevBrightness[i];

      const delta = Math.abs(currentBrightness - prevBrightness);
      const hasMotion = delta > this._motionThreshold;

      this._motionData[i] = {
        hasMotion,
        delta,
        brightness: currentBrightness,
        direction: currentBrightness > prevBrightness ? 1 : -1 // Getting brighter or darker
      };

      // Store current as previous for next frame
      this._prevBrightness[i] = currentBrightness;
    }

    return this._motionData;
  }

  /**
   * Get motion data for a specific cell
   */
  getMotionAt(index) {
    if (index >= 0 && index < this._motionData.length) {
      return this._motionData[index];
    }
    return { hasMotion: false, delta: 0, brightness: 0, direction: 0 };
  }

  /**
   * Get all cells with motion above threshold
   * @returns {Array} Array of { index, col, row, delta, brightness }
   */
  getMotionCells(cols, rows) {
    const cells = [];

    for (let i = 0; i < this._motionData.length; i++) {
      const motion = this._motionData[i];
      if (motion.hasMotion) {
        cells.push({
          index: i,
          col: i % cols,
          row: Math.floor(i / cols),
          delta: motion.delta,
          brightness: motion.brightness,
          direction: motion.direction
        });
      }
    }

    return cells;
  }

  /**
   * Clear motion history (call when video restarts or changes)
   */
  clearMotionHistory() {
    this._prevBrightness = [];
    this._motionData = [];
    this._flowVectors = [];
  }

  /**
   * Set the window size for gradient-based flow calculation
   * @param {number} size - Window size for gradient averaging
   */
  setFlowSearchRadius(size) {
    this._flowWindowSize = Math.max(3, Math.floor(size) * 2 + 1); // Ensure odd number
  }

  /**
   * Get brightness at pixel position from a buffer
   */
  _getBrightnessAt(buffer, x, y) {
    if (!buffer) return 0;
    x = Math.max(0, Math.min(this._bufferWidth - 1, Math.floor(x)));
    y = Math.max(0, Math.min(this._bufferHeight - 1, Math.floor(y)));
    const idx = 4 * (y * this._bufferWidth + x);
    const r = buffer[idx];
    const g = buffer[idx + 1];
    const b = buffer[idx + 2];
    return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  }

  /**
   * Calculate optical flow using gradient-based Lucas-Kanade method
   * Uses spatial gradients (Ix, Iy) and temporal gradient (It)
   * Solves: Ix*u + Iy*v + It = 0 using least squares over a window
   * @param {number} cols - Grid columns
   * @param {number} rows - Grid rows
   * @returns {Array} Flow vectors for each cell { dx, dy, magnitude, angle, hasFlow }
   */
  calculateFlow(cols, rows) {
    if (!this.isVideo || !this._pixelBuffer || !this._prevPixelBuffer) {
      return this._flowVectors;
    }

    const totalCells = cols * rows;

    // Initialize flow vectors if needed
    if (this._flowVectors.length !== totalCells) {
      this._flowVectors = new Array(totalCells);
      for (let i = 0; i < totalCells; i++) {
        this._flowVectors[i] = { dx: 0, dy: 0, magnitude: 0, angle: 0, hasFlow: false };
      }
    }

    const w = this._bufferWidth;
    const h = this._bufferHeight;
    const windowSize = this._flowWindowSize;
    const halfWindow = Math.floor(windowSize / 2);

    // For each grid cell, calculate flow at center using gradient method
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;

        // Map grid cell to pixel coordinates
        const cellCenterX = Math.floor((col + 0.5) / cols * w);
        const cellCenterY = Math.floor((row + 0.5) / rows * h);

        // Lucas-Kanade: solve [Ix*Ix  Ix*Iy] [u]   [-Ix*It]
        //                     [Ix*Iy  Iy*Iy] [v] = [-Iy*It]
        // Accumulate sums over window
        let sumIxIx = 0, sumIyIy = 0, sumIxIy = 0;
        let sumIxIt = 0, sumIyIt = 0;
        let totalIt = 0;

        for (let wy = -halfWindow; wy <= halfWindow; wy++) {
          for (let wx = -halfWindow; wx <= halfWindow; wx++) {
            const px = cellCenterX + wx;
            const py = cellCenterY + wy;

            if (px < 1 || px >= w - 1 || py < 1 || py >= h - 1) continue;

            // Spatial gradients using central differences on current frame
            const Ix = (this._getBrightnessAt(this._pixelBuffer, px + 1, py) -
                       this._getBrightnessAt(this._pixelBuffer, px - 1, py)) / 2;
            const Iy = (this._getBrightnessAt(this._pixelBuffer, px, py + 1) -
                       this._getBrightnessAt(this._pixelBuffer, px, py - 1)) / 2;

            // Temporal gradient (current - previous)
            const It = this._getBrightnessAt(this._pixelBuffer, px, py) -
                      this._getBrightnessAt(this._prevPixelBuffer, px, py);

            sumIxIx += Ix * Ix;
            sumIyIy += Iy * Iy;
            sumIxIy += Ix * Iy;
            sumIxIt += Ix * It;
            sumIyIt += Iy * It;
            totalIt += Math.abs(It);
          }
        }

        // Solve 2x2 system using Cramer's rule
        const det = sumIxIx * sumIyIy - sumIxIy * sumIxIy;
        const minDet = 0.0001; // Avoid division by zero / ill-conditioned matrix

        let u = 0, v = 0;
        if (Math.abs(det) > minDet) {
          u = (-sumIxIt * sumIyIy + sumIyIt * sumIxIy) / det;
          v = (-sumIyIt * sumIxIx + sumIxIt * sumIxIy) / det;
        }

        // Scale flow to reasonable range (pixels -> normalized)
        // Clamp extreme values
        const maxFlow = 20;
        u = Math.max(-maxFlow, Math.min(maxFlow, u));
        v = Math.max(-maxFlow, Math.min(maxFlow, v));

        const magnitude = Math.sqrt(u * u + v * v);
        const angle = Math.atan2(v, u);

        // Consider it valid flow if there's enough temporal change and magnitude
        const avgIt = totalIt / (windowSize * windowSize);
        const hasFlow = magnitude > 0.5 && avgIt > 0.01;

        this._flowVectors[index] = {
          dx: u,
          dy: v,
          magnitude,
          angle,
          hasFlow,
          delta: avgIt
        };
      }
    }

    return this._flowVectors;
  }

  /**
   * Get flow vector for a specific cell
   */
  getFlowAt(index) {
    if (index >= 0 && index < this._flowVectors.length) {
      return this._flowVectors[index];
    }
    return { dx: 0, dy: 0, magnitude: 0, angle: 0, hasFlow: false };
  }

  /**
   * Get all cells with flow above a minimum magnitude
   * @param {number} cols - Grid columns
   * @param {number} rows - Grid rows
   * @param {number} minMagnitude - Minimum magnitude to include
   * @returns {Array} Array of { index, col, row, dx, dy, magnitude, angle }
   */
  getFlowCells(cols, rows, minMagnitude = 0.5) {
    const cells = [];

    for (let i = 0; i < this._flowVectors.length; i++) {
      const flow = this._flowVectors[i];
      if (flow.hasFlow && flow.magnitude >= minMagnitude) {
        cells.push({
          index: i,
          col: i % cols,
          row: Math.floor(i / cols),
          dx: flow.dx,
          dy: flow.dy,
          magnitude: flow.magnitude,
          angle: flow.angle
        });
      }
    }

    return cells;
  }
}

// Singleton instances
let imageSampler = null;
let scaleVideoSampler = null;
let maskSampler = null;
