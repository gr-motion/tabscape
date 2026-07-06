/**
 * ParameterPanelBase - Shared base class for the parameter panel UI.
 * Tool-specific subclasses extend this and override hook methods.
 */
class ParameterPanelBase {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.parameters = new Map();
    this.groups = new Map();
    this._initEditors();
  }

  // -- Hook methods (override in subclasses) ---------------------

  _initEditors() {}
  _getSubtitle() { return 'Tool'; }
  _getExportPrefix() { return 'export'; }
  _getSettingsFilePrefix() { return 'settings'; }
  _onRenderContent(content) {}
  _buildRandomizerRow() { return null; }
  _getExtraSettingsData() { return {}; }
  _getPaletteKeys() { return []; }
  _onSettingsApplied(settings) {}

  _processLoadedSettings(settings) {
    this._applySettings(settings);
    console.log('Settings loaded successfully');
  }

  _buildExportRow(cardBody) {
    const exportBar = document.createElement('div');
    exportBar.className = 'settings-bar settings-bar--export';

    const exportSvgBtn = document.createElement('button');
    exportSvgBtn.className = 'settings-bar__btn settings-bar__btn--export-action';
    exportSvgBtn.textContent = 'SVG';
    exportSvgBtn.addEventListener('click', () => this._exportSVG());

    const exportPngBtn = document.createElement('button');
    exportPngBtn.className = 'settings-bar__btn settings-bar__btn--export-action';
    exportPngBtn.textContent = 'PNG';
    exportPngBtn.addEventListener('click', () => this._exportPNG());

    const resSelect = document.createElement('select');
    resSelect.className = 'settings-bar__select';
    resSelect.id = 'exportResolution';
    for (const size of [1024, 2048, 4096, 8192]) {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size + 'px';
      if (size === 4096) opt.selected = true;
      resSelect.appendChild(opt);
    }

    exportBar.appendChild(exportSvgBtn);
    exportBar.appendChild(exportPngBtn);
    exportBar.appendChild(resSelect);

    const exportsLabel = document.createElement('div');
    exportsLabel.className = 'settings-bar__label settings-bar__label--exports';
    exportsLabel.textContent = 'Exports';

    cardBody.appendChild(exportsLabel);
    cardBody.appendChild(exportBar);
  }

  // -- Core methods ----------------------------------------------

  registerParameters(configs) {
    configs.forEach(config => {
      const param = ParameterFactory.create(config);
      this.parameters.set(config.id, param);
      stateManager.set(config.id, param.value);

      if (config.type === 'range' && config.startKey && config.endKey) {
        stateManager.set(config.startKey, config.startDefault ?? config.min ?? 0);
        stateManager.set(config.endKey, config.endDefault ?? config.max ?? 100);
      }

      const groupName = config.group || 'General';
      if (!this.groups.has(groupName)) {
        this.groups.set(groupName, []);
      }
      this.groups.get(groupName).push(param);
    });
  }

  render() {
    this.container.innerHTML = '';

    // Header card
    const header = document.createElement('div');
    header.className = 'panel__header';
    header.dataset.squircle = '20';
    header.innerHTML =
      '<img class="panel__header-logo" src="/_assets/Opera_Logo.svg" alt="Opera">' +
      '<img class="card__chevron" src="/_assets/chevron_down.svg" alt="">' +
      '<div class="card__body">' +
        '<h2>Tabscape</h2>' +
        '<div class="panel__header-subtitle">' + this._getSubtitle() + '</div>' +
      '</div>';
    header.querySelector('.card__chevron').addEventListener('click', () => {
      header.classList.toggle('card--collapsed');
    });
    this.container.appendChild(header);

    // Settings card
    const settingsBar = this._createSettingsBar();
    this.container.appendChild(settingsBar);

    // Scrollable parameter content
    const content = document.createElement('div');
    content.className = 'panel__content';

    this.groups.forEach((params, groupName) => {
      const visibleParams = params.filter(p => !p.hidden);
      if (visibleParams.length === 0) return;
      const group = this._createGroup(groupName, params);
      content.appendChild(group);
    });

    this.container.appendChild(content);
    this._onRenderContent(content);

    // Sync inverted theme with UI
    stateManager.subscribe('invertColors', (inverted) => {
      document.documentElement.classList.toggle('inverted', !!inverted);
    });
  }

  _createSettingsBar() {
    const wrapper = document.createElement('div');
    wrapper.className = 'settings-wrapper';
    wrapper.dataset.squircle = '20';

    // Settings title
    const settingsTitle = document.createElement('div');
    settingsTitle.className = 'settings-bar__label';
    settingsTitle.textContent = 'Settings';

    // Chevron
    const chevron = document.createElement('img');
    chevron.className = 'card__chevron';
    chevron.src = '/_assets/chevron_down.svg';
    chevron.alt = '';
    chevron.addEventListener('click', () => {
      wrapper.classList.toggle('card--collapsed');
    });

    // Save/Load bar
    const bar = document.createElement('div');
    bar.className = 'settings-bar';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'settings-bar__btn';
    saveBtn.textContent = 'Save Settings';
    saveBtn.addEventListener('click', () => this._saveSettings());

    const loadBtn = document.createElement('button');
    loadBtn.className = 'settings-bar__btn';
    loadBtn.textContent = 'Load Settings';
    loadBtn.addEventListener('click', () => this._triggerLoadSettings());

    const loadInput = document.createElement('input');
    loadInput.type = 'file';
    loadInput.accept = '.json';
    loadInput.style.display = 'none';
    loadInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this._loadSettingsFromFile(e.target.files[0]);
        e.target.value = '';
      }
    });
    this._loadInput = loadInput;

    bar.appendChild(saveBtn);
    bar.appendChild(loadBtn);
    bar.appendChild(loadInput);

    // Card body (collapsible)
    const body = document.createElement('div');
    body.className = 'card__body';
    body.appendChild(bar);

    // Randomizer (hook)
    const randRow = this._buildRandomizerRow();
    if (randRow) body.appendChild(randRow);

    // Export row (hook)
    this._buildExportRow(body);

    wrapper.appendChild(settingsTitle);
    wrapper.appendChild(chevron);
    wrapper.appendChild(body);

    return wrapper;
  }

  _createGroup(name, params) {
    const group = document.createElement('div');
    group.className = 'parameter-group';
    group.dataset.squircle = '20';

    const header = document.createElement('div');
    header.className = 'parameter-group__header';
    header.innerHTML = '<span class="parameter-group__title">' + name + '</span>';

    const chevron = document.createElement('img');
    chevron.className = 'card__chevron';
    chevron.src = '/_assets/chevron_down.svg';
    chevron.alt = '';

    const content = document.createElement('div');
    content.className = 'parameter-group__content';

    params.forEach(param => {
      const control = param.createControl();
      if (param.hidden) control.style.display = 'none';
      content.appendChild(control);
    });

    header.addEventListener('click', () => {
      group.classList.toggle('parameter-group--collapsed');
    });

    group.appendChild(header);
    group.appendChild(chevron);
    group.appendChild(content);

    return group;
  }

  // -- Save / Load / Export --------------------------------------

  _saveSettings() {
    const state = stateManager.getAll();
    const settings = {};
    for (const [key, value] of Object.entries(state)) {
      if (key === 'imageSource') continue;
      if (value instanceof File) continue;
      settings[key] = value;
    }
    // Save lock states
    const locks = {};
    this.parameters.forEach((param, key) => {
      if (param.locked) locks[key] = true;
    });
    if (Object.keys(locks).length > 0) settings._locks = locks;

    Object.assign(settings, this._getExtraSettingsData());

    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._getSettingsFilePrefix() + '-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _triggerLoadSettings() {
    if (this._loadInput) this._loadInput.click();
  }

  _loadSettingsFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const settings = JSON.parse(e.target.result);
        this._processLoadedSettings(settings);
      } catch (err) {
        console.error('Failed to load settings:', err);
        alert('Failed to load settings: Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }

  _applySettings(settings) {
    if (typeof app !== 'undefined' && app) app.isLoadingSettings = true;

    const paletteKeys = this._getPaletteKeys();

    // Phase 1: Set all state
    for (const [key, value] of Object.entries(settings)) {
      if (paletteKeys.includes(key)) continue;
      stateManager.set(key, value);
    }

    // Phase 2: Update param values and DOM
    for (const [key, value] of Object.entries(settings)) {
      if (paletteKeys.includes(key)) continue;
      const param = this.parameters.get(key);
      if (param) param.value = value;

      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = value;
        } else if (element.type === 'color') {
          element.value = value;
        } else if (element.tagName === 'SELECT') {
          element.value = value;
        } else {
          element.value = value;
        }
        if (element.classList.contains('parameter__range-input')) {
          element.dispatchEvent(new Event('input'));
        } else {
          const container = element.closest('.parameter');
          const display = container ? container.querySelector('.parameter__value') : null;
          if (display) display.textContent = value;
        }
      }
    }

    // Phase 3: Re-apply so subscribers see final values
    for (const [key, value] of Object.entries(settings)) {
      if (paletteKeys.includes(key)) continue;
      stateManager.set(key, value);
    }

    // Restore lock states
    if (settings._locks) {
      for (const [key, locked] of Object.entries(settings._locks)) {
        const param = this.parameters.get(key);
        if (param) {
          param.locked = !!locked;
          if (param._lockEl) {
            param._lockEl.classList.toggle('parameter__lock--active', param.locked);
          }
        }
      }
    }

    if (typeof app !== 'undefined' && app) app.isLoadingSettings = false;

    this._onSettingsApplied(settings);
  }

  _exportSVG() {
    if (typeof app !== 'undefined' && app.renderer) {
      const svgContent = app.renderer.exportSVG();
      if (svgContent) {
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this._getExportPrefix() + '-' + Date.now() + '.svg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } else {
      alert('Cannot export SVG: renderer not initialized');
    }
  }

  _exportPNG() {
    if (typeof app === 'undefined' || !app.renderer) {
      alert('Cannot export PNG: renderer not initialized');
      return;
    }
    const svgContent = app.renderer.exportSVG();
    if (!svgContent) return;

    const resSelect = document.getElementById('exportResolution');
    const size = parseInt(resSelect ? resSelect.value : '') || 4096;
    const prefix = this._getExportPrefix();

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
      const svgW = img.naturalWidth || img.width;
      const svgH = img.naturalHeight || img.height;
      const aspect = svgW / svgH;
      const canvasW = aspect >= 1 ? size : Math.round(size * aspect);
      const canvasH = aspect >= 1 ? Math.round(size / aspect) : size;

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      URL.revokeObjectURL(url);

      canvas.toBlob(function (pngBlob) {
        if (!pngBlob) return;
        const pngUrl = URL.createObjectURL(pngBlob);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = prefix + '-' + canvasW + 'x' + canvasH + '-' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert('Failed to render SVG to PNG');
    };
    img.src = url;
  }

  getParameter(id) {
    return this.parameters.get(id);
  }

  updateParameter(id, value) {
    const param = this.parameters.get(id);
    if (param) {
      param.setValue(value);
      const element = document.getElementById(id);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = value;
        } else {
          element.value = value;
        }
      }
    }
  }
}
