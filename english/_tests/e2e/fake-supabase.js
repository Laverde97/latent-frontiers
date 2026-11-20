/* Test double for Supabase used by the account E2E tests.

   - The browser loads a tiny fake of the supabase-js surface we use
     (served in place of app/vendor/…umd.js through page.route, so the
     production code has no test hooks).
   - Every data request goes, through a Playwright binding, to a REAL local
     PostgreSQL (PGlite) where the production migration and its Row Level
     Security policies are installed. Requests run as role "authenticated"
     with the user id bound to the session token, like PostgREST does.
   - Auth itself is simulated: the "email code" is always 246810.

   So: authorisation decisions are made by PostgreSQL/RLS; authentication,
   email delivery and networking are simulated. This is NOT a production
   test (see npm run verify:supabase). */
import { randomUUID } from 'node:crypto';
import { freshDb, as } from '../db/pg.js';

export const CODE = '246810';
export const FAKE_URL = 'http://localhost:54321';

const TABLES = {
  efl_learner_state: ['user_id', 'state', 'state_version', 'rev', 'device', 'updated_at'],
  efl_profiles: ['user_id', 'adult_confirmed', 'terms_version', 'created_at']
};
const RPCS = {
  efl_save_state: (a) => ['select public.efl_save_state($1::jsonb, $2, $3, $4) as r', [JSON.stringify(a.p_state), a.p_state_version, a.p_expected_rev, a.p_device ?? null]],
  efl_delete_my_account: () => ['select public.efl_delete_my_account() as r', []]
};

export async function createFakeServer() {
  const db = await freshDb();
  const tokens = new Map();
  const server = { db, tokens, offline: false, otp: new Set() };

  const err = (e) => ({ data: null, error: { message: String(e.message || e), code: e.code || null } });
  const cols = (table, list) => {
    const all = TABLES[table];
    if (!all) { throw Object.assign(new Error(`relation "${table}" does not exist`), { code: '42P01' }); }
    for (const c of list) { if (!all.includes(c)) { throw Object.assign(new Error(`column "${c}" does not exist`), { code: '42703' }); } }
    return list;
  };
  const where = (table, filters, start) => {
    const parts = []; const vals = [];
    filters.forEach(([c, v], i) => { cols(table, [c]); parts.push(`${c} = $${start + i}`); vals.push(v); });
    return { sql: parts.length ? ` where ${parts.join(' and ')}` : '', vals };
  };

  server.handle = async (req) => {
    if (server.offline) { return { data: null, error: { message: 'Failed to fetch' } }; }
    try {
      if (req.action === 'otp') { server.otp.add(req.email.toLowerCase()); return { data: {}, error: null }; }
      if (req.action === 'verify') {
        if (req.code !== CODE || !server.otp.has(req.email.toLowerCase())) { return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } }; }
        const email = req.email.toLowerCase();
        let r = await db.query('select id from auth.users where email = $1', [email]);
        if (!r.rows.length) { r = await db.query('insert into auth.users (email) values ($1) returning id', [email]); }
        const user = { id: r.rows[0].id, email };
        const token = randomUUID();
        tokens.set(token, user.id);
        return { data: { user, session: { access_token: token, user } }, error: null };
      }
      if (req.action === 'signout') { tokens.delete(req.token); return { data: {}, error: null }; }
      const uid = tokens.get(req.token) || null;
      if (req.action === 'rpc') {
        const fn = RPCS[req.name];
        if (!fn) { return err({ message: `function ${req.name} does not exist`, code: '42883' }); }
        const [sql, params] = fn(req.args || {});
        const r = await as(db, uid, (tx) => tx.query(sql, params));
        if (req.name === 'efl_delete_my_account') { for (const [k, v] of tokens) { if (v === uid) { tokens.delete(k); } } }
        return { data: r.rows[0].r ?? null, error: null };
      }
      const table = req.table;
      if (req.action === 'select') {
        const list = cols(table, req.cols.split(',').map((c) => c.trim()));
        const w = where(table, req.filters || [], 1);
        const r = await as(db, uid, (tx) => tx.query(`select ${list.join(', ')} from public.${table}${w.sql}`, w.vals));
        if (req.single) {
          if (r.rows.length > 1) { return err({ message: 'multiple rows', code: 'PGRST116' }); }
          return { data: r.rows[0] || null, error: null };
        }
        return { data: r.rows, error: null };
      }
      if (req.action === 'insert') {
        const keys = cols(table, Object.keys(req.row));
        const vals = keys.map((k) => (k === 'state' ? JSON.stringify(req.row[k]) : req.row[k]));
        const ph = keys.map((k, i) => (k === 'state' ? `$${i + 1}::jsonb` : `$${i + 1}`));
        await as(db, uid, (tx) => tx.query(`insert into public.${table} (${keys.join(', ')}) values (${ph.join(', ')})`, vals));
        return { data: null, error: null };
      }
      if (req.action === 'update') {
        const keys = cols(table, Object.keys(req.row));
        const sets = keys.map((k, i) => `${k} = $${i + 1}${k === 'state' ? '::jsonb' : ''}`);
        const vals = keys.map((k) => (k === 'state' ? JSON.stringify(req.row[k]) : req.row[k]));
        const w = where(table, req.filters || [], keys.length + 1);
        const r = await as(db, uid, (tx) => tx.query(`update public.${table} set ${sets.join(', ')}${w.sql}`, [...vals, ...w.vals]));
        return { data: null, error: null, count: r.affectedRows };
      }
      if (req.action === 'delete') {
        const w = where(table, req.filters || [], 1);
        const r = await as(db, uid, (tx) => tx.query(`delete from public.${table}${w.sql}`, w.vals));
        return { data: null, error: null, count: r.affectedRows };
      }
      return err({ message: `unsupported ${req.action}` });
    } catch (e) {
      return err(e);
    }
  };
  return server;
}

