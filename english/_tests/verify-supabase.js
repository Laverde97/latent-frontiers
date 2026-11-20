#!/usr/bin/env node
/* =========================================================================
   Production verification against a REAL Supabase project.
   Not run in CI: it needs the project and two throwaway test mailboxes.

   It signs in exactly like the app does (one-time email code: signInWithOtp
   + verifyOtp type "email"), so no passwords are created or needed.

   Values only in environment variables (never committed):
     SUPABASE_URL        https://xxxx.supabase.co
     SUPABASE_ANON_KEY   public anon / publishable key (secret keys refused)
     EFL_TEST_A_EMAIL    test learner A
     EFL_TEST_B_EMAIL    test learner B (different mailbox)

   Step 1 — send the two codes:
     npm run verify:supabase -- --send
   Step 2 — run the checks with the codes received (within their validity):
     EFL_TEST_A_CODE=123456 EFL_TEST_B_CODE=654321 npm run verify:supabase
     (in an interactive terminal the codes can also be typed when asked)
   Add --delete-test-accounts to step 2 to also verify, for real, that
   "delete my account" removes only the caller (both test users end deleted).
   ========================================================================= */
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';

const args = new Set(process.argv.slice(2));
const env = (k, optional = false) => {
  const v = process.env[k];
  if (!v && !optional) { console.error(`Missing ${k}`); process.exit(2); }
  return v;
};

const url = env('SUPABASE_URL');
const key = env('SUPABASE_ANON_KEY');
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

const mk = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

/* ------------------------------------------------------------ step 1: send */
if (args.has('--send')) {
  for (const email of [emailA, emailB]) {
    const { error } = await mk().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    console.log(error ? `✗ code to ${email}: ${error.message}` : `✓ code sent to ${email}`);
    if (error) { process.exit(1); }
  }
  console.log('\nNow run step 2 with EFL_TEST_A_CODE and EFL_TEST_B_CODE (see the header of this file).');
  process.exit(0);
}

/* ----------------------------------------------------------- step 2: check */
async function askCode(label, email) {
  const fromEnv = env(`EFL_TEST_${label}_CODE`, true);
  if (fromEnv) { return fromEnv.trim(); }
  if (!process.stdin.isTTY) { console.error(`Missing EFL_TEST_${label}_CODE`); process.exit(2); }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = await rl.question(`Code received by ${email}: `);
  rl.close();
  return code.trim();
}

async function login(label, email) {
  const c = mk();
  const token = await askCode(label, email);
  const { data, error } = await c.auth.verifyOtp({ email, token, type: 'email' });
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
check('A and B signed in with an email code (same flow as the app)', A.id !== B.id);

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
async function saveOwn(u, tag) {
  const cur = await u.c.from('efl_learner_state').select('rev').maybeSingle();
  return u.c.rpc('efl_save_state', { p_state: { version: 2, verify: tag }, p_state_version: 2, p_expected_rev: cur.data ? cur.data.rev : null, p_device: 'verify' });
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
