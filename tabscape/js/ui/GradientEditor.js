/**
 * GradientEditor - Self-contained interactive gradient stop editor
 * Renders a gradient bar + draggable color stops. Stores stops in stateManager.
 */
class GradientEditor {
  constructor(options = {}) {
    this._container = null;
    this._canvas = null;
    this._ctx = null;
    this._stopsContainer = null;
    this._colorPicker = null;
    this._selectedIdx = 0;
    this._built = false;
    this._changingFromState = false;

    this._stateKey = options.stateKey || 'hueGradientStops';

    // Default gradient stops (matches v2 hueGradMap brand palette)
    this._stops = options.defaultStops || [
      { pos: 0,     color: '#64737e' },  // Gray
      { pos: 1/6,   color: '#48bec5' },  // Teal
      { pos: 2/6,   color: '#52c584' },  // Green
      { pos: 3/6,   color: '#9bad3b' },  // Olive
      { pos: 4/6,   color: '#fd817c' },  // Coral
      { pos: 5/6,   color: '#e35b6c' },  // Candy
      { pos: 1,     color: '#a06279' }   // Mauve
    ];

    // Load saved stops from state if available
    const saved = stateManager.get(this._stateKey);
    if (saved && Array.isArray(saved) && saved.length >= 2) {
      this._stops = saved;
    }
  }

  getContainer() {
    return this._container;
  }

  /**
   * Build the editor DOM and insert it into the given parent element.
   */
  build(parent) {
    if (this._built) return;

    this._container = document.createElement('div');
    this._container.className = 'gradient-editor-wrapper';

    // Canvas for gradient preview
    const editorBox = document.createElement('div');
    editorBox.className = 'gradient-editor';

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'gradient-editor__canvas';
    this._canvas.height = 30;
    editorBox.appendChild(this._canvas);

    // Stop markers container
    this._stopsContainer = document.createElement('div');
    this._stopsContainer.className = 'gradient-editor__stops';
    editorBox.appendChild(this._stopsContainer);

    this._container.appendChild(editorBox);

    // Add / Remove buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'gradient-editor__buttons';

    const addBtn = document.createElement('button');
    addBtn.className = 'gradient-editor__btn';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => this._addStop());

    const removeBtn = document.createElement('button');
    removeBtn.className = 'gradient-editor__btn';
    removeBtn.textContent = '- Remove';
    removeBtn.addEventListener('click', () => this._removeStop());

    btnRow.appendChild(addBtn);
    btnRow.appendChild(removeBtn);
    this._container.appendChild(btnRow);

    // Stop color picker
    const colorRow = document.createElement('div');
    colorRow.className = 'gradient-editor__color-row';

    const colorLabel = document.createElement('span');
    colorLabel.className = 'parameter__label';
    colorLabel.textContent = 'Stop Color';

    this._colorPicker = document.createElement('input');
    this._colorPicker.type = 'color';
    this._colorPicker.className = 'parameter__color';
    this._colorPicker.value = this._stops[0]?.color || '#ff0066';

    this._colorPicker.addEventListener('input', () => {
      if (this._selectedIdx >= 0 && this._selectedIdx < this._stops.length) {
        this._stops[this._selectedIdx].color = this._colorPicker.value;
        this._onChange();
      }
    });

    colorRow.appendChild(colorLabel);
    colorRow.appendChild(this._colorPicker);
    this._container.appendChild(colorRow);

    // Canvas click to add stop
    this._canvas.addEventListener('click', (e) => {
      const rect = this._canvas.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const color = this.sampleGradient(pos);
      this._stops.push({ pos, color });
      this._selectedIdx = this._stops.length - 1;
      this._colorPicker.value = color;
      this._onChange();
    });

    parent.appendChild(this._container);
    this._built = true;

    // Subscribe to external state updates (e.g. loading settings)
    stateManager.subscribe(this._stateKey, (val) => {
      if (this._changingFromState) return;
      if (val && Array.isArray(val) && val.length >= 2) {
        this._stops = val;
        this._selectedIdx = Math.min(this._selectedIdx, this._stops.length - 1);
        if (this._colorPicker && this._stops[this._selectedIdx]) {
          this._colorPicker.value = this._stops[this._selectedIdx].color;
        }
        this.refresh();
      }
    });