/* Browser-side fake of the supabase-js API surface used by the app. */
export const FAKE_LIB = `
window.supabase = { createClient(url, key, opts) {
  var SKEY = 'efl-fake-session';
  var session = null;
  try { session = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) {}
  var subs = [];
  function emit(ev) { subs.forEach(function (cb) { cb(ev, session); }); }
  function call(req) { req.token = session && session.access_token; return window.__eflBackend(req); }
  function builder(table) {
    var q = { table: table, filters: [] };
    var b = {
      select: function (c) { q.action = 'select'; q.cols = c; return b; },
      insert: function (row) { q.action = 'insert'; q.row = row; return call(q); },
      update: function (row) { q.action = 'update'; q.row = row; return b; },
      delete: function () { q.action = 'delete'; return b; },
      eq: function (c, v) { q.filters.push([c, v]); return b; },
      maybeSingle: function () { q.single = true; return call(q); },
      then: function (res, rej) { return call(q).then(res, rej); }
    };
    return b;
  }
  return {
    auth: {
      getSession: async function () { return { data: { session: session } }; },
      onAuthStateChange: function (cb) { subs.push(cb); return { data: { subscription: { unsubscribe: function () { subs = subs.filter(function (x) { return x !== cb; }); } } } }; },
      signInWithOtp: async function (o) { return call({ action: 'otp', email: o.email }); },
      verifyOtp: async function (o) {
        var r = await call({ action: 'verify', email: o.email, code: o.token });
        if (r.error) { return r; }
        session = r.data.session; localStorage.setItem(SKEY, JSON.stringify(session)); emit('SIGNED_IN'); return r;
      },
      signOut: async function () { await call({ action: 'signout' }); session = null; localStorage.removeItem(SKEY); emit('SIGNED_OUT'); return { error: null }; }
    },
    from: builder,
    rpc: function (name, args) { return call({ action: 'rpc', name: name, args: args }); }
  };
} };
`;

/* Wire a browser context to the fake server. */
export async function attach(context, server) {
  await context.exposeBinding('__eflBackend', (_src, req) => server.handle(req));
  await context.route('**/english/app/config.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export const ACCOUNT_CONFIG = { supabaseUrl: '${FAKE_URL}', supabaseAnonKey: 'public-anon-test-key', termsVersion: 'efl-2026-11' };`
  }));
  await context.route('**/english/app/vendor/supabase-js-*.umd.js', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_LIB }));
}
