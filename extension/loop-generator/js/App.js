/**
 * App - Main application coordinator
 * Initializes and connects all components
 */
class App {
  constructor() {
    this.p5Instance = null;
    this.parameterPanel = null;
    this.renderer = null;
    this.isInitialized = false;
    this.isPaused = false;
    this.isLoadingSettings = false;
    this.videoReady = false;
  }

  /**
   * Initialize the application
   */
  async init() {
    // Initialize parameter panel
    this.parameterPanel = new ParameterPanel('parameter-panel');
    this.parameterPanel.registerParameters(PARAMETER_CONFIG);
    this.parameterPanel.render();

    // Load default settings override if present (assets/defaults.json)
    await this._loadDefaultSettings();

    // Initialize p5.js
    this._initP5();

    // Set up colour input (preset video loading + scrubbing)
    this._setupColourInput();

    // Sync fade target colour with invert toggle (skip if user set a custom target via defaults)
    stateManager.subscribe('invertColors', (inverted) => {
      if (!this._defaultsLoaded) {
        stateManager.set('colorFadeTarget', inverted ? '#363530' : '#C4C3BB');
      }
    });
    if (!this._defaultsLoaded) {
      stateManager.set('colorFadeTarget', stateManager.get('invertColors') ? '#363530' : '#C4C3BB');
    }

    this.isInitialized = true;
    console.log('Motion Graphics Tool initialized');
  }

  /**
   * Load defaults.json from assets/ folder if it exists.
   * Drop any exported settings JSON into assets/defaults.json to override hardcoded defaults.
   */
  async _loadDefaultSettings() {
    try {
      const resp = await fetch('../assets/defaults.json');
      if (!resp.ok) return; // no defaults file — use hardcoded defaults
      const settings = await resp.json();
      this.parameterPanel._applySettings(settings);
      this._defaultsLoaded = true;
      // Un-pause since this is initial load, not a user-triggered settings load
      this.isPaused = false;
      if (this.renderer) this.renderer.setPaused(false);
      console.log('Loaded default settings from assets/defaults.json');
    } catch (e) {
      // File doesn't exist or is invalid — silently use hardcoded defaults
    }
  }

