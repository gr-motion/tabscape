/**
 * Parameter Configuration
 * Define all parameters for the application here
 * Easy to add new parameters - just add to this array
 */
const PARAMETER_CONFIG = [
  // Grid parameters
  {
    id: 'gridDensity',
    label: 'Grid Density',
    description: 'Spacing between grid points in pixels',
    group: 'Tab Loop',
    type: 'slider',
    min: 30,
    max: 65,
    step: 1,
    defaultValue: 60
  },

  // Canvas parameters
  {
    id: 'colorMode',
    label: 'Colour',
    description: 'Enable colour rendering',
    group: 'Canvas',
    type: 'toggle',
    defaultValue: true
  },
  {
    id: 'invertColors',
    label: 'Invert',
    description: 'Swap light and dark values',
    group: 'Canvas',
    type: 'toggle',
    defaultValue: false
  },

  // Gradient Ring parameters
  {
    id: 'scaleMin',
    label: 'Scale Min',
    group: 'Tab Loop',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'scaleVariation',
    label: 'Scale Variation',
    description: 'Additional size randomness driven by colour',
    group: 'Tab Loop',
    type: 'slider',
    min: 0,
    max: 140,
    step: 1,
    defaultValue: 37
  },
  {
    id: 'scaleMax',
    label: 'Scale Max',
    description: 'Maximum tab size as percentage of grid cell',
    group: 'Tab Loop',
    type: 'slider',
    min: 40,
    max: 70,
    step: 1,
    defaultValue: 50
  },
  {
    id: 'ringRadius',
    label: 'Ring Radius',
    description: 'Distance from centre to the ring midpoint',
    group: 'Tab Loop',
    type: 'slider',
    min: 140,
    max: 300,
    step: 5,
    defaultValue: 200
  },
  {
    id: 'ringThickness',
    label: 'Ring Thickness',
    description: 'Width of the gradient ring band',
    group: 'Tab Loop',
    type: 'slider',
    min: 45,
    max: 240,
    step: 1,
    defaultValue: 100
  },
  {
    id: 'ringInnerSoftness',
    label: 'Inner Softness',
    description: 'Feathering on the inner ring edge',
    group: 'Tab Loop',
    type: 'slider',
    min: 60,
    max: 250,
    step: 1,
    defaultValue: 100
  },
  {
    id: 'ringOuterSoftness',
    label: 'Outer Softness',
    description: 'Feathering on the outer ring edge',
    group: 'Tab Loop',
    type: 'slider',
    min: 60,
    max: 250,
    step: 1,
    defaultValue: 100
  },
  {
    id: 'ringNoise',
    label: 'Turbulence',
    description: 'Organic distortion applied to the ring edges',
    group: 'Tab Loop',
    type: 'button-group',
    options: [
      { value: 0, label: 'Off' },
      { value: 33, label: 'Low' },
      { value: 66, label: 'Med' },
      { value: 99, label: 'High' }
    ],
    defaultValue: 0,
    onChange(value) {
      // Skip during settings load — the JSON contains the correct individual values
      if (typeof app !== 'undefined' && app && app.isLoadingSettings) return;
      stateManager.set('ringInnerNoise', value);
      stateManager.set('ringOuterNoise', value);
      const scaleMap = { 0: 0.5, 33: 0.5, 66: 0.6, 99: 0.8 };
      stateManager.set('ringNoiseScale', scaleMap[value] ?? 0.5);
    }
  },
  {
    id: 'ringInnerNoise',
    label: 'Inner Turbulence',
    group: 'Tab Loop',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'ringOuterNoise',
    label: 'Outer Turbulence',
    group: 'Tab Loop',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'ringNoiseScale',
    label: 'Turbulence Scale',
    group: 'Tab Loop',
    type: 'slider',
    min: 0.1,
    max: 10,
    step: 0.1,
    defaultValue: 0.5,
    hidden: true
  },
  {
    id: 'ringNoiseSeed',
    label: 'Turbulence Seed',
    description: 'Random seed for turbulence pattern generation',
    group: 'Tab Loop',
    type: 'number',
    min: 0,
    max: 1000,
    step: 1,
    defaultValue: 0
  },
  {
    id: 'velocityPushAmount',
    label: 'Velocity Push',
    group: 'Tab Loop',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 5,
    hidden: true
  },
  {
    id: 'pushDecay',
    label: 'Push Decay',
    group: 'Tab Loop',
    type: 'slider',
    min: 0.8,
    max: 0.99,
    step: 0.01,
    defaultValue: 0.92,
    hidden: true
  },

  // Colour Input parameters (preset video source)
  {
    id: 'colourSource',
    label: 'Colour Input',
    description: 'Preset colour palette to sample from',
    group: 'Colour Input',
    type: 'select',
    options: [
      { value: '1', label: 'Colour 1' },
      { value: '2', label: 'Colour 2' },
      { value: '3', label: 'Colour 3' }
    ],
    defaultValue: '1',
    hidden: true
  },
  {
    id: 'colourPosition',
    label: 'Layout Shift',
    description: 'Scrub position within the colour source',
    group: 'Colour',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.001,
    defaultValue: 0,
    hidden: false
  },
  {
    id: 'hmOrigAmount',
    label: 'Color Offset',
    description: 'Strength of the colour-shift effect',
    group: 'Colour Input',
    type: 'slider',
    min: 10,
    max: 100,
    step: 1,
    defaultValue: 24,
    hidden: true
  },

  // ── Video Color Blend ──
  {
    id: 'videoBlendEnabled',
    label: 'Video Color Blend',
    description: 'Blend original video colour over the processed result',
    group: 'Colour Input',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'videoBlendMode',
    label: 'Blend Mode',
    description: 'How the video colour is composited',
    group: 'Colour Input',
    type: 'select',
    options: [
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'pin-light', label: 'Pin Light' },
      { value: 'hard-mix', label: 'Hard Mix' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'divide', label: 'Divide' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'xor', label: 'XOR' },
      { value: 'average', label: 'Average' },
      { value: 'grain-extract', label: 'Grain Extract' },
      { value: 'grain-merge', label: 'Grain Merge' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'multiply',
    hidden: true
  },
  {
    id: 'videoBlendAmount',
    label: 'Blend Amount',
    description: 'Strength of the video colour blend',
    group: 'Colour Input',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    hidden: true
  },

  // Image Sampler parameters
  {
    id: 'invertImage',
    label: 'Invert',
    description: 'Invert the colours of the input image/video',
    group: 'Image Sampler',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'imageHueOffset',
    label: 'Hue Offset',
    description: 'Shift the hue of the sampled image/video colours',
    group: 'Image Sampler',
    type: 'slider',
    min: -180,
    max: 180,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'imageSource',
    label: 'Image',
    group: 'Image Sampler',
    type: 'image',
    defaultValue: null,
    hidden: true
  },
  {
    id: 'videoScrub',
    label: 'Video Position',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 100,
    step: 0.1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'imageSamplerEnabled',
    label: 'Enable Image',
    group: 'Image Sampler',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'imageMappingMode',
    label: 'Mapping Mode',
    group: 'Image Sampler',
    type: 'select',
    options: [
      { value: 'stretch', label: 'Stretch' },
      { value: 'fit', label: 'Fit' },
      { value: 'tile', label: 'Tile' }
    ],
    defaultValue: 'stretch',
    hidden: true
  },
  {
    id: 'imagePositionX',
    label: 'Position X',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 53,
    hidden: true
  },
  {
    id: 'imagePositionY',
    label: 'Position Y',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 52,
    hidden: true
  },
  {
    id: 'imageScaleX',
    label: 'Scale X',
    group: 'Image Sampler',
    type: 'slider',
    min: 10,
    max: 300,
    step: 1,
    defaultValue: 223,
    hidden: true
  },
  {
    id: 'imageScaleY',
    label: 'Scale Y',
    group: 'Image Sampler',
    type: 'slider',
    min: 10,
    max: 300,
    step: 1,
    defaultValue: 239,
    hidden: true
  },
  {
    id: 'imageRotation',
    label: 'Rotation',
    group: 'Image Sampler',
    type: 'slider',
    min: -180,
    max: 180,
    step: 1,
    defaultValue: 87,
    hidden: true
  },
  {
    id: 'imageColorOpacity',
    label: 'Color Opacity',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 100,
    hidden: true
  },
  {
    id: 'imageBrightnessToScale',
    label: 'Brightness → Scale',
    group: 'Image Sampler',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'imageBrightnessScaleMin',
    label: 'Bright Scale Min',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 163,
    hidden: true
  },
  {
    id: 'imageBrightnessScaleMax',
    label: 'Bright Scale Max',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 400,
    step: 1,
    defaultValue: 237,
    hidden: true
  },
  {
    id: 'imageSaturationToScale',
    label: 'Saturation → Scale',
    group: 'Image Sampler',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'imageSaturationScaleMin',
    label: 'Sat Scale Min',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'imageSaturationScaleMax',
    label: 'Sat Scale Max',
    group: 'Image Sampler',
    type: 'slider',
    min: 0,
    max: 400,
    step: 1,
    defaultValue: 100,
    hidden: true
  },

  // ── Palette: Gradient Map master toggle ──
  {
    id: 'gradientMapEnabled',
    label: 'Gradient Map',
    description: 'Replace original colours with the custom gradient palette',
    group: 'Color Source',
    type: 'toggle',
    defaultValue: false,
    disabled: true,
    hidden: true
  },

  // ── Palette: Color Source ──
  {
    id: 'gradientInterp',
    label: 'Gradient Interp',
    description: 'Colour space used for gradient blending',
    group: 'Color Source',
    type: 'select',
    options: [
      { value: 'rgb', label: 'RGB' },
      { value: 'hsv-near', label: 'HSV Near' },
      { value: 'hsv-far', label: 'HSV Far' },
      { value: 'hsl-near', label: 'HSL Near' },
      { value: 'hsl-far', label: 'HSL Far' }
    ],
    defaultValue: 'rgb',
    disabled: true,
    hidden: true
  },
  {
    id: 'gradientSamples',
    label: 'Heatmap Samples',
    description: 'Number of discrete colour stops in the heatmap',
    group: 'Color Source',
    type: 'slider',
    min: 3,
    max: 20,
    step: 1,
    defaultValue: 3,
    disabled: true,
    hidden: true
  },

  // ── Palette: Mode ──
  {
    id: 'activeMode',
    label: 'Mode',
    group: 'Palette Mode',
    type: 'select',
    options: [
      { value: 'mode1', label: 'Turbulence Color' },
      { value: 'mode2', label: 'Size Heatmap' }
    ],
    defaultValue: 'mode1',
    disabled: true,
    hidden: true
  },

  // ── Palette: Turbulence Color ──
  {
    id: 'noiseScale',
    label: 'Scale',
    group: 'Noise Color',
    type: 'slider',
    min: 0.5,
    max: 30,
    step: 0.5,
    defaultValue: 0.5,
    disabled: true,
    hidden: true
  },
  {
    id: 'noiseOctaves',
    label: 'Detail',
    group: 'Noise Color',
    type: 'slider',
    min: 1,
    max: 8,
    step: 1,
    defaultValue: 1,
    disabled: true,
    hidden: true
  },
  {
    id: 'noisePersist',
    label: 'Roughness',
    group: 'Noise Color',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    disabled: true,
    hidden: true
  },
  {
    id: 'noiseLac',
    label: 'Lacunarity',
    group: 'Noise Color',
    type: 'slider',
    min: 1,
    max: 4,
    step: 0.1,
    defaultValue: 1,
    disabled: true,
    hidden: true
  },
  {
    id: 'noiseSeedX',
    label: 'Seed X',
    group: 'Noise Color',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    disabled: true,
    hidden: true
  },
  {
    id: 'noiseSeedY',
    label: 'Seed Y',
    group: 'Noise Color',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    disabled: true,
    hidden: true
  },
  {
    id: 'noiseLightFreq',
    label: 'Lightness Freq',
    group: 'Noise Color',
    type: 'slider',
    min: 0.5,
    max: 5,
    step: 0.1,
    defaultValue: 0.5,
    disabled: true,
    hidden: true
  },

  // ── Palette: Size Heatmap ──
  {
    id: 'heatmapInterp',
    label: 'Interpolation',
    group: 'Size Heatmap',
    type: 'select',
    options: [
      { value: 'smooth', label: 'Smooth' },
      { value: 'step', label: 'Stepped' }
    ],
    defaultValue: 'smooth',
    disabled: true,
    hidden: true
  },
  {
    id: 'heatmapInvert',
    label: 'Invert Size',
    group: 'Size Heatmap',
    type: 'toggle',
    defaultValue: false,
    disabled: true,
    hidden: true
  },

  // ── Hue Layer ──
  {
    id: 'hueLayerEnabled',
    label: 'Hue Layer',
    description: 'Composite a hue-shifted copy over the base colour',
    group: 'Hue Layer',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'hueLayerOffset',
    label: 'Hue Offset',
    description: 'Hue shift applied to the duplicate layer',
    group: 'Colour',
    type: 'slider',
    min: -180,
    max: 180,
    step: 1,
    defaultValue: -5,
    hidden: false
  },
  {
    id: 'hueLayerBlend',
    label: 'Blend Mode',
    description: 'How the shifted layer composites onto the base',
    group: 'Hue Layer',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'darker-color', label: 'Darker Color' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'divide', label: 'Divide' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'average', label: 'Average' },
      { value: 'grain-extract', label: 'Grain Extract' },
      { value: 'grain-merge', label: 'Grain Merge' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'hue',
    hidden: true
  },
  {
    id: 'hueLayerOpacity',
    label: 'Opacity',
    description: 'Strength of the composited hue layer',
    group: 'Hue Layer',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 59,
    hidden: true
  },

  // ── Color Offset (only Amount slider visible) ──
  {
    id: 'origInterferenceEnabled',
    label: 'Enable Interference',
    group: 'Color Offset',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'hmOrigDriver',
    label: 'Sample From Original',
    group: 'Color Offset',
    type: 'select',
    options: [
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'luminance', label: 'Luminance' }
    ],
    defaultValue: 'saturation',
    hidden: true
  },
  {
    id: 'hmOutputDriver',
    label: 'Sample From Output',
    group: 'Color Offset',
    type: 'select',
    options: [
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'luminance', label: 'Luminance' }
    ],
    defaultValue: 'saturation',
    hidden: true
  },
  {
    id: 'hmOrigMix',
    label: 'Mix Mode',
    group: 'Color Offset',
    type: 'select',
    options: [
      { value: 'offset', label: 'Offset' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'wrap', label: 'Wrap' },
      { value: 'xor', label: 'XOR Fold' }
    ],
    defaultValue: 'wrap',
    hidden: true
  },
  {
    id: 'hmOrigQuant',
    label: 'Quantize',
    group: 'Color Offset',
    type: 'slider',
    min: 0,
    max: 7,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Yellow → Green Remap (hidden) ──
  {
    id: 'hueRemapEnabled',
    label: 'Enable',
    group: 'Yellow → Green',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'hueRemapStart',
    label: 'Range Start',
    group: 'Yellow → Green',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 25,
    hidden: true
  },
  {
    id: 'hueRemapEnd',
    label: 'Range End',
    group: 'Yellow → Green',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 70,
    hidden: true
  },
  {
    id: 'hueRemapStrength',
    label: 'Strength',
    group: 'Yellow → Green',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 37,
    hidden: true
  },
  {
    id: 'hueRemapSatOffset',
    label: 'Sat Offset',
    group: 'Yellow → Green',
    type: 'slider',
    min: -50,
    max: 50,
    step: 1,
    defaultValue: -28,
    hidden: true
  },
  {
    id: 'hueRemapLightOffset',
    label: 'Light Offset',
    group: 'Yellow → Green',
    type: 'slider',
    min: -50,
    max: 50,
    step: 1,
    defaultValue: 15,
    hidden: true
  },
  {
    id: 'hueRemapFalloff',
    label: 'Falloff',
    description: 'Degrees of soft fade at the edges of the hue range',
    group: 'Yellow → Green',
    type: 'slider',
    min: 0,
    max: 60,
    step: 1,
    defaultValue: 15,
    hidden: true
  },

  // ── Orange → Red Remap (hidden) ──
  {
    id: 'hueRemap2Enabled',
    label: 'Enable',
    group: 'Orange → Red',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'hueRemap2Start',
    label: 'Range Start',
    group: 'Orange → Red',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'hueRemap2End',
    label: 'Range End',
    group: 'Orange → Red',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 14,
    hidden: true
  },
  {
    id: 'hueRemap2Strength',
    label: 'Strength',
    group: 'Orange → Red',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 37,
    hidden: true
  },
  {
    id: 'hueRemap2Target',
    label: 'Target Hue',
    group: 'Orange → Red',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 321,
    hidden: true
  },
  {
    id: 'hueRemap2SatOffset',
    label: 'Sat Offset',
    group: 'Orange → Red',
    type: 'slider',
    min: -50,
    max: 50,
    step: 1,
    defaultValue: 1,
    hidden: true
  },
  {
    id: 'hueRemap2LightOffset',
    label: 'Light Offset',
    group: 'Orange → Red',
    type: 'slider',
    min: -50,
    max: 50,
    step: 1,
    defaultValue: -2,
    hidden: true
  },
  {
    id: 'hueRemap2Falloff',
    label: 'Falloff',
    description: 'Degrees of soft fade at the edges of the hue range',
    group: 'Orange → Red',
    type: 'slider',
    min: 0,
    max: 60,
    step: 1,
    defaultValue: 15,
    hidden: true
  },

  // ── Hue Gradient Map ──
  {
    id: 'hueGradMapEnabled',
    label: 'Enable',
    description: 'Remap the colour wheel through a gradient of palette colours',
    group: 'Hue Gradient Map',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'hueGradMapStrength',
    label: 'Strength',
    description: 'How strongly the hue gradient map replaces the original colour',
    group: 'Hue Gradient Map',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 100,
    hidden: true
  },
  {
    id: 'hueGradMapPreserveLight',
    label: 'Preserve Lightness',
    description: 'Keep the original lightness instead of using the gradient colour lightness',
    group: 'Hue Gradient Map',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'hueGradMapPhase',
    label: 'Phase',
    description: 'Shift the gradient map along the hue wheel (wraps around)',
    group: 'Hue Gradient Map',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Color Fade ──
  {
    id: 'colorFadeEnabled',
    label: 'Fade to Color',
    description: 'Blend low-saturation areas toward a target colour',
    group: 'Color Fade',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'colorFadeDriver',
    label: 'Driven By',
    group: 'Color Fade',
    type: 'select',
    options: [
      { value: 'luminance', label: 'Luminance' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'hue', label: 'Hue' }
    ],
    defaultValue: 'hue',
    hidden: true
  },
  {
    id: 'colorFadeTarget',
    label: 'Target Color',
    group: 'Color Fade',
    type: 'color',
    defaultValue: '#C4C3BB',
    hidden: true
  },
  {
    id: 'cfFadeRange',
    label: 'Fade Range',
    group: 'Color Fade',
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    startKey: 'cfFadeStart',
    endKey: 'cfFadeEnd',
    startDefault: 0,
    endDefault: 28,
    hidden: true
  },
  {
    id: 'cfStrength',
    label: 'Strength',
    group: 'Color Fade',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 100,
    hidden: true
  },
  {
    id: 'cfBlendMode',
    label: 'Blend Mode',
    group: 'Color Fade',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'normal',
    hidden: true
  },
  {
    id: 'cfHueOffset',
    label: 'Offset',
    description: 'Shift the driver value to target a different region',
    group: 'Color Fade',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Color Fade 2 ──
  {
    id: 'colorFade2Enabled',
    label: 'Fade to Color',
    description: 'Second color fade pass with independent driver and range',
    group: 'Color Fade 2',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'colorFade2Driver',
    label: 'Driven By',
    group: 'Color Fade 2',
    type: 'select',
    options: [
      { value: 'luminance', label: 'Luminance' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'hue', label: 'Hue' }
    ],
    defaultValue: 'luminance',
    hidden: true
  },
  {
    id: 'colorFade2Target',
    label: 'Target Color',
    group: 'Color Fade 2',
    type: 'color',
    defaultValue: '#1a1a1a',
    hidden: true
  },
  {
    id: 'cf2FadeRange',
    label: 'Fade Range',
    group: 'Color Fade 2',
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    startKey: 'cf2FadeStart',
    endKey: 'cf2FadeEnd',
    startDefault: 0,
    endDefault: 30,
    hidden: true
  },
  {
    id: 'cf2Strength',
    label: 'Strength',
    group: 'Color Fade 2',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    hidden: true
  },
  {
    id: 'cf2BlendMode',
    label: 'Blend Mode',
    group: 'Color Fade 2',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'normal',
    hidden: true
  },
  {
    id: 'cf2HueOffset',
    label: 'Offset',
    description: 'Shift the driver value to target a different region',
    group: 'Color Fade 2',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Color Fade 3 ──
  {
    id: 'colorFade3Enabled',
    label: 'Fade to Color',
    description: 'Third color fade pass with independent driver and range',
    group: 'Color Fade 3',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'colorFade3Driver',
    label: 'Driven By',
    group: 'Color Fade 3',
    type: 'select',
    options: [
      { value: 'luminance', label: 'Luminance' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'hue', label: 'Hue' }
    ],
    defaultValue: 'saturation',
    hidden: true
  },
  {
    id: 'colorFade3Target',
    label: 'Target Color',
    group: 'Color Fade 3',
    type: 'color',
    defaultValue: '#1a1a1a',
    hidden: true
  },
  {
    id: 'cf3FadeRange',
    label: 'Fade Range',
    group: 'Color Fade 3',
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    startKey: 'cf3FadeStart',
    endKey: 'cf3FadeEnd',
    startDefault: 0,
    endDefault: 30,
    hidden: true
  },
  {
    id: 'cf3Strength',
    label: 'Strength',
    group: 'Color Fade 3',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    hidden: true
  },
  {
    id: 'cf3BlendMode',
    label: 'Blend Mode',
    group: 'Color Fade 3',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'normal',
    hidden: true
  },
  {
    id: 'cf3HueOffset',
    label: 'Offset',
    description: 'Shift the driver value to target a different region',
    group: 'Color Fade 3',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Color Fade 4 ──
  {
    id: 'colorFade4Enabled',
    label: 'Fade to Color',
    description: 'Fourth color fade pass with independent driver and range',
    group: 'Color Fade 4',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'colorFade4Driver',
    label: 'Driven By',
    group: 'Color Fade 4',
    type: 'select',
    options: [
      { value: 'luminance', label: 'Luminance' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'hue', label: 'Hue' }
    ],
    defaultValue: 'hue',
    hidden: true
  },
  {
    id: 'colorFade4Target',
    label: 'Target Color',
    group: 'Color Fade 4',
    type: 'color',
    defaultValue: '#1a1a1a',
    hidden: true
  },
  {
    id: 'cf4FadeRange',
    label: 'Fade Range',
    group: 'Color Fade 4',
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    startKey: 'cf4FadeStart',
    endKey: 'cf4FadeEnd',
    startDefault: 0,
    endDefault: 30,
    hidden: true
  },
  {
    id: 'cf4Strength',
    label: 'Strength',
    group: 'Color Fade 4',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    hidden: true
  },
  {
    id: 'cf4BlendMode',
    label: 'Blend Mode',
    group: 'Color Fade 4',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'normal',
    hidden: true
  },
  {
    id: 'cf4HueOffset',
    label: 'Offset',
    description: 'Shift the driver value to target a different region',
    group: 'Color Fade 4',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Color Space ──
  {
    id: 'colorSpace',
    label: 'Color Space',
    description: 'Working color space for hue/saturation/lightness operations',
    group: 'Color Grade',
    type: 'select',
    options: [
      { value: 'hsl', label: 'HSL' },
      { value: 'oklch', label: 'OKLCH' }
    ],
    defaultValue: 'oklch',
    hidden: true
  },

  // ── Color Grade ──
  {
    id: 'colorGradeEnabled',
    label: 'Enable Color Grade',
    group: 'Color Grade',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'gradeBlend',
    label: 'Blend Mode',
    group: 'Color Grade',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'vivid-light', label: 'Vivid Light' },
      { value: 'linear-light', label: 'Linear Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'linear-burn', label: 'Linear Burn' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'divide', label: 'Divide' },
      { value: 'difference', label: 'Difference' },
      { value: 'exclusion', label: 'Exclusion' },
      { value: 'average', label: 'Average' },
      { value: 'grain-extract', label: 'Grain Extract' },
      { value: 'grain-merge', label: 'Grain Merge' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'saturation',
    hidden: true
  },
  {
    id: 'gradeTemp',
    label: 'Temperature',
    group: 'Color Grade',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: -9,
    hidden: true
  },
  {
    id: 'gradeTint',
    label: 'Tint',
    group: 'Color Grade',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: -95,
    hidden: true
  },
  {
    id: 'gradeSat',
    label: 'Saturation',
    group: 'Color Grade',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 62,
    hidden: true
  },
  {
    id: 'gradeExp',
    label: 'Exposure',
    group: 'Color Grade',
    type: 'slider',
    min: -300,
    max: 300,
    step: 1,
    defaultValue: -4,
    hidden: true
  },
  {
    id: 'gradeContrast',
    label: 'Contrast',
    group: 'Color Grade',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 15,
    hidden: true
  },
  {
    id: 'gradeHigh',
    label: 'Highlights',
    group: 'Color Grade',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: -46,
    hidden: true
  },
  {
    id: 'gradeShadow',
    label: 'Shadows',
    group: 'Color Grade',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: -37,
    hidden: true
  },

  // ── Image Adjust ──
  {
    id: 'imgAdjVibrancy',
    label: 'Vibrancy',
    description: 'Boost saturation of muted colours without oversaturating vivid ones',
    group: 'Image Adjust',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 14,
    hidden: true
  },
  {
    id: 'imgAdjBrightness',
    label: 'Brightness',
    description: 'Shift overall brightness',
    group: 'Image Adjust',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: -1,
    hidden: true
  },
  {
    id: 'imgAdjContrast',
    label: 'Contrast',
    description: 'Increase or decrease tonal range',
    group: 'Image Adjust',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Hue Exclusion ──
  {
    id: 'hueExcludeEnabled',
    label: 'Hue Exclusion',
    description: 'Remove a slice of the hue wheel and close the gap naturally',
    group: 'Hue Exclusion',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'hueExcludeStart',
    label: 'Zone Start',
    description: 'Start of the excluded hue range (degrees)',
    group: 'Hue Exclusion',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 55,
    hidden: true
  },
  {
    id: 'hueExcludeEnd',
    label: 'Zone End',
    description: 'End of the excluded hue range (degrees)',
    group: 'Hue Exclusion',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 92,
    hidden: true
  },

  // ── Hue Convergence ──
  {
    id: 'hueConvergenceStrength',
    label: 'Hue Convergence',
    description: 'Shift all hues toward the dominant on-screen hue',
    group: 'Colour',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0
  },

];
