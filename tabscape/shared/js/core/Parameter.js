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
    this.locked = false;
  }

  setValue(value) {
    this.value = value;
    stateManager.set(this.id, value);
    if (this.onChange) this.onChange(value);
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

      const tooltip = document.createElement('span');
      tooltip.className = 'parameter__tooltip';
      tooltip.textContent = this.description;

      info.appendChild(tooltip);
      label.appendChild(info);
    }

    // Lock icon (prevents randomization)
    const lock = document.createElement('span');
    lock.className = 'parameter__lock';
    lock.innerHTML = '<svg width="8" height="10" viewBox="0 0 8 10" fill="none"><rect x="0.5" y="4.5" width="7" height="5" rx="1" stroke="currentColor"/><path d="M2 4.5V3a2 2 0 1 1 4 0v1.5" stroke="currentColor" fill="none"/></svg>';
    lock.title = 'Lock to prevent randomization';
    lock.addEventListener('click', (e) => {
      e.preventDefault();
      this.locked = !this.locked;
      lock.classList.toggle('parameter__lock--active', this.locked);
    });
    this._lockEl = lock;
    label.appendChild(lock);

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
  }

  createControl() {
    const container = document.createElement('div');
    container.className = 'parameter parameter--slider';

    const header = document.createElement('div');
    header.className = 'parameter__header';

    const label = this._createLabel();

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'parameter__value';
    valueDisplay.textContent = this.value;

    header.appendChild(label);
    header.appendChild(valueDisplay);

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
      valueDisplay.textContent = val;
      this.setValue(val);
    });

    container.appendChild(header);
    container.appendChild(slider);

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

    const select = document.createElement('select');
    select.id = this.id;
    select.className = 'parameter__select';

    this.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === this.value) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', (e) => {
      this.setValue(e.target.value);
    });

    container.appendChild(label);
    container.appendChild(select);

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
