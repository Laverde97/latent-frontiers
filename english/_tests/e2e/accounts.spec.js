/* Accounts & profiles E2E.
   Data requests hit a real local PostgreSQL with the production migration
   and RLS (see fake-supabase.js); authentication is simulated. */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FAKE_TTS, trackErrors, openLab, readData, solveExercises } from './helpers.js';
import { createFakeServer, attach, CODE } from './fake-supabase.js';

const lessonState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k === 'efl-progress' || k.startsWith('efl-progress:')) || 'efl-progress') || 'null'));

async function newDevice(browser, server) {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript(FAKE_TTS);
  if (server) { await attach(context, server); }
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  return { context, page };
}

async function doFirstVocabStep(page) {
  await openLab(page, '?view=lesson&id=w01-l1');
  await solveExercises(page, page.locator('.efl-stage'), readData('lessons/w01-l1.json').steps[0].exercises);
}

async function signIn(page, email, { adult = true, terms = true } = {}) {
  await openLab(page, '?view=account');
  const panel = page.locator('[data-testid="account-panel"]');
  await panel.locator('[data-testid="signin-email"]').fill(email);
  if (adult) { await panel.locator('[data-testid="signin-adult"]').check(); }
  if (terms) { await panel.locator('[data-testid="signin-terms"]').check(); }
  await panel.locator('[data-testid="signin-send"]').click();
  if (!adult || !terms) { return panel; }
  await panel.locator('[data-testid="signin-code"]').fill(CODE);
  await panel.locator('[data-testid="signin-verify"]').click();
  return panel;
}

async function serverRow(server, email) {
  const r = await server.db.query('select s.state, s.rev from efl_learner_state s join auth.users u on u.id = s.user_id where u.email = $1', [email]);
  return r.rows[0] || null;
}

test('without configuration: guest mode only, clear notice, isolated local profiles', async ({ browser }) => {
  const { context, page } = await newDevice(browser, null);
  const errors = trackErrors(page);
  await openLab(page, '?view=account');
  await expect(page.locator('[data-testid="accounts-not-configured"]')).toBeVisible();
  await doFirstVocabStep(page);
  /* create a second profile and switch to it */
  await openLab(page, '?view=account');
  await page.locator('[data-testid="new-profile-name"]').fill('Camila');
  await page.locator('[data-testid="create-profile"]').click();
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('[data-testid="profile-chip"]')).toContainText('Camila');
  await openLab(page);
  await expect(page.getByText('0 / 130')).toBeVisible();
  await expect(page.locator('[data-testid="dash-continue"]')).toHaveText(/Empezar|Start/);
  /* Camila does her own activity in lesson 2's prerequisite path (lesson 1, listening step) */
  await openLab(page, '?view=lesson&id=w01-l1');
  await page.locator('[data-step="s2"]').click();
  await solveExercises(page, page.locator('.efl-stage'), readData('lessons/w01-l1.json').steps[1].exercises);
  /* back to the main profile: its progress is intact */
  await openLab(page, '?view=account');
  await page.locator('[data-testid="use-profile-default"]').click();
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  await openLab(page);
  await expect(page.locator('[data-testid="dash-continue"]')).toHaveText(/Continuar|Continue/);
  const data = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('efl-progress')).map((k) => [k, Object.keys(JSON.parse(localStorage.getItem(k)).lessons['w01-l1'].activities)])));
  expect(Object.keys(data).length).toBe(2);
  expect(data['efl-progress']).toEqual(['s1']);
  const other = Object.keys(data).find((k) => k !== 'efl-progress');
  expect(data[other]).toEqual(['s2']);
  expect(errors).toEqual([]);
  await context.close();
});

