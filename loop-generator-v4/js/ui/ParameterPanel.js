/**
 * ParameterPanel - Loop Generator v3
 * Extends shared base with gradient/curves editors, randomizer, and palette save/load.
 */
class ParameterPanel extends ParameterPanelBase {
  _initEditors() {
    this.gradientEditor = new GradientEditor();
    this.hueGradMapEditor = new GradientEditor({ stopsKey: '_hueGradMapStops' });
    this.curvesEditor = new CurvesEditor();
  }

  _getSubtitle() { return 'Loop Generator'; }
  _getExportPrefix() { return 'motion-export'; }
  _getSettingsFilePrefix() { return 'motion-settings'; }

  _getPaletteKeys() {
    return ['customGradientStops', 'hueGradMapStops', 'curvePoints', 'heatmapColorOrder'];
  }

  _getExtraSettingsData() {
    const extra = {};
    if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      extra.customGradientStops = JSON.parse(JSON.stringify(paletteProcessor._customGradientStops));
      extra.hueGradMapStops = JSON.parse(JSON.stringify(paletteProcessor._hueGradMapStops));
      if (paletteProcessor._curvePoints) {
        extra.curvePoints = JSON.parse(JSON.stringify(paletteProcessor._curvePoints));
      }
      extra.heatmapColorOrder = [...paletteProcessor._heatmapColorOrder];
    }
    return extra;
  }

  _onRenderContent(content) {
    requestAnimationFrame(() => this._injectEditors(content));
  }

  _injectEditors(content) {
    const groups = content.querySelectorAll('.parameter-group');
    groups.forEach(group => {
      const title = group.querySelector('.parameter-group__title');
      if (!title) return;
      const name = title.textContent.trim();

      if (name === 'Color Source') {
        const gc = group.querySelector('.parameter-group__content');
        if (gc) this.gradientEditor.build(gc);
      }
      if (name === 'Hue Gradient Map') {
        const gc = group.querySelector('.parameter-group__content');
        if (gc) this.hueGradMapEditor.build(gc);
      }
      if (name === 'Color Grade') {
        const gc = group.querySelector('.parameter-group__content');
        if (gc) this.curvesEditor.build(gc);
      }
    });
  }

  _buildRandomizerRow() {
    const randBar = document.createElement('div');
    randBar.className = 'settings-bar settings-bar--randomizer';

    const randBtn = document.createElement('button');
    randBtn.className = 'settings-bar__btn settings-bar__btn--randomize';
    randBtn.textContent = 'Randomize';

    randBtn.addEventListener('click', () => {
      const lowPct = 0.2;
      const highPct = 0.8;

      this.parameters.forEach((param) => {
        if (param.locked) return;
        if (param.hidden) return;
        if (param.type !== 'slider' && param.type !== 'number' && param.type !== 'button-group') return;

        if (param.type === 'button-group') {
          const opts = param.options;
          const pick = opts[Math.floor(Math.random() * opts.length)];
          param.setValue(pick.value);
          if (param._buttonRow) {
            param._buttonRow.querySelectorAll('.parameter__group-btn').forEach(b => {
              b.classList.toggle('parameter__group-btn--active', String(b.dataset.value) === String(pick.value));
            });
          }
          return;
        }

        const range = param.max - param.min;
        const minVal = param.min + range * lowPct;
        const maxVal = param.min + range * highPct;
        const steps = Math.round((maxVal - minVal) / param.step);
        const randomSteps = Math.floor(Math.random() * (steps + 1));
        const val = parseFloat((minVal + randomSteps * param.step).toFixed(10));
        const clamped = Math.max(param.min, Math.min(param.max, val));

        param.setValue(clamped);
        stateManager.set(param.id, clamped);

        const el = document.getElementById(param.id);
        if (el) {
          el.value = clamped;
          const container = el.closest('.parameter');
          const display = container ? container.querySelector('.parameter__value') : null;
          if (display) display.textContent = clamped;
        }
      });

      // Also randomize hidden hue offset (full range)
      const hueOffset = Math.floor(Math.random() * 361) - 180;
      stateManager.set('imageHueOffset', hueOffset);
      const hueParam = this.parameters.get('imageHueOffset');
      if (hueParam) hueParam.setValue(hueOffset);
    });

    randBar.appendChild(randBtn);
    return randBar;
  }

  _processLoadedSettings(settings) {
    // Detect palette tool JSON vs motion graphics settings JSON
    if (typeof PaletteProcessor !== 'undefined' && PaletteProcessor.isPaletteJSON(settings)) {
      if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
        paletteProcessor.loadSettings(settings);
        stateManager.set('colorMode', true);
        const toggle = document.getElementById('colorMode');
        if (toggle) toggle.checked = true;
        this.gradientEditor.refresh();
        this.hueGradMapEditor.refresh();
        this.curvesEditor.refresh();
        console.log('Palette settings loaded from JSON');
      }
    } else {
      this._applySettings(settings);
      // Restore custom editor data if present
      if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
        if (settings.customGradientStops) {
          paletteProcessor._customGradientStops = settings.customGradientStops;
        }
        if (settings.hueGradMapStops) {
          paletteProcessor._hueGradMapStops = settings.hueGradMapStops;
        }
        if (settings.heatmapColorOrder) {
          paletteProcessor._heatmapColorOrder = settings.heatmapColorOrder;
        }
        if (settings.curvePoints) {
          paletteProcessor._curvePoints = settings.curvePoints;
          const defaultCurve = [{x:0,y:0}, {x:1,y:1}];
          for (const ch of ['master', 'red', 'green', 'blue']) {
            paletteProcessor._curveLUTs[ch] = paletteProcessor._buildCurveLUT(
              settings.curvePoints[ch] || defaultCurve
            );
          }
        }
      }
      this.gradientEditor.refresh();
      this.curvesEditor.refresh();
      console.log('Settings loaded successfully');
    }
  }

  _onSettingsApplied(settings) {
    // Reset manual scale offsets from click+drag adjustments
    if (typeof app !== 'undefined' && app && app.renderer) {
      app.renderer.resetManualScaleOffsets();
    }
    // Pause after loading so the user sees the restored state
    if (typeof app !== 'undefined' && app && !app.isPaused) {
      app.isPaused = true;
      if (app.renderer) app.renderer.setPaused(true);
      if (typeof cursorTracker !== 'undefined' && cursorTracker) cursorTracker.freeze();
      if (typeof imageSampler !== 'undefined' && imageSampler && imageSampler.hasVideo()) imageSampler.pause();
    }
  }
}
