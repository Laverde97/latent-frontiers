/* Local PostgreSQL (PGlite, WASM) with a minimal emulation of the parts of
   Supabase the migration relies on: the auth schema, auth.users,
   auth.uid() (same definition as Supabase: JWT "sub" claim) and the roles
   anon / authenticated. The real migration file is applied unchanged.

   These are LOCAL PostgreSQL tests of our SQL and RLS policies — not a test
   of a production Supabase project (see npm run verify:supabase). */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MIGRATION = readFileSync(join(repo, 'supabase', 'migrations', '0001_efl_accounts.sql'), 'utf8');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase's default privileges: every new table / function in public is
  -- granted to anon and authenticated. The migration must undo this itself.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

export async function freshDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(MIGRATION);
  return db;
}

export async function createUser(db, email) {
  const r = await db.query('insert into auth.users (email) values ($1) returning id', [email]);
  return r.rows[0].id;
}

/* Run fn(tx) as a signed-in user (role authenticated + JWT sub claim), or as
   anon when uid is null — the same way PostgREST executes API requests. */
export async function as(db, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(uid ? 'set local role authenticated' : 'set local role anon');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    return fn(tx);
  });
}
