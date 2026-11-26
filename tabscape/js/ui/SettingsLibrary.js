/**
 * SettingsLibrary - Save / Load Settings window.
 *
 * Saves live in this browser (IndexedDB): each entry keeps the settings JSON,
 * a small canvas preview, a name and its creation time. From the list you can
 * load, rename, download (.json) or delete an entry, and load a settings file
 * from disk via a drop zone.
 */
class SettingsLibrary {
  constructor(panel) {
    this.panel = panel;           // ParameterPanel (collect / apply / file prefix)
    this._dbPromise = null;
    this._overlay = null;
    this._onKey = null;
  }

  // ── Storage ───────────────────────────────────────────────

  _db() {
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open('tabscape-settings-library', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  async _tx(mode, fn) {
    const db = await this._db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saves', mode);
      const store = tx.objectStore('saves');
      let result;
      const req = fn(store);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async list() {
    const all = await this._tx('readonly', s => s.getAll());
    return (all || []).sort((a, b) => b.createdAt - a.createdAt);
  }

  put(entry) { return this._tx('readwrite', s => s.put(entry)); }
  remove(id) { return this._tx('readwrite', s => s.delete(id)); }

  // ── Helpers ───────────────────────────────────────────────

  _capturePreview() {
    try {
      const src = (typeof app !== 'undefined' && app.p5Instance && app.p5Instance.canvas) || document.querySelector('#canvas-container canvas');
      if (!src || !src.width || !src.height) return null;
      const w = 240, h = Math.max(1, Math.round(w * src.height / src.width));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = (typeof stateManager !== 'undefined' && stateManager.get('backgroundColor')) || '#FFFEF7';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);
      const webp = c.toDataURL('image/webp', 0.75);
      return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.8);
    } catch (err) {
      console.warn('Preview capture failed:', err);
      return null;
    }
  }

  _defaultName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `Settings ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  _formatDate(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return new Date(ts).toISOString();
    }
  }

  _safeFileName(name) {
    return (name || 'settings').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'settings';
  }

  _download(entry) {
    const json = JSON.stringify(entry.settings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.panel._getSettingsFilePrefix() + '-' + this._safeFileName(entry.name) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Window ────────────────────────────────────────────────

  open({ focusSave = false } = {}) {
    this.close();
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };

    const overlay = el('div', 'settings-lib__overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Saved settings');
    const card = el('div', 'settings-lib__card');

    // Header
    const header = el('div', 'settings-lib__header');
    header.appendChild(el('div', 'settings-lib__title', 'Settings'));
    const closeBtn = el('button', 'settings-lib__close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    // Save row
    const saveRow = el('div', 'settings-lib__save');
    const nameInput = el('input', 'settings-lib__name-input');
    nameInput.type = 'text';
    nameInput.placeholder = this._defaultName();
    nameInput.setAttribute('aria-label', 'Name for the new save');
    const saveBtn = el('button', 'settings-bar__btn settings-lib__btn--primary', 'Save current');
    saveBtn.type = 'button';
    saveRow.append(nameInput, saveBtn);

    // List
    const list = el('div', 'settings-lib__list');

    // Load from file
    const fileBtn = el('button', 'settings-bar__btn settings-lib__file-btn', 'Load from file');
    fileBtn.type = 'button';
    const drop = el('div', 'settings-lib__drop');
    drop.hidden = true;
    drop.tabIndex = 0;
    drop.textContent = 'Drop a settings .json here or click to choose a file';
    const fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.style.display = 'none';

    const note = el('div', 'settings-lib__note',
      'Saves are stored locally in this browser. They won’t be available on other computers or browsers — use Download to keep a copy.');

    card.append(header, saveRow, list, fileBtn, drop, fileInput, note);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this._overlay = overlay;

    // ── Behaviour ──
    const status = (text) => {
      list.innerHTML = '';
      list.appendChild(el('div', 'settings-lib__status', text));
    };

    const render = async () => {
      let entries;
      try {
        entries = await this.list();
      } catch (err) {
        status('Browser storage is unavailable here (private mode?). Use Load from file / Download instead.');
        saveBtn.disabled = true;
        return;
      }
      list.innerHTML = '';
      if (entries.length === 0) { status('No saved settings yet.'); return; }
      entries.forEach(entry => list.appendChild(this._renderItem(entry, render)));
    };

    const doSave = async () => {
      const settings = this.panel._collectSettings();
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: nameInput.value.trim() || nameInput.placeholder,
        createdAt: Date.now(),
        preview: this._capturePreview(),
        settings,
      };
      try {
        await this.put(entry);
        nameInput.value = '';
        nameInput.placeholder = this._defaultName();
        await render();
      } catch (err) {
        console.error('Save failed:', err);
        alert('Could not save in this browser: ' + (err && err.message));
      }
    };
    saveBtn.addEventListener('click', doSave);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });

    const loadFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const settings = JSON.parse(e.target.result);
          this.panel._processLoadedSettings(settings);
          this.close();
        } catch (err) {
          alert('Failed to load settings: invalid JSON file');
        }
      };
      reader.readAsText(file);
    };
    fileBtn.addEventListener('click', () => {
      drop.hidden = !drop.hidden;
      fileBtn.classList.toggle('is-active', !drop.hidden);
      if (!drop.hidden) drop.focus();
    });
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    fileInput.addEventListener('change', () => { loadFile(fileInput.files[0]); fileInput.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove('is-over');
      loadFile(e.dataTransfer && e.dataTransfer.files[0]);
    });

    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });
    this._onKey = (e) => {
      if (e.key === 'Escape' && !(e.target && e.target.classList && e.target.classList.contains('settings-lib__rename'))) this.close();
    };
    document.addEventListener('keydown', this._onKey);

    render();
    if (focusSave) nameInput.focus();
    else closeBtn.focus({ preventScroll: true });
  }

  _renderItem(entry, rerender) {
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    };
    const row = el('div', 'settings-lib__item');

    const thumb = el('div', 'settings-lib__thumb');
    if (entry.preview) {
      const img = el('img');
      img.src = entry.preview;
      img.alt = '';
      thumb.appendChild(img);
    }

    const info = el('div', 'settings-lib__info');
    const name = el('input', 'settings-lib__rename');
    name.type = 'text';
    name.value = entry.name;
    name.title = 'Click to rename';
    name.setAttribute('aria-label', 'Rename');
    const commit = async () => {
      const next = name.value.trim();
      if (!next) { name.value = entry.name; return; }
      if (next === entry.name) return;
      entry.name = next;
      try { await this.put(entry); } catch (err) { console.error('Rename failed:', err); }
    };
    name.addEventListener('blur', commit);
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
      if (e.key === 'Escape') { name.value = entry.name; name.blur(); }
    });
    info.append(name, el('div', 'settings-lib__date', this._formatDate(entry.createdAt)));

    const actions = el('div', 'settings-lib__actions');
    const loadBtn = el('button', 'settings-bar__btn settings-lib__btn', 'Load');
    loadBtn.type = 'button';
    loadBtn.addEventListener('click', () => {
      this.panel._processLoadedSettings(JSON.parse(JSON.stringify(entry.settings)));
      this.close();
    });
    const icon = (path, label) => {
      const b = el('button', 'settings-lib__icon');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
      return b;
    };
    const dl = icon('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>', 'Download');
    dl.addEventListener('click', () => this._download(entry));
    const del = icon('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>', 'Delete');
    del.addEventListener('click', async () => {
      if (!confirm('Delete “' + entry.name + '”? This cannot be undone.')) return;
      try { await this.remove(entry.id); } catch (err) { console.error('Delete failed:', err); }
      rerender();
    });
    actions.append(loadBtn, dl, del);

    row.append(thumb, info, actions);
    return row;
  }

  close() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    this._onKey = null;
    if (this._overlay) this._overlay.remove();
    this._overlay = null;
  }
}
