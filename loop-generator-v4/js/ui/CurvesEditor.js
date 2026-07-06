/**
 * CurvesEditor - Interactive RGB curves editor
 * Canvas with grid/diagonal, channel tabs (master/R/G/B),
 * click-to-add / drag / double-click-to-remove control points.
 * Monotone cubic Hermite spline → 256-entry LUT per channel.
 */
class CurvesEditor {
  static COLORS = { master: '#ffffff', red: '#ff4444', green: '#44cc44', blue: '#4488ff' };

  constructor() {
    this._container = null;
    this._canvas = null;
    this._ctx = null;
    this._activeChannel = 'master';
    this._dragIdx = -1;
    this._built = false;
  }

  /**
   * Build the editor DOM and insert it into the given parent element.
   */
  build(parent) {
    if (this._built) return;

    this._container = document.createElement('div');
    this._container.className = 'curves-editor-wrapper';

    // Channel tabs
    const tabs = document.createElement('div');
    tabs.className = 'curves-editor__tabs';

    for (const ch of ['master', 'red', 'green', 'blue']) {
      const btn = document.createElement('button');
      btn.className = 'curves-editor__tab' + (ch === 'master' ? ' active' : '');
      btn.dataset.ch = ch;
      btn.style.color = CurvesEditor.COLORS[ch];
      btn.innerHTML = '&#9679;';
      btn.addEventListener('click', () => {
        this._activeChannel = ch;
        tabs.querySelectorAll('.curves-editor__tab').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        this._draw();
      });
      tabs.appendChild(btn);
    }
    this._container.appendChild(tabs);

    // Canvas
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'curves-editor__canvas';
    this._canvas.width = 200;
    this._canvas.height = 200;
    this._container.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');

    // Hint text
    const hint = document.createElement('div');
    hint.className = 'curves-editor__hint';
    hint.textContent = 'Click to add, drag to adjust, double-click to remove';
    this._container.appendChild(hint);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'gradient-editor__btn curves-editor__reset';
    resetBtn.textContent = 'Reset Curves';
    resetBtn.addEventListener('click', () => this._reset());
    this._container.appendChild(resetBtn);

    // Mouse interaction
    this._canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this._canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this._canvas.addEventListener('mouseup', () => { this._dragIdx = -1; });
    this._canvas.addEventListener('mouseleave', () => { this._dragIdx = -1; });
    this._canvas.addEventListener('dblclick', (e) => this._onDblClick(e));

    parent.appendChild(this._container);
    this._built = true;

    // Ensure LUTs exist, then draw
    this._ensureLUTs();
    requestAnimationFrame(() => this._draw());
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
   * Refresh the canvas.
   */
  refresh() {
    this._ensureLUTs();
    this._draw();
  }

  // ── Private helpers ──

  _getPoints() {
    if (typeof paletteProcessor !== 'undefined' && paletteProcessor) {
      if (!paletteProcessor._curvePoints) {
        paletteProcessor._curvePoints = {
          master: [{x:0,y:0}, {x:1,y:1}],
          red:    [{x:0,y:0}, {x:1,y:1}],
          green:  [{x:0,y:0}, {x:1,y:1}],
          blue:   [{x:0,y:0}, {x:1,y:1}]
        };
      }
      return paletteProcessor._curvePoints;
    }
    return null;
  }

  _ensureLUTs() {
    if (typeof paletteProcessor === 'undefined' || !paletteProcessor) return;
    const pts = this._getPoints();
    if (!pts) return;
    for (const ch of ['master', 'red', 'green', 'blue']) {
      paletteProcessor._curveLUTs[ch] = paletteProcessor._buildCurveLUT(pts[ch]);
    }
  }

  _rebuildLUTs() {
    this._ensureLUTs();
  }

  _curvePos(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: 1 - (e.clientY - rect.top) / rect.height
    };
  }

