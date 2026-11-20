#!/usr/bin/env node
/* =========================================================================
   Production verification against a REAL Supabase project.
   Not run in CI: it needs the project and two throwaway test mailboxes.

   It signs in passwordless, like the app (signInWithOtp). The email can be
   answered with the code ({{ .Token }} templates) or with the magic link of
   the DEFAULT template: copy the link (do not open it) and pass it in.

   Public values: SUPABASE_URL / SUPABASE_ANON_KEY, or read from the
   git-ignored english/_local/config.js. Test mailboxes in variables only:
     EFL_TEST_A_EMAIL    test learner A
     EFL_TEST_B_EMAIL    test learner B (different mailbox)

   Step 1 — send the two emails:
     npm run verify:supabase -- --send
   Step 2 — run the checks within the validity of the emails (1 h, single use):
     EFL_TEST_A_LINK='<link A>' EFL_TEST_B_LINK='<link B>' npm run verify:supabase
       or EFL_TEST_A_CODE=123456 EFL_TEST_B_CODE=654321 npm run verify:supabase
     (in an interactive terminal the code or link can also be pasted when asked)
   Add --delete-test-accounts to step 2 to also verify, for real, that
   "delete my account" removes only the caller (both test users end deleted).
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createBackend } from '../app/account/backend.js';
import { Store, memoryStorage, createInitialState, recordActivity, validateState } from '../app/core/store.js';
import { SyncEngine } from '../app/core/sync.js';
import { parseMagicLink } from './magic-link.js';

const args = new Set(process.argv.slice(2));
const env = (k, optional = false) => {
  const v = process.env[k];
  if (!v && !optional) { console.error(`Missing ${k}`); process.exit(2); }
  return v;
};

function localConfig() {
  try {
    const src = readFileSync(fileURLToPath(new URL('../_local/config.js', import.meta.url)), 'utf8');
    const pick = (k) => (src.match(new RegExp(`${k}\\s*:\\s*'([^']*)'`)) || [])[1] || '';
    return { url: pick('supabaseUrl'), key: pick('supabaseAnonKey') };
  } catch { return { url: '', key: '' }; }
}
const local = localConfig();
if (!process.env.SUPABASE_URL && local.url) { process.env.SUPABASE_URL = local.url; }
if (!process.env.SUPABASE_ANON_KEY && local.key) { process.env.SUPABASE_ANON_KEY = local.key; }
const url = env('SUPABASE_URL');
const key = env('SUPABASE_ANON_KEY');
console.log(`project ${new URL(url).host} · key type ${key.startsWith('sb_publishable_') ? 'publishable' : 'legacy anon JWT'}`);
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('SUPABASE_URL must look like https://<project-ref>.supabase.co (no trailing slash).');
  process.exit(2);
}
function isSecretKey(k) {
  if (/^sb_secret_/.test(k)) { return true; }
  try {
    const payload = JSON.parse(Buffer.from(k.split('.')[1] || '', 'base64url').toString());
    return payload.role === 'service_role';
  } catch { return false; }
}
if (isSecretKey(key)) {
  console.error('Refusing to run with a service_role / secret key: use the public anon (publishable) key.');
  process.exit(2);
}

const emailA = env('EFL_TEST_A_EMAIL');
const emailB = env('EFL_TEST_B_EMAIL');
if (emailA.toLowerCase() === emailB.toLowerCase()) { console.error('A and B must be different addresses.'); process.exit(2); }

/* implicit flow: the emailed token is not bound to a PKCE verifier, so the
   link can be verified here (the app itself uses PKCE in the browser) */
