/* =========================================================================
   profiles.js — independent local profiles (guest mode).

   Several people can share one browser without mixing progress. Each
   profile has its own storage key; the default profile keeps the original
   'efl-progress' key so progress saved before profiles existed is intact.
   A profile may be linked to a personal account (see account/), in which
   case its progress is also synced to the learner's account.
   ========================================================================= */

import { STORAGE_KEY } from './store.js';

export const PROFILES_KEY = 'efl-profiles';
export const DEFAULT_PROFILE_ID = 'default';
const NAME_MAX = 30;

export function profileStorageKey(id) {
  return id === DEFAULT_PROFILE_ID ? STORAGE_KEY : `${STORAGE_KEY}:${id}`;
}

export function syncMetaKey(id) {
  return `efl-sync:${id}`;
}

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n || n.length > NAME_MAX) { throw new Error('invalid-name'); }
  return n;
}

function newId() {
  const rnd = (globalThis.crypto && globalThis.crypto.getRandomValues)
    ? [...globalThis.crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(16).slice(2, 14);
  return `p-${rnd}`;
}

export class ProfileRegistry {
  constructor(storage) {
    this.storage = storage;
    this.data = this.read();
  }

  read() {
    let d = null;
    try { d = JSON.parse(this.storage.getItem(PROFILES_KEY) || 'null'); } catch (e) { d = null; }
    const ok = d && Array.isArray(d.list) && d.list.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
    if (!ok) {
      d = { active: DEFAULT_PROFILE_ID, list: [{ id: DEFAULT_PROFILE_ID, name: 'Principal', createdAt: new Date().toISOString() }] };
    }
    if (!d.list.some((p) => p.id === DEFAULT_PROFILE_ID)) {
      d.list.unshift({ id: DEFAULT_PROFILE_ID, name: 'Principal', createdAt: new Date().toISOString() });
    }
    if (!d.list.some((p) => p.id === d.active)) { d.active = DEFAULT_PROFILE_ID; }
    return d;
  }

  write() {
    try { this.storage.setItem(PROFILES_KEY, JSON.stringify(this.data)); } catch (e) { /* storage unavailable */ }
  }

  list() { return this.data.list.map((p) => ({ ...p })); }
  activeId() { return this.data.active; }
  active() { return { ...this.data.list.find((p) => p.id === this.data.active) }; }
  get(id) { const p = this.data.list.find((x) => x.id === id); return p ? { ...p } : null; }

  create(name) {
    const p = { id: newId(), name: cleanName(name), createdAt: new Date().toISOString() };
    this.data.list.push(p);
    this.write();
    return { ...p };
  }

  rename(id, name) {
    const p = this.data.list.find((x) => x.id === id);
    if (!p) { throw new Error('unknown-profile'); }
    p.name = cleanName(name);
    this.write();
  }

  setActive(id) {
    if (!this.get(id)) { throw new Error('unknown-profile'); }
    this.data.active = id;
    this.write();
  }

  /* Removes a profile and its local data. The default profile cannot be
     removed (it can be reset from Settings). */
  remove(id) {
    if (id === DEFAULT_PROFILE_ID) { throw new Error('cannot-remove-default'); }
    if (!this.get(id)) { throw new Error('unknown-profile'); }
    this.data.list = this.data.list.filter((p) => p.id !== id);
    if (this.data.active === id) { this.data.active = DEFAULT_PROFILE_ID; }
    try {
      this.storage.removeItem(profileStorageKey(id));
      this.storage.removeItem(syncMetaKey(id));
    } catch (e) { /* ignore */ }
    this.write();
  }

  /* account link: { userId, email } or null */
  link(id, account) {
    const p = this.data.list.find((x) => x.id === id);
    if (!p) { throw new Error('unknown-profile'); }
    if (account) {
      const other = this.data.list.find((x) => x.id !== id && x.account && x.account.userId === account.userId);
      if (other) { throw new Error('account-linked-elsewhere'); }
      p.account = { userId: account.userId, email: account.email || null };
    } else {
      delete p.account;
    }
    this.write();
  }

  profileForUser(userId) {
    const p = this.data.list.find((x) => x.account && x.account.userId === userId);
    return p ? { ...p } : null;
  }
}
