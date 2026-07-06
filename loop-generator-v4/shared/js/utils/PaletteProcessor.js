/**
 * PaletteProcessor - Applies the SVG palette tool's color processing pipeline
 * to shapes in the motion graphics renderer.
 *
 * Loaded from JSON settings exported by the SVG palette tool (palette-only.html).
 * When colorMode is on and settings are loaded, processes each shape through:
 *   Mode (Noise/Heatmap) → Interference → Hue Remap → Color Fade → Color Grade
 */
class PaletteProcessor {
  constructor() {
    this.settings = null;
    this._curveLUTs = { master: null, red: null, green: null, blue: null };
    this._curvePoints = {
      master: [{x:0,y:0}, {x:0.33476394849785407,y:0.0021459227467811592}, {x:0.7167381974248928,y:0.9549356223175965}, {x:1,y:1}],
      red:    [{x:0,y:0}, {x:1,y:1}],
      green:  [{x:0,y:0}, {x:0.7811158798283262,y:0.7553648068669527}, {x:1,y:1}],
      blue:   [{x:0,y:0}, {x:1,y:1}]
    };
    this._heatmapColorOrder = [0, 1, 2];
    this._customGradientStops = [
      {pos: 0,      color: '#707070'},
      {pos: 0.1622, color: '#616161'},
      {pos: 0.2448, color: '#559190'},
      {pos: 0.3274, color: '#6ecc61'},
      {pos: 0.3776, color: '#dc79a1'},
      {pos: 0.5959, color: '#555791'},
      {pos: 0.7493, color: '#6feca2'},
      {pos: 0.8496, color: '#aed580'},
      {pos: 1,      color: '#ffcc00'}
    ];

    // Dirty flag for syncFromState — avoid full re-sync every frame
    this._dirty = true;

    // Noise texture cache — avoids per-shape FBM computation each frame
    this._noiseTextureCache = null;
    this._noiseTextureCols = 0;
    this._noiseTextureRows = 0;
    this._noiseTextureDirty = true;
    this._paletteKeys = [
      'gradientMapEnabled', 'gradientInterp', 'gradientSamples', 'activeMode',
      'noiseScale', 'noiseOctaves', 'noisePersist', 'noiseLac',
      'noiseSeedX', 'noiseSeedY', 'noiseLightFreq',
      'heatmapInterp', 'heatmapInvert',
      'origInterferenceEnabled', 'hmOrigDriver', 'hmOutputDriver', 'hmOrigMix',
      'hmOrigAmount', 'hmOrigQuant',
      'hueRemapEnabled', 'hueRemapStart', 'hueRemapEnd',
      'hueRemapStrength', 'hueRemapSatOffset', 'hueRemapLightOffset', 'hueRemapFalloff',
      'hueRemap2Enabled', 'hueRemap2Start', 'hueRemap2End',
      'hueRemap2Strength', 'hueRemap2Target', 'hueRemap2SatOffset', 'hueRemap2LightOffset', 'hueRemap2Falloff',
      'hueGradMapEnabled', 'hueGradMapStrength', 'hueGradMapPreserveLight', 'hueGradMapPhase',
      'colorFadeEnabled', 'colorFadeDriver', 'colorFadeTarget',
      'cfFadeStart', 'cfFadeEnd', 'cfStrength', 'cfBlendMode', 'cfHueOffset',
      'colorFade2Enabled', 'colorFade2Driver', 'colorFade2Target',
      'cf2FadeStart', 'cf2FadeEnd', 'cf2Strength', 'cf2BlendMode', 'cf2HueOffset',
      'colorFade3Enabled', 'colorFade3Driver', 'colorFade3Target',
      'cf3FadeStart', 'cf3FadeEnd', 'cf3Strength', 'cf3BlendMode', 'cf3HueOffset',
      'colorFade4Enabled', 'colorFade4Driver', 'colorFade4Target',
      'cf4FadeStart', 'cf4FadeEnd', 'cf4Strength', 'cf4BlendMode', 'cf4HueOffset',
      'colorSpace',
      'colorGradeEnabled', 'gradeBlend',
      'gradeTemp', 'gradeTint', 'gradeSat', 'gradeExp',
      'gradeContrast', 'gradeHigh', 'gradeShadow',
      'imgAdjVibrancy', 'imgAdjBrightness', 'imgAdjContrast',
      'hueExcludeEnabled', 'hueExcludeStart', 'hueExcludeEnd',
      'hueLayerEnabled', 'hueLayerOffset', 'hueLayerBlend', 'hueLayerOpacity',
      'hueConvergenceStrength'
    ];

    // Opt A: Pre-sorted, pre-parsed gradient stops (built in syncFromState)
    this._sortedStopsRGB = null;
    this._heatmapColorsRGB = null;

    // Opt B: Cached numeric settings (built in syncFromState)
    this._numNoiseScale = 4;
    this._numNoiseOctaves = 4;
    this._numNoisePersist = 0.5;
    this._numNoiseLac = 2;
    this._numNoiseSeedX = 0;
    this._numNoiseSeedY = 0;
    this._numNoiseLightFreq = 1.7;
    this._numHmOrigAmount = 0;
    this._numHmOrigQuant = 0;
    this._numHueRemapStrength = 0;
    this._numHueRemapStart = 25;
    this._numHueRemapEnd = 70;
    this._numHueRemapSatOffset = 0;
    this._numHueRemapLightOffset = 0;
    this._numHueRemapFalloff = 15;
    this._numHueRemap2Strength = 0;
    this._numHueRemap2Start = 10;
    this._numHueRemap2End = 40;
    this._numHueRemap2Target = 340;
    this._numHueRemap2SatOffset = 0;
    this._numHueRemap2LightOffset = 0;
    this._numHueRemap2Falloff = 15;
    this._numCfFadeStart = 0;
    this._numCfFadeEnd = 0.5;
    this._numCfStrength = 1;
    this._cfTargetR = 26;
    this._cfTargetG = 26;
    this._cfTargetB = 26;
    this._numCf2FadeStart = 0;
    this._numCf2FadeEnd = 0.3;
    this._numCf2Strength = 0;
    this._cf2TargetR = 26;
    this._cf2TargetG = 26;
    this._cf2TargetB = 26;
    this._numCf3FadeStart = 0;
    this._numCf3FadeEnd = 0.3;
    this._numCf3Strength = 0;
    this._cf3TargetR = 26;
    this._cf3TargetG = 26;
    this._cf3TargetB = 26;
    this._numCf4FadeStart = 0;
    this._numCf4FadeEnd = 0.3;
    this._numCf4Strength = 0;
    this._cf4TargetR = 26;
    this._cf4TargetG = 26;
    this._cf4TargetB = 26;
    this._numGradeTemp = 0;
    this._numGradeTint = 0;
    this._numGradeSat = 1;
    this._numGradeExp = 0;
    this._numGradeContrast = 0;
    this._numGradeHigh = 0;
    this._numGradeShadow = 0;
    this._numGradientSamples = 7;
    this._numImgAdjVibrancy = 0;
    this._numImgAdjBrightness = 0;
    this._numImgAdjContrast = 0;
    this._numHueExcludeStart = 15;
    this._numHueExcludeEnd = 65;
    this._numHueLayerOffset = 0;
    this._numHueLayerOpacity = 0;
    this._numHueGradMapStrength = 1;
    this._numHueGradMapPhase = 0;

    // Hue Gradient Map — brand palette stops evenly across the hue wheel
    this._hueGradMapStops = [
      { pos: 0,     color: '#64737e' },  // Gray
      { pos: 1/6,   color: '#48bec5' },  // Teal
      { pos: 2/6,   color: '#52c584' },  // Green
      { pos: 3/6,   color: '#9bad3b' },  // Olive
      { pos: 4/6,   color: '#fd817c' },  // Coral
      { pos: 5/6,   color: '#e35b6c' },  // Candy
      { pos: 1,     color: '#a06279' }   // Mauve
    ];
    this._hueGradMapStopsRGB = null;

    // Cached color-space dispatch (swapped in syncFromState)
    this._toPerceptual = PaletteProcessor.rgbToHsl;
    this._fromPerceptual = PaletteProcessor.hslToRgb;

    // Opt C: Reusable color result objects (avoid GC pressure)
    this._gradientResult = { r: 0, g: 0, b: 0 };
    this._heatmapResult = { r: 0, g: 0, b: 0 };
    this._hueRemapResult = { r: 0, g: 0, b: 0 };
    this._hueRemap2Result = { r: 0, g: 0, b: 0 };
    this._colorFadeResult = { r: 0, g: 0, b: 0 };
    this._colorFade2Result = { r: 0, g: 0, b: 0 };
    this._colorFade3Result = { r: 0, g: 0, b: 0 };
    this._colorFade4Result = { r: 0, g: 0, b: 0 };
    this._gradeResult = { r: 0, g: 0, b: 0 };
    this._imgAdjResult = { r: 0, g: 0, b: 0 };
    this._hueExcludeResult = { r: 0, g: 0, b: 0 };
    this._hueLayerResult = { r: 0, g: 0, b: 0 };
    this._hueGradMapResult = { r: 0, g: 0, b: 0 };
    this._hueConvergenceResult = { r: 0, g: 0, b: 0 };
    this._outputResult = { r: 0, g: 0, b: 0 };

    // Hue convergence state — double-buffered histogram
    this._dominantHue = 0;
    this._hueHistBuilding = new Float32Array(12);  // current frame accumulator
    this._hueHistActive = new Float32Array(12);    // previous frame (read-only)
    this._hasHistogram = false;
  }

  /**
   * Subscribe to palette-related state changes to set dirty flag.
   * Call after stateManager is available.
   */
  bindToStateManager() {
    for (const key of this._paletteKeys) {
      stateManager.subscribe(key, () => { this._dirty = true; });
    }
  }

  // ════════════════════════════════════════
  // Settings management
  // ════════════════════════════════════════

