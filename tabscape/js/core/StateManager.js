/**
 * StateManager - Centralized state management with observer pattern
 * Allows components to subscribe to state changes.
 * Includes undo/redo history with batch transaction support.
 */
class StateManager {
  constructor() {
    this._state = {};
    this._listeners = new Map();
    this._globalListeners = [];

    // Undo / redo
    this._undoStack = [];
    this._redoStack = [];
    this._maxHistory = 100;
    this._batchDepth = 0;       // nesting counter for beginBatch / endBatch
    this._batchSnapshot = null;  // state snapshot taken at outermost beginBatch
    this._isRestoring = false;   // true while undo/redo is applying state
    this._coalesceKey = null;    // key of the last single-set push
    this._coalesceTimer = null;  // debounce timer for rapid slider drags

    // Keys excluded from history (transient / derived state)
    this._historyExclude = new Set([
      'videoScrub', 'loopDuration',
      '_locks', '_motion', '_defaultTextureProgress', '_defaultTexturePaused',
      // Derived keys set by cascade subscribers — the source params cover these
      'postFadeEnabled', 'postFadeDriver', 'postFadeEnd', 'postFadeStrength',
      'maskRingInnerNoise', 'maskRingOuterNoise', 'maskRingNoiseScale',
      'postFadeTarget',
    ]);
  }

  /**
   * Initialize state with default values
   * @param {Object} initialState
   */
  init(initialState) {
    this._state = { ...initialState };
  }

  /**
   * Get a state value
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this._state[key];
  }

  /**
   * Get all state (shallow copy)
   * @returns {Object}
   */
  getAll() {
    return { ...this._state };
  }

  /**
   * Get direct reference to state object (read-only by convention).
   * Use in hot paths where a copy is unnecessary.
   * @returns {Object}
   */
  getRef() {
    return this._state;
  }

  /**
   * Set a state value and notify listeners.
   * Automatically pushes undo history for user-initiated changes.
   * @param {string} key
   * @param {any} value
   */
  set(key, value, options = {}) {
    const oldValue = this._state[key];
    if (oldValue === value) return;

    // Push history for non-excluded, non-restore, non-batch single changes.
    // Coalesce rapid changes to the same key (e.g. slider drags) into one entry.
    if (!options.skipHistory && !this._isRestoring && !this._historyExclude.has(key) && this._batchDepth === 0) {
      if (this._coalesceKey === key && this._coalesceTimer) {
        // Same key changed again quickly — reuse the already-pushed snapshot,
        // just reset the debounce timer.
        clearTimeout(this._coalesceTimer);
      } else {
        this._pushUndo();
      }
      this._coalesceKey = key;
      clearTimeout(this._coalesceTimer);
      this._coalesceTimer = setTimeout(() => {
        this._coalesceKey = null;
        this._coalesceTimer = null;
      }, 400);
    }

    this._state[key] = value;
    this._notifyListeners(key, value, oldValue);
  }

  /**
   * Set multiple state values
   * @param {Object} updates
   */
  setMultiple(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  // -- Undo / Redo ------------------------------------------------

  /**
   * Begin a batch transaction. All state changes until the matching
   * endBatch() are grouped as a single undo entry. Nestable.
   */
  beginBatch() {
    if (this._batchDepth === 0) {
      this._batchSnapshot = this._snapshot();
    }
    this._batchDepth++;
  }

  /**
   * End a batch transaction. When the outermost batch closes, a single
   * undo entry is pushed if state actually changed.
   */
  endBatch() {
    if (this._batchDepth <= 0) return;
    this._batchDepth--;
    if (this._batchDepth === 0 && this._batchSnapshot) {
      // Only push if state actually changed
      if (this._snapshotChanged(this._batchSnapshot)) {
        this._undoStack.push(this._batchSnapshot);
        if (this._undoStack.length > this._maxHistory) this._undoStack.shift();
        this._redoStack.length = 0;
      }
      this._batchSnapshot = null;
    }
  }

  /**
   * Undo the last state change.
   * @returns {boolean} true if undo was performed
   */
  undo() {
    if (this._undoStack.length === 0) return false;
    const snapshot = this._undoStack.pop();
    this._redoStack.push(this._snapshot());
    this._restore(snapshot);
    return true;
  }

  /**
   * Redo the last undone state change.
   * @returns {boolean} true if redo was performed
   */
  redo() {
    if (this._redoStack.length === 0) return false;
    const snapshot = this._redoStack.pop();
    this._undoStack.push(this._snapshot());
    this._restore(snapshot);
    return true;
  }

  /** @returns {boolean} */
  canUndo() { return this._undoStack.length > 0; }
  /** @returns {boolean} */
  canRedo() { return this._redoStack.length > 0; }

  /**
   * Clear all history (e.g. after loading settings).
   */
  clearHistory() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._batchSnapshot = null;
    this._batchDepth = 0;
  }

  // -- History internals ------------------------------------------

  /** Create a serialisable snapshot of undoable state */
  _snapshot() {
    const snap = {};
    for (const key of Object.keys(this._state)) {
      if (this._historyExclude.has(key)) continue;
      const v = this._state[key];
      // Skip non-serialisable values (File objects, etc.)
      if (v instanceof File || v instanceof Blob) continue;
      snap[key] = v;
    }
    return snap;
  }

  /** Check if current state differs from a snapshot */
  _snapshotChanged(snapshot) {
    for (const key of Object.keys(snapshot)) {
      if (this._state[key] !== snapshot[key]) return true;
    }
    return false;
  }

  /** Push current state onto undo stack (for single-key changes) */
  _pushUndo() {
    this._undoStack.push(this._snapshot());
    if (this._undoStack.length > this._maxHistory) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  /**
   * Restore state from a snapshot, notifying listeners for every changed key.
   * Sets _isRestoring to prevent recursive history pushes.
   */
  _restore(snapshot) {
    this._isRestoring = true;
    for (const [key, value] of Object.entries(snapshot)) {
      const oldValue = this._state[key];
      if (oldValue !== value) {
        this._state[key] = value;
        this._notifyListeners(key, value, oldValue);
      }
    }
    this._isRestoring = false;

    // Notify the UI to sync DOM elements
    this._globalListeners.forEach(cb => cb('__undoRedo', null, null));
  }

  // -- Observer pattern -------------------------------------------

  /**
   * Subscribe to changes on a specific key
   * @param {string} key
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, []);
    }
    this._listeners.get(key).push(callback);

    return () => {
      const listeners = this._listeners.get(key);
      const index = listeners.indexOf(callback);
      if (index > -1) listeners.splice(index, 1);
    };
  }

  /**
   * Subscribe to all state changes
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  subscribeAll(callback) {
    this._globalListeners.push(callback);
    return () => {
      const index = this._globalListeners.indexOf(callback);
      if (index > -1) this._globalListeners.splice(index, 1);
    };
  }

  _notifyListeners(key, newValue, oldValue) {
    // Notify specific listeners
    const listeners = this._listeners.get(key) || [];
    listeners.forEach(cb => cb(newValue, oldValue, key));

    // Notify global listeners
    this._globalListeners.forEach(cb => cb(key, newValue, oldValue));
  }
}

// Singleton instance
const stateManager = new StateManager();
