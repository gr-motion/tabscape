class WorkspacePersistence {
  constructor({
    storageKey = 'tabscape-workspace-v1',
    dbName = 'tabscape-workspace-db',
    storeName = 'media'
  } = {}) {
    this.storageKey = storageKey;
    this.dbName = dbName;
    this.storeName = storeName;
    this._dbPromise = null;
  }

  loadSnapshot() {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.warn('Failed to load workspace snapshot:', err);
      return null;
    }
  }

  saveSnapshot(snapshot) {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        ...snapshot
      }));
      return true;
    } catch (err) {
      console.warn('Failed to save workspace snapshot:', err);
      return false;
    }
  }

  async saveMedia(id, file) {
    if (!id || !(file instanceof Blob)) return false;
    const db = await this._getDb().catch(() => null);
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put({
        id,
        blob: file,
        name: file.name || `${id}.bin`,
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified || Date.now(),
        savedAt: Date.now()
      });
      req.onsuccess = () => resolve(true);
      req.onerror = () => {
        console.warn('Failed to save persisted media:', req.error);
        resolve(false);
      };
    });
  }

  async removeMedia(id) {
    if (!id) return false;
    const db = await this._getDb().catch(() => null);
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => {
        console.warn('Failed to remove persisted media:', req.error);
        resolve(false);
      };
    });
  }

  async loadAllMedia() {
    const db = await this._getDb().catch(() => null);
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => {
        console.warn('Failed to load persisted media:', req.error);
        resolve([]);
      };
    });
  }

  async _getDb() {
    if (this._dbPromise) return this._dbPromise;
    if (!window.indexedDB) throw new Error('IndexedDB unavailable');

    this._dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this._dbPromise;
  }
}
