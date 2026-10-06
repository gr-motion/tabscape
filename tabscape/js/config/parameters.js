/**
 * Parameter Configuration
 * Define all parameters for the application here
 * Easy to add new parameters - just add to this array
 */
const PARAMETER_CONFIG = [
  // ── Scope ──
  {
    id: 'extendScope',
    label: 'Extend Scope',
    description: 'Extends all slider ranges by x3. Use with care.',
    group: 'Scope',
    type: 'toggle',
    defaultValue: false
  },

  // ── Tabs ──
  {
    id: 'gridDensity',
    label: 'Grid Density',
    description: 'Spacing between grid points in pixels',
    group: 'Tabs',
    type: 'slider',
    min: 10,
    max: 100,
    step: 1,
    defaultValue: 60
  },
  {
    id: 'scaleMin',
    label: 'Base Scale',
    description: 'Tab size at rest (no motion)',
    group: 'Tabs',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 150,
    defaultLocked: true
  },
  {
    id: 'imageBrightnessScaleMin',
    label: 'Scale Dark',
    description: 'Tab size at darkest brightness',
    group: 'Tabs',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 100,
    defaultLocked: true
  },
  {
    id: 'imageBrightnessScaleMax',
    label: 'Scale Light',
    description: 'Tab size at lightest brightness',
    group: 'Tabs',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 100,
    defaultLocked: true
  },
  // ── Mask ──
  {
    id: 'maskMode',
    label: 'Mask Mode',
    description: 'How the mask controls cell scale',
    group: 'Mask',
    type: 'select',
    options: [
      { value: 'tabloop', label: 'Tab Loop' },
      { value: 'custom', label: 'Custom' },
      { value: 'library', label: 'Library' }
    ],
    defaultValue: 'tabloop'
  },
  {
    id: 'maskCustomImage',
    label: 'Mask Image',
    description: 'Upload or drop an image to use as mask',
    group: 'Mask',
    type: 'image',
    targetSampler: 'maskSampler',
    enableStateKey: 'maskImageLoaded',
    dropZone: true,
    dropZoneText: 'Drop mask image here',
    defaultValue: null
  },
  {
    id: 'maskLibraryItem',
    label: 'Mask Image',
    description: 'Pick a shape from the mask library (SVG files in the mask_library folder)',
    group: 'Mask',
    type: 'mask-library',
    libraryPath: 'mask_library',
    buttonText: 'Choose from the library',
    enableStateKey: 'maskImageLoaded',
    defaultValue: null
  },
  {
    id: 'maskSyncWithTexture',
    label: 'Sync with Texture',
    description: 'Keep custom mask position and scale linked to the texture transform',
    group: 'Mask',
    type: 'toggle',
    defaultValue: true
  },
  {
    id: 'maskPositionX',
    label: 'Position X',
    description: 'Horizontal offset of the custom mask',
    group: 'Mask',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'maskPositionY',
    label: 'Position Y',
    description: 'Vertical offset of the custom mask',
    group: 'Mask',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'maskScale',
    label: 'Scale',
    description: 'Zoom level of the custom mask (aspect ratio locked)',
    group: 'Mask',
    type: 'slider',
    min: 10,
    max: 400,
    step: 1,
    defaultValue: 100,
    defaultLocked: true
  },
  {
    id: 'maskRotation',
    label: 'Rotate',
    description: 'Rotation of the custom mask in degrees',
    group: 'Mask',
    type: 'slider',
    min: -180,
    max: 180,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'maskChannel',
    label: 'Mask Channel',
    description: 'Which channel to read from the mask image',
    group: 'Mask',
    type: 'select',
    options: [
      { value: 'luminance', label: 'Luminance' },
      { value: 'alpha', label: 'Alpha' }
    ],
    defaultValue: 'alpha'
  },
  {
    id: 'maskInvert',
    label: 'Invert Mask',
    description: 'Flip the mask values',
    group: 'Mask',
    type: 'toggle',
    defaultValue: false
  },
  {
    id: 'maskRingRadius',
    label: 'Ring Radius',
    description: 'Distance from centre to ring midpoint',
    group: 'Mask',
    type: 'slider',
    min: 140,
    max: 230,
    step: 1,
    defaultValue: 200
  },
  {
    id: 'maskRingThickness',
    label: 'Ring Thickness',
    description: 'Width of the ring band',
    group: 'Mask',
    type: 'slider',
    min: 45,
    max: 200,
    step: 1,
    defaultValue: 100
  },
  {
    id: 'maskSoftness',
    label: 'Softness',
    description: 'GPU blur applied to the source mask image',
    group: 'Mask',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0
  },
  {
    id: 'maskInnerSoftness',
    label: 'Inner Softness',
    description: 'Feathering on the inner ring edge',
    group: 'Mask',
    type: 'slider',
    min: 60,
    max: 250,
    step: 1,
    defaultValue: 100
  },
  {
    id: 'maskOuterSoftness',
    label: 'Outer Softness',
    description: 'Feathering on the outer ring edge',
    group: 'Mask',
    type: 'slider',
    min: 60,
    max: 200,
    step: 1,
    defaultValue: 100
  },
  {
    id: 'maskNoise',
    label: 'Noise',
    description: 'Turbulence applied to ring edges',
    group: 'Mask',
    type: 'slider',
    min: 0,
    max: 99,
    step: 0.1,
    valueLabels: {
      0: 'Off',
      33: 'Low',
      66: 'Med',
      99: 'High'
    },
    defaultValue: 0
  },
  {
    id: 'maskNoiseEvolutionSpeed',
    label: 'Noise Evolution Speed',
    description: 'Speed of continuous ring noise evolution',
    group: 'Mask',
    type: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0
  },
  {
    id: 'maskNoiseSeed',
    label: 'Noise Seed',
    description: 'Random seed for noise pattern',
    group: 'Mask',
    type: 'number',
    min: 0,
    max: 1000,
    step: 1,
    defaultValue: 0
  },
  {
    id: 'maskRingInnerNoise',
    label: 'Inner Noise',
    group: 'Mask',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'maskRingOuterNoise',
    label: 'Outer Noise',
    group: 'Mask',
    type: 'slider',
    min: 0,
    max: 200,
    step: 1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'maskRingNoiseScale',
    label: 'Noise Scale',
    group: 'Mask',
    type: 'slider',
    min: 0.1,
    max: 10,
    step: 0.1,
    defaultValue: 0.5,
    hidden: true
  },

  // ── Texture ──
  {
    id: 'textureMode',
    label: 'Texture Mode',
    description: 'Controls the colour source for the grid',
    group: 'Texture',
    type: 'select',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'custom', label: 'Custom' }
    ],
    defaultValue: 'default'
  },
  {
    id: 'texturePlaybackSpeed',
    label: 'Texture Playback Speed',
    description: 'Playback speed for the texture video',
    group: 'Texture',
    type: 'slider',
    min: 0.45,
    max: 1,
    step: 0.01,
    valuePrefix: 'x',
    defaultValue: 1
  },
  {
    id: 'imageSource',
    label: 'Image',
    description: 'Upload an image or video to drive the pattern',
    group: 'Texture',
    type: 'image',
    dropZone: true,
    dropZoneText: 'Drop texture here',
    defaultValue: null
  },
  {
    id: 'videoScrub',
    label: 'Video Position',
    group: 'Texture',
    type: 'slider',
    min: 0,
    max: 100,
    step: 0.1,
    defaultValue: 0,
    hidden: true
  },
  {
    id: 'textureVisible',
    label: 'Texture Visible',
    description: 'Show texture colours on tabs. When off, renders black/white but texture still drives tab sizes',
    group: 'Texture',
    type: 'toggle',
    defaultValue: true,
    hidden: true
  },
  {
    id: 'fadeToGrey',
    label: 'Fade to Grey',
    description: 'Desaturate texture colours',
    group: 'Texture',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'backgroundColor',
    label: 'Background',
    description: 'Background colour behind the tab grid',
    group: 'Texture',
    type: 'color',
    defaultValue: '#FFFEF7',
    defaultLocked: true
  },
  {
    id: 'sizeFadeCurve',
    label: 'Size Fade Curve',
    description: 'Shape of the fade falloff. Low = fade kicks in only for very small shapes. High = aggressive fade across all sizes',
    group: 'Texture',
    type: 'slider',
    min: 10,
    max: 300,
    step: 1,
    defaultValue: 100,
    hidden: true
  },
  {
    id: 'colorRemapMode',
    label: 'Colour Remap',
    description: 'Colour processing mode for sampled textures',
    group: 'Texture',
    type: 'select',
    options: [
      { value: 'none', label: 'None' },
      { value: 'full', label: 'Full Range' },
      { value: 'duotone', label: 'Duo Tone' },
      { value: 'tritone', label: 'Tri Tone' }
    ],
    defaultValue: 'none'
  },
  {
    id: 'imageHueOffset',
    label: 'Hue Offset',
    description: 'Shift the hue of the sampled image/video colours',
    group: 'Texture',
    type: 'slider',
    min: -180,
    max: 180,
    step: 1,
    defaultValue: 0
  },
  {
    id: 'texturePositionX',
    label: 'Position X',
    description: 'Horizontal offset of the texture',
    group: 'Texture',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'texturePositionY',
    label: 'Position Y',
    description: 'Vertical offset of the texture',
    group: 'Texture',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'textureScale',
    label: 'Scale',
    description: 'Zoom level of the texture (aspect ratio locked)',
    group: 'Texture',
    type: 'slider',
    min: 10,
    max: 400,
    step: 1,
    defaultValue: 100,
    defaultLocked: true
  },
  {
    id: 'textureRotation',
    label: 'Rotate',
    description: 'Rotation of the texture in degrees',
    group: 'Texture',
    type: 'slider',
    min: -180,
    max: 180,
    step: 1,
    defaultValue: 0
  },
  {
    id: 'imageSaturationToScale',
    label: 'Saturation \u2192 Scale',
    group: 'Texture',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'imageSaturationScaleMin',
    label: 'Sat Scale Min',
    group: 'Texture',
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
    group: 'Texture',
    type: 'slider',
    min: 0,
    max: 400,
    step: 1,
    defaultValue: 100,
    hidden: true
  },

  // ── Fade to Color (hidden – controlled by fadeToGrey toggle) ──
  {
    id: 'postFadeEnabled',
    label: 'Fade to Color',
    description: 'Blend colours toward a target based on luminance, saturation, or hue',
    group: 'Fade to Color',
    type: 'toggle',
    defaultValue: false,
    hidden: true
  },
  {
    id: 'postFadeDriver',
    label: 'Driven By',
    group: 'Fade to Color',
    type: 'select',
    options: [
      { value: 'luminance', label: 'Luminance' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'hue', label: 'Hue' },
      { value: 'size', label: 'Size' }
    ],
    defaultValue: 'luminance',
    hidden: true
  },
  {
    id: 'postFadeTarget',
    label: 'Target Color',
    group: 'Fade to Color',
    type: 'color',
    defaultValue: '#C4C3BB',
    hidden: true
  },
  {
    id: 'postFadeStrength',
    label: 'Strength',
    description: 'Maximum fade amount at smallest scale',
    group: 'Fade to Color',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 100,
    hidden: true
  },
  {
    id: 'postFadeBlendMode',
    label: 'Blend Mode',
    group: 'Fade to Color',
    type: 'select',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' },
      { value: 'soft-light', label: 'Soft Light' },
      { value: 'hard-light', label: 'Hard Light' },
      { value: 'darken', label: 'Darken' },
      { value: 'lighten', label: 'Lighten' },
      { value: 'color-dodge', label: 'Color Dodge' },
      { value: 'color-burn', label: 'Color Burn' },
      { value: 'add', label: 'Add' },
      { value: 'difference', label: 'Difference' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'color', label: 'Color' },
      { value: 'luminosity', label: 'Luminosity' }
    ],
    defaultValue: 'normal',
    hidden: true
  },
  {
    id: 'postFadeOffset',
    label: 'Offset',
    description: 'Shift the driver value to target a different region',
    group: 'Fade to Color',
    type: 'slider',
    min: 0,
    max: 360,
    step: 1,
    defaultValue: 0,
    hidden: true
  },

  // ── Motion ──
  {
    id: 'loopTrim',
    label: 'Loop Duration',
    description: 'Portion of the source to use as the loop (value shown in seconds)',
    group: 'Motion',
    type: 'slider',
    min: 10,
    max: 100,
    step: 1,
    defaultValue: 100,
    defaultLocked: true
  },
  {
    id: 'scaleMax',
    label: 'Motion Scale',
    description: 'Tab size at maximum motion (additive — cannot go below Base Scale)',
    group: 'Motion',
    type: 'slider',
    min: 0,
    max: 500,
    step: 1,
    defaultValue: 150,
    defaultLocked: true,
    dynamicMinFrom: 'scaleMin'
  },
  {
    id: 'effectMode',
    label: 'Effect Mode',
    description: 'Switch between ripple and spring motion',
    group: 'Motion',
    type: 'select',
    options: [
      { value: 'ripple', label: 'Ripple' },
      { value: 'attractor', label: 'Spring' }
    ],
    defaultValue: 'ripple'
  },
  {
    id: 'brightnessVariance',
    label: 'Brightness Variance',
    description: 'Negative: darken small tabs. Positive: brighten large tabs. Centre = no change',
    group: 'Motion',
    type: 'slider',
    min: -100,
    max: 100,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'scaleHueRange',
    label: 'Hue Variance',
    description: 'Maximum hue shift in degrees at extreme scale values (0 = off)',
    group: 'Motion',
    type: 'slider',
    min: 0,
    max: 180,
    step: 1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'forceDriver',
    label: 'Force Driver',
    description: 'Drive forces from cursor or autonomous drivers',
    group: 'Motion',
    type: 'select',
    options: [
      { value: 'cursor', label: 'Cursor' },
      { value: 'null', label: 'Auto' }
    ],
    defaultValue: 'cursor'
  },
  {
    id: 'nullMode',
    label: 'Auto Mode',
    description: 'Noise: autonomous wandering drivers. Position: fixed position driver',
    group: 'Motion',
    type: 'select',
    options: [
      { value: 'noise', label: 'Noise' },
      { value: 'position', label: 'Position' }
    ],
    defaultValue: 'noise'
  },
  {
    id: 'noiseNullCount',
    label: 'Auto Count',
    description: 'Number of noise-driven force points',
    group: 'Motion',
    type: 'slider',
    min: 1,
    max: 8,
    step: 1,
    defaultValue: 1
  },
  {
    id: 'noiseNullFreq',
    label: 'Auto Frequency',
    description: 'Speed of auto driver wandering',
    group: 'Motion',
    type: 'slider',
    min: 0.01,
    max: 1,
    step: 0.01,
    defaultValue: 0.25
  },
  {
    id: 'noiseNullStrength',
    label: 'Auto Movement',
    description: 'Wander amplitude of auto drivers in pixels',
    group: 'Motion',
    type: 'slider',
    min: 100,
    max: 1000,
    step: 10,
    defaultValue: 250
  },
  {
    id: 'nullPositionX',
    label: 'Position X',
    description: 'Horizontal position of the auto driver (percentage of canvas width)',
    group: 'Motion',
    type: 'slider',
    min: -200,
    max: 300,
    step: 1,
    defaultValue: 50
  },
  {
    id: 'nullPositionY',
    label: 'Position Y',
    description: 'Vertical position of the auto driver (percentage of canvas height)',
    group: 'Motion',
    type: 'slider',
    min: -200,
    max: 300,
    step: 1,
    defaultValue: 50
  },
  {
    id: 'pushDecay',
    label: 'Push Decay',
    group: 'Motion',
    type: 'slider',
    min: 0.8,
    max: 0.99,
    step: 0.01,
    defaultValue: 0.8,
    hidden: true
  },
  {
    id: 'velocityPushAmount',
    label: 'Velocity Push',
    group: 'Motion',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 40,
    defaultLocked: true
  },
  {
    id: 'cursorRadius',
    label: 'Driver Radius',
    description: 'Size of the area affected by the driver',
    group: 'Motion',
    type: 'slider',
    min: 100,
    max: 1000,
    step: 10,
    defaultValue: 200,
    defaultLocked: true
  },
  {
    id: 'cursorFalloff',
    label: 'Cursor Falloff',
    description: 'Easing curve for cursor influence decay',
    group: 'Motion',
    type: 'select',
    hidden: true,
    options: [
      { value: 'linear', label: 'Linear' },
      { value: 'quadratic', label: 'Quadratic' },
      { value: 'smooth', label: 'Smooth' },
      { value: 'exponential', label: 'Exponential' }
    ],
    defaultValue: 'smooth'
  },
  // Attractor params
  {
    id: 'attractorRepulsion',
    label: 'Repulsion',
    description: 'Push force applied when cursor is nearby',
    group: 'Motion',
    type: 'slider',
    min: 50,
    max: 3000,
    step: 10,
    defaultValue: 100
  },
  {
    id: 'springDamping',
    label: 'Spring Damping',
    description: 'Friction that slows tabs returning to rest (lower = less bounce)',
    group: 'Motion',
    type: 'slider',
    min: 0.5,
    max: 0.99,
    step: 0.01,
    defaultValue: 0.75
  },
  {
    id: 'springStrength',
    label: 'Spring Strength',
    description: 'Force pulling tabs back to their home position',
    group: 'Motion',
    type: 'slider',
    min: 10,
    max: 500,
    step: 5,
    defaultValue: 80
  },
  // Pulse params
  {
    id: 'autoRippleRate',
    label: 'Auto Pulse Rate',
    description: 'Pulses per second spawned by each auto driver (0 = off)',
    group: 'Motion',
    type: 'slider',
    min: 0,
    max: 5,
    step: 0.1,
    defaultValue: 0,
    defaultLocked: true
  },
  {
    id: 'rippleSpeed',
    label: 'Pulse Speed',
    description: 'How fast pulses expand outward',
    group: 'Motion',
    type: 'slider',
    min: 50,
    max: 700,
    step: 10,
    defaultValue: 300,
    defaultLocked: true
  },
  {
    id: 'rippleWidth',
    label: 'Pulse Width',
    description: 'Thickness of each pulse wavefront',
    group: 'Motion',
    type: 'slider',
    min: 20,
    max: 400,
    step: 5,
    defaultValue: 110,
    defaultLocked: true
  },
  {
    id: 'rippleDecay',
    label: 'Pulse Decay',
    description: 'How quickly ripples fade over time',
    group: 'Motion',
    type: 'slider',
    min: 0.1,
    max: 3,
    step: 0.1,
    defaultValue: 2,
    defaultLocked: true
  },
  {
    id: 'pulseStrength',
    label: 'Pulse Strength',
    description: 'How much the pulse boosts spring targets',
    group: 'Motion',
    type: 'slider',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50
  },
  {
    id: 'loopDuration',
    label: 'Loop Duration (s)',
    group: 'Motion',
    type: 'slider',
    min: 0,
    max: 60,
    step: 0.1,
    defaultValue: 0,
    hidden: true
  },

];
