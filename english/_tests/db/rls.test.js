/* Row Level Security tests — LOCAL PostgreSQL (PGlite) running the real
   migration with a Supabase-like auth emulation. They prove the SQL and the
   policies; they are not a test of a production Supabase project. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, createUser, as } from './pg.js';

let db; let A; let B;
const STATE = (tag) => JSON.stringify({ version: 2, tag, lessons: {}, evidence: [] });

async function confirmAdult(uid) {
  await as(db, uid, (tx) => tx.query("insert into efl_profiles (adult_confirmed, terms_version) values (true, 'efl-2026-11')"));
}
async function save(uid, tag, rev) {
  const r = await as(db, uid, (tx) => tx.query('select efl_save_state($1::jsonb, 2, $2, $3) as r', [STATE(tag), rev, 'test']));
  return r.rows[0].r;
}
async function rejects(promise, re) {
  await assert.rejects(promise, (e) => { assert.match(String(e.message), re); return true; });
}

before(async () => {
  db = await freshDb();
  A = await createUser(db, 'a@example.test');
  B = await createUser(db, 'b@example.test');
  await confirmAdult(A);
  await confirmAdult(B);
  assert.deepEqual(await save(A, 'A1', null), { status: 'ok', rev: 1 });
  assert.deepEqual(await save(B, 'B1', null), { status: 'ok', rev: 1 });
});

test('each user only sees their own rows', async () => {
  const a = await as(db, A, (tx) => tx.query('select user_id, state->>\'tag\' as tag from efl_learner_state'));
  assert.deepEqual(a.rows, [{ user_id: A, tag: 'A1' }]);
  const b = await as(db, B, (tx) => tx.query('select * from efl_profiles'));
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0].user_id, B);
});

test('A cannot read B by filtering explicitly on B\'s id', async () => {
  const r = await as(db, A, (tx) => tx.query('select * from efl_learner_state where user_id = $1', [B]));
  assert.equal(r.rows.length, 0);
});

test('A cannot update or delete B\'s rows (0 rows affected, B unchanged)', async () => {
  const u = await as(db, A, (tx) => tx.query("update efl_learner_state set state = '{\"version\":2,\"tag\":\"hacked\"}' where user_id = $1", [B]));
  assert.equal(u.affectedRows, 0);
  const d = await as(db, A, (tx) => tx.query('delete from efl_learner_state where user_id = $1', [B]));
  assert.equal(d.affectedRows, 0);
  const d2 = await as(db, A, (tx) => tx.query('delete from efl_profiles where user_id = $1', [B]));
  assert.equal(d2.affectedRows, 0);
  const b = await as(db, B, (tx) => tx.query("select state->>'tag' as tag from efl_learner_state"));
  assert.equal(b.rows[0].tag, 'B1');
});

test('A cannot insert rows on behalf of B (forged user_id)', async () => {
  const C = await createUser(db, 'c@example.test');
  await rejects(as(db, A, (tx) => tx.query("insert into efl_profiles (user_id, adult_confirmed, terms_version) values ($1, true, 'x')", [C])), /row-level security/);
  await rejects(as(db, A, (tx) => tx.query("insert into efl_learner_state (user_id, state, state_version) values ($1, '{}', 2)", [C])), /row-level security|duplicate/);
});

test('A cannot move a row to another owner', async () => {
  await rejects(as(db, A, (tx) => tx.query('update efl_learner_state set user_id = $1 where user_id = $2', [B, A])), /row-level security|user_id cannot change|duplicate/);
  const a = await as(db, A, (tx) => tx.query('select count(*)::int as n from efl_learner_state'));
  assert.equal(a.rows[0].n, 1);
});

test('anonymous (public key) has no access at all', async () => {
  await rejects(as(db, null, (tx) => tx.query('select * from efl_learner_state')), /permission denied/);
  await rejects(as(db, null, (tx) => tx.query('select * from efl_profiles')), /permission denied/);
  await rejects(as(db, null, (tx) => tx.query("select efl_save_state('{}'::jsonb, 2, null)")), /permission denied/);
  await rejects(as(db, null, (tx) => tx.query('select efl_delete_my_account()')), /permission denied/);
});

test('progress cannot be saved without the 18+ confirmation', async () => {
  const D = await createUser(db, 'd@example.test');
  await rejects(as(db, D, (tx) => tx.query("select efl_save_state('{\"version\":2}'::jsonb, 2, null)")), /row-level security/);
  await rejects(as(db, D, (tx) => tx.query("insert into efl_profiles (adult_confirmed, terms_version) values (false, 'x')")), /check constraint/);
});

test('optimistic concurrency: a stale rev is a conflict and changes nothing', async () => {
  const ok = await save(A, 'A2', 1);
  assert.deepEqual(ok, { status: 'ok', rev: 2 });
  const stale = await save(A, 'A-stale', 1);
  assert.deepEqual(stale, { status: 'conflict', rev: 2 });
  const second = await save(A, 'A-dup-insert', null);
  assert.equal(second.status, 'conflict');
  const a = await as(db, A, (tx) => tx.query("select state->>'tag' as tag, rev from efl_learner_state"));
  assert.deepEqual(a.rows[0], { tag: 'A2', rev: 2 });
});

test('rev and updated_at are server-controlled', async () => {
  await as(db, A, (tx) => tx.query("update efl_learner_state set rev = 999, state = '{\"version\":2,\"tag\":\"A3\"}'"));
  const a = await as(db, A, (tx) => tx.query('select rev from efl_learner_state'));
  assert.equal(Number(a.rows[0].rev), 3);
});

test('a save by A can never touch B, even through the RPC', async () => {
  const before = await as(db, B, (tx) => tx.query('select rev from efl_learner_state'));
  await save(A, 'A4', 3);
  const after = await as(db, B, (tx) => tx.query("select rev, state->>'tag' as tag from efl_learner_state"));
  assert.equal(Number(after.rows[0].rev), Number(before.rows[0].rev));
  assert.equal(after.rows[0].tag, 'B1');
});

test('state must be a JSON object within the size limit', async () => {
  await rejects(as(db, A, (tx) => tx.query("select efl_save_state('[1,2]'::jsonb, 2, 4)")), /efl_state_is_object/);
  const big = JSON.stringify({ version: 2, blob: 'x'.repeat(3 * 1024 * 1024) });
  await rejects(as(db, A, (tx) => tx.query('select efl_save_state($1::jsonb, 2, 4)', [big])), /efl_state_size/);
});

test('delete my account removes only the caller and cascades', async () => {
  const E = await createUser(db, 'e@example.test');
  await confirmAdult(E);
  await save(E, 'E1', null);
  await as(db, E, (tx) => tx.query('select efl_delete_my_account()'));
  const users = await db.query('select id from auth.users where id = $1', [E]);
  assert.equal(users.rows.length, 0);
  const rows = await db.query('select count(*)::int as n from efl_learner_state where user_id = $1', [E]);
  assert.equal(rows.rows[0].n, 0);
  /* A and B are untouched */
  const others = await db.query('select count(*)::int as n from auth.users where id in ($1, $2)', [A, B]);
  assert.equal(others.rows[0].n, 2);
});

test('the delete function takes no user id: it cannot target someone else', async () => {
  await rejects(as(db, A, (tx) => tx.query('select efl_delete_my_account($1)', [B])), /function .* does not exist/);
});
