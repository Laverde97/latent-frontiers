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
  /* device 1 adds nothing the server lacks: it adopts rev 2 without a
     redundant push (no endless write ping-pong between devices) */
  assert.equal(d1.meta().dirty, false);
  assert.equal(d1.meta().rev, 2);
  assert.equal(backend.peek().rev, 2);
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

test('accounts accept a publishable key and refuse secret / service_role keys', async () => {
  const { accountsConfigured, isSecretKey } = await import('../../app/account/auth.js');
  const url = 'https://abcdefghijklmnop.supabase.co';
  const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal(accountsConfigured({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_abc123' }), true);
    assert.equal(accountsConfigured({ supabaseUrl: url, supabaseAnonKey: jwt('anon') }), true);
    assert.equal(accountsConfigured({ supabaseUrl: url, supabaseAnonKey: 'sb_secret_abc123' }), false);
    assert.equal(accountsConfigured({ supabaseUrl: url, supabaseAnonKey: jwt('service_role') }), false);
    assert.equal(accountsConfigured({ supabaseUrl: 'https://evil.example.com', supabaseAnonKey: 'sb_publishable_x' }), false);
    assert.equal(accountsConfigured({ supabaseUrl: '', supabaseAnonKey: '' }), false);
    assert.equal(isSecretKey('sb_publishable_abc'), false);
  } finally { console.error = quiet; }
});

/* PostgreSQL jsonb returns keys in its own order (shorter keys first). */
function reorderKeys(v) {
  if (Array.isArray(v)) { return v.map(reorderKeys); }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).map((k) => [k, reorderKeys(v[k])]));
  }
  return v;
}

test('devices converge: after one round no more writes, even with jsonb key reordering and different settings', async () => {
  const backend = memoryBackend();
  const origLoad = backend.load.bind(backend);
  backend.load = async () => { const r = await origLoad(); return r && { ...r, state: reorderKeys(r.state) }; };
  const d1 = engineFor(backend, deviceA());
  const d2 = engineFor(backend, deviceB());
  d2.store.update((s) => { s.settings.rate = 1; s.settings.studyMode = 'essential'; });
  await d1.eng.sync(); await d2.eng.sync(); await d1.eng.sync();
  const rev = backend.peek().rev;
  for (let i = 0; i < 3; i++) { await d1.eng.sync(); await d2.eng.sync(); }
  assert.equal(backend.peek().rev, rev, 'no further writes once converged');
  assert.equal(d1.meta().rev, d2.meta().rev);
  assert.ok(d1.store.state.lessons['w01-l3'] && d2.store.state.lessons['w01-l1'].activities.s2);
  d1.eng.stop(); d2.eng.stop();
});

test('magic link of the default template is parsed; PKCE links and junk are refused', async () => {
  const { parseMagicLink } = await import('../magic-link.js');
  const link = 'https://abcd.supabase.co/auth/v1/verify?token=0123abcd&type=magiclink&redirect_to=https://laverde97.github.io/latent-frontiers/english/index.html?view=account';
  assert.deepEqual(parseMagicLink(link), { token_hash: '0123abcd', type: 'magiclink' });
  assert.deepEqual(parseMagicLink(`https://nam.safelinks.protection.outlook.com/?url=${encodeURIComponent(link)}`), { token_hash: '0123abcd', type: 'magiclink' });
  assert.deepEqual(parseMagicLink('https://abcd.supabase.co/auth/v1/verify?token=ff&type=signup'), { token_hash: 'ff', type: 'signup' });
  assert.throws(() => parseMagicLink('https://abcd.supabase.co/auth/v1/verify?token=pkce_ff&type=magiclink'), /PKCE/);
  assert.equal(parseMagicLink('123456'), null);
  assert.equal(parseMagicLink('https://example.com/?a=1'), null);
});

test('no push when the remote differs only in save timestamp or per-device settings (deterministic)', async () => {
  const backend = memoryBackend();
  const remote = deviceA();
  remote.updatedAt = '2026-01-01T00:00:00.000Z';
  await backend.save(remote, null);
  const local = JSON.parse(JSON.stringify(remote));
  local.updatedAt = '2026-12-31T23:59:59.999Z';
  local.settings.rate = 1.2;
  const d = engineFor(backend, local);
  await d.eng.sync();
  assert.equal(backend.peek().rev, 1, 'no redundant write');
  assert.equal(d.meta().rev, 1);
  assert.equal(d.meta().dirty, false);
  /* but real new progress is pushed */
  d.store.update((s) => { recordActivity(s, 'w01-l4', 's1', { score: 1, max: 1, source: 'auto', skill: null }); });
  await d.eng.sync();
  assert.equal(backend.peek().rev, 2);
  assert.ok(backend.peek().state.lessons['w01-l4']);
  d.eng.stop();
});

test('classifyOtpError maps provider responses without exposing addresses or tokens', async () => {
  const { classifyOtpError } = await import('../../app/account/auth.js');
  const err = (props) => Object.assign(new Error(props.message || 'x'), props);
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', code: 'email_address_not_authorized', status: 400, message: 'Email address "a@b.c" cannot be used' })), { kind: 'notAuthorized', code: 'email_address_not_authorized' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', code: 'over_email_send_rate_limit', status: 429 })), { kind: 'rateLimit', code: 'over_email_send_rate_limit' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', code: 'over_request_rate_limit', status: 429 })), { kind: 'rateLimit', code: 'over_request_rate_limit' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', status: 429 })), { kind: 'rateLimit', code: 'http_429' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', code: 'email_address_invalid', status: 400 })), { kind: 'invalidEmail', code: 'email_address_invalid' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })), { kind: 'network', code: 'network' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', code: 'email_provider_disabled', status: 400 })), { kind: 'config', code: 'email_provider_disabled' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthApiError', status: 500 })), { kind: 'config', code: 'http_500' });
  assert.deepEqual(classifyOtpError(null), { kind: 'config', code: 'unknown' });
  /* the code shown never contains the address from the message */
  assert.ok(!JSON.stringify(classifyOtpError(err({ code: 'email_address_not_authorized', message: 'Email address "a@b.c"' }))).includes('@'));
});

test('classifyOtpError falls back to status/message when the provider code is unavailable', async () => {
  const { classifyOtpError } = await import('../../app/account/auth.js');
  const err = (props) => Object.assign(new Error(props.message || 'x'), props);
  assert.equal(classifyOtpError(err({ name: 'AuthApiError', status: 400, message: 'Email address "a@b.c" cannot be used as it is not authorized' })).kind, 'notAuthorized');
  assert.equal(classifyOtpError(err({ name: 'AuthApiError', status: 400, message: 'email rate limit exceeded' })).kind, 'rateLimit');
  assert.deepEqual(classifyOtpError(err({ name: 'AuthRetryableFetchError', status: 500, message: '{}' })), { kind: 'config', code: 'http_500' });
  assert.deepEqual(classifyOtpError(err({ name: 'AuthRetryableFetchError', status: 502, message: 'Bad gateway' })), { kind: 'config', code: 'http_502' });
});
