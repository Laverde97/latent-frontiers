import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileRegistry, profileStorageKey, DEFAULT_PROFILE_ID, PROFILES_KEY } from '../../app/core/profiles.js';
import { Store, memoryStorage, createInitialState, recordActivity, completeLesson, validateState, STORAGE_KEY } from '../../app/core/store.js';
import { mergeStates, hasProgress, summarize, SyncEngine } from '../../app/core/sync.js';
import { newCard, review } from '../../app/core/srs.js';

/* ---- local profiles ---------------------------------------------------- */
test('default profile keeps the original key; others are isolated', () => {
  const mem = memoryStorage();
  const legacy = createInitialState();
  recordActivity(legacy, 'w01-l1', 's1', { score: 1, max: 1, source: 'auto', skill: null });
  mem.setItem(STORAGE_KEY, JSON.stringify(legacy));
  const reg = new ProfileRegistry(mem);
  assert.equal(reg.activeId(), DEFAULT_PROFILE_ID);
  assert.equal(profileStorageKey(DEFAULT_PROFILE_ID), 'efl-progress');
  const def = new Store(mem, profileStorageKey(DEFAULT_PROFILE_ID));
  assert.ok(def.state.lessons['w01-l1'], 'pre-existing progress is still there');

  const ana = reg.create('Ana');
  reg.setActive(ana.id);
  const s2 = new Store(mem, profileStorageKey(ana.id));
  assert.deepEqual(s2.state.lessons, {}, 'a new profile starts empty');
  s2.update((s) => { recordActivity(s, 'w01-l2', 's1', { score: 1, max: 1, source: 'auto', skill: null }); });
  const again = new Store(mem, profileStorageKey(DEFAULT_PROFILE_ID));
  assert.equal(again.state.lessons['w01-l2'], undefined, 'profiles never mix');
  assert.equal(new ProfileRegistry(mem).activeId(), ana.id, 'active profile persists');
});

test('profile names are validated; default cannot be removed; removal deletes data', () => {
  const mem = memoryStorage();
  const reg = new ProfileRegistry(mem);
  assert.throws(() => reg.create('   '), /invalid-name/);
  assert.throws(() => reg.create('x'.repeat(31)), /invalid-name/);
  assert.throws(() => reg.remove(DEFAULT_PROFILE_ID), /cannot-remove-default/);
  const p = reg.create('Hermano');
  mem.setItem(profileStorageKey(p.id), '{}');
  reg.setActive(p.id);
  reg.remove(p.id);
  assert.equal(mem.getItem(profileStorageKey(p.id)), null);
  assert.equal(reg.activeId(), DEFAULT_PROFILE_ID);
});

test('corrupt registry falls back to the default profile', () => {
  const mem = memoryStorage();
  mem.setItem(PROFILES_KEY, '{oops');
  assert.equal(new ProfileRegistry(mem).activeId(), DEFAULT_PROFILE_ID);
});

test('one account can be linked to only one local profile', () => {
  const reg = new ProfileRegistry(memoryStorage());
  const p = reg.create('B');
  reg.link(DEFAULT_PROFILE_ID, { userId: 'u1', email: 'a@x' });
  assert.throws(() => reg.link(p.id, { userId: 'u1' }), /account-linked-elsewhere/);
  assert.equal(reg.profileForUser('u1').id, DEFAULT_PROFILE_ID);
  reg.link(DEFAULT_PROFILE_ID, null);
  assert.equal(reg.profileForUser('u1'), null);
});

/* ---- merge -------------------------------------------------------------- */
function deviceA() {
  const s = createInitialState(new Date('2026-11-01T10:00:00Z'));
  recordActivity(s, 'w01-l1', 's1', { score: 3, max: 5, source: 'auto', skill: null }, new Date('2026-11-01T10:05:00Z'));
  recordActivity(s, 'w01-l1', 's2', { score: 5, max: 5, source: 'auto', skill: 'listening' }, new Date('2026-11-01T10:10:00Z'));
  s.practice['2026-11-01'] = 20;
  s.srs.hello = review(newCard(new Date('2026-11-01T10:00:00Z')), 4, new Date('2026-11-01T10:00:00Z'));
  s.badges.firstLesson = '2026-11-01T11:00:00Z';
  return s;
}
function deviceB() {
  const s = createInitialState(new Date('2026-10-30T09:00:00Z'));
  recordActivity(s, 'w01-l1', 's1', { score: 5, max: 5, source: 'auto', skill: null }, new Date('2026-11-02T08:00:00Z'));
  recordActivity(s, 'w01-l3', 's1', { score: 2, max: 5, source: 'auto', skill: null }, new Date('2026-11-02T08:30:00Z'));
  recordActivity(s, 'studio', 'shadow', { score: 9, max: 12, source: 'self', skill: 'speaking' }, new Date('2026-11-02T09:00:00Z'));
  s.practice['2026-11-01'] = 5;
  s.practice['2026-11-02'] = 30;
  s.srs.hello = review(review(newCard(new Date('2026-11-01T10:00:00Z')), 4, new Date('2026-11-01T10:00:00Z')), 1, new Date('2026-11-02T08:00:00Z'));
  s.badges.firstLesson = '2026-11-02T08:00:00Z';
  s.settings.esSupport = false;
  return s;
}

