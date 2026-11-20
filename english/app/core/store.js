/* =========================================================================
   store.js — learning state, persistence, versioning and migrations.

   The whole learning record lives in one JSON document stored under
   STORAGE_KEY in localStorage (it stays small: no audio). Recordings are
   kept separately in IndexedDB (see audio/recording-db.js).

   Pure functions (createInitialState, migrate, validateState, record*)
   take and return plain objects so they can be unit-tested in Node. The
   Store class wraps them with a storage adapter and change listeners.
   ========================================================================= */

export const STATE_VERSION = 2;
export const STORAGE_KEY = 'efl-progress';
export const SKILLS = ['speaking', 'listening', 'reading', 'writing'];
/* Where a result comes from. Never mix them when reporting. */
export const SOURCES = ['auto', 'asr', 'self', 'pending'];

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createInitialState(now = new Date()) {
  return {
    version: STATE_VERSION,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    settings: {
      esSupport: true,
      studyMode: 'standard',
      rate: 0.9,
      voiceURI: null,
      micConsent: false,
      saveRecordings: false
    },
    lessons: {},
    evidence: [],
    practice: {},
    srs: {},
    diagnostic: null,
    assessments: {},
    badges: {},
    events: []
  };
}

/* ---- migrations -------------------------------------------------------
   Each entry upgrades a state from version N to N+1. Version 1 (the
   format used during development) stored per-lesson results under
   `lessonProgress` and minutes under `minutesByDay`. */
const MIGRATIONS = {
  0: (s) => ({ ...s, version: 1, lessonProgress: s.lessonProgress || {} }),
  1: (s) => {
    const next = { ...s, version: 2 };
    next.lessons = s.lessons || s.lessonProgress || {};
    next.practice = s.practice || s.minutesByDay || {};
    delete next.lessonProgress;
    delete next.minutesByDay;
    return next;
  }
};

export function migrate(input) {
  let s = { ...input };
  let v = Number.isInteger(s.version) ? s.version : 0;
  if (v > STATE_VERSION) {
    throw new Error(`Unsupported future version ${v}`);
  }
  while (v < STATE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) { throw new Error(`No migration from version ${v}`); }
    s = step(s);
    v = s.version;
  }
  /* fill any missing top-level keys with defaults */
  const base = createInitialState();
  for (const k of Object.keys(base)) {
    if (s[k] === undefined) { s[k] = base[k]; }
  }
  s.settings = { ...base.settings, ...(s.settings || {}) };
  return s;
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/* Structural validation. Returns a list of problems (empty = valid). */
export function validateState(s) {
  const errors = [];
  if (!isObj(s)) { return ['state is not an object']; }
  if (s.version !== STATE_VERSION) { errors.push('wrong version'); }
  if (!isObj(s.settings)) { errors.push('settings must be an object'); }
  if (!isObj(s.lessons)) { errors.push('lessons must be an object'); }
  if (!Array.isArray(s.evidence)) { errors.push('evidence must be an array'); }
  if (!isObj(s.practice)) { errors.push('practice must be an object'); }
  if (!isObj(s.srs)) { errors.push('srs must be an object'); }
  if (Array.isArray(s.evidence)) {
    s.evidence.forEach((e, i) => {
      if (!SKILLS.includes(e.skill)) { errors.push(`evidence[${i}].skill invalid`); }
      if (!SOURCES.includes(e.source)) { errors.push(`evidence[${i}].source invalid`); }
      if (e.source !== 'pending' && (typeof e.score !== 'number' || e.score < 0 || e.score > 1)) {
        errors.push(`evidence[${i}].score must be within 0..1`);
      }
    });
  }
  if (isObj(s.practice)) {
    for (const [day, min] of Object.entries(s.practice)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof min !== 'number' || min < 0) {
        errors.push(`practice.${day} invalid`);
      }
    }
  }
  if (isObj(s.lessons)) {
    for (const [id, l] of Object.entries(s.lessons)) {
      if (!isObj(l) || !isObj(l.activities || {})) { errors.push(`lessons.${id} invalid`); }
    }
  }
  return errors;
}

/* Parse + migrate + validate an exported document (string or object). */
export function importState(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, errors: ['invalid JSON'] }; }
  }
  if (!isObj(obj)) { return { ok: false, errors: ['not an object'] }; }
  if (obj.app && obj.app !== 'english-fluency-lab') {
    return { ok: false, errors: ['file belongs to another application'] };
  }
  const payload = isObj(obj.state) ? obj.state : obj;
  let migrated;
  try { migrated = migrate(payload); } catch (e) { return { ok: false, errors: [e.message] }; }
  const errors = validateState(migrated);
  return errors.length ? { ok: false, errors } : { ok: true, state: migrated };
}

