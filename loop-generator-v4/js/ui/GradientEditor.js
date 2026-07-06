/**
 * GradientEditor - Interactive gradient stop editor with canvas preview
 * Renders a gradient bar + draggable color stops below it.
 * Click canvas to add stop, drag stops to reposition, color picker to change stop color.
 */
class GradientEditor {
  /**
   * @param {Object} [options]
   * @param {string} [options.stopsKey='_customGradientStops'] - PaletteProcessor property holding the stops array
   */
  constructor(options = {}) {
    this._stopsKey = options.stopsKey || '_customGradientStops';
    this._container = null;
    this._canvas = null;
    this._ctx = null;
    this._stopsContainer = null;
    this._colorPicker = null;
    this._selectedIdx = 0;
    this._built = false;
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
    this._colorPicker.value = this._getStops()[0]?.color || '#ff0066';

    this._colorPicker.addEventListener('input', () => {
      const stops = this._getStops();
      if (this._selectedIdx >= 0 && this._selectedIdx < stops.length) {
        stops[this._selectedIdx].color = this._colorPicker.value;
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
      const color = this._sampleAt(pos);
      const stops = this._getStops();
      stops.push({ pos, color });
      this._selectedIdx = stops.length - 1;
      this._colorPicker.value = color;
      this._onChange();
    });

    parent.appendChild(this._container);
    this._built = true;

    // Initial draw (deferred so canvas has layout dimensions)
    requestAnimationFrame(() => this.refresh());
  }

  /**
   * Remove the editor DOM.
   */
  destroy() {
    if (this._container && this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._built = false;
  }

  /**
   * Refresh the canvas and stop markers.
   */
  refresh() {
    this._drawCanvas();
    this._buildMarkers();
  }

  // ── Private helpers ──

  _getStops() {
    if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      return paletteProcessor[this._stopsKey];
    }
    return [];
  }

  _drawCanvas() {
    if (!this._canvas) return;
    if (typeof paletteProcessor === 'undefined' || !paletteProcessor) return;
    const w = this._canvas.offsetWidth || 240;
    this._canvas.width = w;
    this._canvas.height = 30;
    const ctx = this._canvas.getContext('2d');

    for (let x = 0; x < w; x++) {
      ctx.fillStyle = this._sampleAt(x / (w - 1));
      ctx.fillRect(x, 0, 1, 30);
    }
  }

  /** Sample the gradient stops at position t (0-1) → hex color */
  _sampleAt(t) {
    const stops = [...this._getStops()].sort((a, b) => a.pos - b.pos);
    if (stops.length === 0) return '#808080';
    if (stops.length === 1) return stops[0].color;
    t = Math.max(0, Math.min(1, t));
    if (t <= stops[0].pos) return stops[0].color;
    if (t >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;
    let lo = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].pos && t <= stops[i + 1].pos) { lo = i; break; }
    }
    const hi = lo + 1;
    const range = stops[hi].pos - stops[lo].pos;
    const frac = range > 0 ? (t - stops[lo].pos) / range : 0;
    // Simple RGB lerp
    const parse = (hex) => {
      const v = parseInt(hex.slice(1), 16);
      return [(v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF];
    };
    const a = parse(stops[lo].color), b = parse(stops[hi].color);
    const r = Math.round(a[0] + (b[0] - a[0]) * frac);
    const g = Math.round(a[1] + (b[1] - a[1]) * frac);
    const bl = Math.round(a[2] + (b[2] - a[2]) * frac);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  _buildMarkers() {
    if (!this._stopsContainer) return;
    this._stopsContainer.innerHTML = '';
    const stops = this._getStops();

    stops.forEach((stop, i) => {
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
          stops[i].pos = newPos;
          el.style.left = (newPos * 100) + '%';
          this._drawCanvas();
          if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
            paletteProcessor._dirty = true;
          }
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
    const stops = this._getStops();
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    let newPos = 0.5;
    if (sorted.length >= 2) {
      let maxGap = 0, gapStart = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        const gap = sorted[i + 1].pos - sorted[i].pos;
        if (gap > maxGap) { maxGap = gap; gapStart = i; }
      }
      newPos = (sorted[gapStart].pos + sorted[gapStart + 1].pos) / 2;
    }
    const newColor = this._sampleAt(newPos);
    stops.push({ pos: newPos, color: newColor });
    this._selectedIdx = stops.length - 1;
    this._colorPicker.value = newColor;
    this._onChange();
  }

  _removeStop() {
    const stops = this._getStops();
    if (stops.length <= 2) return;
    stops.splice(this._selectedIdx, 1);
    this._selectedIdx = Math.min(this._selectedIdx, stops.length - 1);
    this._colorPicker.value = stops[this._selectedIdx].color;
    this._onChange();
  }

  _onChange() {
    this._drawCanvas();
    this._buildMarkers();
    // Mark palette processor dirty so pre-sorted stops cache rebuilds
    if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      paletteProcessor._dirty = true;
    }
  }
}