  /**
   * Load settings from a palette tool JSON export.
   * Overrides gradient stops, heatmap order, and curve points (complex data not in UI sliders).
   * Simple slider/toggle/select values are written to stateManager so the UI updates too.
   */
  loadSettings(settingsJson) {
    // Write simple values into stateManager so UI sliders update
    const stateKeys = [
      'gradientMapEnabled', 'gradientInterp', 'gradientSamples', 'activeMode',
      'noiseScale', 'noiseOctaves', 'noisePersist', 'noiseLac',
      'noiseSeedX', 'noiseSeedY', 'noiseLightFreq',
      'heatmapInterp', 'heatmapInvert',
      'origInterferenceEnabled', 'hmOrigDriver', 'hmOutputDriver', 'hmOrigMix',
      'hmOrigAmount', 'hmOrigQuant',
      'hueRemapEnabled', 'hueRemapStart', 'hueRemapEnd',
      'hueRemapStrength', 'hueRemapSatOffset', 'hueRemapLightOffset', 'hueRemapFalloff',
      'hueRemap2Enabled', 'hueRemap2Start', 'hueRemap2End',
      'hueRemap2Strength', 'hueRemap2Target', 'hueRemap2SatOffset', 'hueRemap2LightOffset', 'hueRemap2Falloff',
      'hueGradMapEnabled', 'hueGradMapStrength', 'hueGradMapPreserveLight', 'hueGradMapPhase',
      'colorFadeEnabled', 'colorFadeDriver', 'colorFadeTarget',
      'cfFadeStart', 'cfFadeEnd', 'cfStrength', 'cfBlendMode', 'cfHueOffset',
      'colorFade2Enabled', 'colorFade2Driver', 'colorFade2Target',
      'cf2FadeStart', 'cf2FadeEnd', 'cf2Strength', 'cf2BlendMode', 'cf2HueOffset',
      'colorFade3Enabled', 'colorFade3Driver', 'colorFade3Target',
      'cf3FadeStart', 'cf3FadeEnd', 'cf3Strength', 'cf3BlendMode', 'cf3HueOffset',
      'colorFade4Enabled', 'colorFade4Driver', 'colorFade4Target',
      'cf4FadeStart', 'cf4FadeEnd', 'cf4Strength', 'cf4BlendMode', 'cf4HueOffset',
      'colorSpace',
      'colorGradeEnabled', 'gradeBlend',
      'gradeTemp', 'gradeTint', 'gradeSat', 'gradeExp',
      'gradeContrast', 'gradeHigh', 'gradeShadow',
      'imgAdjVibrancy', 'imgAdjBrightness', 'imgAdjContrast',
      'hueExcludeEnabled', 'hueExcludeStart', 'hueExcludeEnd',
      'hueLayerEnabled', 'hueLayerOffset', 'hueLayerBlend', 'hueLayerOpacity'
    ];

    for (const key of stateKeys) {
      if (settingsJson[key] !== undefined) {
        const val = settingsJson[key];
        stateManager.set(key, typeof val === 'string' ? val : val);
        // Update the DOM element too
        const el = document.getElementById(key);
        if (el) {
          if (el.type === 'checkbox') {
            el.checked = !!val;
          } else {
            el.value = val;
          }
          const container = el.closest('.parameter');
          const display = container?.querySelector('.parameter__value');
          if (display) display.textContent = val;
        }
      }
    }

    // Restore complex data that isn't in UI sliders
    if (settingsJson.customGradientStops && Array.isArray(settingsJson.customGradientStops)) {
      this._customGradientStops = settingsJson.customGradientStops;
    }

    if (settingsJson.heatmapColorOrder && Array.isArray(settingsJson.heatmapColorOrder)) {
      this._heatmapColorOrder = settingsJson.heatmapColorOrder;
    }

    // Load curve points
    const defaultCurve = [{x:0,y:0}, {x:1,y:1}];
    if (settingsJson.curvePoints) {
      for (const ch of ['master', 'red', 'green', 'blue']) {
        this._curvePoints[ch] = settingsJson.curvePoints[ch] || defaultCurve;
        this._curveLUTs[ch] = this._buildCurveLUT(this._curvePoints[ch]);
      }
    }

    this._dirty = true;
    console.log('Palette settings loaded from JSON:', settingsJson.activeMode || 'mode1');
  }

  /**
   * Sync settings from stateManager (called once per frame before processing).
   * Reads all palette parameters from the UI state.
   */
  syncFromState() {
    if (!this._dirty && this.settings) return;
    this._dirty = false;
    this._noiseTextureDirty = true;

    const s = stateManager.getRef();
    this.settings = s;

    // Ensure heatmap order matches current gradient samples count
    const expectedN = parseInt(s.gradientSamples) || 7;
    if (this._heatmapColorOrder.length !== expectedN) {
      this._heatmapColorOrder = Array.from({length: expectedN}, (_, i) => i);
    }

    // Ensure curve LUTs exist (built from _curvePoints which editors may have modified)
    if (!this._curveLUTs.master) {
      for (const ch of ['master', 'red', 'green', 'blue']) {
        this._curveLUTs[ch] = this._buildCurveLUT(this._curvePoints[ch]);
      }
    }

    // Switch color-space dispatch pointers
    if (s.colorSpace === 'oklch') {
      this._toPerceptual = PaletteProcessor.rgbToOklch;
      this._fromPerceptual = PaletteProcessor.oklchToRgb;
    } else {
      this._toPerceptual = PaletteProcessor.rgbToHsl;
      this._fromPerceptual = PaletteProcessor.hslToRgb;
    }

    // Opt A: Pre-sort and pre-parse gradient stops
    const sortedStops = [...this._customGradientStops].sort((a, b) => a.pos - b.pos);
    this._sortedStopsRGB = sortedStops.map(stop => {
      const rgb = PaletteProcessor.hexToRgb(stop.color);
      return { pos: stop.pos, r: rgb.r, g: rgb.g, b: rgb.b, color: stop.color };
    });

    // Opt B: Cache all numeric settings
    this._numNoiseScale = parseFloat(s.noiseScale) || 4;
    this._numNoiseOctaves = parseInt(s.noiseOctaves) || 4;
    this._numNoisePersist = (parseFloat(s.noisePersist) || 50) / 100;
    this._numNoiseLac = parseFloat(s.noiseLac) || 2;
    this._numNoiseSeedX = parseFloat(s.noiseSeedX) || 0;
    this._numNoiseSeedY = parseFloat(s.noiseSeedY) || 0;
    this._numNoiseLightFreq = parseFloat(s.noiseLightFreq) || 1.7;
    this._numHmOrigAmount = (parseFloat(s.hmOrigAmount) || 0) / 100;
    this._numHmOrigQuant = parseInt(s.hmOrigQuant) || 0;
    this._numHueRemapStrength = (parseFloat(s.hueRemapStrength) || 0) / 100;
    this._numHueRemapStart = parseFloat(s.hueRemapStart) || 25;
    this._numHueRemapEnd = parseFloat(s.hueRemapEnd) || 70;
    this._numHueRemapSatOffset = parseFloat(s.hueRemapSatOffset) || 0;
    this._numHueRemapLightOffset = parseFloat(s.hueRemapLightOffset) || 0;
    this._numHueRemapFalloff = parseFloat(s.hueRemapFalloff) ?? 15;
    this._numHueRemap2Strength = (parseFloat(s.hueRemap2Strength) || 0) / 100;
    this._numHueRemap2Start = parseFloat(s.hueRemap2Start) || 10;
    this._numHueRemap2End = parseFloat(s.hueRemap2End) || 40;
    this._numHueRemap2Target = parseFloat(s.hueRemap2Target) || 340;
    this._numHueRemap2SatOffset = parseFloat(s.hueRemap2SatOffset) || 0;
    this._numHueRemap2LightOffset = parseFloat(s.hueRemap2LightOffset) || 0;
    this._numHueRemap2Falloff = parseFloat(s.hueRemap2Falloff) ?? 15;
    this._numCfFadeStart = (parseFloat(s.cfFadeStart) || 0) / 100;
    this._numCfFadeEnd = (parseFloat(s.cfFadeEnd) || 50) / 100;
    this._numCfStrength = (parseFloat(s.cfStrength) || 100) / 100;
    const cfTarget = PaletteProcessor.hexToRgb(s.colorFadeTarget || '#1a1a1a');
    this._cfTargetR = cfTarget.r;
    this._cfTargetG = cfTarget.g;
    this._cfTargetB = cfTarget.b;
    this._numCf2FadeStart = (parseFloat(s.cf2FadeStart) || 0) / 100;
    this._numCf2FadeEnd = (parseFloat(s.cf2FadeEnd) || 30) / 100;
    this._numCf2Strength = (parseFloat(s.cf2Strength) || 0) / 100;
    const cf2Target = PaletteProcessor.hexToRgb(s.colorFade2Target || '#1a1a1a');
    this._cf2TargetR = cf2Target.r;
    this._cf2TargetG = cf2Target.g;
    this._cf2TargetB = cf2Target.b;
    this._numCf3FadeStart = (parseFloat(s.cf3FadeStart) || 0) / 100;
    this._numCf3FadeEnd = (parseFloat(s.cf3FadeEnd) || 30) / 100;
    this._numCf3Strength = (parseFloat(s.cf3Strength) || 0) / 100;
    const cf3Target = PaletteProcessor.hexToRgb(s.colorFade3Target || '#1a1a1a');
    this._cf3TargetR = cf3Target.r;
    this._cf3TargetG = cf3Target.g;
    this._cf3TargetB = cf3Target.b;
    this._numCf4FadeStart = (parseFloat(s.cf4FadeStart) || 0) / 100;
    this._numCf4FadeEnd = (parseFloat(s.cf4FadeEnd) || 30) / 100;
    this._numCf4Strength = (parseFloat(s.cf4Strength) || 0) / 100;
    const cf4Target = PaletteProcessor.hexToRgb(s.colorFade4Target || '#1a1a1a');
    this._cf4TargetR = cf4Target.r;
    this._cf4TargetG = cf4Target.g;
    this._cf4TargetB = cf4Target.b;
    this._numGradeTemp = parseFloat(s.gradeTemp) || 0;
    this._numGradeTint = parseFloat(s.gradeTint) || 0;
    this._numGradeSat = (parseFloat(s.gradeSat) || 100) / 100;
    this._numGradeExp = (parseFloat(s.gradeExp) || 0) / 100;
    this._numGradeContrast = parseFloat(s.gradeContrast) || 0;
    this._numGradeHigh = parseFloat(s.gradeHigh) || 0;
    this._numGradeShadow = parseFloat(s.gradeShadow) || 0;
    this._numGradientSamples = parseInt(s.gradientSamples) || 7;
    this._numImgAdjVibrancy = (parseFloat(s.imgAdjVibrancy) || 0) / 100;
    this._numImgAdjBrightness = parseFloat(s.imgAdjBrightness) || 0;
    this._numImgAdjContrast = parseFloat(s.imgAdjContrast) || 0;
    this._numHueExcludeStart = parseFloat(s.hueExcludeStart) ?? 15;
    this._numHueExcludeEnd = parseFloat(s.hueExcludeEnd) ?? 65;
    this._numHueLayerOffset = parseFloat(s.hueLayerOffset) || 0;
    this._numHueLayerOpacity = (parseFloat(s.hueLayerOpacity) || 0) / 100;
    this._numHueGradMapStrength = (parseFloat(s.hueGradMapStrength) || 100) / 100;
    this._numHueGradMapPhase = (parseFloat(s.hueGradMapPhase) || 0) / 360;
    this._numHueConvergenceStrength = (parseFloat(s.hueConvergenceStrength) || 0) / 100;

    // Opt A: Pre-compute heatmap colors as RGB
    this._heatmapColorsRGB = [];
    for (let i = 0; i < this._heatmapColorOrder.length; i++) {
      const idx = this._heatmapColorOrder[i];
      const t = this._numGradientSamples > 1 ? idx / (this._numGradientSamples - 1) : 0;
      const rgb = this._sampleCustomGradientRGB(t);
      this._heatmapColorsRGB.push({ r: rgb.r, g: rgb.g, b: rgb.b });
    }

    // Pre-compute hue gradient map stops as sorted RGB
    const P = PaletteProcessor;
    this._hueGradMapStopsRGB = [...this._hueGradMapStops]
      .sort((a, b) => a.pos - b.pos)
      .map(s => {
        const rgb = P.hexToRgb(s.color);
        return { pos: s.pos, r: rgb.r, g: rgb.g, b: rgb.b };
      });
  }