  /**
   * Load a preset colour video into the image sampler
   */
  _loadColourVideo(value) {
    if (!imageSampler) return;
    const videoPath = `assets/${value}.mp4`;

    // Fetch the entire video into memory as a blob so the browser can
    // seek to any position without needing HTTP range requests.
    fetch(videoPath)
      .then(res => res.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        return imageSampler.loadMedia(blobUrl, 'video/mp4').then(() => {
          // Always keep the video paused — scrub with Colour Position slider
          imageSampler.pause();
          // Seek to current colour position and wait for frame decode
          const pos = stateManager.get('colourPosition') || 0;
          const elt = imageSampler.video.elt;
          const dur = elt.duration;
          const targetTime = dur * Math.min(1, Math.max(0, pos));
          elt.currentTime = targetTime;
          const onFirstFrame = () => {
            elt.removeEventListener('seeked', onFirstFrame);
            // Force pixel buffer update so first render has colour data
            imageSampler.updateVideoBuffer();
            imageSampler.invalidateCache();
            stateManager.set('imageSamplerEnabled', true);
            this.videoReady = true;
          };
          elt.addEventListener('seeked', onFirstFrame);
        });
      })
      .catch(err => console.error('Failed to load colour video:', err));
  }

  /**
   * Set up colour input: preset video loading and position scrubbing
   */
  _setupColourInput() {
    // Listen for colour source dropdown changes
    stateManager.subscribe('colourSource', (value) => {
      this._loadColourVideo(value);
    });

    // Listen for colour position slider changes (scrub through video frames)
    stateManager.subscribe('colourPosition', (value) => {
      if (imageSampler && imageSampler.hasVideo()) {
        imageSampler.seekPercent(value);
      }
    });

    // Scale Variation: drives brightness scale min down and max up from 100
    stateManager.subscribe('scaleVariation', (value) => {
      // Skip during settings load — the JSON contains the correct min/max values
      if (this.isLoadingSettings) return;
      // At 0: min=200, max=200 (no variation). At 200: min=0, max=400.
      stateManager.set('imageBrightnessScaleMin', 200 - value);
      stateManager.set('imageBrightnessScaleMax', 200 + value);
    });
  }

  /**
   * Set up proportional spacing lock.
   * When enabled, changing shape width/height auto-adjusts spacing to maintain the ratio.
   */
  // _setupSpacingLock removed — spacing is derived from grid density

  _initP5() {
    const self = this;

    const sketch = (p) => {
      p.setup = function() {
        const canvasContainer = document.getElementById('canvas-container');
        const canvas = p.createCanvas(
          canvasContainer.offsetWidth,
          canvasContainer.offsetHeight
        );
        canvas.parent('canvas-container');
        // Hint that we'll read pixels frequently (suppresses console warning)
        p.drawingContext.canvas.getContext('2d', { willReadFrequently: true });
        p.rectMode(p.CORNER);

        // Initialize renderer, image sampler, and palette processor
        self.renderer = new AnimatedGridRenderer(p);
        imageSampler = new ImageSampler(p);
        paletteProcessor = new PaletteProcessor();
        paletteProcessor.bindToStateManager();

        // Set up mouse enter/leave events on canvas element
        canvas.mouseOver(() => cursorTracker.setActive(true));
        canvas.mouseOut(() => cursorTracker.setActive(false));

        // Store p5 instance
        self.p5Instance = p;

        // Load the default colour video now that imageSampler exists
        const defaultColour = stateManager.get('colourSource');
        if (defaultColour) {
          self._loadColourVideo(defaultColour);
        }
      };

      p.keyPressed = function() {
        // Spacebar toggles pause
        if (p.keyCode === 32) {
          self.isPaused = !self.isPaused;
          // Sync pause state with renderer so it doesn't modify state during render
          if (self.renderer) {
            self.renderer.setPaused(self.isPaused);
          }
          // Freeze/unfreeze cursor tracker (preserves velocity for parameter tweaking)
          if (self.isPaused) {
            cursorTracker.freeze();
          } else {
            cursorTracker.unfreeze();
            // Reset manual scale adjustments when unpausing
            if (self.renderer) {
              self.renderer.resetManualScaleOffsets();
            }
          }
          // Videos stay paused — scrubbed via Colour Position slider
          return false; // Prevent default scrolling
        }
      };

      p.draw = function() {
        // Wait for the colour video to load before rendering anything
        if (!self.videoReady) return;

        // Only update dynamics when not paused
        if (!self.isPaused) {
          // Update cursor tracker
          const deltaTime = p.deltaTime / 1000;
          cursorTracker.update(p.mouseX, p.mouseY, deltaTime);

          // Also check bounds as fallback for cursor active state
          const isInCanvas = p.mouseX >= 0 && p.mouseX <= p.width &&
                            p.mouseY >= 0 && p.mouseY <= p.height;
          if (isInCanvas && !cursorTracker.isActive) {
            cursorTracker.setActive(true);
          }

        }

        // Background: white by default, dark when inverted
        const inverted = stateManager.get('invertColors') || false;
        p.background(inverted ? '#0E0E0C' : '#FFFEF7');

        // Update (when not paused) and render grid
        if (self.renderer) {
          if (!self.isPaused) {
            self.renderer.update();
          }
          self.renderer.render();
        }

        // Handle manual scale adjustment when paused with mouse held
        if (self.isPaused && p.mouseIsPressed && p.mouseButton === p.LEFT && self.renderer) {
          const isInCanvas = p.mouseX >= 0 && p.mouseX <= p.width &&
                            p.mouseY >= 0 && p.mouseY <= p.height;
          if (isInCanvas) {
            const deltaTime = p.deltaTime / 1000;
            const isGrow = !p.keyIsDown(p.SHIFT); // Shift = shrink, no shift = grow
            self.renderer.applyManualScale(p.mouseX, p.mouseY, isGrow, deltaTime);
          }
        }

        // Show pause indicator
        if (self.isPaused) {
          p.push();
          p.fill(255, 255, 255, 180);
          p.noStroke();
          p.textSize(14);
          p.textAlign(p.LEFT, p.TOP);
          p.text('PAUSED (space=resume, click=grow, shift+click=shrink)', 10, 10);
          p.pop();
        }
      };

      p.windowResized = function() {
        const canvasContainer = document.getElementById('canvas-container');
        p.resizeCanvas(
          canvasContainer.offsetWidth,
          canvasContainer.offsetHeight
        );
      };
    };

    new p5(sketch);
  }

  /**
   * Get the current state
   */
  getState() {
    return stateManager.getAll();
  }

  /**
   * Export current configuration as JSON
   */
  exportConfig() {
    return JSON.stringify(stateManager.getAll(), null, 2);
  }

  /**
   * Import configuration from JSON
   */
  importConfig(jsonString) {
    try {
      const config = JSON.parse(jsonString);
      Object.entries(config).forEach(([key, value]) => {
        this.parameterPanel.updateParameter(key, value);
      });
      return true;
    } catch (e) {
      console.error('Failed to import config:', e);
      return false;
    }
  }

  /**
   * Get the renderer instance
   */
  getRenderer() {
    return this.renderer;
  }

  /**
   * Get cursor tracker for external access
   */
  getCursorTracker() {
    return cursorTracker;
  }
}

// Global app instance
let app;