  _findNear(pos) {
    const pts = this._getPoints();
    if (!pts) return -1;
    const arr = pts[this._activeChannel];
    for (let i = 0; i < arr.length; i++) {
      const dx = arr[i].x - pos.x, dy = arr[i].y - pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.06) return i;
    }
    return -1;
  }

  _onMouseDown(e) {
    e.preventDefault();
    const pos = this._curvePos(e);
    const idx = this._findNear(pos);
    if (idx >= 0) {
      this._dragIdx = idx;
    } else {
      // Add new point
      const pts = this._getPoints();
      if (!pts) return;
      const arr = pts[this._activeChannel];
      arr.push({
        x: Math.max(0, Math.min(1, pos.x)),
        y: Math.max(0, Math.min(1, pos.y))
      });
      arr.sort((a, b) => a.x - b.x);
      this._dragIdx = arr.findIndex(p =>
        Math.abs(p.x - pos.x) < 0.01 && Math.abs(p.y - pos.y) < 0.01
      );
      this._rebuildLUTs();
      this._draw();
    }
  }

  _onMouseMove(e) {
    if (this._dragIdx < 0) return;
    const pos = this._curvePos(e);
    const pts = this._getPoints();
    if (!pts) return;
    const arr = pts[this._activeChannel];

    let nx = Math.max(0, Math.min(1, pos.x));
    let ny = Math.max(0, Math.min(1, pos.y));

    // Lock endpoints at x boundaries
    if (this._dragIdx === 0) nx = 0;
    if (this._dragIdx === arr.length - 1) nx = 1;

    // Keep points ordered
    if (this._dragIdx > 0) nx = Math.max(arr[this._dragIdx - 1].x + 0.005, nx);
    if (this._dragIdx < arr.length - 1) nx = Math.min(arr[this._dragIdx + 1].x - 0.005, nx);

    arr[this._dragIdx].x = nx;
    arr[this._dragIdx].y = ny;
    this._rebuildLUTs();
    this._draw();
  }

  _onDblClick(e) {
    const pos = this._curvePos(e);
    const idx = this._findNear(pos);
    const pts = this._getPoints();
    if (!pts) return;
    const arr = pts[this._activeChannel];
    // Don't remove endpoints
    if (idx > 0 && idx < arr.length - 1) {
      arr.splice(idx, 1);
      this._rebuildLUTs();
      this._draw();
    }
  }

  _reset() {
    const pts = this._getPoints();
    if (!pts) return;
    for (const ch of ['master', 'red', 'green', 'blue']) {
      pts[ch] = [{x:0,y:0}, {x:1,y:1}];
    }
    this._rebuildLUTs();
    this._draw();
  }

  _draw() {
    if (!this._canvas || !this._ctx) return;

    // Resize canvas to match CSS layout
    const cssW = this._canvas.offsetWidth || 200;
    const cssH = this._canvas.offsetHeight || cssW; // aspect-ratio: 1
    if (this._canvas.width !== cssW || this._canvas.height !== cssH) {
      this._canvas.width = cssW;
      this._canvas.height = cssH;
    }

    const w = this._canvas.width;
    const h = this._canvas.height;
    const ctx = this._ctx;

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * w;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
    }

    // Identity diagonal
    ctx.strokeStyle = '#444';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
    ctx.setLineDash([]);

    if (typeof paletteProcessor === 'undefined' || !paletteProcessor) return;

    // Draw all channel curves
    for (const ch of ['master', 'red', 'green', 'blue']) {
      const lut = paletteProcessor._curveLUTs[ch];
      if (!lut) continue;
      ctx.strokeStyle = ch === this._activeChannel
        ? CurvesEditor.COLORS[ch]
        : (CurvesEditor.COLORS[ch] + '40');
      ctx.lineWidth = ch === this._activeChannel ? 2 : 1;
      ctx.beginPath();
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * w;
        const y = (1 - lut[i]) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Control points for active channel
    const pts = this._getPoints();
    if (!pts) return;
    const arr = pts[this._activeChannel];
    for (const p of arr) {
      ctx.fillStyle = CurvesEditor.COLORS[this._activeChannel];
      ctx.beginPath();
      ctx.arc(p.x * w, (1 - p.y) * h, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
