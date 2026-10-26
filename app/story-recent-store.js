'use strict';

/*
 * The last few story files, kept so reopening one is a single tap.
 *
 * A browser cannot reopen a file from a remembered PATH: the File a picker
 * hands over is a one-time grant, and nothing in it survives a reload. So this
 * stores the file's TEXT and rebuilds the story from it, which is also why the
 * entries stay in IndexedDB rather than localStorage -- a story is allowed to
 * reach 25 MB and localStorage's ~5 MB quota would reject it (and, being
 * synchronous, would jank the paint loop on the way).
 *
 * Everything here degrades to "no recent files" rather than throwing: private
 * windows, cleared site data and blocked storage all surface as a failed open,
 * and a missing list is never worth breaking the File tab over.
 */
const STORY_RECENT_DB = 'fluid-paint-story-recent';
const STORY_RECENT_STORE = 'files';
const STORY_RECENT_LIMIT = 3;
// A story is capped at 25 MB by the loader; keeping three of them is the most
// this list can ever hold.
const STORY_RECENT_MAX_BYTES = 25 * 1024 * 1024;

class StoryRecentStore {
  constructor(limit = STORY_RECENT_LIMIT) {
    this.limit = limit;
    this._db = null;
  }

  /** True when this browser can store anything at all. */
  static get supported() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  }

  async _open() {
    if (this._db) return this._db;
    if (!StoryRecentStore.supported) return null;
    this._db = await new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open(STORY_RECENT_DB, 1);
      } catch (_) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORY_RECENT_STORE)) {
          // `openedAt` orders the list; the key is name+size so reopening the
          // same file promotes its entry instead of adding a duplicate.
          db.createObjectStore(STORY_RECENT_STORE, { keyPath: 'id' })
            .createIndex('openedAt', 'openedAt');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this._db;
  }

  async _transaction(mode, run) {
    const db = await this._open();
    if (!db) return null;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORY_RECENT_STORE, mode);
      } catch (_) {
        resolve(null);
        return;
      }
      let result = null;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
      try {
        result = run(tx.objectStore(STORY_RECENT_STORE), (value) => { result = value; });
      } catch (_) {
        resolve(null);
      }
    });
  }

  static id(name, size) {
    return `${name}\u0000${size}`;
  }

  /**
   * Remember one story's text. Reopening a file already listed promotes it
   * rather than duplicating it, and the oldest entries past the limit are
   * dropped in the same transaction.
   */
  async remember(name, size, text) {
    if (typeof text !== 'string' || !text) return false;
    // Oversized text cannot be replayed by the loader anyway, so storing it
    // would only consume quota that a usable entry needs.
    if (text.length > STORY_RECENT_MAX_BYTES) return false;
    const entry = {
      id: StoryRecentStore.id(name, size),
      name: String(name || 'story.json'),
      size: Number(size) || text.length,
      openedAt: Date.now(),
      text,
    };
    const stored = await this._transaction('readwrite', (store) => {
      store.put(entry);
      // Trim inside the SAME transaction: a separate pass could run after
      // another tab wrote, and evict an entry that tab had just promoted.
      const request = store.index('openedAt').openCursor(null, 'prev');
      let seen = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        seen++;
        if (seen > this.limit) cursor.delete();
        cursor.continue();
      };
      return true;
    });
    return stored === true;
  }

  /** The stored stories, newest first. Never throws; [] when unavailable. */
  async list() {
    const entries = await this._transaction('readonly', (store, done) => {
      const request = store.index('openedAt').openCursor(null, 'prev');
      const found = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || found.length >= this.limit) { done(found); return; }
        const { id, name, size, openedAt } = cursor.value;
        // The text stays in the database: a list of three 25 MB strings in
        // memory is not what a menu needs.
        found.push({ id, name, size, openedAt });
        cursor.continue();
      };
      return found;
    });
    return Array.isArray(entries) ? entries : [];
  }

  /** One stored story's text, or null when it is no longer there. */
  async read(id) {
    const entry = await this._transaction('readonly', (store, done) => {
      const request = store.get(id);
      request.onsuccess = () => done(request.result || null);
      return null;
    });
    return entry && typeof entry.text === 'string' ? entry : null;
  }

  async forget(id) {
    const done = await this._transaction('readwrite', (store) => {
      store.delete(id);
      return true;
    });
    return done === true;
  }

  async clear() {
    const done = await this._transaction('readwrite', (store) => {
      store.clear();
      return true;
    });
    return done === true;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = StoryRecentStore;