test('sign-in requires 18+ and the data notice; code flow links an empty profile', async ({ browser }) => {
  const server = await createFakeServer();
  const { context, page } = await newDevice(browser, server);
  const errors = trackErrors(page);
  let panel = await signIn(page, 'minor@example.test', { adult: false });
  await expect(panel.locator('[data-testid="signin-msg"]')).toContainText(/18/);
  await expect(panel.locator('[data-testid="signin-code"]')).toBeHidden();
  panel = await signIn(page, 'ana@example.test');
  await expect(panel.locator('[data-testid="signed-in-email"]')).toHaveText('ana@example.test');
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const row = await serverRow(server, 'ana@example.test');
  expect(row).toBeTruthy();
  const prof = await server.db.query("select adult_confirmed, terms_version from efl_profiles p join auth.users u on u.id = p.user_id where u.email = 'ana@example.test'");
  expect(prof.rows[0]).toEqual({ adult_confirmed: true, terms_version: 'efl-2026-11' });
  await expect(page.locator('[data-testid="profile-chip"]')).toContainText(/sincronizado|synced/);
  /* wrong code */
  const { context: c2, page: p2 } = await newDevice(browser, server);
  await openLab(p2, '?view=account');
  const pn = p2.locator('[data-testid="account-panel"]');
  await pn.locator('[data-testid="signin-email"]').fill('ana@example.test');
  await pn.locator('[data-testid="signin-adult"]').check();
  await pn.locator('[data-testid="signin-terms"]').check();
  await pn.locator('[data-testid="signin-send"]').click();
  await pn.locator('[data-testid="signin-code"]').fill('000000');
  await pn.locator('[data-testid="signin-verify"]').click();
  await expect(pn.locator('[data-testid="signin-msg"]')).toContainText(/no es válido|invalid/);
  expect(errors).toEqual([]);
  await context.close(); await c2.close();
});

