/* Regression: no view may show the literal text "null", "undefined" or
   "NaN" (a linked account showed "null" under the last-sync line, and the
   same pattern was latent in lessons, dialogues, challenges and the
   diagnostic when Spanish help was off; every recorder showed "null" once
   the microphone consent was given, across Speaking Studio, Listening Lab
   and the lesson speaking/pronunciation steps). Guest mode, no accounts.
   Every sweep runs with and without microphone consent. */
import { test, expect } from '@playwright/test';
import { FAKE_TTS, FAKE_ASR, openLab, rateRubric, trackErrors } from './helpers.js';

const VIEWS = ['', '?view=path', '?view=speaking', '?view=listening', '?view=vocab', '?view=readwrite', '?view=assess', '?view=progress', '?view=settings', '?view=account'];
const LESSONS = ['w01-l1', 'w01-l2', 'w01-l3', 'w01-l4', 'w01-l5', 'w01-review'];
const BAD = /(^|[^\w-])(null|undefined|NaN)([^\w-]|$)/;

/* every text node of the app (also hidden-by-layout ones), not just innerText */
const leaksIn = (page) => page.evaluate((src) => {
  const re = new RegExp(src); const out = [];
  const w = document.createTreeWalker(document.querySelector('#efl-app'), NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    if (re.test(n.nodeValue)) { const sec = n.parentElement.closest('section'); const h3 = sec && sec.querySelector('h3'); out.push(`${h3 ? h3.textContent : '?'} › .${n.parentElement.className}: «${n.nodeValue.trim().slice(0, 60)}»`); }
  }
  return [...new Set(out)];
}, BAD.source);

for (const mic of [false, true]) for (const es of [true, false]) {
  test(`no "null"/"undefined"/"NaN" text in any view or lesson step (Spanish help ${es ? 'on' : 'off'}, microphone consent ${mic ? 'given' : 'not given'})`, async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await openLab(page);
    await page.evaluate(([on, m]) => window.__efl.store.update((s) => { s.settings.esSupport = on; s.settings.micConsent = m; }), [es, mic]);
    const leaks = [];
    const check = async (where) => {
      const text = await page.locator('#efl-app').innerText();
      const line = text.split('\n').find((l) => BAD.test(l));
      if (line) { leaks.push(`${where}: «${line.trim().slice(0, 100)}»`); }
      for (const l of await leaksIn(page)) { leaks.push(`${where}: ${l}`); }
    };
    for (const v of VIEWS) { await openLab(page, v); await check(v || 'dashboard'); }
    for (const id of LESSONS) {
      await openLab(page, `?view=lesson&id=${id}`);
      const steps = page.locator('.efl-stepper__btn');
      const n = await steps.count();
      for (let i = 0; i < n; i++) {
        const b = steps.nth(i);
        if (await b.isEnabled()) { await b.click(); await page.waitForTimeout(50); }
        await check(`${id} step ${i + 1}`);
      }
    }
    expect(leaks).toEqual([]);
  });
}

/* Speaking Studio, every section and every control state (the reported bug:
   "null" under «Escuchar / Lento» in every listen-and-repeat card). */