  hasSettings() {
    return this.settings !== null;
  }

  clearSettings() {
    this.settings = null;
  }

  /**
   * Detect whether a JSON object is a palette tool settings file
   */
  static isPaletteJSON(json) {
    if (!json) return false;
    // A palette-only JSON has palette keys but NOT motion-settings keys like gridDensity/ringRadius
    const hasPaletteKeys = json.activeMode !== undefined || json.noiseScale !== undefined || json.curvePoints !== undefined;
    const hasMotionKeys = json.gridDensity !== undefined || json.ringRadius !== undefined || json.scaleMax !== undefined;
    return hasPaletteKeys && !hasMotionKeys;
  }

  // ════════════════════════════════════════
  // Main processing entry point
  // ════════════════════════════════════════

  /**
   * Process a shape's color through the full palette pipeline.
   * Noise/heatmap always generates the base color from the custom gradient.
   * origColor (from image sampler or base fill) feeds into interference.
   *
   * @param {number} normX - Normalized X position (0-1)
   * @param {number} normY - Normalized Y position (0-1)
   * @param {number} normSize - Normalized size (0=smallest, 1=largest)
   * @param {string} origColor - Original hex color (from image sampler or base fill)
   * @returns {string} Processed hex color
   */
  processColor(normX, normY, normSize, origColor) {
    if (!this.settings) return origColor;

    const s = this.settings;
    let color;

    // 1. Base color from noise or heatmap (only when gradient map is enabled)
    if (s.gradientMapEnabled) {
      const mode = s.activeMode || 'mode1';
      if (mode === 'mode1') {
        color = this._sampleNoiseCPU(normX, normY);
      } else {
        color = this._sampleHeatmap(normSize);
      }
    } else {
      color = origColor || '#808080';
    }

    // 1.5. Hue Layer (AE-style duplicate + blend)
    if (s.hueLayerEnabled) {
      const P = PaletteProcessor;
      const rgb = P.hexToRgb(color);
      const layered = this._applyHueLayerRGB(rgb);
      color = P.rgbToHex(layered.r, layered.g, layered.b);
    }

    // 2. Original color interference (origColor = image sampler color or base fill)
    if (s.origInterferenceEnabled && origColor) {
      color = this._applyInterference(color, origColor);
    }

    // 2.5a. Yellow → Green remap
    if (s.hueRemapEnabled) {
      color = this._applyHueRemap(color);
    }

    // 2.5b. Orange → Red remap
    if (s.hueRemap2Enabled) {
      color = this._applyHueRemap2(color);
    }

    // 2.6. Hue Gradient Map
    if (s.hueGradMapEnabled) {
      const P = PaletteProcessor;
      const rgb = P.hexToRgb(color);
      const mapped = this._applyHueGradMapRGB(rgb);
      color = P.rgbToHex(mapped.r, mapped.g, mapped.b);
    }

    // 2.7. Hue Convergence
    if (this._numHueConvergenceStrength > 0) {
      const P = PaletteProcessor;
      const rgb = P.hexToRgb(color);
      const conv = this._applyHueConvergenceRGB(rgb);
      color = P.rgbToHex(conv.r, conv.g, conv.b);
    }

    // 3. Color grade
    if (s.colorGradeEnabled) {
      color = this._gradeColor(color);
    }

    // 4. Image Adjust
    if (this._numImgAdjVibrancy !== 0 || this._numImgAdjBrightness !== 0 || this._numImgAdjContrast !== 0) {
      const P = PaletteProcessor;
      const rgb = P.hexToRgb(color);
      const adj = this._applyImageAdjustRGB(rgb);
      color = P.rgbToHex(adj.r, adj.g, adj.b);
    }

    // 5. Color fade
    if (s.colorFadeEnabled) {
      color = this._applyColorFade(color);
    }

    // 5b. Color fade 2
    if (s.colorFade2Enabled) {
      color = this._applyColorFade2(color);
    }

    // 5c. Color fade 3
    if (s.colorFade3Enabled) {
      color = this._applyColorFade3(color);
    }

    // 5d. Color fade 4
    if (s.colorFade4Enabled) {
      color = this._applyColorFade4(color);
    }

    // 6. Hue Exclusion
    if (s.hueExcludeEnabled) {
      const P = PaletteProcessor;
      const rgb = P.hexToRgb(color);
      const exc = this._applyHueExcludeRGB(rgb);
      color = P.rgbToHex(exc.r, exc.g, exc.b);
    }

    return color;
  }

  // ════════════════════════════════════════
  // Color utilities
  // ════════════════════════════════════════