export function exportState(state, now = new Date()) {
  return JSON.stringify({
    app: 'english-fluency-lab',
    exportedAt: now.toISOString(),
    state
  }, null, 2);
}

/* ---- pure updaters ------------------------------------------------------ */

export function ensureLesson(state, lessonId, now = new Date()) {
  if (!state.lessons[lessonId]) {
    state.lessons[lessonId] = {
      status: 'in_progress',
      startedAt: now.toISOString(),
      completedAt: null,
      attempts: 1,
      activities: {}
    };
  }
  return state.lessons[lessonId];
}

/* result: { score, max, source, skill, detail? } — score/max are raw. */
export function recordActivity(state, lessonId, activityId, result, now = new Date()) {
  const lesson = ensureLesson(state, lessonId, now);
  const prev = lesson.activities[activityId];
  const ratio = result.max > 0 ? result.score / result.max : null;
  const entry = {
    done: true,
    score: result.score,
    max: result.max,
    ratio,
    source: result.source,
    skill: result.skill,
    attempts: (prev ? prev.attempts : 0) + 1,
    best: prev && prev.best != null && ratio != null ? Math.max(prev.best, ratio) : ratio,
    lastAt: now.toISOString()
  };
  if (result.detail) { entry.detail = result.detail; }
  lesson.activities[activityId] = entry;
  if (result.skill && SKILLS.includes(result.skill)) {
    state.evidence.push({
      skill: result.skill,
      source: result.source,
      score: result.source === 'pending' ? null : (ratio == null ? 0 : ratio),
      lessonId,
      activityId,
      at: now.toISOString()
    });
    /* keep the log bounded */
    if (state.evidence.length > 2000) { state.evidence.splice(0, state.evidence.length - 2000); }
  }
  state.updatedAt = now.toISOString();
  return entry;
}

export function completeLesson(state, lessonId, requiredActivityIds, reviewThreshold = 0.7, now = new Date()) {
  const lesson = ensureLesson(state, lessonId, now);
  const missing = requiredActivityIds.filter((id) => !(lesson.activities[id] && lesson.activities[id].done));
  if (missing.length) { return { ok: false, missing }; }
  const autos = requiredActivityIds
    .map((id) => lesson.activities[id])
    .filter((a) => a.source === 'auto' && a.ratio != null);
  const autoMean = autos.length ? autos.reduce((t, a) => t + a.ratio, 0) / autos.length : null;
  const weak = requiredActivityIds.filter((id) => {
    const a = lesson.activities[id];
    return a.source === 'auto' && a.ratio != null && a.ratio < reviewThreshold;
  });
  if (lesson.status !== 'completed') { lesson.completedAt = now.toISOString(); }
  lesson.status = 'completed';
  lesson.autoMean = autoMean;
  lesson.needsReview = weak.length > 0;
  lesson.weakActivities = weak;
  state.updatedAt = now.toISOString();
  return { ok: true, autoMean, weak };
}

export function addPracticeMinutes(state, minutes, now = new Date()) {
  if (!(minutes > 0)) { return; }
  const k = todayKey(now);
  state.practice[k] = Math.round(((state.practice[k] || 0) + minutes) * 100) / 100;
}

export function awardBadge(state, id, now = new Date()) {
  if (state.badges[id]) { return false; }
  state.badges[id] = now.toISOString();
  return true;
}

/* ---- storage-backed store ---------------------------------------------- */

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  };
}

function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    const probe = '__efl_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { storage: ls, persistent: true };
  } catch (e) {
    return { storage: memoryStorage(), persistent: false };
  }
}

export class Store {
  constructor(storage) {
    if (storage) {
      this.storage = storage;
      this.persistent = true;
    } else {
      const s = safeLocalStorage();
      this.storage = s.storage;
      this.persistent = s.persistent;
    }
    this.listeners = new Set();
    this.notice = null;
    this.state = this.load();
  }

  load() {
    let raw = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) { return createInitialState(); }
    const res = importState(raw);
    if (res.ok) {
      if (res.state.version !== (JSON.parse(raw).version)) { this.notice = 'migrated'; }
      return res.state;
    }
    /* Corrupt or unreadable: keep a copy for manual recovery, start fresh. */
    try { this.storage.setItem(`${STORAGE_KEY}-corrupt-${Date.now()}`, raw); } catch (e) { /* ignore */ }
    this.notice = 'corrupt';
    return createInitialState();
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.saveError = null;
    } catch (e) {
      this.saveError = e;
    }
  }

  /* Mutate state through a function, then persist and notify. */
  update(fn) {
    const out = fn(this.state);
    this.save();
    this.listeners.forEach((l) => l(this.state));
    return out;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  replace(newState) {
    this.state = newState;
    this.save();
    this.listeners.forEach((l) => l(this.state));
  }

  reset() {
    this.replace(createInitialState());
  }
}