const mk = () => createClient(url, key, { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

/* ------------------------------------------------------------ step 1: send */
if (args.has('--send')) {
  for (const email of [emailA, emailB]) {
    const { error } = await mk().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    console.log(error ? `✗ code to ${email}: ${error.message}` : `✓ code sent to ${email}`);
    if (error) { process.exit(1); }
  }
  console.log('\nNow run step 2 with EFL_TEST_A_LINK / EFL_TEST_B_LINK (or _CODE). Copy the links; do not open them.');
  process.exit(0);
}

/* ----------------------------------------------------------- step 2: check */
async function askSecretOnce(label, email) {
  const fromEnv = env(`EFL_TEST_${label}_LINK`, true) || env(`EFL_TEST_${label}_CODE`, true);
  if (fromEnv) { return fromEnv.trim(); }
  if (!process.stdin.isTTY) { console.error(`Missing EFL_TEST_${label}_LINK or EFL_TEST_${label}_CODE`); process.exit(2); }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const v = await rl.question(`Link or code received by ${email}: `);
  rl.close();
  return v.trim();
}

async function login(label, email) {
  const c = mk();
  const value = await askSecretOnce(label, email);
  const link = parseMagicLink(value);
  const { data, error } = link
    ? await c.auth.verifyOtp({ token_hash: link.token_hash, type: link.type })
    : await c.auth.verifyOtp({ email, token: value, type: 'email' });
  if (error || !data.user) { throw new Error(`sign-in ${label} failed: ${error ? error.message : 'no user'}`); }
  return { c, id: data.user.id };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};
const msg = (r) => (r && r.error ? r.error.message : '');
/* a forged insert must fail because of RLS — a duplicate-key error would
   not prove anything */
const rlsDenied = (r) => !!r.error && /row-level security|permission denied/i.test(r.error.message);

const A = await login('A', emailA);
const B = await login('B', emailB);
check('A and B signed in passwordless (email link or code)', A.id !== B.id);

/* 18+ gate: a user without the confirmation row cannot store progress */
for (const [label, u] of [['A', A], ['B', B]]) {
  const has = await u.c.from('efl_profiles').select('user_id').maybeSingle();
  if (!has.data) {
    const early = await u.c.rpc('efl_save_state', { p_state: { version: 2 }, p_state_version: 2, p_expected_rev: null, p_device: 'verify' });
    check(`${label} cannot save progress before confirming 18+`, !!early.error, 'save was accepted');
    const ins = await u.c.from('efl_profiles').insert({ adult_confirmed: true, terms_version: 'verify' });
    check(`${label} can record its own 18+ confirmation`, !ins.error, msg(ins));
  } else {
    console.log(`· ${label} already had its 18+ row (re-run): gate check skipped`);
  }
}
let r = await A.c.from('efl_profiles').insert({ adult_confirmed: false, terms_version: 'x' });
check('adult_confirmed = false is rejected', !!r.error);

/* each saves its own state */
/* valid progress documents (the same format the app stores) */
function stateWith(lessonId) {
  const st = createInitialState();
  recordActivity(st, lessonId, 's1', { score: 1, max: 1, source: 'auto', skill: null });
  return st;
}
async function saveOwn(u, tag) {
  const cur = await u.c.from('efl_learner_state').select('rev').maybeSingle();
  return u.c.rpc('efl_save_state', { p_state: stateWith(`verify-${tag}`), p_state_version: 2, p_expected_rev: cur.data ? cur.data.rev : null, p_device: 'verify' });
}
let s = await saveOwn(A, 'A');
check('A can save its own state', !s.error && s.data.status === 'ok', msg(s));
s = await saveOwn(B, 'B');
check('B can save its own state', !s.error && s.data.status === 'ok', msg(s));
const bBefore = await B.c.from('efl_learner_state').select('state,rev').maybeSingle();

/* optimistic concurrency */
s = await B.c.rpc('efl_save_state', { p_state: { version: 2, verify: 'stale' }, p_state_version: 2, p_expected_rev: bBefore.data.rev - 1, p_device: 'verify' });
check('a stale rev is reported as a conflict', !s.error && s.data.status === 'conflict', msg(s));

/* A tries to reach B in every way the public API allows */
r = await A.c.from('efl_learner_state').select('user_id').eq('user_id', B.id);
check('A cannot read B (explicit filter)', !r.error && r.data.length === 0, msg(r));
r = await A.c.from('efl_learner_state').select('user_id');
check('A only sees its own row', !r.error && r.data.length === 1 && r.data[0].user_id === A.id, msg(r));
r = await A.c.from('efl_profiles').select('user_id');
check('A only sees its own 18+ row', !r.error && r.data.every((x) => x.user_id === A.id), msg(r));
r = await A.c.from('efl_learner_state').update({ state: { version: 2, hacked: true } }).eq('user_id', B.id).select();
check('A cannot update B', r.error ? true : r.data.length === 0);
r = await A.c.from('efl_learner_state').delete().eq('user_id', B.id).select();
check('A cannot delete B', r.error ? true : r.data.length === 0);
r = await A.c.from('efl_learner_state').insert({ user_id: B.id, state: { version: 2 }, state_version: 2 });
check('A cannot insert a row as B (denied by RLS)', rlsDenied(r), msg(r));
r = await A.c.from('efl_profiles').insert({ user_id: B.id, adult_confirmed: true, terms_version: 'x' });
check('A cannot create an 18+ row for B (denied by RLS)', rlsDenied(r), msg(r));
r = await A.c.from('efl_learner_state').update({ user_id: B.id }).eq('user_id', A.id).select();
check('A cannot move its row to B', !!r.error || r.data.length === 0);
r = await A.c.from('efl_profiles').update({ terms_version: 'changed' }).eq('user_id', A.id).select();
check('18+ rows are not editable', !!r.error || r.data.length === 0);

/* the public key alone */
const anon = mk();
r = await anon.from('efl_learner_state').select('user_id');
check('anon key reads no progress', !!r.error || r.data.length === 0);
r = await anon.from('efl_profiles').select('user_id');
check('anon key reads no 18+ rows', !!r.error || r.data.length === 0);
r = await anon.from('efl_learner_state').insert({ state: { version: 2 }, state_version: 2 });
check('anon key cannot insert', rlsDenied(r), msg(r));
r = await anon.rpc('efl_save_state', { p_state: { version: 2 }, p_state_version: 2, p_expected_rev: null, p_device: 'x' });
check('anon key cannot call save', !!r.error);
r = await anon.rpc('efl_delete_my_account');
check('anon key cannot call delete', !!r.error);

const bAfter = await B.c.from('efl_learner_state').select('state,rev').maybeSingle();
check('B data unchanged after all attempts by A and anon', JSON.stringify(bAfter.data) === JSON.stringify(bBefore.data));

/* real synchronisation: A on two devices, with the app's own SyncEngine */
async function device(u, name, seedLesson) {
  const store = new Store(memoryStorage(), `efl-progress:${name}`);
  store.update((st) => { recordActivity(st, seedLesson, 's1', { score: 1, max: 1, source: 'auto', skill: null }); });
  let meta = {};
  const statuses = [];
  const engine = new SyncEngine({ backend: createBackend(u.c), store, device: name, debounceMs: 60_000,
    readMeta: () => meta, writeMeta: (m) => { meta = m; }, onStatus: (st) => statuses.push(st) });
  return { store, engine, statuses, meta: () => meta };
}
const sessionA = (await A.c.auth.getSession()).data.session;
const A2 = mk();
await A2.auth.setSession({ access_token: sessionA.access_token, refresh_token: sessionA.refresh_token });
const d1 = await device(A, 'laptop', 'w01-l1');
const d2 = await device({ c: A2 }, 'phone', 'w01-l2');
const r1 = await d1.engine.sync();
const r2 = await d2.engine.sync();
const r3 = await d1.engine.sync();
const has = (d, id) => !!d.store.state.lessons[id];
check('sync: device 1 and device 2 both report synced', [r1, r2, r3].every((x) => x && x.status === 'synced'), JSON.stringify([r1, r2, r3]));
check('sync: both devices end with the union (w01-l1 + w01-l2 + earlier progress)',
  has(d1, 'w01-l1') && has(d1, 'w01-l2') && has(d2, 'w01-l1') && has(d2, 'w01-l2') && has(d1, 'verify-A'));
check('sync: both devices agree on the server revision', d1.meta().rev === d2.meta().rev && d1.meta().rev > 1);
const remoteA = await A.c.from('efl_learner_state').select('state,rev').maybeSingle();
const errs = validateState(remoteA.data.state);
check('sync: the stored document is valid and equals the devices\' state',
  errs.length === 0 && remoteA.data.rev === d1.meta().rev && JSON.stringify(remoteA.data.state.lessons) === JSON.stringify(d1.store.state.lessons), errs.join('; '));
const bSync = await B.c.from('efl_learner_state').select('state').maybeSingle();
check('sync: none of A\'s progress reached B', !bSync.data.state.lessons['w01-l1'] && !bSync.data.state.lessons['w01-l2'] && !bSync.data.state.lessons['verify-A']);
d1.engine.stop(); d2.engine.stop();

/* real account deletion (opt-in: deletes both test users) */
if (args.has('--delete-test-accounts')) {
  r = await A.c.rpc('efl_delete_my_account');
  check('A can delete its own account', !r.error, msg(r));
  r = await A.c.from('efl_learner_state').select('user_id');
  check('A data is gone after deletion', !!r.error || r.data.length === 0);
  const bStill = await B.c.from('efl_learner_state').select('state,rev').maybeSingle();
  check('deleting A did not touch B', JSON.stringify(bStill.data) === JSON.stringify(bBefore.data));
  r = await B.c.rpc('efl_delete_my_account');
  check('B can delete its own account (cleanup)', !r.error, msg(r));
  r = await B.c.from('efl_learner_state').select('user_id');
  check('B data is gone after deletion', !!r.error || r.data.length === 0);
} else {
  console.log('· account deletion not exercised (add --delete-test-accounts)');
}

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${new URL(url).host}`);
process.exit(failed ? 1 : 0);
