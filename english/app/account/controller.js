/* =========================================================================
   controller.js — links a personal account to the active local profile and
   keeps it in sync.

   Linking rules (nothing is ever overwritten silently):
     local empty  + account empty  → link and create the account copy
     local empty  + account data   → link and download the account copy
     local data   + account empty  → ASK: upload this progress, or use the
                                     account in a new empty local profile
     local data   + account data   → ASK: merge (recommended), use the
                                     account copy, or replace the account
                                     with this browser (double confirmation)
   Before replacing or merging, the local document is backed up under
   efl-progress-backup:<profile>:<timestamp>.
   ========================================================================= */

import { SyncEngine, mergeStates, hasProgress, summarize } from '../core/sync.js';
import { syncMetaKey, profileStorageKey } from '../core/profiles.js';
import { createBackend } from './backend.js';

export class AccountController {
  constructor({ auth, registry, store, storage, termsVersion, onChange = () => {} }) {
    Object.assign(this, { auth, registry, store, storage, termsVersion, onChange });
    this.backend = null;
    this.engine = null;
    this.status = 'idle';
    this.phase = 'signed-out';
    this.pending = null;
    this.error = null;
  }

  get profileId() { return this.registry.activeId(); }

  readMeta() {
    try { return JSON.parse(this.storage.getItem(syncMetaKey(this.profileId)) || 'null'); } catch (e) { return null; }
  }

  writeMeta(m) {
    try { this.storage.setItem(syncMetaKey(this.profileId), JSON.stringify(m)); } catch (e) { /* ignore */ }
  }

  set(phase, extra = {}) {
    this.phase = phase;
    Object.assign(this, extra);
    this.onChange(this);
  }