for (const es of [true, false]) {
  test(`Speaking Studio never shows "null"/"undefined"/"NaN" in any section or state (Spanish help ${es ? 'on' : 'off'})`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(FAKE_TTS);
    await page.addInitScript(FAKE_ASR);
    await openLab(page);
    await page.evaluate((on) => window.__efl.store.update((s) => { s.settings.esSupport = on; s.settings.micConsent = true; s.settings.saveRecordings = true; }), es);
    await openLab(page, '?view=speaking');
    const leaks = [];
    const shots = [];
    const check = async (state) => {
      for (const l of await leaksIn(page)) { leaks.push(`${state}: ${l}`); }
      const name = `speaking-${state}-es${es ? 'on' : 'off'}`;
      await page.screenshot({ path: `_tests/results/${name}.png`, fullPage: true });
      shots.push(name);
    };
    await check('inicial');

    /* A. listen and repeat: the three cards of the report */
    const repeat = page.locator('#sp-repeat').locator('..');
    for (const text of ['Hello! How are you?', "Hi, I'm Sofía.", 'He is here.']) {
      await expect(repeat.locator('.efl-repeat__text', { hasText: text })).toHaveCount(1);
    }
    const card = repeat.locator('.efl-repeat', { has: page.locator('.efl-repeat__text', { hasText: "Hi, I'm Sofía." }) });
    await card.locator('.efl-btn--audio').first().click();
    await card.getByRole('button', { name: /Lento|Slow/ }).click();
    const rec = card.locator('[data-testid="rec-toggle"]');
    await rec.click();
    await expect(rec).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(900);
    await check('grabando');
    await rec.click();
    await expect(card.locator('[data-testid="my-recording"]')).toBeVisible();
    await expect(card.locator('[data-testid="rec-info"]')).toHaveText(/\d+(\.\d)? s/);
    await check('grabada');
    await card.locator('[data-testid="compare"]').click();
    await check('reproduccion');
    await page.evaluate(() => { window.__asrTranscript = 'Hi I am Sofia'; });
    await card.locator('[data-testid="asr-check"]').click();
    await expect(card.locator('[data-testid="asr-transcript"]')).toBeVisible();
    await check('reconocimiento');
    await page.evaluate(() => { window.__asrTranscript = ''; });
    await card.locator('[data-testid="asr-check"]').click();
    await expect(card.locator('.efl-asr__out [role="alert"]')).toBeVisible();
    await check('reconocimiento-error');
    await card.getByRole('button', { name: /Borrar grabación|Delete recording/ }).click();
    await check('eliminada');

    /* B. shadowing: record a line, hide and show the text */
    const shadow = page.locator('#sp-shadow').locator('..');
    const srec = shadow.locator('[data-testid="rec-toggle"]').first();
    await srec.click(); await page.waitForTimeout(700); await srec.click();
    await expect(shadow.locator('[data-testid="my-recording"]').first()).toBeVisible();
    await shadow.getByLabel(/sin transcripción|without the transcript/).check();
    await shadow.getByRole('button', { name: /Mostrar texto|Show text/ }).first().click();
    await rateRubric(shadow, 2);
    await check('shadowing');

    /* C. speaking challenge: record and self-assess */
    const ch = page.locator('#sp-challenge').locator('..');
    const crec = ch.locator('[data-testid="rec-toggle"]').first();
    await crec.click(); await page.waitForTimeout(700); await crec.click();
    await expect(ch.locator('[data-testid="my-recording"]')).toBeVisible();
    await rateRubric(ch, 3);
    await check('reto');

    /* D. conversation coach, challenge mode, answer by voice, reveal */
    const coach = page.locator('#sp-coach').locator('..');
    await coach.locator('[data-testid="coach-mode"]').selectOption('challenge');
    await coach.locator('[data-testid="coach-start"]').click();
    await coach.locator('[data-testid="dlg-start"]').click();
    await page.evaluate(() => { window.__asrTranscript = "Hi Mia I'm Carla"; });
    await coach.locator('[data-testid="dlg-voice"]').click();
    await expect(coach.locator('.efl-chat__you').first()).toBeVisible();
    await coach.locator('[data-testid="dlg-reveal"]').click();
    await check('coach');

    /* existing recordings: reload; progress and stored recordings are kept */
    const before = await page.evaluate(async () => {
      const db = await import(new URL('app/audio/recording-db.js', document.baseURI).href);
      const p = JSON.parse(localStorage.getItem('efl-progress'));
      return { recordings: await db.countRecordings(), attempts: Object.values(p.lessons.studio.activities).reduce((n, a) => n + a.attempts, 0), evidence: p.evidence.length };
    });
    expect(before.recordings).toBeGreaterThanOrEqual(3);
    expect(before.attempts).toBeGreaterThanOrEqual(3);
    await openLab(page, '?view=speaking');
    await check('recargada');
    const after = await page.evaluate(async () => {
      const db = await import(new URL('app/audio/recording-db.js', document.baseURI).href);
      const p = JSON.parse(localStorage.getItem('efl-progress'));
      return { recordings: await db.countRecordings(), attempts: Object.values(p.lessons.studio.activities).reduce((n, a) => n + a.attempts, 0), evidence: p.evidence.length };
    });
    expect(after).toEqual(before);

    expect(leaks).toEqual([]);
    expect(errors).toEqual([]);
  });
}