test('migration: local progress is uploaded only after an explicit choice', async ({ browser }) => {
  const server = await createFakeServer();
  const { context, page } = await newDevice(browser, server);
  await doFirstVocabStep(page);
  const panel = await signIn(page, 'bea@example.test');
  await expect(panel.locator('[data-testid="migration"]')).toBeVisible();
  expect(await serverRow(server, 'bea@example.test')).toBeNull();
  await panel.locator('[data-testid="mig-upload"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const row = await serverRow(server, 'bea@example.test');
  expect(row.state.lessons['w01-l1'].activities.s1.ratio).toBe(1);
  await context.close();
});

test('two devices: merge keeps both, with a local backup; changes flow both ways', async ({ browser }) => {
  const server = await createFakeServer();
  /* device 1: lesson 1 vocab, signs in, uploads */
  const d1 = await newDevice(browser, server);
  await doFirstVocabStep(d1.page);
  let panel = await signIn(d1.page, 'carlos@example.test');
  await panel.locator('[data-testid="mig-upload"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);

  /* device 2: has its own progress (lesson 1 listening), signs in, merges */
  const d2 = await newDevice(browser, server);
  await openLab(d2.page, '?view=lesson&id=w01-l1');
  await d2.page.locator('[data-step="s2"]').click();
  await d2.page.locator('[data-testid="player-play"]').click();
  await solveExercises(d2.page, d2.page.locator('.efl-stage'), readData('lessons/w01-l1.json').steps[1].exercises);
  panel = await signIn(d2.page, 'carlos@example.test');
  await expect(panel.locator('[data-testid="migration"]')).toContainText(/1 lecciones|1 lessons/);
  await panel.locator('[data-testid="mig-merge"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const backups = await d2.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('efl-progress-backup:')));
  expect(backups.length).toBe(1);
  let st = await lessonState(d2.page);
  expect(st.lessons['w01-l1'].activities.s1).toBeTruthy();
  expect(st.lessons['w01-l1'].activities.s2).toBeTruthy();

  /* device 1 pulls device 2's work */
  await openLab(d1.page, '?view=account');
  await d1.page.locator('[data-testid="sync-now"]').click();
  await expect(d1.page.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  st = await lessonState(d1.page);
  expect(st.lessons['w01-l1'].activities.s2).toBeTruthy();
  const row = await serverRow(server, 'carlos@example.test');
  expect(row.state.lessons['w01-l1'].activities.s1 && row.state.lessons['w01-l1'].activities.s2).toBeTruthy();
  await d1.context.close(); await d2.context.close();
});

test('use-account and replace-account need confirmation and behave as described', async ({ browser }) => {
  const server = await createFakeServer();
  const a = await newDevice(browser, server);
  await doFirstVocabStep(a.page);
  let panel = await signIn(a.page, 'dana@example.test');
  await panel.locator('[data-testid="mig-upload"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);

  /* device B with different local work chooses "use the account copy" */
  const b = await newDevice(browser, server);
  await openLab(b.page, '?view=lesson&id=w01-l2');
  await solveExercises(b.page, b.page.locator('.efl-stage'), readData('lessons/w01-l2.json').steps[0].exercises);
  panel = await signIn(b.page, 'dana@example.test');
  await panel.locator('[data-testid="mig-use-account"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const st = await lessonState(b.page);
  expect(st.lessons['w01-l2']).toBeUndefined();
  expect(st.lessons['w01-l1']).toBeTruthy();
  const backups = await b.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('efl-progress-backup:')).map((k) => JSON.parse(localStorage.getItem(k))));
  expect(backups[0].lessons['w01-l2']).toBeTruthy();

  /* device C replaces the account (two confirmations, auto-accepted here) */
  const c = await newDevice(browser, server);
  await openLab(c.page, '?view=lesson&id=w01-l3');
  await solveExercises(c.page, c.page.locator('.efl-stage'), readData('lessons/w01-l3.json').steps[0].exercises);
  const dialogs = [];
  c.page.removeAllListeners('dialog');
  c.page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  panel = await signIn(c.page, 'dana@example.test');
  await panel.locator('[data-testid="mig-replace"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  expect(dialogs.length).toBe(2);
  const row = await serverRow(server, 'dana@example.test');
  expect(Object.keys(row.state.lessons)).toEqual(['w01-l3']);
  await a.context.close(); await b.context.close(); await c.context.close();
});

test('request manipulation: user A cannot read or modify user B through the API', async ({ browser }) => {
  const server = await createFakeServer();
  const b = await newDevice(browser, server);
  await doFirstVocabStep(b.page);
  let panel = await signIn(b.page, 'b@example.test');
  await panel.locator('[data-testid="mig-upload"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const bId = (await server.db.query("select id from auth.users where email = 'b@example.test'")).rows[0].id;
  const before = await serverRow(server, 'b@example.test');

  const a = await newDevice(browser, server);
  panel = await signIn(a.page, 'a@example.test');
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const results = await a.page.evaluate(async (victim) => {
    const c = window.supabase.createClient('http://localhost:54321', 'public-anon-test-key', {});
    const out = {};
    out.readB = await c.from('efl_learner_state').select('user_id,state').eq('user_id', victim);
    out.readAll = await c.from('efl_learner_state').select('user_id');
    out.profilesB = await c.from('efl_profiles').select('user_id').eq('user_id', victim);
    out.updateB = await c.from('efl_learner_state').update({ state: { version: 2, hacked: true } }).eq('user_id', victim);
    out.deleteB = await c.from('efl_learner_state').delete().eq('user_id', victim);
    out.insertAsB = await c.from('efl_learner_state').insert({ user_id: victim, state: { version: 2 }, state_version: 2 });
    out.profileAsB = await c.from('efl_profiles').insert({ user_id: victim, adult_confirmed: true, terms_version: 'x' });
    out.moveToB = await c.from('efl_learner_state').update({ user_id: victim });
    return out;
  }, bId);
  expect(results.readB.data).toEqual([]);
  expect(results.readAll.data.length).toBe(1);
  expect(results.readAll.data[0].user_id).not.toBe(bId);
  expect(results.profilesB.data).toEqual([]);
  expect(results.updateB.count).toBe(0);
  expect(results.deleteB.count).toBe(0);
  expect(results.insertAsB.error.message).toMatch(/row-level security|duplicate/);
  expect(results.profileAsB.error.message).toMatch(/row-level security|duplicate/);
  expect(results.moveToB.error).toBeTruthy();
  const after = await serverRow(server, 'b@example.test');
  expect(after).toEqual(before);

  /* a signed-out (anon) client gets nothing */
  const anon = await a.page.evaluate(async () => {
    localStorage.removeItem('efl-fake-session');
    const c = window.supabase.createClient('http://localhost:54321', 'public-anon-test-key', {});
    return c.from('efl_learner_state').select('user_id');
  });
  expect(anon.error.message).toMatch(/permission denied/);
  await a.context.close(); await b.context.close();
});

test('sign out (keep / clear) and delete account', async ({ browser }) => {
  const server = await createFakeServer();
  const { context, page } = await newDevice(browser, server);
  await doFirstVocabStep(page);
  let panel = await signIn(page, 'eva@example.test');
  await panel.locator('[data-testid="mig-upload"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  /* keep local */
  await panel.locator('[data-testid="signout-keep"]').click();
  await expect(page.locator('[data-testid="signin-email"]')).toBeVisible();
  expect((await lessonState(page)).lessons['w01-l1']).toBeTruthy();
  await expect(page.locator('[data-testid="profile-chip"]')).toContainText(/invitado|guest/);
  /* sign in again (account already has data; local identical) → merge, then clear on sign-out */
  panel = await signIn(page, 'eva@example.test');
  await panel.locator('[data-testid="mig-merge"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  await panel.locator('[data-testid="signout-clear"]').click();
  await expect(page.locator('[data-testid="signin-email"]')).toBeVisible();
  expect(Object.keys((await lessonState(page)).lessons)).toEqual([]);
  expect(await serverRow(server, 'eva@example.test')).toBeTruthy();
  /* sign in on the empty profile → account copy downloaded automatically */
  panel = await signIn(page, 'eva@example.test');
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  expect((await lessonState(page)).lessons['w01-l1']).toBeTruthy();
  /* delete account: requires typing the word */
  await panel.locator('.efl-danger-zone summary').click();
  await panel.locator('[data-testid="delete-account"]').click();
  await expect(panel.locator('.efl-danger-zone [role="status"]')).toContainText(/ELIMINAR|DELETE/);
  await panel.locator('[data-testid="delete-confirm-text"]').fill('eliminar');
  await panel.locator('[data-testid="delete-account"]').click();
  await expect(page.locator('[data-testid="account-panel"]')).toContainText(/eliminados del servidor|deleted from the server/);
  expect((await server.db.query("select count(*)::int n from auth.users where email = 'eva@example.test'")).rows[0].n).toBe(0);
  expect((await lessonState(page)).lessons['w01-l1']).toBeTruthy();
  await context.close();
});

test('offline: status is shown and the next sync recovers', async ({ browser }) => {
  const server = await createFakeServer();
  const { context, page } = await newDevice(browser, server);
  const panel = await signIn(page, 'fer@example.test');
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  server.offline = true;
  await doFirstVocabStep(page);
  await openLab(page, '?view=account');
  await page.locator('[data-testid="sync-now"]').click();
  await expect(page.locator('[data-testid="sync-status"]')).toContainText(/sin conexión|offline/);
  server.offline = false;
  await page.locator('[data-testid="sync-now"]').click();
  await expect(page.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  const row = await serverRow(server, 'fer@example.test');
  expect(row.state.lessons['w01-l1']).toBeTruthy();
  await context.close();
});

test('accessibility (axe) of the account view, signed out and signed in', async ({ browser }) => {
  const server = await createFakeServer();
  const { context, page } = await newDevice(browser, server);
  await openLab(page, '?view=account');
  const check = async () => {
    const r = await new AxeBuilder({ page }).include('#efl-app').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes[0].target}`);
  };
  expect(await check()).toEqual([]);
  const panel = await signIn(page, 'gil@example.test');
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
  expect(await check()).toEqual([]);
  await context.close();
});