  backup() {
    const key = `efl-progress-backup:${this.profileId}:${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { this.storage.setItem(key, JSON.stringify(this.store.state)); } catch (e) { /* storage full: abort below */ return null; }
    return key;
  }

  /* Called at start-up and whenever the auth user changes. */
  async handleUser(user) {
    this.stopEngine();
    if (!user) { this.set('signed-out', { pending: null }); return; }
    this.backend = createBackend(this.auth.client);
    try {
      const linked = this.registry.profileForUser(user.id);
      if (linked && linked.id !== this.profileId) { this.set('linked-elsewhere', { otherProfile: linked }); return; }
      const active = this.registry.active();
      if (active.account && active.account.userId !== user.id) { this.set('profile-has-other-account'); return; }
      /* already linked (and therefore already 18+-confirmed): start from the
         local copy without needing the network; sync reports offline */
      if (linked) { this.startEngine(); this.set('linked'); this.syncNow(); return; }
      if (!(await this.backend.hasAdultConfirmation())) {
        /* the learner ticked "18+" in the sign-in form of this browser for
           this email less than an hour ago → record it; otherwise ask */
        if (this.consumeAdultIntent(user.email)) {
          await this.backend.confirmAdult(this.termsVersion);
        } else { this.set('needs-adult'); return; }
      }
      await this.prepareLink(user);
    } catch (e) {
      this.set('error', { error: e });
    }
  }

  rememberAdultIntent(email) {
    try { this.storage.setItem('efl-adult-intent', JSON.stringify({ email: String(email).toLowerCase(), at: Date.now() })); } catch (e) { /* ignore */ }
  }

  consumeAdultIntent(email) {
    let v = null;
    try { v = JSON.parse(this.storage.getItem('efl-adult-intent') || 'null'); this.storage.removeItem('efl-adult-intent'); } catch (e) { v = null; }
    return !!(v && email && v.email === String(email).toLowerCase() && Date.now() - v.at < 3600 * 1000);
  }

  async confirmAdult() {
    await this.backend.confirmAdult(this.termsVersion);
    await this.handleUser(this.auth.user);
  }

  async prepareLink(user) {
    const remote = await this.backend.load();
    const localHas = hasProgress(this.store.state);
    if (!localHas && !remote) { await this.link(user, 'upload'); return; }
    if (!localHas && remote) { await this.link(user, 'use-account', remote); return; }
    this.set('choose', {
      pending: { user, remote, local: summarize(this.store.state), remoteSummary: remote ? summarize(remote.state) : null }
    });
  }

  /* choice: 'upload' | 'merge' | 'use-account' | 'replace-account' | 'new-profile' */
  async link(user, choice, remote = this.pending && this.pending.remote) {
    if (choice === 'new-profile') {
      const p = this.registry.create(`Cuenta ${user.email ? user.email.split('@')[0] : ''}`.trim().slice(0, 30));
      this.registry.link(p.id, { userId: user.id, email: user.email });
      this.registry.setActive(p.id);
      this.set('reload');
      return;
    }
    let backupKey = null;
    if (choice === 'merge' || choice === 'use-account') {
      if (hasProgress(this.store.state)) {
        backupKey = this.backup();
        if (!backupKey) { throw new Error('backup-failed'); }
      }
    }
    if (choice === 'merge') {
      this.store.replace(mergeStates(this.store.state, remote.state));
      this.writeMeta({ rev: remote.rev, dirty: true });
    } else if (choice === 'use-account') {
      /* normalised account copy, including its own settings */
      this.store.replace(mergeStates(remote.state, remote.state));
      this.writeMeta({ rev: remote.rev, dirty: false });
    } else if (choice === 'replace-account') {
      this.writeMeta({ rev: remote ? remote.rev : null, dirty: true });
    } else { /* upload */
      this.writeMeta({ rev: remote ? remote.rev : null, dirty: true });
    }
    this.registry.link(this.profileId, { userId: user.id, email: user.email });
    this.pending = null;
    this.startEngine();
    this.set('linked', { lastBackup: backupKey });
    await this.syncNow();
  }

  startEngine() {
    this.stopEngine();
    this.engine = new SyncEngine({
      backend: this.backend,
      store: this.store,
      readMeta: () => this.readMeta(),
      writeMeta: (m) => this.writeMeta(m),
      onStatus: (s) => { this.status = s; this.onChange(this); }
    });
    this.onOnline = () => this.syncNow();
    window.addEventListener('online', this.onOnline);
    this.retry = setInterval(() => { if (this.status === 'offline' || this.status === 'error') { this.syncNow(); } }, 60000);
  }

  stopEngine() {
    if (this.engine) { this.engine.stop(); this.engine = null; }
    if (this.onOnline) { window.removeEventListener('online', this.onOnline); this.onOnline = null; }
    clearInterval(this.retry);
  }

  async syncNow() {
    if (!this.engine) { return null; }
    try { return await this.engine.sync(); } catch (e) { this.error = e; this.onChange(this); return null; }
  }

  lastSyncedAt() { const m = this.readMeta(); return m && m.lastSyncedAt; }

  /* keepLocal=false also clears this profile's progress from this browser */
  async signOut(keepLocal = true) {
    if (this.engine) { await this.syncNow(); }
    this.stopEngine();
    this.registry.link(this.profileId, null);
    try { this.storage.removeItem(syncMetaKey(this.profileId)); } catch (e) { /* ignore */ }
    if (!keepLocal) {
      try { this.storage.removeItem(profileStorageKey(this.profileId)); } catch (e) { /* ignore */ }
      this.store.reset();
    }
    await this.auth.signOut();
    this.set('signed-out');
  }

  /* Deletes the server account and its data; local progress stays on this
     device as a guest profile unless the learner chooses otherwise. */
  async deleteAccount(keepLocal = true) {
    this.stopEngine();
    await this.backend.deleteAccount();
    this.registry.link(this.profileId, null);
    try { this.storage.removeItem(syncMetaKey(this.profileId)); } catch (e) { /* ignore */ }
    if (!keepLocal) { this.store.reset(); }
    try { await this.auth.signOut(); } catch (e) { /* the user no longer exists */ }
    this.set('deleted');
  }
}
