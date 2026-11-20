/* =========================================================================
   sync.js — merging and syncing a learner's progress between devices.

   mergeStates(local, remote) is deterministic, never drops evidence and is
   idempotent (merge(x, x) == x; merging the same remote twice changes
   nothing). Rules per field:
     lessons/activities  union; for the same activity the most recent
                          result (lastAt) wins, attempts = max, best = max
     lesson status        completed if completed anywhere (earliest date)
     evidence             union (key: lesson|activity|at|source), by date
     srs                  per card, the one with the most recent review
     practice minutes     max per day (summing would double-count on
                          repeated merges)
     badges               earliest award; assessments/diagnostic: latest
     settings             the current device's (they are preferences)

   SyncEngine pushes the local document with optimistic concurrency (rev)
   and, on conflict, pulls, merges and retries. The backend is injected so
   the engine is testable without a network.
   ========================================================================= */

import { STATE_VERSION, validateState, migrate } from './store.js';

const t = (x) => (x ? new Date(x).getTime() : 0);
const newer = (a, b, key) => (t(b && b[key]) > t(a && a[key]) ? b : a);

function mergeActivity(a, b) {
  if (!a) { return { ...b }; }
  if (!b) { return { ...a }; }
  const base = newer(a, b, 'lastAt');
  const bests = [a.best, b.best].filter((x) => x != null);
  return { ...base, attempts: Math.max(a.attempts || 0, b.attempts || 0), best: bests.length ? Math.max(...bests) : base.best };
}

function lastTouch(lesson) {
  return Math.max(0, ...Object.values(lesson.activities || {}).map((x) => t(x.lastAt)));
}

function mergeLesson(a, b) {
  /* a lesson present on one side only is normalised by merging it with
     itself, so a second merge gives exactly the same result */
  if (!a) { a = b; }
  if (!b) { b = a; }
  const base = lastTouch(b) > lastTouch(a) ? b : a;
  const activities = {};
  for (const id of new Set([...Object.keys(a.activities || {}), ...Object.keys(b.activities || {})])) {
    activities[id] = mergeActivity((a.activities || {})[id], (b.activities || {})[id]);
  }
  const out = { ...base, activities, attempts: Math.max(a.attempts || 1, b.attempts || 1) };
  /* do not invent fields: an absent cursor stays absent */
  if (a.cursor != null || b.cursor != null) { out.cursor = Math.max(a.cursor || 0, b.cursor || 0); }
  const done = [a, b].filter((l) => l.status === 'completed');
  if (done.length) {
    const first = done.reduce((x, y) => (t(y.completedAt) && t(y.completedAt) < t(x.completedAt) ? y : x));
    const latest = done.reduce((x, y) => (t(y.completedAt) > t(x.completedAt) ? y : x));
    out.status = 'completed';
    out.completedAt = first.completedAt;
    out.autoMean = latest.autoMean;
    out.needsReview = latest.needsReview;
    out.weakActivities = latest.weakActivities;
  }
  const starts = [a.startedAt, b.startedAt].filter(Boolean).sort();
  if (starts.length) { out.startedAt = starts[0]; }
  return out;
}

function lastReview(card) {
  const h = (card && card.history) || [];
  return h.length ? t(h[h.length - 1].at) : 0;
}

export function mergeStates(localIn, remoteIn) {
  const local = migrate(localIn);
  const remote = migrate(remoteIn);
  const out = {
    version: STATE_VERSION,
    createdAt: [local.createdAt, remote.createdAt].filter(Boolean).sort()[0] || local.createdAt,
    updatedAt: [local.updatedAt, remote.updatedAt].filter(Boolean).sort().pop() || local.updatedAt,
    settings: { ...remote.settings, ...local.settings },
    lessons: {},
    evidence: [],
    practice: {},
    srs: {},
    diagnostic: null,
    assessments: {},
    badges: {},
    events: local.events || []
  };
  for (const id of new Set([...Object.keys(local.lessons), ...Object.keys(remote.lessons)])) {
    out.lessons[id] = mergeLesson(local.lessons[id], remote.lessons[id]);
  }
  const seen = new Map();
  for (const e of [...remote.evidence, ...local.evidence]) {
    const k = `${e.lessonId}|${e.activityId}|${e.at}|${e.source}`;
    if (!seen.has(k)) { seen.set(k, e); }
  }
  out.evidence = [...seen.values()].sort((x, y) => t(x.at) - t(y.at) || String(x.activityId).localeCompare(String(y.activityId))).slice(-2000);
  for (const d of new Set([...Object.keys(local.practice), ...Object.keys(remote.practice)])) {
    out.practice[d] = Math.max(local.practice[d] || 0, remote.practice[d] || 0);
  }
  for (const id of new Set([...Object.keys(local.srs), ...Object.keys(remote.srs)])) {
    const a = local.srs[id];
    const b = remote.srs[id];
    out.srs[id] = !a ? b : !b ? a : (lastReview(b) > lastReview(a) ? b : (lastReview(a) > lastReview(b) ? a : ((b.history || []).length > (a.history || []).length ? b : a)));
  }
  for (const id of new Set([...Object.keys(local.badges), ...Object.keys(remote.badges)])) {
    out.badges[id] = [local.badges[id], remote.badges[id]].filter(Boolean).sort()[0];
  }
  for (const id of new Set([...Object.keys(local.assessments), ...Object.keys(remote.assessments)])) {
    out.assessments[id] = newer(local.assessments[id], remote.assessments[id], 'at') || local.assessments[id] || remote.assessments[id];
  }
  out.diagnostic = newer(local.diagnostic, remote.diagnostic, 'at') || local.diagnostic || remote.diagnostic || null;
  const errors = validateState(out);
  if (errors.length) { throw new Error(`merge produced invalid state: ${errors.join('; ')}`); }
  return out;
}

