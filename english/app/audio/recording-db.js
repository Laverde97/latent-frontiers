/* =========================================================================
   recording-db.js — optional local storage of recordings in IndexedDB.
   Used only when the learner enables "Keep my recordings on this device".
   ========================================================================= */

const DB = 'efl-recordings';
const STORE = 'recordings';

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('indexeddb-unsupported')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out && out.result !== undefined ? out.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

export function saveRecording(key, blob, meta = {}) {
  return tx('readwrite', (s) => s.put({ key, blob, savedAt: new Date().toISOString(), ...meta }));
}

export function getRecording(key) {
  return tx('readonly', (s) => s.get(key));
}

export function countRecordings() {
  return tx('readonly', (s) => s.count()).catch(() => 0);
}

export function deleteAllRecordings() {
  return tx('readwrite', (s) => s.clear());
}