  static hexToRgb(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) }
             : { r: 128, g: 128, b: 128 };
  }

  static rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const h = Math.round(Math.max(0, Math.min(255, x))).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }

  static rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  static hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
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
    return { r: r * 255, g: g * 255, b: b * 255 };
  }

  static rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h, s = max === 0 ? 0 : d / max, v = max;
    if (d === 0) {
      h = 0;
    } else {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, v: v * 100 };
  }

  static hsvToRgb(h, s, v) {
    h /= 360; s /= 100; v /= 100;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    let r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p; break;
      case 1: r = q; g = v; b = p; break;
      case 2: r = p; g = v; b = t; break;
      case 3: r = p; g = q; b = v; break;
      case 4: r = t; g = p; b = v; break;
      case 5: r = v; g = p; b = q; break;
    }
    return { r: r * 255, g: g * 255, b: b * 255 };
  }

  static rgbToOklch(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    g = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
    b = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
    let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    l = Math.cbrt(l); m = Math.cbrt(m); s = Math.cbrt(s);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const C = Math.sqrt(A * A + B * B);
    let h = Math.atan2(B, A) * 180 / Math.PI;
    if (h < 0) h += 360;
    return { h: h, s: C / 0.4 * 100, l: L * 100 };
  }

  static oklchToRgb(h, s, l) {
    const L = l / 100;
    const C = s / 100 * 0.4;
    const hRad = h * Math.PI / 180;
    const A = C * Math.cos(hRad);
    const B = C * Math.sin(hRad);
    let ll = L + 0.3963377774 * A + 0.2158037573 * B;
    let m = L - 0.1055613458 * A - 0.0638541728 * B;
    let ss = L - 0.0894841775 * A - 1.2914855480 * B;
    ll = ll * ll * ll; m = m * m * m; ss = ss * ss * ss;
    let r = +4.0767416621 * ll - 3.3077115913 * m + 0.2309699292 * ss;
    let g = -1.2684380046 * ll + 2.6097574011 * m - 0.3413193965 * ss;
    let b = -0.0041960863 * ll - 0.7034186147 * m + 1.7076147010 * ss;
    r = r <= 0.0031308 ? 12.92 * r : 1.055 * Math.pow(r, 1 / 2.4) - 0.055;
    g = g <= 0.0031308 ? 12.92 * g : 1.055 * Math.pow(g, 1 / 2.4) - 0.055;
    b = b <= 0.0031308 ? 12.92 * b : 1.055 * Math.pow(b, 1 / 2.4) - 0.055;
    return {
      r: Math.max(0, Math.min(255, r * 255)),
      g: Math.max(0, Math.min(255, g * 255)),
      b: Math.max(0, Math.min(255, b * 255))
    };
  }

  static colorDriverValue(hex, driver) {
    const rgb = PaletteProcessor.hexToRgb(hex);
    const hsl = PaletteProcessor.rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (driver === 'hue') return hsl.h / 360;
    if (driver === 'saturation') return hsl.s / 100;
    return hsl.l / 100;
  }

  _toHSL(r, g, b) { return this._toPerceptual(r, g, b); }
  _fromHSL(h, s, l) { return this._fromPerceptual(h, s, l); }

  _colorDriverValue(hex, driver) {
    const rgb = PaletteProcessor.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);
    if (driver === 'hue') return hsl.h / 360;
    if (driver === 'saturation') return hsl.s / 100;
    return hsl.l / 100;
  }

  // ════════════════════════════════════════
  // Custom Gradient
  // ════════════════════════════════════════

  _sampleCustomGradient(t) {
    const P = PaletteProcessor;
    t = Math.max(0, Math.min(1, t));
    const stops = [...this._customGradientStops].sort((a, b) => a.pos - b.pos);
    if (stops.length === 0) return '#808080';
    if (stops.length === 1) return stops[0].color;
    if (t <= stops[0].pos) return stops[0].color;
    if (t >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;

    let lo = 0, hi = 1;
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].pos && t <= stops[i + 1].pos) {
        lo = i; hi = i + 1; break;
      }
    }

    const range = stops[hi].pos - stops[lo].pos;
    const frac = range > 0 ? (t - stops[lo].pos) / range : 0;
    const interp = (this.settings && this.settings.gradientInterp) || 'rgb';
    const a = P.hexToRgb(stops[lo].color);
    const b = P.hexToRgb(stops[hi].color);

    if (interp === 'rgb') {
      return P.rgbToHex(
        a.r + (b.r - a.r) * frac,
        a.g + (b.g - a.g) * frac,
        a.b + (b.b - a.b) * frac
      );
    }

    let aH, aS, aV, bH, bS, bV;
    if (interp.startsWith('hsv')) {
      const av = P.rgbToHsv(a.r, a.g, a.b);
      const bv = P.rgbToHsv(b.r, b.g, b.b);
      aH = av.h; aS = av.s; aV = av.v;
      bH = bv.h; bS = bv.s; bV = bv.v;
    } else {
      const al = P.rgbToHsl(a.r, a.g, a.b);
      const bl = P.rgbToHsl(b.r, b.g, b.b);
      aH = al.h; aS = al.s; aV = al.l;
      bH = bl.h; bS = bl.s; bV = bl.l;
    }

    let dH = bH - aH;
    const isNear = interp.endsWith('near');
    if (isNear) {
      if (dH > 180) dH -= 360;
      if (dH < -180) dH += 360;
    } else {
      if (dH >= 0 && dH < 180) dH -= 360;
      if (dH < 0 && dH > -180) dH += 360;
    }

    let h = (aH + dH * frac) % 360;
    if (h < 0) h += 360;
    const s = aS + (bS - aS) * frac;
    const v = aV + (bV - aV) * frac;

    let rgb;
    if (interp.startsWith('hsv')) {
      rgb = P.hsvToRgb(h, s, v);
    } else {
      rgb = P.hslToRgb(h, s, v);
    }
    return P.rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  _sampleColorSource(t) {
    return this._sampleCustomGradient(t);
  }

  // ════════════════════════════════════════
  // Heatmap
  // ════════════════════════════════════════

  _getHeatmapColors() {
    const n = parseInt(this.settings.gradientSamples) || 7;
    return this._heatmapColorOrder.map(i => this._sampleCustomGradient(n > 1 ? i / (n - 1) : 0));
  }

  _sampleHeatmap(t) {
    const P = PaletteProcessor;
    const colors = this._getHeatmapColors();
    const interp = (this.settings && this.settings.heatmapInterp) || 'smooth';
    const invert = this.settings && this.settings.heatmapInvert;
    if (invert) t = 1 - t;

    t = Math.max(0, Math.min(1, t));
    const n = colors.length;
    if (n === 0) return '#808080';
    if (n === 1) return colors[0];
    const scaled = t * (n - 1);

    if (interp === 'step') {
      return colors[Math.min(Math.round(scaled), n - 1)];
    }

    const lo = Math.floor(scaled);
    const hi = Math.min(lo + 1, n - 1);
    const frac = scaled - lo;
    const a = P.hexToRgb(colors[lo]);
    const b = P.hexToRgb(colors[hi]);
    return P.rgbToHex(
      a.r + (b.r - a.r) * frac,
      a.g + (b.g - a.g) * frac,
      a.b + (b.b - a.b) * frac
    );
  }

  // ════════════════════════════════════════
  // Simplex Noise (CPU port of GLSL shader)
  // Ashima Arts simplex 2D noise, same as the WebGL version
  // ════════════════════════════════════════

  static _mod289(x) { return x - Math.floor(x * (1.0 / 289.0)) * 289.0; }

  static _permute(x) { return PaletteProcessor._mod289(((x * 34.0) + 1.0) * x); }

  static _snoise(vx, vy) {
    const C_x = 0.211324865405187;   // (3-sqrt(3))/6
    const C_y = 0.366025403784439;   // 0.5*(sqrt(3)-1)
    const C_z = -0.577350269189626;  // -1+2*C.x
    const C_w = 0.024390243902439;   // 1/41

    const ix = Math.floor(vx + (vx + vy) * C_y);
    const iy = Math.floor(vy + (vx + vy) * C_y);

    const x0x = vx - ix + (ix + iy) * C_x;
    const x0y = vy - iy + (ix + iy) * C_x;

    const i1x = x0x > x0y ? 1.0 : 0.0;
    const i1y = 1.0 - i1x;

    const x12x = x0x + C_x - i1x;
    const x12y = x0y + C_x - i1y;
    const x12z = x0x + C_z;
    const x12w = x0y + C_z;

    const mix = PaletteProcessor._mod289(ix);
    const miy = PaletteProcessor._mod289(iy);

    const p0 = PaletteProcessor._permute(PaletteProcessor._permute(miy) + mix);
    const p1 = PaletteProcessor._permute(PaletteProcessor._permute(miy + i1y) + mix + i1x);
    const p2 = PaletteProcessor._permute(PaletteProcessor._permute(miy + 1.0) + mix + 1.0);

    let m0 = Math.max(0, 0.5 - (x0x * x0x + x0y * x0y));
    let m1 = Math.max(0, 0.5 - (x12x * x12x + x12y * x12y));
    let m2 = Math.max(0, 0.5 - (x12z * x12z + x12w * x12w));

    m0 = m0 * m0; m0 = m0 * m0;
    m1 = m1 * m1; m1 = m1 * m1;
    m2 = m2 * m2; m2 = m2 * m2;

    const x0_ = 2.0 * ((p0 * C_w) - Math.floor(p0 * C_w)) - 1.0;
    const x1_ = 2.0 * ((p1 * C_w) - Math.floor(p1 * C_w)) - 1.0;
    const x2_ = 2.0 * ((p2 * C_w) - Math.floor(p2 * C_w)) - 1.0;

    const h0 = Math.abs(x0_) - 0.5;
    const h1 = Math.abs(x1_) - 0.5;
    const h2 = Math.abs(x2_) - 0.5;

    const ox0 = Math.floor(x0_ + 0.5);
    const ox1 = Math.floor(x1_ + 0.5);
    const ox2 = Math.floor(x2_ + 0.5);

    const a00 = x0_ - ox0;
    const a01 = x1_ - ox1;
    const a02 = x2_ - ox2;

    m0 *= 1.79284291400159 - 0.85373472095314 * (a00 * a00 + h0 * h0);
    m1 *= 1.79284291400159 - 0.85373472095314 * (a01 * a01 + h1 * h1);
    m2 *= 1.79284291400159 - 0.85373472095314 * (a02 * a02 + h2 * h2);

    const g0 = a00 * x0x + h0 * x0y;
    const g1 = a01 * x12x + h1 * x12y;
    const g2 = a02 * x12z + h2 * x12w;

    return 130.0 * (m0 * g0 + m1 * g1 + m2 * g2);
  }

  static _fbm(px, py, octaves, persistence, lacunarity) {
    let value = 0, amp = 1, maxAmp = 0, freq = 1;
    for (let i = 0; i < octaves; i++) {
      value += amp * PaletteProcessor._snoise(px * freq, py * freq);
      maxAmp += amp;
      freq *= lacunarity;
      amp *= persistence;
    }
    return value / maxAmp;
  }

  /**
   * Sample noise color at normalized (0-1) coordinates.
   * CPU implementation matching the WebGL noise shader.
   */
  _sampleNoiseCPU(normX, normY) {
    const s = this.settings;
    const scale = parseFloat(s.noiseScale) || 4;
    const octaves = parseInt(s.noiseOctaves) || 4;
    const persistence = (parseFloat(s.noisePersist) || 50) / 100;
    const lacunarity = parseFloat(s.noiseLac) || 2;
    const seedX = parseFloat(s.noiseSeedX) || 0;
    const seedY = parseFloat(s.noiseSeedY) || 0;
    const lightFreq = parseFloat(s.noiseLightFreq) || 1.7;

    const px = normX * scale + seedX;
    const py = normY * scale + seedY;

    // Two independent noise channels for hue and lightness
    const hueN = PaletteProcessor._fbm(px, py, octaves, persistence, lacunarity) * 0.5 + 0.5;
    const lightN = PaletteProcessor._fbm(
      normX * scale * lightFreq + seedX + 73.5,
      normY * scale * lightFreq + seedY + 91.2,
      octaves, persistence, lacunarity
    ) * 0.5 + 0.5;

    return this._samplePaletteTexture(
      Math.max(0, Math.min(1, hueN)),
      Math.max(0, Math.min(1, lightN))
    );
  }

  /**
   * Sample the gradient texture at (u, v) coordinates.
   * u maps along the gradient (1D); v is unused.
   */
  _samplePaletteTexture(u, v) {
    return this._sampleCustomGradient(u);
  }

  // ════════════════════════════════════════
  // Interference
  // ════════════════════════════════════════

  _applyInterference(outputHex, origColor) {
    const s = this.settings;
    const P = PaletteProcessor;
    const amount = (parseFloat(s.hmOrigAmount) || 0) / 100;
    if (amount <= 0) return outputHex;

    const origDriver = s.hmOrigDriver || 'luminance';
    const outputDriver = s.hmOutputDriver || 'hue';
    const mix = s.hmOrigMix || 'offset';
    const quant = parseInt(s.hmOrigQuant) || 0;

    const ov = this._colorDriverValue(origColor, origDriver);
    const t = this._colorDriverValue(outputHex, outputDriver);

    let result;
    if (mix === 'offset') {
      result = (t + ov * amount) % 1;
    } else if (mix === 'multiply') {
      const factor = 1 + (ov * 2 - 1) * amount;
      result = t * factor;
      result = result - Math.floor(result);
    } else if (mix === 'wrap') {
      const raw = t + ov * amount * 3;
      const period = raw % 2;
      result = period <= 1 ? period : 2 - period;
    } else if (mix === 'xor') {
      const steps = 7;
      const tQ = Math.floor(t * steps);
      const cQ = Math.floor(ov * steps);
      const xored = tQ ^ cQ;
      result = t * (1 - amount) + (xored / steps) * amount;
    }

    result = Math.max(0, Math.min(1, result));
    if (quant > 0) {
      result = Math.round(result * quant) / quant;
    }

    return this._sampleColorSource(result);
  }

  // ════════════════════════════════════════
  // Hue Remap (eliminate yellows/oranges)
  // ════════════════════════════════════════

  _applyHueRemap(hex) {
    const P = PaletteProcessor;
    const s = this.settings;
    const strength = (parseFloat(s.hueRemapStrength) || 0) / 100;
    if (strength <= 0) return hex;

    const start = parseFloat(s.hueRemapStart) || 25;
    const end = parseFloat(s.hueRemapEnd) || 70;
    if (start >= end) return hex;

    const rgb = P.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);
    const hue = hsl.h;

    const falloff = parseFloat(s.hueRemapFalloff) ?? 15;
    const softStart = start - falloff;
    const softEnd = end + falloff;

    // Outside the soft zone entirely — no effect
    if (hue < softStart || hue > softEnd) return hex;

    // Compute edge fade: 0 at soft boundary, 1 inside the hard zone
    let edgeFade = 1;
    if (hue < start) {
      edgeFade = (hue - softStart) / falloff;            // 0→1 as hue approaches start
    } else if (hue > end) {
      edgeFade = (softEnd - hue) / falloff;              // 1→0 as hue approaches softEnd
    }
    // Smooth the fade with hermite (smoothstep)
    edgeFade = edgeFade * edgeFade * (3 - 2 * edgeFade);

    const mid = (start + end) / 2;
    let targetHue, t;
    if (hue <= mid) {
      // Below midpoint → push toward red (0°)
      t = Math.min(1, (mid - hue) / (mid - start || 1));  // 1 at start, 0 at mid
      targetHue = 0;
    } else {
      // Above midpoint → push toward green (120°)
      t = Math.min(1, (hue - mid) / (end - mid || 1));    // 0 at mid, 1 at end
      targetHue = 120;
    }

    // Push amount: strongest at midpoint, tapered by position and edge fade
    const push = strength * edgeFade * (1 - t);
    const newHue = hue + (targetHue - hue) * push;

    // Apply saturation and lightness offsets, also scaled by edge fade
    const satOffset = (parseFloat(s.hueRemapSatOffset) || 0) * edgeFade;
    const lightOffset = (parseFloat(s.hueRemapLightOffset) || 0) * edgeFade;
    const newSat = Math.max(0, Math.min(100, hsl.s + satOffset));
    const newLight = Math.max(0, Math.min(100, hsl.l + lightOffset));

    const c = this._fromHSL(((newHue % 360) + 360) % 360, newSat, newLight);
    return P.rgbToHex(c.r, c.g, c.b);
  }

  // ── Orange → Red/Pink remap ──

  _applyHueRemap2(hex) {
    const P = PaletteProcessor;
    const s = this.settings;
    const strength = (parseFloat(s.hueRemap2Strength) || 0) / 100;
    if (strength <= 0) return hex;

    const start = parseFloat(s.hueRemap2Start) || 10;
    const end = parseFloat(s.hueRemap2End) || 40;
    const targetHue = parseFloat(s.hueRemap2Target) || 340;
    if (start >= end) return hex;

    const rgb = P.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);
    const hue = hsl.h;

    const falloff = parseFloat(s.hueRemap2Falloff) ?? 15;
    const softStart = start - falloff;
    const softEnd = end + falloff;

    if (hue < softStart || hue > softEnd) return hex;

    // Edge fade: 0 at soft boundary, 1 inside hard zone
    let edgeFade = 1;
    if (hue < start) {
      edgeFade = (hue - softStart) / falloff;
    } else if (hue > end) {
      edgeFade = (softEnd - hue) / falloff;
    }
    edgeFade = edgeFade * edgeFade * (3 - 2 * edgeFade);

    // Push all hues in the zone toward the single target hue
    const push = strength * edgeFade;
    // Shortest-path hue interpolation
    let dH = targetHue - hue;
    if (dH > 180) dH -= 360;
    if (dH < -180) dH += 360;
    const newHue = hue + dH * push;

    const satOffset = (parseFloat(s.hueRemap2SatOffset) || 0) * edgeFade;
    const lightOffset = (parseFloat(s.hueRemap2LightOffset) || 0) * edgeFade;
    const newSat = Math.max(0, Math.min(100, hsl.s + satOffset));
    const newLight = Math.max(0, Math.min(100, hsl.l + lightOffset));

    const c = this._fromHSL(((newHue % 360) + 360) % 360, newSat, newLight);
    return P.rgbToHex(c.r, c.g, c.b);
  }

  // ════════════════════════════════════════
  // Color Fade
  // ════════════════════════════════════════

  _applyColorFade(hex) {
    const s = this.settings;
    const P = PaletteProcessor;
    const driver = s.colorFadeDriver || 'luminance';
    const targetHex = s.colorFadeTarget || '#1a1a1a';
    const fadeStart = (parseFloat(s.cfFadeStart) || 0) / 100;
    const fadeEnd = (parseFloat(s.cfFadeEnd) || 50) / 100;
    const strength = (parseFloat(s.cfStrength) || 100) / 100;
    const mode = s.cfBlendMode || 'normal';
    const hueOffset = (parseFloat(s.cfHueOffset) || 0) / 360;

    const rgb = P.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);

    let rawDriver = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? hsl.h / 360
                  : hsl.l / 100;
    let driverVal = (rawDriver + hueOffset) % 1;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return hex;

    const tgt = P.hexToRgb(targetHex);
    const blended = this._applyGradeBlend(rgb.r, rgb.g, rgb.b, tgt.r, tgt.g, tgt.b, mode);
    return P.rgbToHex(
      rgb.r + (blended.r - rgb.r) * blend,
      rgb.g + (blended.g - rgb.g) * blend,
      rgb.b + (blended.b - rgb.b) * blend
    );
  }

  // ════════════════════════════════════════
  // Color Fade 2
  // ════════════════════════════════════════

  _applyColorFade2(hex) {
    const s = this.settings;
    const P = PaletteProcessor;
    const driver = s.colorFade2Driver || 'luminance';
    const targetHex = s.colorFade2Target || '#1a1a1a';
    const fadeStart = this._numCf2FadeStart;
    const fadeEnd = this._numCf2FadeEnd;
    const strength = this._numCf2Strength;
    const mode = s.cf2BlendMode || 'normal';
    const hueOffset = (parseFloat(s.cf2HueOffset) || 0) / 360;

    const rgb = P.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);

    let rawDriver = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? hsl.h / 360
                  : hsl.l / 100;
    let driverVal = (rawDriver + hueOffset) % 1;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return hex;

    const tgt = P.hexToRgb(targetHex);
    const blended = this._applyGradeBlend(rgb.r, rgb.g, rgb.b, tgt.r, tgt.g, tgt.b, mode);
    return P.rgbToHex(
      rgb.r + (blended.r - rgb.r) * blend,
      rgb.g + (blended.g - rgb.g) * blend,
      rgb.b + (blended.b - rgb.b) * blend
    );
  }

  // ════════════════════════════════════════
  // Color Fade 3
  // ════════════════════════════════════════

  _applyColorFade3(hex) {
    const s = this.settings;
    const P = PaletteProcessor;
    const driver = s.colorFade3Driver || 'saturation';
    const targetHex = s.colorFade3Target || '#1a1a1a';
    const fadeStart = this._numCf3FadeStart;
    const fadeEnd = this._numCf3FadeEnd;
    const strength = this._numCf3Strength;
    const mode = s.cf3BlendMode || 'normal';
    const hueOffset = (parseFloat(s.cf3HueOffset) || 0) / 360;

    const rgb = P.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);

    let rawDriver = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? hsl.h / 360
                  : hsl.l / 100;
    let driverVal = (rawDriver + hueOffset) % 1;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return hex;

    const tgt = P.hexToRgb(targetHex);
    const blended = this._applyGradeBlend(rgb.r, rgb.g, rgb.b, tgt.r, tgt.g, tgt.b, mode);
    return P.rgbToHex(
      rgb.r + (blended.r - rgb.r) * blend,
      rgb.g + (blended.g - rgb.g) * blend,
      rgb.b + (blended.b - rgb.b) * blend
    );
  }

  // ════════════════════════════════════════
  // Color Fade 4
  // ════════════════════════════════════════

  _applyColorFade4(hex) {
    const s = this.settings;
    const P = PaletteProcessor;
    const driver = s.colorFade4Driver || 'hue';
    const targetHex = s.colorFade4Target || '#1a1a1a';
    const fadeStart = this._numCf4FadeStart;
    const fadeEnd = this._numCf4FadeEnd;
    const strength = this._numCf4Strength;
    const mode = s.cf4BlendMode || 'normal';
    const hueOffset = (parseFloat(s.cf4HueOffset) || 0) / 360;

    const rgb = P.hexToRgb(hex);
    const hsl = this._toHSL(rgb.r, rgb.g, rgb.b);

    let rawDriver = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? hsl.h / 360
                  : hsl.l / 100;
    let driverVal = (rawDriver + hueOffset) % 1;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return hex;

    const tgt = P.hexToRgb(targetHex);
    const blended = this._applyGradeBlend(rgb.r, rgb.g, rgb.b, tgt.r, tgt.g, tgt.b, mode);
    return P.rgbToHex(
      rgb.r + (blended.r - rgb.r) * blend,
      rgb.g + (blended.g - rgb.g) * blend,
      rgb.b + (blended.b - rgb.b) * blend
    );
  }

  // ════════════════════════════════════════
  // Color Grade
  // ════════════════════════════════════════

  _buildCurveLUT(points) {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const n = sorted.length;
    const lut = new Float32Array(256);
    if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i / 255; return lut; }

    const xs = sorted.map(p => p.x * 255);
    const ys = sorted.map(p => p.y * 255);

    // Slopes between points
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) {
      dx.push(xs[i + 1] - xs[i]);
      dy.push(ys[i + 1] - ys[i]);
      m.push(dx[i] > 0 ? dy[i] / dx[i] : 0);
    }

    // Tangents (Fritsch-Carlson monotonicity)
    const tg = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      tg.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
    }
    tg.push(m[n - 2]);

    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(m[i]) < 1e-10) { tg[i] = 0; tg[i + 1] = 0; continue; }
      const a = tg[i] / m[i], b = tg[i + 1] / m[i];
      const s2 = a * a + b * b;
      if (s2 > 9) {
        const tau = 3 / Math.sqrt(s2);
        tg[i] = tau * a * m[i];
        tg[i + 1] = tau * b * m[i];
      }
    }

    // Evaluate Hermite at each x
    for (let i = 0; i < 256; i++) {
      let seg = 0;
      for (let j = 0; j < n - 1; j++) { if (i >= xs[j]) seg = j; }
      if (seg >= n - 1) seg = n - 2;

      const h = dx[seg] || 1;
      const t = (i - xs[seg]) / h;
      const t2 = t * t, t3 = t2 * t;
      lut[i] = Math.max(0, Math.min(1,
        ((2 * t3 - 3 * t2 + 1) * ys[seg] +
         (t3 - 2 * t2 + t) * h * tg[seg] +
         (-2 * t3 + 3 * t2) * ys[seg + 1] +
         (t3 - t2) * h * tg[seg + 1]) / 255
      ));
    }
    return lut;
  }

  _applyCurves(r, g, b) {
    const ri = Math.round(Math.max(0, Math.min(255, r)));
    const gi = Math.round(Math.max(0, Math.min(255, g)));
    const bi = Math.round(Math.max(0, Math.min(255, b)));
    const cr = this._curveLUTs.red[ri] * 255;
    const cg = this._curveLUTs.green[gi] * 255;
    const cb = this._curveLUTs.blue[bi] * 255;
    return {
      r: this._curveLUTs.master[Math.round(Math.max(0, Math.min(255, cr)))] * 255,
      g: this._curveLUTs.master[Math.round(Math.max(0, Math.min(255, cg)))] * 255,
      b: this._curveLUTs.master[Math.round(Math.max(0, Math.min(255, cb)))] * 255
    };
  }

  _applyColorGrade(r, g, b) {
    const P = PaletteProcessor;
    const temp     = this._numGradeTemp;
    const tint     = this._numGradeTint;
    const sat      = this._numGradeSat;
    const exposure = this._numGradeExp;
    const contrast = this._numGradeContrast;
    const highs    = this._numGradeHigh;
    const shadows  = this._numGradeShadow;

    // 1. Temperature & Tint
    r += temp * 0.6;
    b -= temp * 0.6;
    g -= tint * 0.4;
    r += tint * 0.1;
    b += tint * 0.1;

    // 2. Exposure
    const expMul = Math.pow(2, exposure);
    r *= expMul; g *= expMul; b *= expMul;

    // 3. Contrast
    if (contrast !== 0) {
      const cf = Math.max(0.01, (100 + contrast) / 100);
      r = ((r / 255 - 0.5) * cf + 0.5) * 255;
      g = ((g / 255 - 0.5) * cf + 0.5) * 255;
      b = ((b / 255 - 0.5) * cf + 0.5) * 255;
    }

    // 4. Highlights & Shadows
    const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    if (highs !== 0) {
      const mask = Math.max(0, Math.min(1, (lum - 0.5) * 2));
      const adj = highs * 0.6 * mask;
      r += adj; g += adj; b += adj;
    }
    if (shadows !== 0) {
      const mask = Math.max(0, Math.min(1, 1 - lum * 2));
      const adj = shadows * 0.6 * mask;
      r += adj; g += adj; b += adj;
    }

    // 5. Saturation
    if (sat !== 1) {
      const hsl = this._toHSL(
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b))
      );
      hsl.s = Math.max(0, Math.min(100, hsl.s * sat));
      const c = this._fromHSL(hsl.h, hsl.s, hsl.l);
      r = c.r; g = c.g; b = c.b;
    }

    // 6. Curves
    return this._applyCurves(r, g, b);
  }

  _applyGradeBlend(baseR, baseG, baseB, gradedR, gradedG, gradedB, mode) {
    const P = PaletteProcessor;
    if (!mode) mode = (this.settings && this.settings.gradeBlend) || 'normal';
    if (mode === 'normal') return { r: gradedR, g: gradedG, b: gradedB };

    // Layer compositing: base = bottom layer, graded = top layer
    let r1 = baseR / 255, g1 = baseG / 255, b1 = baseB / 255;
    let r2 = Math.max(0, Math.min(255, gradedR)) / 255;
    let g2 = Math.max(0, Math.min(255, gradedG)) / 255;
    let b2 = Math.max(0, Math.min(255, gradedB)) / 255;
    let ro, go, bo;

    switch (mode) {
      case 'multiply':
        ro = r1 * r2; go = g1 * g2; bo = b1 * b2; break;
      case 'screen':
        ro = 1 - (1 - r1) * (1 - r2); go = 1 - (1 - g1) * (1 - g2); bo = 1 - (1 - b1) * (1 - b2); break;
      case 'overlay':
        ro = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        go = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        bo = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2); break;
      case 'soft-light':
        ro = r2 < 0.5 ? r1 - (1 - 2 * r2) * r1 * (1 - r1) : r1 + (2 * r2 - 1) * (Math.sqrt(r1) - r1);
        go = g2 < 0.5 ? g1 - (1 - 2 * g2) * g1 * (1 - g1) : g1 + (2 * g2 - 1) * (Math.sqrt(g1) - g1);
        bo = b2 < 0.5 ? b1 - (1 - 2 * b2) * b1 * (1 - b1) : b1 + (2 * b2 - 1) * (Math.sqrt(b1) - b1); break;
      case 'hard-light':
        ro = r2 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
        go = g2 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
        bo = b2 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2); break;
      case 'vivid-light':
        ro = r2 <= 0.5 ? (r2 === 0 ? 0 : Math.max(0, 1 - (1 - r1) / (2 * r2))) : (r2 === 1 ? 1 : Math.min(1, r1 / (2 * (1 - r2))));
        go = g2 <= 0.5 ? (g2 === 0 ? 0 : Math.max(0, 1 - (1 - g1) / (2 * g2))) : (g2 === 1 ? 1 : Math.min(1, g1 / (2 * (1 - g2))));
        bo = b2 <= 0.5 ? (b2 === 0 ? 0 : Math.max(0, 1 - (1 - b1) / (2 * b2))) : (b2 === 1 ? 1 : Math.min(1, b1 / (2 * (1 - b2)))); break;
      case 'linear-light':
        ro = r1 + 2 * r2 - 1; go = g1 + 2 * g2 - 1; bo = b1 + 2 * b2 - 1; break;
      case 'darken':
        ro = Math.min(r1, r2); go = Math.min(g1, g2); bo = Math.min(b1, b2); break;
      case 'darker-color': {
        const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
        const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
        if (lum1 <= lum2) { ro = r1; go = g1; bo = b1; }
        else              { ro = r2; go = g2; bo = b2; }
        break;
      }
      case 'lighten':
        ro = Math.max(r1, r2); go = Math.max(g1, g2); bo = Math.max(b1, b2); break;
      case 'color-dodge':
        ro = r2 >= 1 ? 1 : Math.min(1, r1 / (1 - r2));
        go = g2 >= 1 ? 1 : Math.min(1, g1 / (1 - g2));
        bo = b2 >= 1 ? 1 : Math.min(1, b1 / (1 - b2)); break;
      case 'color-burn':
        ro = r2 <= 0 ? 0 : Math.max(0, 1 - (1 - r1) / r2);
        go = g2 <= 0 ? 0 : Math.max(0, 1 - (1 - g1) / g2);
        bo = b2 <= 0 ? 0 : Math.max(0, 1 - (1 - b1) / b2); break;
      case 'linear-burn':
        ro = r1 + r2 - 1; go = g1 + g2 - 1; bo = b1 + b2 - 1; break;
      case 'add':
        ro = r1 + r2; go = g1 + g2; bo = b1 + b2; break;
      case 'subtract':
        ro = r1 - r2; go = g1 - g2; bo = b1 - b2; break;
      case 'divide':
        ro = r2 === 0 ? 1 : r1 / r2; go = g2 === 0 ? 1 : g1 / g2; bo = b2 === 0 ? 1 : b1 / b2; break;
      case 'difference':
        ro = Math.abs(r1 - r2); go = Math.abs(g1 - g2); bo = Math.abs(b1 - b2); break;
      case 'exclusion':
        ro = r1 + r2 - 2 * r1 * r2; go = g1 + g2 - 2 * g1 * g2; bo = b1 + b2 - 2 * b1 * b2; break;
      case 'average':
        ro = (r1 + r2) / 2; go = (g1 + g2) / 2; bo = (b1 + b2) / 2; break;
      case 'grain-extract':
        ro = r1 - r2 + 0.5; go = g1 - g2 + 0.5; bo = b1 - b2 + 0.5; break;
      case 'grain-merge':
        ro = r1 + r2 - 0.5; go = g1 + g2 - 0.5; bo = b1 + b2 - 0.5; break;
      case 'hue':
      case 'saturation':
      case 'color':
      case 'luminosity': {
        const bHsl = this._toHSL(baseR, baseG, baseB);
        const gHsl = this._toHSL(
          Math.max(0, Math.min(255, gradedR)),
          Math.max(0, Math.min(255, gradedG)),
          Math.max(0, Math.min(255, gradedB))
        );
        let rH, rS, rL;
        if (mode === 'hue')             { rH = gHsl.h; rS = bHsl.s; rL = bHsl.l; }
        else if (mode === 'saturation') { rH = bHsl.h; rS = gHsl.s; rL = bHsl.l; }
        else if (mode === 'color')      { rH = gHsl.h; rS = gHsl.s; rL = bHsl.l; }
        else /* luminosity */           { rH = bHsl.h; rS = bHsl.s; rL = gHsl.l; }
        const c = this._fromHSL(rH, rS, rL);
        return { r: c.r, g: c.g, b: c.b };
      }
      default:
        return { r: gradedR, g: gradedG, b: gradedB };
    }

    return {
      r: Math.max(0, Math.min(255, ro * 255)),
      g: Math.max(0, Math.min(255, go * 255)),
      b: Math.max(0, Math.min(255, bo * 255))
    };
  }

  _gradeColor(hex) {
    const P = PaletteProcessor;
    const orig = P.hexToRgb(hex);
    const graded = this._applyColorGrade(orig.r, orig.g, orig.b);
    const blended = this._applyGradeBlend(orig.r, orig.g, orig.b, graded.r, graded.g, graded.b);
    return P.rgbToHex(
      Math.max(0, Math.min(255, blended.r)),
      Math.max(0, Math.min(255, blended.g)),
      Math.max(0, Math.min(255, blended.b))
    );
  }

  // ════════════════════════════════════════
  // RGB Pipeline — no hex strings between stages
  // processColorRGB() is the main entry point
  // ════════════════════════════════════════

  static colorDriverValueRGB(r, g, b, driver) {
    const hsl = PaletteProcessor.rgbToHsl(r, g, b);
    if (driver === 'hue') return hsl.h / 360;
    if (driver === 'saturation') return hsl.s / 100;
    return hsl.l / 100;
  }

  _sampleCustomGradientRGB(t) {
    const P = PaletteProcessor;
    t = Math.max(0, Math.min(1, t));
    const stops = this._sortedStopsRGB;
    const out = this._gradientResult;
    if (!stops || stops.length === 0) { out.r = 128; out.g = 128; out.b = 128; return out; }
    if (stops.length === 1) { out.r = stops[0].r; out.g = stops[0].g; out.b = stops[0].b; return out; }
    if (t <= stops[0].pos) { out.r = stops[0].r; out.g = stops[0].g; out.b = stops[0].b; return out; }
    const last = stops[stops.length - 1];
    if (t >= last.pos) { out.r = last.r; out.g = last.g; out.b = last.b; return out; }

    let lo = 0, hi = 1;
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].pos && t <= stops[i + 1].pos) {
        lo = i; hi = i + 1; break;
      }
    }

    const range = stops[hi].pos - stops[lo].pos;
    const frac = range > 0 ? (t - stops[lo].pos) / range : 0;
    const interp = (this.settings && this.settings.gradientInterp) || 'rgb';
    const aR = stops[lo].r, aG = stops[lo].g, aB = stops[lo].b;
    const bR = stops[hi].r, bG = stops[hi].g, bB = stops[hi].b;

    if (interp === 'rgb') {
      out.r = aR + (bR - aR) * frac;
      out.g = aG + (bG - aG) * frac;
      out.b = aB + (bB - aB) * frac;
      return out;
    }

    let aH, aS, aV, bH, bS, bV;
    if (interp.startsWith('hsv')) {
      const av = P.rgbToHsv(aR, aG, aB);
      const bv = P.rgbToHsv(bR, bG, bB);
      aH = av.h; aS = av.s; aV = av.v;
      bH = bv.h; bS = bv.s; bV = bv.v;
    } else {
      const al = P.rgbToHsl(aR, aG, aB);
      const bl = P.rgbToHsl(bR, bG, bB);
      aH = al.h; aS = al.s; aV = al.l;
      bH = bl.h; bS = bl.s; bV = bl.l;
    }

    let dH = bH - aH;
    const isNear = interp.endsWith('near');
    if (isNear) {
      if (dH > 180) dH -= 360;
      if (dH < -180) dH += 360;
    } else {
      if (dH >= 0 && dH < 180) dH -= 360;
      if (dH < 0 && dH > -180) dH += 360;
    }

    let h = (aH + dH * frac) % 360;
    if (h < 0) h += 360;
    const s = aS + (bS - aS) * frac;
    const v = aV + (bV - aV) * frac;

    const rgb = interp.startsWith('hsv') ? P.hsvToRgb(h, s, v) : P.hslToRgb(h, s, v);
    out.r = rgb.r; out.g = rgb.g; out.b = rgb.b;
    return out;
  }

  _sampleColorSourceRGB(t) {
    return this._sampleCustomGradientRGB(t);
  }

  /**
   * Pre-compute noise colors for the entire grid into a Float32Array cache.
   * Only rebuilds when noise params change (via _dirty flag) or grid size changes.
   * @param {number} cols - Grid columns
   * @param {number} rows - Grid rows
   * @param {Float32Array} normCoords - Flat array of [normX, normY, ...] per cell
   */
  buildNoiseTexture(cols, rows, normCoords) {
    if (!this.settings) return;
    const mode = this.settings.activeMode || 'mode1';
    if (mode !== 'mode1') return; // Only needed for noise mode

    const gridSize = cols * rows;
    if (!this._noiseTextureDirty &&
        this._noiseTextureCols === cols &&
        this._noiseTextureRows === rows &&
        this._noiseTextureCache) {
      return;
    }

    if (!this._noiseTextureCache || this._noiseTextureCache.length !== gridSize * 3) {
      this._noiseTextureCache = new Float32Array(gridSize * 3);
    }

    for (let i = 0; i < gridSize; i++) {
      const rgb = this._sampleNoiseCPURGB(normCoords[i * 2], normCoords[i * 2 + 1]);
      const idx = i * 3;
      this._noiseTextureCache[idx] = rgb.r;
      this._noiseTextureCache[idx + 1] = rgb.g;
      this._noiseTextureCache[idx + 2] = rgb.b;
    }

    this._noiseTextureCols = cols;
    this._noiseTextureRows = rows;
    this._noiseTextureDirty = false;
  }

  /**
   * Look up pre-computed noise color for a cell index.
   * Returns null if cache is not available (falls back to per-shape computation).
   */
  _lookupNoiseRGB(index) {
    if (this._noiseTextureCache && index * 3 + 2 < this._noiseTextureCache.length) {
      const idx = index * 3;
      const out = this._gradientResult;
      out.r = this._noiseTextureCache[idx];
      out.g = this._noiseTextureCache[idx + 1];
      out.b = this._noiseTextureCache[idx + 2];
      return out;
    }
    return null;
  }

  _sampleNoiseCPURGB(normX, normY) {
    const px = normX * this._numNoiseScale + this._numNoiseSeedX;
    const py = normY * this._numNoiseScale + this._numNoiseSeedY;

    const hueN = PaletteProcessor._fbm(px, py, this._numNoiseOctaves, this._numNoisePersist, this._numNoiseLac) * 0.5 + 0.5;

    return this._sampleCustomGradientRGB(Math.max(0, Math.min(1, hueN)));
  }

  _sampleHeatmapRGB(t) {
    const interp = (this.settings && this.settings.heatmapInterp) || 'smooth';
    const invert = this.settings && this.settings.heatmapInvert;
    if (invert) t = 1 - t;

    t = Math.max(0, Math.min(1, t));
    const colors = this._heatmapColorsRGB;
    const out = this._heatmapResult;
    if (!colors || colors.length === 0) { out.r = 128; out.g = 128; out.b = 128; return out; }
    const n = colors.length;
    if (n === 1) { out.r = colors[0].r; out.g = colors[0].g; out.b = colors[0].b; return out; }
    const scaled = t * (n - 1);

    if (interp === 'step') {
      const c = colors[Math.min(Math.round(scaled), n - 1)];
      out.r = c.r; out.g = c.g; out.b = c.b;
      return out;
    }

    const lo = Math.floor(scaled);
    const hi = Math.min(lo + 1, n - 1);
    const frac = scaled - lo;
    const a = colors[lo];
    const b = colors[hi];
    out.r = a.r + (b.r - a.r) * frac;
    out.g = a.g + (b.g - a.g) * frac;
    out.b = a.b + (b.b - a.b) * frac;
    return out;
  }

  _applyInterferenceRGB(color, origR, origG, origB) {
    const amount = this._numHmOrigAmount;
    if (amount <= 0) return color;

    const s = this.settings;
    const P = PaletteProcessor;
    const origDriver = s.hmOrigDriver || 'luminance';
    const outputDriver = s.hmOutputDriver || 'hue';
    const mix = s.hmOrigMix || 'offset';
    const quant = this._numHmOrigQuant;

    // Opt D: Inline HSL conversions — compute once instead of 2× colorDriverValueRGB calls
    const origHsl = this._toHSL(origR, origG, origB);
    let ov;
    if (origDriver === 'hue') ov = origHsl.h / 360;
    else if (origDriver === 'saturation') ov = origHsl.s / 100;
    else ov = origHsl.l / 100;

    const colorHsl = this._toHSL(color.r, color.g, color.b);
    let t;
    if (outputDriver === 'hue') t = colorHsl.h / 360;
    else if (outputDriver === 'saturation') t = colorHsl.s / 100;
    else t = colorHsl.l / 100;

    let result;
    if (mix === 'offset') {
      result = (t + ov * amount) % 1;
    } else if (mix === 'multiply') {
      const factor = 1 + (ov * 2 - 1) * amount;
      result = t * factor;
      result = result - Math.floor(result);
    } else if (mix === 'wrap') {
      const raw = t + ov * amount * 3;
      const period = raw % 2;
      result = period <= 1 ? period : 2 - period;
    } else if (mix === 'xor') {
      const steps = 7;
      const tQ = Math.floor(t * steps);
      const cQ = Math.floor(ov * steps);
      const xored = tQ ^ cQ;
      result = t * (1 - amount) + (xored / steps) * amount;
    }

    result = Math.max(0, Math.min(1, result));
    if (quant > 0) {
      result = Math.round(result * quant) / quant;
    }

    return this._sampleColorSourceRGB(result);
  }

  _applyHueRemapRGB(color) {
    const P = PaletteProcessor;
    const strength = this._numHueRemapStrength;
    if (strength <= 0) return color;

    const start = this._numHueRemapStart;
    const end = this._numHueRemapEnd;
    if (start >= end) return color;

    const hsl = this._toHSL(color.r, color.g, color.b);
    const hue = hsl.h;

    const falloff = this._numHueRemapFalloff;
    const softStart = start - falloff;
    const softEnd = end + falloff;

    if (hue < softStart || hue > softEnd) return color;

    let edgeFade = 1;
    if (hue < start) {
      edgeFade = (hue - softStart) / falloff;
    } else if (hue > end) {
      edgeFade = (softEnd - hue) / falloff;
    }
    edgeFade = edgeFade * edgeFade * (3 - 2 * edgeFade);

    const mid = (start + end) / 2;
    let targetHue, t;
    if (hue <= mid) {
      t = Math.min(1, (mid - hue) / (mid - start || 1));
      targetHue = 0;
    } else {
      t = Math.min(1, (hue - mid) / (end - mid || 1));
      targetHue = 120;
    }

    const push = strength * edgeFade * (1 - t);
    const newHue = hue + (targetHue - hue) * push;

    const satOffset = this._numHueRemapSatOffset * edgeFade;
    const lightOffset = this._numHueRemapLightOffset * edgeFade;
    const newSat = Math.max(0, Math.min(100, hsl.s + satOffset));
    const newLight = Math.max(0, Math.min(100, hsl.l + lightOffset));

    const c = this._fromHSL(((newHue % 360) + 360) % 360, newSat, newLight);
    const out = this._hueRemapResult;
    out.r = c.r; out.g = c.g; out.b = c.b;
    return out;
  }

  _applyHueRemap2RGB(color) {
    const P = PaletteProcessor;
    const strength = this._numHueRemap2Strength;
    if (strength <= 0) return color;

    const start = this._numHueRemap2Start;
    const end = this._numHueRemap2End;
    const targetHue = this._numHueRemap2Target;
    if (start >= end) return color;

    const hsl = this._toHSL(color.r, color.g, color.b);
    const hue = hsl.h;

    const falloff = this._numHueRemap2Falloff;
    const softStart = start - falloff;
    const softEnd = end + falloff;

    if (hue < softStart || hue > softEnd) return color;

    let edgeFade = 1;
    if (hue < start) {
      edgeFade = (hue - softStart) / falloff;
    } else if (hue > end) {
      edgeFade = (softEnd - hue) / falloff;
    }
    edgeFade = edgeFade * edgeFade * (3 - 2 * edgeFade);

    const push = strength * edgeFade;
    let dH = targetHue - hue;
    if (dH > 180) dH -= 360;
    if (dH < -180) dH += 360;
    const newHue = hue + dH * push;

    const satOffset = this._numHueRemap2SatOffset * edgeFade;
    const lightOffset = this._numHueRemap2LightOffset * edgeFade;
    const newSat = Math.max(0, Math.min(100, hsl.s + satOffset));
    const newLight = Math.max(0, Math.min(100, hsl.l + lightOffset));

    const c = this._fromHSL(((newHue % 360) + 360) % 360, newSat, newLight);
    const out = this._hueRemap2Result;
    out.r = c.r; out.g = c.g; out.b = c.b;
    return out;
  }

  _applyHueGradMapRGB(color) {
    const strength = this._numHueGradMapStrength;
    if (strength <= 0) return color;

    const stops = this._hueGradMapStopsRGB;
    if (!stops || stops.length === 0) return color;

    const hsl = this._toHSL(
      Math.max(0, Math.min(255, color.r)),
      Math.max(0, Math.min(255, color.g)),
      Math.max(0, Math.min(255, color.b))
    );

    // Map input hue (0-360) to gradient position (0-1), offset by phase
    let t = hsl.h / 360 + this._numHueGradMapPhase;
    if (t >= 1) t -= 1;

    // Sample the pre-computed sorted RGB stops
    let mr, mg, mb;
    if (t <= stops[0].pos) {
      mr = stops[0].r; mg = stops[0].g; mb = stops[0].b;
    } else if (t >= stops[stops.length - 1].pos) {
      const last = stops[stops.length - 1];
      mr = last.r; mg = last.g; mb = last.b;
    } else {
      let lo = 0;
      for (let i = 0; i < stops.length - 1; i++) {
        if (t >= stops[i].pos && t <= stops[i + 1].pos) { lo = i; break; }
      }
      const hi = lo + 1;
      const range = stops[hi].pos - stops[lo].pos;
      const frac = range > 0 ? (t - stops[lo].pos) / range : 0;
      mr = stops[lo].r + (stops[hi].r - stops[lo].r) * frac;
      mg = stops[lo].g + (stops[hi].g - stops[lo].g) * frac;
      mb = stops[lo].b + (stops[hi].b - stops[lo].b) * frac;
    }

    // Optionally preserve original lightness
    if (this.settings.hueGradMapPreserveLight) {
      const mappedHsl = this._toHSL(mr, mg, mb);
      const preserved = this._fromHSL(mappedHsl.h, mappedHsl.s, hsl.l);
      mr = preserved.r; mg = preserved.g; mb = preserved.b;
    }

    // Lerp original → mapped by strength
    const out = this._hueGradMapResult;
    out.r = color.r + (mr - color.r) * strength;
    out.g = color.g + (mg - color.g) * strength;
    out.b = color.b + (mb - color.b) * strength;
    return out;
  }

  _applyColorFadeRGB(color) {
    const driver = this.settings.colorFadeDriver || 'luminance';
    const fadeStart = this._numCfFadeStart;
    const fadeEnd = this._numCfFadeEnd;
    const strength = this._numCfStrength;
    const mode = this.settings.cfBlendMode || 'normal';
    const hueOffset = (parseFloat(this.settings.cfHueOffset) || 0) / 360;

    const hsl = this._toHSL(color.r, color.g, color.b);
    let driverVal = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? (((hsl.h / 360 + hueOffset) % 1) + 1) % 1
                    : hsl.l / 100;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return color;

    const blended = this._applyGradeBlend(color.r, color.g, color.b, this._cfTargetR, this._cfTargetG, this._cfTargetB, mode);
    const out = this._colorFadeResult;
    out.r = color.r + (blended.r - color.r) * blend;
    out.g = color.g + (blended.g - color.g) * blend;
    out.b = color.b + (blended.b - color.b) * blend;
    return out;
  }

  _applyColorFade2RGB(color) {
    const driver = this.settings.colorFade2Driver || 'luminance';
    const fadeStart = this._numCf2FadeStart;
    const fadeEnd = this._numCf2FadeEnd;
    const strength = this._numCf2Strength;
    const mode = this.settings.cf2BlendMode || 'normal';
    const hueOffset = (parseFloat(this.settings.cf2HueOffset) || 0) / 360;

    const hsl = this._toHSL(color.r, color.g, color.b);
    let driverVal = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? (((hsl.h / 360 + hueOffset) % 1) + 1) % 1
                    : hsl.l / 100;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return color;

    const blended = this._applyGradeBlend(color.r, color.g, color.b, this._cf2TargetR, this._cf2TargetG, this._cf2TargetB, mode);
    const out = this._colorFade2Result;
    out.r = color.r + (blended.r - color.r) * blend;
    out.g = color.g + (blended.g - color.g) * blend;
    out.b = color.b + (blended.b - color.b) * blend;
    return out;
  }

  _applyColorFade3RGB(color) {
    const driver = this.settings.colorFade3Driver || 'saturation';
    const fadeStart = this._numCf3FadeStart;
    const fadeEnd = this._numCf3FadeEnd;
    const strength = this._numCf3Strength;
    const mode = this.settings.cf3BlendMode || 'normal';
    const hueOffset = (parseFloat(this.settings.cf3HueOffset) || 0) / 360;

    const hsl = this._toHSL(color.r, color.g, color.b);
    let driverVal = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? (((hsl.h / 360 + hueOffset) % 1) + 1) % 1
                    : hsl.l / 100;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return color;

    const blended = this._applyGradeBlend(color.r, color.g, color.b, this._cf3TargetR, this._cf3TargetG, this._cf3TargetB, mode);
    const out = this._colorFade3Result;
    out.r = color.r + (blended.r - color.r) * blend;
    out.g = color.g + (blended.g - color.g) * blend;
    out.b = color.b + (blended.b - color.b) * blend;
    return out;
  }

  _applyColorFade4RGB(color) {
    const driver = this.settings.colorFade4Driver || 'hue';
    const fadeStart = this._numCf4FadeStart;
    const fadeEnd = this._numCf4FadeEnd;
    const strength = this._numCf4Strength;
    const mode = this.settings.cf4BlendMode || 'normal';
    const hueOffset = (parseFloat(this.settings.cf4HueOffset) || 0) / 360;

    const hsl = this._toHSL(color.r, color.g, color.b);
    let rawDriver = driver === 'saturation' ? hsl.s / 100
                  : driver === 'hue' ? hsl.h / 360
                  : hsl.l / 100;
    let driverVal = ((rawDriver + hueOffset) % 1 + 1) % 1;

    const mid = (fadeStart + fadeEnd) / 2;
    const halfWidth = (fadeEnd - fadeStart) / 2;
    let blend;
    if (halfWidth <= 0) {
      blend = 0;
    } else {
      const dist = Math.abs(driverVal - mid);
      blend = dist >= halfWidth ? 0 : strength * (1 - dist / halfWidth);
    }

    if (blend <= 0) return color;

    const blended = this._applyGradeBlend(color.r, color.g, color.b, this._cf4TargetR, this._cf4TargetG, this._cf4TargetB, mode);
    const out = this._colorFade4Result;
    out.r = color.r + (blended.r - color.r) * blend;
    out.g = color.g + (blended.g - color.g) * blend;
    out.b = color.b + (blended.b - color.b) * blend;
    return out;
  }

  _gradeColorRGB(color) {
    const graded = this._applyColorGrade(color.r, color.g, color.b);
    const blended = this._applyGradeBlend(color.r, color.g, color.b, graded.r, graded.g, graded.b);
    const out = this._gradeResult;
    out.r = Math.max(0, Math.min(255, blended.r));
    out.g = Math.max(0, Math.min(255, blended.g));
    out.b = Math.max(0, Math.min(255, blended.b));
    return out;
  }

  _applyImageAdjustRGB(color) {
    let r = color.r, g = color.g, b = color.b;

    // 1. Brightness — additive shift
    const brightness = this._numImgAdjBrightness;
    if (brightness !== 0) {
      const adj = brightness * 2.55;
      r += adj; g += adj; b += adj;
    }

    // 2. Contrast — same formula as Color Grade
    const contrast = this._numImgAdjContrast;
    if (contrast !== 0) {
      const cf = Math.max(0.01, (100 + contrast) / 100);
      r = ((r / 255 - 0.5) * cf + 0.5) * 255;
      g = ((g / 255 - 0.5) * cf + 0.5) * 255;
      b = ((b / 255 - 0.5) * cf + 0.5) * 255;
    }

    // 3. Vibrancy — boost muted colours more than vivid ones
    const vibrancy = this._numImgAdjVibrancy;
    if (vibrancy !== 0) {
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      const hsl = this._toHSL(r, g, b);
      const sat01 = hsl.s / 100;
      const weight = 1 - sat01 * sat01;
      hsl.s = Math.max(0, Math.min(100, hsl.s + vibrancy * weight * 100));
      const c = this._fromHSL(hsl.h, hsl.s, hsl.l);
      r = c.r; g = c.g; b = c.b;
    }

    const out = this._imgAdjResult;
    out.r = Math.max(0, Math.min(255, r));
    out.g = Math.max(0, Math.min(255, g));
    out.b = Math.max(0, Math.min(255, b));
    return out;
  }

  _applyHueLayerRGB(color) {
    const opacity = this._numHueLayerOpacity;
    if (opacity <= 0) return color;

    // 1. Shift hue → top layer
    const hsl = this._toHSL(
      Math.max(0, Math.min(255, color.r)),
      Math.max(0, Math.min(255, color.g)),
      Math.max(0, Math.min(255, color.b))
    );
    hsl.h = (hsl.h + this._numHueLayerOffset + 360) % 360;
    const shifted = this._fromHSL(hsl.h, hsl.s, hsl.l);

    // 2. Blend shifted (top) onto original (base) using selected mode
    const mode = (this.settings && this.settings.hueLayerBlend) || 'normal';
    const blended = this._applyGradeBlend(color.r, color.g, color.b, shifted.r, shifted.g, shifted.b, mode);

    // 3. Apply opacity (lerp base → blended)
    const out = this._hueLayerResult;
    out.r = color.r + (blended.r - color.r) * opacity;
    out.g = color.g + (blended.g - color.g) * opacity;
    out.b = color.b + (blended.b - color.b) * opacity;
    return out;
  }

  _applyHueExcludeRGB(color) {
    const zoneStart = this._numHueExcludeStart;
    const zoneEnd = this._numHueExcludeEnd;
    const zoneSize = zoneEnd - zoneStart;
    if (zoneSize <= 0 || zoneSize >= 360) return color;

    const hsl = this._toHSL(
      Math.max(0, Math.min(255, color.r)),
      Math.max(0, Math.min(255, color.g)),
      Math.max(0, Math.min(255, color.b))
    );

    const allowedRange = 360 - zoneSize;
    // Compress input hue (0-360) into the allowed range, then map back
    const t = (hsl.h / 360) * allowedRange;
    hsl.h = t < zoneStart ? t : t + zoneSize;
    hsl.h = ((hsl.h % 360) + 360) % 360;

    const c = this._fromHSL(hsl.h, hsl.s, hsl.l);
    const out = this._hueExcludeResult;
    out.r = c.r; out.g = c.g; out.b = c.b;
    return out;
  }

  /**
   * Call once per frame before the draw loop.
   * Swaps histogram buffers: previous frame's accumulated data becomes the
   * active read-only histogram, and the building buffer is cleared for the
   * new frame. Computes dominant hue from the active histogram.
   */
  beginConvergenceFrame() {
    if (this._numHueConvergenceStrength <= 0) return;

    // Swap: building → active, then clear building for new frame
    const tmp = this._hueHistActive;
    this._hueHistActive = this._hueHistBuilding;
    this._hueHistBuilding = tmp;
    this._hueHistBuilding.fill(0);

    // Find peak bucket from previous frame's data
    const hist = this._hueHistActive;
    let maxVal = 0, maxBucket = 0;
    for (let i = 0; i < 12; i++) {
      if (hist[i] > maxVal) { maxVal = hist[i]; maxBucket = i; }
    }

    if (maxVal === 0) return; // no data yet (first frame)

    const targetHue = maxBucket * 30 + 15; // center of bucket

    // EMA smooth with shortest angular path
    if (!this._hasHistogram) {
      this._dominantHue = targetHue;
      this._hasHistogram = true;
    } else {
      let diff = targetHue - this._dominantHue;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this._dominantHue = ((this._dominantHue + diff * 0.15) % 360 + 360) % 360;
    }
  }

  /**
   * Shift color hue toward the dominant on-screen hue.
   */
  _applyHueConvergenceRGB(color) {
    const strength = this._numHueConvergenceStrength;
    if (strength <= 0) return color;

    const hsl = this._toHSL(
      Math.max(0, Math.min(255, color.r)),
      Math.max(0, Math.min(255, color.g)),
      Math.max(0, Math.min(255, color.b))
    );

    // Accumulate histogram from this processed color (reuses HSL above)
    const weight = hsl.s / 100;
    if (weight >= 0.05) {
      this._hueHistBuilding[Math.floor(hsl.h / 30) % 12] += weight;
    }

    // Shortest angular path toward dominant hue
    let diff = this._dominantHue - hsl.h;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    hsl.h = ((hsl.h + diff * strength) % 360 + 360) % 360;

    const c = this._fromHSL(hsl.h, hsl.s, hsl.l);
    const out = this._hueConvergenceResult;
    out.r = c.r; out.g = c.g; out.b = c.b;
    return out;
  }

  processColorRGB(normX, normY, normSize, origR, origG, origB, index) {
    if (!this.settings) {
      const out = this._outputResult;
      out.r = origR; out.g = origG; out.b = origB;
      return out;
    }

    const s = this.settings;
    let color;

    // Base color from noise or heatmap (only when gradient map is enabled)
    if (s.gradientMapEnabled) {
      const mode = s.activeMode || 'mode1';
      if (mode === 'mode1') {
        const cached = (index !== undefined) ? this._lookupNoiseRGB(index) : null;
        color = cached || this._sampleNoiseCPURGB(normX, normY);
      } else {
        color = this._sampleHeatmapRGB(normSize);
      }
    } else {
      color = this._gradientResult;
      color.r = origR !== undefined ? origR : 128;
      color.g = origG !== undefined ? origG : 128;
      color.b = origB !== undefined ? origB : 128;
    }

    if (s.hueLayerEnabled) {
      color = this._applyHueLayerRGB(color);
    }

    if (s.origInterferenceEnabled && origR !== undefined) {
      color = this._applyInterferenceRGB(color, origR, origG, origB);
    }

    if (s.hueRemapEnabled) {
      color = this._applyHueRemapRGB(color);
    }

    if (s.hueRemap2Enabled) {
      color = this._applyHueRemap2RGB(color);
    }

    if (s.hueGradMapEnabled) {
      color = this._applyHueGradMapRGB(color);
    }

    if (this._numHueConvergenceStrength > 0) {
      color = this._applyHueConvergenceRGB(color);
    }

    if (s.colorGradeEnabled) {
      color = this._gradeColorRGB(color);
    }

    if (this._numImgAdjVibrancy !== 0 || this._numImgAdjBrightness !== 0 || this._numImgAdjContrast !== 0) {
      color = this._applyImageAdjustRGB(color);
    }

    if (s.colorFadeEnabled) {
      color = this._applyColorFadeRGB(color);
    }

    if (s.colorFade2Enabled) {
      color = this._applyColorFade2RGB(color);
    }

    if (s.colorFade3Enabled) {
      color = this._applyColorFade3RGB(color);
    }

    if (s.colorFade4Enabled) {
      color = this._applyColorFade4RGB(color);
    }

    if (s.hueExcludeEnabled) {
      color = this._applyHueExcludeRGB(color);
    }

    const out = this._outputResult;
    out.r = color.r; out.g = color.g; out.b = color.b;
    return out;
  }
}

// Global instance
let paletteProcessor;
