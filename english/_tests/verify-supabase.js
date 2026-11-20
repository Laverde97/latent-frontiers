#!/usr/bin/env node
/* Production RLS verification against a REAL Supabase project.
   Not run in CI: it needs a project and two throwaway test users.

   Usage (values only in environment variables, never committed):
     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_ANON_KEY=<public anon key> \
     EFL_TEST_A_EMAIL=... EFL_TEST_A_PASSWORD=... \
     EFL_TEST_B_EMAIL=... EFL_TEST_B_PASSWORD=... \
     npm run verify:supabase

   Create the two test users in the Supabase dashboard (Authentication →
   Users → Add user, "auto confirm"). Password sign-in is used ONLY by this
   script; the app itself uses one-time email codes. */
import { createClient } from '@supabase/supabase-js';

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
const url = env('SUPABASE_URL');
const key = env('SUPABASE_ANON_KEY');
if (/service_role/.test(Buffer.from((key.split('.')[1] || ''), 'base64').toString())) {
  console.error('Refusing to run with a service_role key: use the public anon key.');
  process.exit(2);
}
const mk = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function login(email, password) {
  const c = mk();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) { throw new Error(`login ${email}: ${error.message}`); }
  return { c, id: data.user.id };
}

const A = await login(env('EFL_TEST_A_EMAIL'), env('EFL_TEST_A_PASSWORD'));
const B = await login(env('EFL_TEST_B_EMAIL'), env('EFL_TEST_B_PASSWORD'));

for (const u of [A, B]) {
  const { error } = await u.c.from('efl_profiles').insert({ adult_confirmed: true, terms_version: 'verify' });
  if (error && error.code !== '23505') { throw error; }
}
const bRow = await B.c.from('efl_learner_state').select('rev').maybeSingle();
const bSave = await B.c.rpc('efl_save_state', { p_state: { version: 2, verify: 'B' }, p_state_version: 2, p_expected_rev: bRow.data ? bRow.data.rev : null, p_device: 'verify' });
check('B can save its own state', !bSave.error && bSave.data.status === 'ok', bSave.error && bSave.error.message);
const bBefore = await B.c.from('efl_learner_state').select('state,rev').maybeSingle();

let r = await A.c.from('efl_learner_state').select('user_id').eq('user_id', B.id);
check('A cannot read B (explicit filter)', !r.error && r.data.length === 0);
r = await A.c.from('efl_learner_state').select('user_id');
check('A only sees its own rows', !r.error && r.data.every((x) => x.user_id === A.id));
r = await A.c.from('efl_profiles').select('user_id').eq('user_id', B.id);
check('A cannot read B profile', !r.error && r.data.length === 0);
r = await A.c.from('efl_learner_state').update({ state: { version: 2, hacked: true } }).eq('user_id', B.id).select();
check('A cannot update B', !r.error ? r.data.length === 0 : true, r.error && r.error.message);
r = await A.c.from('efl_learner_state').delete().eq('user_id', B.id).select();
check('A cannot delete B', !r.error ? r.data.length === 0 : true, r.error && r.error.message);
r = await A.c.from('efl_learner_state').insert({ user_id: B.id, state: { version: 2 }, state_version: 2 });
check('A cannot insert as B', !!r.error, r.error && r.error.message);
r = await A.c.from('efl_profiles').insert({ user_id: B.id, adult_confirmed: true, terms_version: 'x' });
check('A cannot create a profile for B', !!r.error, r.error && r.error.message);
const anon = mk();
r = await anon.from('efl_learner_state').select('user_id');
check('anon key reads nothing', !!r.error || r.data.length === 0, r.error && r.error.message);
r = await anon.rpc('efl_delete_my_account');
check('anon cannot call delete', !!r.error, r.error && r.error.message);
const bAfter = await B.c.from('efl_learner_state').select('state,rev').maybeSingle();
check('B data unchanged after all attempts', JSON.stringify(bAfter.data) === JSON.stringify(bBefore.data));

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${new URL(url).host}`);
process.exit(failed ? 1 : 0);
