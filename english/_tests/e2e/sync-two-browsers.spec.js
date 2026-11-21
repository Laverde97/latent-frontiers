/* SIMULATED two-browser sync (Chrome ↔ Edge) for ONE account.
   Data goes through a real local PostgreSQL (PGlite) with the production
   migration and RLS; authentication and network are simulated (see
   fake-supabase.js). It also runs the read-only console diagnostic
   (_docs/diagnostico-sincronizacion.js) the learner uses on the real site. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_TTS, trackErrors, openLab, readData, solveExercises } from './helpers.js';
import { createFakeServer, attach, CODE } from './fake-supabase.js';

const DIAG = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '_docs', 'diagnostico-sincronizacion.js'), 'utf8')
  .replace('setTimeout(r, 60000)', 'setTimeout(r, 3000)');                 /* 3 s watch window in tests */
const EMAIL = 'learner@example.test';

async function browserCtx(browser, server, storageState) {
  const context = await browser.newContext(storageState ? { storageState } : {});
  await context.addInitScript(FAKE_TTS);
  await attach(context, server);
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  return { context, page, errors: trackErrors(page) };
}

async function signIn(page) {
  await openLab(page, '?view=account');
  const panel = page.locator('[data-testid="account-panel"]');
  await panel.locator('[data-testid="signin-email"]').fill(EMAIL);
  await panel.locator('[data-testid="signin-adult"]').check();
  await panel.locator('[data-testid="signin-terms"]').check();
  await panel.locator('[data-testid="signin-send"]').click();
  await panel.locator('[data-testid="signin-code"]').fill(CODE);
  await panel.locator('[data-testid="signin-verify"]').click();
  await expect(panel.locator('[data-testid="sync-status"]')).toContainText(/sincronizado|synced/);
}

/* a real activity in the UI, then back to «Cuenta y perfiles» (as the
   learner would, to check the status); that view does not count practice */
async function doStep(page, lessonId, stepIndex = 0) {
  await openLab(page, `?view=lesson&id=${lessonId}`);
  await solveExercises(page, page.locator('.efl-stage'), readData(`lessons/${lessonId}.json`).steps[stepIndex].exercises);
  await openLab(page, '?view=account');
}

const serverRev = async (server) => {
  const r = await server.db.query('select s.rev from efl_learner_state s join auth.users u on u.id = s.user_id where u.email = $1', [EMAIL]);
  return r.rows[0] ? Number(r.rows[0].rev) : null;
};
const diag = (page) => page.evaluate(async (src) => {
  const logs = [];
  const orig = console.log; console.log = (m) => logs.push(m);
  try { await (0, eval)(src); } finally { console.log = orig; }
  return { report: JSON.parse(logs[logs.length - 1]), raw: logs.join('\n') };
}, DIAG);
const waitSynced = (page) => expect.poll(async () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem(`efl-sync:${window.__efl.ctx.profileId}`) || '{}');
  return window.__efl.ctx.account.status === 'synced' && m.dirty === false;
}), { timeout: 15000 }).toBe(true);

test('Chrome → Edge → Chrome: same progress, changes flow both ways, reload/close lose or duplicate nothing, no redundant writes', async ({ browser }) => {
  const server = await createFakeServer();

  /* "Chrome": existing account with progress */
  const chrome = await browserCtx(browser, server);
  await signIn(chrome.page);
  await doStep(chrome.page, 'w01-l1', 0);
  await waitSynced(chrome.page);
  await openLab(chrome.page, '?view=account');

  /* "Edge": empty browser, same account → downloads it, no question asked */
  const edge = await browserCtx(browser, server);
  await signIn(edge.page);
  await expect(edge.page.locator('[data-testid="migration"]')).toHaveCount(0);
  let c = await diag(chrome.page);
  let e = await diag(edge.page);
  expect(e.report.huella).toBe(c.report.huella);
  expect(e.report.revision).toBe(c.report.revision);
  expect(e.report.resumen).toEqual(c.report.resumen);
  /* the diagnostic never prints emails, links or tokens */
  for (const r of [c.raw, e.raw]) { expect(r).not.toMatch(/@|access_token|refresh_token|eyJ|token_hash|\/auth\/v1/); }
  expect(c.report.escriturasEn60s).toBe(0);                                /* idle: no writes */

  /* activity 1 in Chrome → reaches Edge when Edge's tab gets focus back */
  const rev0 = await serverRev(server);
  await doStep(chrome.page, 'w01-l2', 0);
  await waitSynced(chrome.page);
  expect(await serverRev(server)).toBe(rev0 + 1);
  await edge.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await diag(edge.page)).report.huella, { timeout: 15000 }).toBe((await diag(chrome.page)).report.huella);
  expect(await edge.page.evaluate(() => !!window.__efl.store.state.lessons['w01-l2'])).toBe(true);
  expect(await serverRev(server)).toBe(rev0 + 1);                          /* the pull did not write */

  /* activity 2 in Edge → reaches Chrome */
  await doStep(edge.page, 'w01-l3', 0);
  await waitSynced(edge.page);
  expect(await serverRev(server)).toBe(rev0 + 2);
  await chrome.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await diag(chrome.page)).report.huella, { timeout: 15000 }).toBe((await diag(edge.page)).report.huella);
  c = await diag(chrome.page);
  e = await diag(edge.page);
  expect(c.report.resumen).toEqual(e.report.resumen);
  const before = { rev: await serverRev(server), huella: c.report.huella, resumen: c.report.resumen };

  /* reload both: nothing lost, nothing duplicated, no write */
  for (const b of [chrome, edge]) { await b.page.reload(); await expect(b.page.locator('#efl-app')).toHaveAttribute('data-ready', 'true'); await waitSynced(b.page); }
  for (const b of [chrome, edge]) {
    const d = (await diag(b.page)).report;
    expect(d.huella).toBe(before.huella);
    expect(d.resumen).toEqual(before.resumen);
    expect(d.escriturasEn60s).toBe(0);
  }
  expect(await serverRev(server)).toBe(before.rev);

  /* close both browsers completely and reopen them (persisted storage) */
  const states = [await chrome.context.storageState(), await edge.context.storageState()];
  const allErrors = [...chrome.errors, ...edge.errors];
  await chrome.context.close(); await edge.context.close();
  for (const st of states) {
    const b = await browserCtx(browser, server, st);
    await openLab(b.page, '?view=account');
    await waitSynced(b.page);
    const d = (await diag(b.page)).report;
    expect(d.vinculado).toBe(true);
    expect(d.huella).toBe(before.huella);
    expect(d.resumen).toEqual(before.resumen);
    allErrors.push(...b.errors);
    await b.context.close();
  }
  expect(await serverRev(server)).toBe(before.rev);
  expect(allErrors).toEqual([]);
});

test('focus pulls are rate-limited (no repetitive requests)', async ({ browser }) => {
  const server = await createFakeServer();
  const a = await browserCtx(browser, server);
  await signIn(a.page);
  const loads = await a.page.evaluate(async () => {
    const acc = window.__efl.ctx.account;
    let n = 0;
    const orig = acc.syncNow.bind(acc);
    acc.syncNow = () => { n++; return orig(); };
    for (let i = 0; i < 10; i++) { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }
    await new Promise((r) => setTimeout(r, 300));
    return n;
  });
  expect(loads).toBe(1);
  await a.context.close();
});