    requestAnimationFrame(() => this.refresh());
  }

  destroy() {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._built = false;
  }

  refresh() {
    this._drawCanvas();
    this._buildMarkers();
  }

  /**
   * Sample the gradient at position t (0-1), returns hex color string.
   */
  sampleGradient(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [...this._stops].sort((a, b) => a.pos - b.pos);
    if (stops.length === 0) return '#808080';
    if (stops.length === 1) return stops[0].color;
    if (t <= stops[0].pos) return stops[0].color;
    if (t >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;

    // Find bracketing stops
    let lo = 0, hi = 1;
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].pos && t <= stops[i + 1].pos) {
        lo = i; hi = i + 1; break;
      }
    }

    const range = stops[hi].pos - stops[lo].pos;
    const frac = range > 0 ? (t - stops[lo].pos) / range : 0;

    // Simple RGB lerp (matches v2)
    const a = GradientEditor.hexToRgb(stops[lo].color);
    const b = GradientEditor.hexToRgb(stops[hi].color);
    return GradientEditor.rgbToHex(
      a.r + (b.r - a.r) * frac,
      a.g + (b.g - a.g) * frac,
      a.b + (b.b - a.b) * frac
    );
  }

  // ── Color conversion utilities ──

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
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  static hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
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
    return {
      r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1/3) * 255)
    };
  }

  // ── Private helpers ──

  _drawCanvas() {
    if (!this._canvas) return;
    const w = this._canvas.offsetWidth || 240;
    this._canvas.width = w;
    this._canvas.height = 30;
    const ctx = this._canvas.getContext('2d');

    for (let x = 0; x < w; x++) {
      ctx.fillStyle = this.sampleGradient(x / (w - 1));
      ctx.fillRect(x, 0, 1, 30);
    }
  }

  _buildMarkers() {
    if (!this._stopsContainer) return;
    this._stopsContainer.innerHTML = '';

    this._stops.forEach((stop, i) => {
      const el = document.createElement('div');
      el.className = 'gradient-stop' + (i === this._selectedIdx ? ' selected' : '');
      el.style.left = (stop.pos * 100) + '%';
      el.style.background = stop.color;

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._selectedIdx = i;
        this._colorPicker.value = stop.color;
        this._buildMarkers();

        const rect = this._stopsContainer.getBoundingClientRect();
        el.classList.add('dragging');

        const onMove = (ev) => {
          const newPos = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          this._stops[i].pos = newPos;
          el.style.left = (newPos * 100) + '%';
          this._drawCanvas();
        };

        const onUp = () => {
          el.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          this._buildMarkers();
          this._onChange();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      this._stopsContainer.appendChild(el);
    });
  }

  _addStop() {
    const sorted = [...this._stops].sort((a, b) => a.pos - b.pos);
    let newPos = 0.5;
    if (sorted.length >= 2) {
      let maxGap = 0, gapStart = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].pos - sorted[i].pos;
        if (gap > maxGap) { maxGap = gap; gapStart = i; }
      }
      newPos = (sorted[gapStart].pos + sorted[gapStart + 1].pos) / 2;
    }
    const newColor = this.sampleGradient(newPos);
    this._stops.push({ pos: newPos, color: newColor });
    this._selectedIdx = this._stops.length - 1;
    this._colorPicker.value = newColor;
    this._onChange();
  }

  _removeStop() {
    if (this._stops.length <= 2) return;
    this._stops.splice(this._selectedIdx, 1);
    this._selectedIdx = Math.min(this._selectedIdx, this._stops.length - 1);
    this._colorPicker.value = this._stops[this._selectedIdx].color;
    this._onChange();
  }

  _onChange() {
    this._drawCanvas();
    this._buildMarkers();
    // Persist stops to state
    this._changingFromState = true;
    stateManager.set(this._stateKey, this._stops.map(s => ({ pos: s.pos, color: s.color })));
    this._changingFromState = false;
  }
}
