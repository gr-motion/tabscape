/**
 * StateManager - Centralized state management with observer pattern
 * Allows components to subscribe to state changes
 */
class StateManager {
  constructor() {
    this._state = {};
    this._listeners = new Map();
    this._globalListeners = [];
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
   * Set a state value and notify listeners
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    const oldValue = this._state[key];
    if (oldValue === value) return;

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