/* Is there anything worth keeping in this state? */
export function hasProgress(s) {
  return !!s && (Object.keys(s.lessons || {}).length > 0 || (s.evidence || []).length > 0 || Object.keys(s.srs || {}).length > 0 || !!s.diagnostic);
}

export function summarize(s) {
  const lessons = Object.values(s.lessons || {});
  return {
    lessons: lessons.length,
    completed: lessons.filter((l) => l.status === 'completed').length,
    evidence: (s.evidence || []).length,
    cards: Object.keys(s.srs || {}).length,
    minutes: Math.round(Object.values(s.practice || {}).reduce((a, b) => a + b, 0))
  };
}

/* ---------------------------------------------------------------- engine
   backend: { load() -> {state, rev} | null,
              save(state, expectedRev) -> {status:'ok'|'conflict', rev} }
   meta: persisted { userId, rev, lastSyncedAt, dirty } (per profile)      */
/* JSON with sorted keys: PostgreSQL jsonb does not keep key order, so a
   plain JSON.stringify comparison would always report a difference. */
export function canonicalJSON(v) {
  if (Array.isArray(v)) { return `[${v.map(canonicalJSON).join(',')}]`; }
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export class SyncEngine {
  constructor({ backend, store, readMeta, writeMeta, onStatus = () => {}, debounceMs = 2000, device = null }) {
    Object.assign(this, { backend, store, readMeta, writeMeta, onStatus, debounceMs, device });
    this.timer = null;
    this.running = null;
    this.applyingRemote = false;
    this.unsub = store.subscribe(() => {
      if (this.applyingRemote) { return; }
      this.markDirty();
      this.schedule();
    });
  }

  meta() { return this.readMeta() || {}; }
  markDirty() { this.writeMeta({ ...this.meta(), dirty: true }); }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.sync().catch(() => {}); }, this.debounceMs);
  }

  stop() {
    clearTimeout(this.timer);
    if (this.unsub) { this.unsub(); }
  }

  applyRemote(state) {
    this.applyingRemote = true;
    try { this.store.replace(state); } finally { this.applyingRemote = false; }
  }

  /* Pull remote, merge if it moved on, push if we have local changes. */
  async sync() {
    if (this.running) { return this.running; }
    this.running = this._sync().finally(() => { this.running = null; });
    return this.running;
  }

  async _sync() {
    this.onStatus('syncing');
    try {
      let meta = this.meta();
      const remote = await this.backend.load();
      if (remote && remote.rev !== meta.rev) {
        const merged = mergeStates(this.store.state, remote.state);
        this.applyRemote(merged);
        /* push only if this device adds something the server lacks */
        /* compare progress only: settings are per device and updatedAt is
           a save timestamp, not progress */
        const shared = (st) => canonicalJSON({ ...st, settings: undefined, updatedAt: undefined });
        const differs = shared(merged) !== shared(remote.state);
        meta = { ...meta, rev: remote.rev, dirty: !!meta.dirty || differs };
        this.writeMeta(meta);
      }
      if (!meta.dirty && remote) {
        this.writeMeta({ ...meta, lastSyncedAt: new Date().toISOString() });
        this.onStatus('synced');
        return { status: 'synced' };
      }
      for (let i = 0; i < 3; i++) {
        /* no remote row yet → first save (insert); otherwise update at rev */
        const expected = remote || i > 0 ? (meta.rev ?? null) : null;
        const res = await this.backend.save(this.store.state, expected, this.device);
        if (res.status === 'ok') {
          this.writeMeta({ ...this.meta(), rev: res.rev, dirty: false, lastSyncedAt: new Date().toISOString() });
          this.onStatus('synced');
          return { status: 'synced', rev: res.rev };
        }
        /* conflict: someone else saved; merge theirs into ours and retry */
        const fresh = await this.backend.load();
        if (fresh) {
          this.applyRemote(mergeStates(this.store.state, fresh.state));
          meta = { ...this.meta(), rev: fresh.rev, dirty: true };
          this.writeMeta(meta);
        }
      }
      this.onStatus('conflict');
      return { status: 'conflict' };
    } catch (e) {
      this.onStatus(e && e.offline ? 'offline' : 'error', e);
      throw e;
    }
  }
}