test('merge keeps everything from both devices', () => {
  const a = deviceA();
  const b = deviceB();
  const m = mergeStates(a, b);
  assert.deepEqual(validateState(m), []);
  assert.ok(m.lessons['w01-l3'], 'lesson only on B kept');
  assert.ok(m.lessons.studio, 'studio practice kept');
  const s1 = m.lessons['w01-l1'].activities.s1;
  assert.equal(s1.score, 5, 'most recent result wins');
  assert.equal(s1.best, 1);
  assert.ok(m.lessons['w01-l1'].activities.s2, 'activity only on A kept');
  assert.equal(m.evidence.length, a.evidence.length + b.evidence.length, 'no evidence lost');
  assert.equal(m.practice['2026-11-01'], 20);
  assert.equal(m.practice['2026-11-02'], 30);
  assert.equal(m.srs.hello.lapses, 1, 'most recently reviewed card wins');
  assert.equal(m.badges.firstLesson, '2026-11-01T11:00:00Z', 'earliest award kept');
  assert.equal(m.createdAt, b.createdAt);
  assert.equal(m.settings.esSupport, true, 'settings of the current (local) device');
});

test('merge is idempotent and evidence-commutative', () => {
  const a = deviceA();
  const b = deviceB();
  const ab = mergeStates(a, b);
  assert.deepEqual(mergeStates(ab, b).evidence, ab.evidence);
  assert.deepEqual(mergeStates(ab, ab).lessons, ab.lessons);
  const ba = mergeStates(b, a);
  assert.deepEqual(ba.evidence, ab.evidence);
  assert.deepEqual(ba.lessons, ab.lessons);
  assert.deepEqual(ba.srs, ab.srs);
});

test('a completed lesson stays completed after merging with an older copy', () => {
  const a = deviceA();
  const done = JSON.parse(JSON.stringify(a));
  for (const id of ['s3']) { recordActivity(done, 'w01-l1', id, { score: 1, max: 1, source: 'auto', skill: null }, new Date('2026-11-03T00:00:00Z')); }
  completeLesson(done, 'w01-l1', ['s1', 's2', 's3'], 0.7, new Date('2026-11-03T00:00:00Z'));
  const m = mergeStates(a, done);
  assert.equal(m.lessons['w01-l1'].status, 'completed');
  assert.equal(mergeStates(done, a).lessons['w01-l1'].status, 'completed');
});

test('hasProgress / summarize', () => {
  assert.equal(hasProgress(createInitialState()), false);
  assert.equal(hasProgress(deviceA()), true);
  /* deviceB: only the studio activity has a skill → 1 evidence entry */
  assert.deepEqual(summarize(deviceB()), { lessons: 3, completed: 0, evidence: 1, cards: 1, minutes: 35 });
});

/* ---- sync engine with an in-memory backend ------------------------------ */
function memoryBackend() {
  let row = null;
  return {
    calls: [],
    async load() { this.calls.push('load'); return row ? { state: JSON.parse(JSON.stringify(row.state)), rev: row.rev } : null; },
    async save(state, expectedRev) {
      this.calls.push(`save:${expectedRev}`);
      if (expectedRev == null) {
        if (row) { return { status: 'conflict', rev: row.rev }; }
        row = { state: JSON.parse(JSON.stringify(state)), rev: 1 };
        return { status: 'ok', rev: 1 };
      }
      if (!row || row.rev !== expectedRev) { return { status: 'conflict', rev: row && row.rev }; }
      row = { state: JSON.parse(JSON.stringify(state)), rev: row.rev + 1 };
      return { status: 'ok', rev: row.rev };
    },
    peek() { return row; }
  };
}
function engineFor(backend, initial) {
  const mem = memoryStorage();
  const store = new Store(mem, 'k');
  if (initial) { store.replace(initial); }
  let meta = null;
  const statuses = [];
  const eng = new SyncEngine({ backend, store, readMeta: () => meta, writeMeta: (m) => { meta = m; }, onStatus: (s) => statuses.push(s), debounceMs: 5 });
  return { store, eng, statuses, meta: () => meta };
}

test('two devices sync through the backend without losing work', async () => {
  const backend = memoryBackend();
  const d1 = engineFor(backend, deviceA());
  await d1.eng.sync();
  assert.equal(backend.peek().rev, 1);
  const d2 = engineFor(backend, deviceB());
  await d2.eng.sync();
  assert.equal(backend.peek().rev, 2);
  assert.ok(d2.store.state.lessons['w01-l1'].activities.s2, 'device 2 received device 1 work');
  await d1.eng.sync();
  assert.ok(d1.store.state.lessons['w01-l3'], 'device 1 received device 2 work');
  /* the merged document is pushed in the same sync */
  assert.equal(d1.meta().dirty, false);
  assert.equal(backend.peek().rev, 3);
  assert.ok(backend.peek().state.lessons['w01-l3'] && backend.peek().state.lessons['w01-l1'].activities.s2);
  d1.eng.stop(); d2.eng.stop();
});

test('a stale device gets a conflict, merges and retries', async () => {
  const backend = memoryBackend();
  const d1 = engineFor(backend, deviceA());
  const d2 = engineFor(backend, deviceB());
  await d1.eng.sync();
  await d2.eng.sync();
  /* d1 thinks rev=1 but server is at 2 → its push conflicts */
  d1.store.update((s) => { recordActivity(s, 'w01-l2', 's1', { score: 1, max: 1, source: 'auto', skill: null }); });
  await d1.eng.sync();
  const server = backend.peek().state;
  assert.ok(server.lessons['w01-l2'], 'new local work reached the server');
  assert.ok(server.lessons['w01-l3'], 'other device work preserved');
  d1.eng.stop(); d2.eng.stop();
});

test('offline errors are reported and nothing is lost', async () => {
  const backend = memoryBackend();
  backend.load = async () => { const e = new Error('Failed to fetch'); e.offline = true; throw e; };
  const d = engineFor(backend, deviceA());
  await assert.rejects(d.eng.sync());
  assert.equal(d.statuses.pop(), 'offline');
  assert.ok(d.store.state.lessons['w01-l1']);
  d.eng.stop();
});
