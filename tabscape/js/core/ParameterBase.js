/**
 * Parameter - Base class for all parameter types
 * Extensible system for adding new parameter types
 */
class Parameter {
  constructor(config) {
    this.id = config.id;
    this.label = config.label || config.id;
    this.group = config.group || 'default';
    this.type = config.type || 'number';
    this.defaultValue = config.defaultValue;
    this.value = config.defaultValue;
    this.description = config.description || null;
    this.onChange = config.onChange || null;
    this.hidden = config.hidden || false;
    this.disabled = false;
    this.locked = config.defaultLocked || false;
    this._container = null;
  }

  setValue(value) {
    if (this.disabled) return;
    this.value = value;
    stateManager.set(this.id, value);
    if (this.onChange) this.onChange(value);
  }

  setDisabled(disabled) {
    this.disabled = disabled;
    if (this._container) {
      this._container.classList.toggle('parameter--disabled', disabled);
    }
    if (this._selectEl) {
      this._selectEl.disabled = disabled;
    }
  }

  getValue() {
    return this.value;
  }

  /**
   * Build a <label> element, appending an info icon + tooltip when description exists.
   * @returns {HTMLLabelElement}
   */
  _createLabel() {
    const label = document.createElement('label');
    label.className = 'parameter__label';
    label.textContent = this.label;
    if (this.id) label.htmlFor = this.id;

    if (this.description) {
      const info = document.createElement('span');
      info.className = 'parameter__info';
      info.textContent = 'i';

      const desc = this.description;
      info.addEventListener('mouseenter', function() {
        if (info._tip) return;
        const tip = document.createElement('div');
        tip.className = 'parameter__tooltip';
        tip.textContent = desc;
        tip.style.left = '-9999px';
        tip.style.top = '-9999px';
        document.body.appendChild(tip);
        const r = info.getBoundingClientRect();
        const tr = tip.getBoundingClientRect();
        tip.style.left = Math.max(4, r.left + r.width / 2 - tr.width / 2) + 'px';
        tip.style.top = (r.top - tr.height - 6) + 'px';
        info._tip = tip;
      });
      info.addEventListener('mouseleave', function() {
        if (info._tip) { info._tip.remove(); info._tip = null; }
      });

      label.appendChild(info);
    }

    // Lock icon — only for randomizable params (not in excluded groups/types)
    const excludedGroups = new Set(['Fade to Color']);
    const excludedIds = new Set(['maskMode', 'textureMode', 'forceDriver']);
    const randomizableTypes = new Set(['slider', 'button-group']);
    if (randomizableTypes.has(this.type) && !excludedGroups.has(this.group) && !excludedIds.has(this.id)) {
      const lock = document.createElement('span');
      lock.className = 'parameter__lock' + (this.locked ? ' parameter__lock--active' : '');
      lock.innerHTML = '<svg width="8" height="10" viewBox="0 0 8 10" fill="none"><rect x="0.5" y="4.5" width="7" height="5" rx="1" stroke="currentColor"/><path d="M2 4.5V3a2 2 0 1 1 4 0v1.5" stroke="currentColor" fill="none"/></svg>';
      lock.title = 'Lock to prevent randomization';
      lock.addEventListener('click', (e) => {
        e.preventDefault();
        this.locked = !this.locked;
        lock.classList.toggle('parameter__lock--active', this.locked);
      });
      this._lockEl = lock;
      label.appendChild(lock);
    }

    return label;
  }

  /**
   * Create DOM element for this parameter - override in subclasses
   * @returns {HTMLElement}
   */
  createControl() {
    throw new Error('createControl must be implemented by subclass');
  }
}

/**
 * SliderParameter - Number input with range slider
 */
class SliderParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'slider' });
    this.min = config.min ?? 0;
    this.max = config.max ?? 100;
    this.step = config.step ?? 1;
    // Optional: id of another state key whose value acts as the lower bound for
    // this slider. Visually clamps the slider; does NOT mutate stored value.
    this.dynamicMinFrom = config.dynamicMinFrom || null;
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--slider';

    const header = document.createElement('div');
    header.className = 'parameter__header';

    const label = this._createLabel();

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'parameter__value parameter__value--editable';
    valueInput.value = this.value;

    header.appendChild(label);
    header.appendChild(valueInput);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = this.id;
    slider.className = 'parameter__slider';
    slider.min = this.min;
    slider.max = this.max;
    slider.step = this.step;
    slider.value = this.value;

    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      valueInput.value = val;
      this.setValue(val);
    });

    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { valueInput.blur(); }
    });
    valueInput.addEventListener('blur', () => {
      let val = parseFloat(valueInput.value);
      if (isNaN(val)) val = this.value;
      val = Math.max(this.min, Math.min(this.max, val));
      valueInput.value = val;
      slider.value = val;
      this.setValue(val);
    });

    container.appendChild(header);

    // Bind a dynamic lower bound (visual only — stored value is preserved).
    // Mirrors the playback bar's trim overlay pattern: wrap the slider in a
    // relative container and overlay a dark band over the disabled portion.
    if (this.dynamicMinFrom && typeof stateManager !== 'undefined') {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;display:flex;align-items:center;width:100%;';
      slider.style.width = '100%';
      // Layered: visual track (grey) at the bottom, dark floor overlay on top
      // of it, then the slider (with transparent native track) on top so the
      // thumb floats above the overlay without overlapping it.
      const trackBg = document.createElement('div');
      trackBg.style.cssText = 'position:absolute;top:50%;left:0;right:0;height:4px;transform:translateY(-50%);background:var(--input-border);border-radius:2px;pointer-events:none;';
      const floorOverlay = document.createElement('div');
      floorOverlay.style.cssText = 'position:absolute;top:50%;left:0;height:4px;transform:translateY(-50%);background:rgba(0,0,0,0.5);border-radius:2px 0 0 2px;pointer-events:none;';
      floorOverlay.style.width = '0%';
      slider.style.background = 'transparent';
      slider.style.position = 'relative';
      slider.style.zIndex = '2';
      wrap.appendChild(trackBg);
      wrap.appendChild(floorOverlay);
      wrap.appendChild(slider);
      container.appendChild(wrap);

      let currentFloor = this.min;
      const applyDynMin = (other) => {
        const lo = Math.max(this.min, parseFloat(other) || this.min);
        currentFloor = lo;
        // Keep slider.min at the static config min so the slider's visual
        // range (and the overlay's coordinate space) stays stable. The input
        // listener below enforces the dynamic floor when dragging.
        if (parseFloat(slider.value) < lo) slider.value = lo;
        const range = this.max - this.min;
        const pct = range > 0 ? Math.max(0, Math.min(100, ((lo - this.min) / range) * 100)) : 0;
        floorOverlay.style.width = pct + '%';
      };
      const initial = stateManager.get(this.dynamicMinFrom);
      if (initial != null) applyDynMin(initial);
      stateManager.subscribe(this.dynamicMinFrom, applyDynMin);

      // Hard-enforce the floor on drag (belt-and-braces in case slider.min
      // isn't honored, and so the stored value is also clamped to the floor).
      slider.addEventListener('input', (e) => {
        if (parseFloat(e.target.value) < currentFloor) {
          e.target.value = currentFloor;
          valueInput.value = currentFloor;
          this.setValue(currentFloor);
        }
      });
    } else {
      container.appendChild(slider);
    }

    this._container = container;
    return container;
  }
}

/**
 * ColorParameter - Color picker
 */
class ColorParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'color' });
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--color';

    const label = this._createLabel();

    const input = document.createElement('input');
    input.type = 'color';
    input.id = this.id;
    input.className = 'parameter__color';
    input.value = this.value;

    input.addEventListener('input', (e) => {
      this.setValue(e.target.value);
    });

    container.appendChild(label);
    container.appendChild(input);

    return container;
  }
}

/**
 * ToggleParameter - Boolean toggle
 */
class ToggleParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'toggle' });
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--toggle';

    const label = this._createLabel();

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = this.id;
    toggle.className = 'parameter__toggle';
    toggle.checked = this.value;

    toggle.addEventListener('change', (e) => {
      this.setValue(e.target.checked);
    });

    container.appendChild(label);
    container.appendChild(toggle);

    return container;
  }
}

/**
 * SelectParameter - Dropdown select
 */
class SelectParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'select' });
    this.options = config.options || [];
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--select';

    const label = this._createLabel();

    // Custom dropdown — avoids native <select> popup positioning and
    // color-scheme quirks that the OS controls.
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = this.id;
    trigger.className = 'parameter__select';
    trigger.setAttribute('aria-haspopup', 'listbox');

    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'parameter__select-label';
    trigger.appendChild(triggerLabel);

    const chevron = document.createElement('span');
    chevron.className = 'parameter__select-chevron';
    chevron.innerHTML = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    trigger.appendChild(chevron);

    // Menu lives on <body> so parent overflow/contain can't clip it.
    const menu = document.createElement('div');
    menu.className = 'parameter__select-menu';
    document.body.appendChild(menu);

    const items = [];
    this.options.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'parameter__select-item';
      item.textContent = opt.label;
      item.dataset.value = opt.value;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setValue(opt.value);
        close();
      });
      menu.appendChild(item);
      items.push(item);
    });

    const updateUI = () => {
      const found = this.options.find(o => String(o.value) === String(this.value));
      triggerLabel.textContent = found ? found.label : '';
      items.forEach(el => {
        el.classList.toggle('parameter__select-item--active',
          String(el.dataset.value) === String(this.value));
      });
    };
    const stateVal = stateManager.get(this.id);
    if (stateVal !== undefined) this.value = stateVal;
    updateUI();

    const position = () => {
      const r = trigger.getBoundingClientRect();
      menu.style.minWidth = r.width + 'px';
      menu.style.visibility = 'hidden';
      menu.classList.add('parameter__select-menu--open');
      const natH = menu.scrollHeight;
      const spaceBelow = window.innerHeight - r.bottom - 12;
      const spaceAbove = r.top - 12;
      const below = natH <= spaceBelow || spaceBelow >= spaceAbove;
      const top = below ? (r.bottom + 4) : (r.top - natH - 4);
      menu.style.top = top + 'px';
      menu.style.left = r.left + 'px';
      menu.style.visibility = '';
    };

    const outsideHandler = (e) => {
      if (!menu.contains(e.target) && !trigger.contains(e.target)) close();
    };

    const open = () => {
      position();
      trigger.classList.add('parameter__select--open');
      setTimeout(() => document.addEventListener('mousedown', outsideHandler, true), 0);
      window.addEventListener('resize', close, { once: true });
      window.addEventListener('scroll', close, { once: true, capture: true });
    };
    const close = () => {
      menu.classList.remove('parameter__select-menu--open');
      trigger.classList.remove('parameter__select--open');
      document.removeEventListener('mousedown', outsideHandler, true);
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (trigger.disabled) return;
      if (menu.classList.contains('parameter__select-menu--open')) close();
      else open();
    });

    // External state changes (undo/redo, settings load) — reflect in UI.
    stateManager.subscribe(this.id, (val) => {
      this.value = val;
      updateUI();
    });

    container.appendChild(label);
    container.appendChild(trigger);

    this._container = container;
    this._selectEl = trigger;
    this._menuEl = menu;

    return container;
  }
}

/**
 * NumberParameter - Number input with randomize button
 */
class NumberParameter extends Parameter {
  constructor(config) {
    super({ ...config, type: 'number' });
    this.min = config.min ?? 0;
    this.max = config.max ?? 1000;
    this.step = config.step ?? 1;
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--number';

    const label = this._createLabel();

    const inputRow = document.createElement('div');
    inputRow.className = 'parameter__number-row';

    const input = document.createElement('input');
    input.type = 'number';
    input.id = this.id;
    input.className = 'parameter__number-input';
    input.min = this.min;
    input.max = this.max;
    input.step = this.step;
    input.value = this.value;

    input.addEventListener('change', (e) => {
      let val = parseFloat(e.target.value);
      val = Math.max(this.min, Math.min(this.max, val));
      val = Math.round(val / this.step) * this.step;
      input.value = val;
      this.setValue(val);
    });

    const randomBtn = document.createElement('button');
    randomBtn.className = 'parameter__randomize-btn';
    randomBtn.textContent = '\u2733';
    randomBtn.title = 'Randomize';
    randomBtn.addEventListener('click', () => {
      const range = this.max - this.min;
      const steps = Math.floor(range / this.step);
      const randomSteps = Math.floor(Math.random() * (steps + 1));
      const val = this.min + randomSteps * this.step;
      input.value = val;
      this.setValue(val);
    });

    inputRow.appendChild(input);
    inputRow.appendChild(randomBtn);

    container.appendChild(label);
    container.appendChild(inputRow);

    this._container = container;
    return container;
  }
}

/**
 * ParameterFactory - Extensible factory for creating parameters from config.
 * Tool-specific parameter types register themselves via registerType().
 */
const ParameterFactory = {
  _types: {},

  registerType(name, cls) {
    this._types[name] = cls;
  },

  create(config) {
    const Cls = this._types[config.type];
    return Cls ? new Cls(config) : new SliderParameter(config);
  }
};

// Register shared types
ParameterFactory.registerType('slider', SliderParameter);
ParameterFactory.registerType('color', ColorParameter);
ParameterFactory.registerType('toggle', ToggleParameter);
ParameterFactory.registerType('select', SelectParameter);
ParameterFactory.registerType('number', NumberParameter);
