/* Functional audit (Delivery 1 review): attempts, recording duration,
   no answer leaks, persistence across browser restarts, dashboard updates,
   SRS scheduling, diagnostic coherence, English UI and keyboard-only use. */
import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_TTS, FAKE_ASR, trackErrors, openLab, recordFor, readData, solveExercises, completeLesson, setSiteLang } from './helpers.js';

const BASE = 'http://127.0.0.1:4173/latent-frontiers/';
const state = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')));

test.describe('speaking & listening audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await page.addInitScript(FAKE_ASR);
  });

  test('each recording is logged as an attempt and the player shows a real duration', async ({ page }) => {
    const errors = trackErrors(page);
    await openLab(page, '?view=lesson&id=w01-l1');
    await page.locator('[data-step="s5"]').click();
    const card = page.locator('.efl-stage .efl-repeat').first();
    const audio = await recordFor(page, card, 1500);
    await expect(card.locator('[data-testid="rec-info"]')).toContainText(/Intento 1|Attempt 1/);
    const dur = await audio.evaluate((a) => new Promise((r) => {
      const done = () => r(a.duration);
      if (Number.isFinite(a.duration) && a.duration > 0 && a.currentTime === 0) { done(); return; }
      a.addEventListener('durationchange', () => setTimeout(done, 200));
      setTimeout(done, 4000);
    }));
    expect(Number.isFinite(dur)).toBe(true);
    expect(dur).toBeGreaterThan(0.5);
    /* second attempt */
    await card.locator('[data-testid="rec-toggle"]').click();
    await page.waitForTimeout(600);
    await card.locator('[data-testid="rec-toggle"]').click();
    await expect(card.locator('[data-testid="rec-info"]')).toContainText(/Intento 2|Attempt 2/);
    const st = await state(page);
    expect(st.lessons['w01-l1'].activities['s5-rec-0'].attempts).toBe(2);
    expect(st.lessons['w01-l1'].activities['s5-rec-0'].ratio).toBeNull();
    /* recordings never become a "pronunciation score" */
    expect(st.evidence.filter((e) => e.activityId.startsWith('s5-rec'))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('no answer is revealed before the learner responds', async ({ page }) => {
    await openLab(page, '?view=lesson&id=w01-l1');
    await page.locator('[data-step="s2"]').click();
    const stage = page.locator('.efl-stage');
    await expect(stage.locator('.efl-transcript')).toBeHidden();
    await expect(stage.locator('.is-correct, .is-wrong')).toHaveCount(0);
    await expect(stage.locator('.efl-feedback')).toHaveText(['', '', '', '', '']);
    /* the dictation's audio button must not expose the sentence */
    const L = readData('lessons/w01-l1.json');
    const dict = L.steps[1].exercises.find((e) => e.type === 'dictation');
    const html = await stage.locator(`fieldset[data-ex="${dict.id}"]`).evaluate((el) => el.outerHTML);
    expect(html.toLowerCase()).not.toContain('spell your last name');
    /* same in the retrieval step and the Listening Lab */
    await page.locator('[data-step="s9"]').click();
    const q4 = await page.locator('.efl-stage fieldset[data-ex="q4"]').evaluate((el) => el.outerHTML);
    expect(q4.toLowerCase()).not.toContain('good afternoon');
    await openLab(page, '?view=listening');
    const respond = page.locator('#li-respond').locator('..');
    const q = await respond.evaluate((el) => [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || '').join(' '));
    expect(q).not.toMatch(/\?/);
  });

  test('Listening Lab: comprehension and dictation give feedback, can be repeated and are logged', async ({ page }) => {
    const errors = trackErrors(page);
    await openLab(page, '?view=listening');
    const sec = page.locator('#li-dialogues').locator('..');
    const L = readData('lessons/w01-l1.json');
    await sec.locator('[data-testid="player-play"]').click();
    await page.waitForFunction(() => window.__spoken.length >= 3);
    await solveExercises(page, sec, L.steps[1].exercises, 'lab-');
    await expect(sec.locator('.efl-score')).toContainText(/5 de 5|5 of 5/);
    /* dictation: wrong then answer revealed with feedback */
    const dsec = page.locator('#li-dict').locator('..');
    const first = dsec.locator('fieldset.efl-ex').first();
    await first.locator('input').fill('xyz');
    await first.locator('button.efl-check').click();
    await expect(first.locator('.efl-feedback')).toContainText(/Todavía no|Not yet/);
    /* finish the set (wrong answers), then repeat with a new set */
    const boxes = dsec.locator('fieldset.efl-ex');
    for (let i = 0; i < await boxes.count(); i++) {
      for (let k = 0; k < 2; k++) {
        const b = boxes.nth(i);
        if (await b.evaluate((el) => el.classList.contains('is-correct') || el.classList.contains('is-wrong'))) { break; }
        await b.locator('input').fill('xyz');
        await b.locator('button.efl-check').click();
      }
    }
    await expect(dsec.locator('.efl-score')).toBeVisible();
    await dsec.getByRole('button', { name: /Nueva serie|New set/ }).click();
    await expect(dsec.locator('.efl-score')).toHaveCount(0);
    const st = await state(page);
    expect(st.lessons.studio.activities['listening-w01-l1'].ratio).toBe(1);
    expect(st.lessons.studio.activities.dictation.ratio).toBe(0);
    expect(st.evidence.filter((e) => e.lessonId === 'studio' && e.skill === 'listening').length).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });
});

test('progress survives closing and reopening the browser', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'efl-profile-'));
  const launch = () => chromium.launchPersistentContext(dir, {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    permissions: ['microphone']
  });
  try {
    let ctx = await launch();
    await ctx.addInitScript(FAKE_TTS);
    let page = await ctx.newPage();
    await page.goto(`${BASE}english/index.html?view=lesson&id=w01-l1`);
    await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
    await solveExercises(page, page.locator('.efl-stage'), readData('lessons/w01-l1.json').steps[0].exercises);
    await ctx.close();

    ctx = await launch();
    await ctx.addInitScript(FAKE_TTS);
    page = await ctx.newPage();
    await page.goto(`${BASE}english/index.html`);
    await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('[data-testid="dash-continue"]')).toHaveText(/Continuar|Continue/);
    await expect(page.getByText(/Te quedan 8 pasos|8 steps left/)).toBeVisible();
    const st = await state(page);
    expect(st.lessons['w01-l1'].activities.s1.ratio).toBe(1);
    await ctx.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('dashboard updates after activities (minutes, steps, skills)', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(FAKE_TTS);
  await openLab(page, '?view=lesson&id=w01-l1');
  const L = readData('lessons/w01-l1.json');
  await solveExercises(page, page.locator('.efl-stage'), L.steps[0].exercises);
  await page.locator('[data-testid="next-step"]').click();
  await page.locator('[data-testid="player-play"]').click();
  await solveExercises(page, page.locator('.efl-stage'), L.steps[1].exercises);
  /* keep interacting while the (fake) clock advances two minutes */
  for (let i = 0; i < 8; i++) { await page.mouse.click(5, 5); await page.clock.runFor(15000); }
  await page.locator('.efl-nav a[data-view="dashboard"]').click();
  await expect(page.locator('.efl-main h2')).toHaveText(/Panel|Dashboard/);
  const minutes = await page.locator('.efl-card').filter({ hasText: /Práctica|Practice/ }).locator('.efl-big').textContent();
  expect(parseInt(minutes, 10)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-testid="skill-listening"]')).toContainText('100 %');
  await expect(page.getByText(/Te quedan 7 pasos|7 steps left/)).toBeVisible();
});

test('spaced repetition schedules reviews from performance', async ({ page }) => {
  test.setTimeout(240000);
  await page.addInitScript(FAKE_TTS);
  await completeLesson(page, 'w01-l1');
  let st = await state(page);
  const fresh = Object.entries(st.srs).filter(([, c]) => c.reps === 0 && c.history.length === 0);
  expect(fresh.length).toBeGreaterThan(5);
  await openLab(page, '?view=vocab');
  const sess = page.locator('[data-testid="srs-session"]');
  await sess.locator('[data-testid="srs-show"]').click();
  const firstWord = (await sess.locator('.efl-flash .efl-vcard__word').textContent()).trim();
  await sess.locator('[data-testid="srs-again"]').click();
  st = await state(page);
  const failed = Object.values(st.srs).find((c) => c.history.length && c.history[c.history.length - 1].q === 1 && c.lapses >= 1);
  expect(failed, `card for ${firstWord}`).toBeTruthy();
  const mins = (new Date(failed.due) - Date.now()) / 60000;
  expect(mins).toBeGreaterThan(8);
  expect(mins).toBeLessThan(11);
  /* card 2 is listen-and-type: answer it correctly → due in ~1 day */
  const box = sess.locator('fieldset.efl-ex');
  await expect(box).toBeVisible();
  const vocab = readData('vocab/a1-w01.json').items;
  await box.locator('button.efl-btn--audio').first().click();
  await page.waitForFunction(() => window.__spoken.length > 0);
  const said = await page.evaluate(() => window.__spoken[window.__spoken.length - 1].text);
  expect(vocab.some((v) => v.word === said)).toBe(true);
  await box.locator('input').fill(said);
  await box.locator('button.efl-check').click();
  st = await state(page);
  const id = vocab.find((v) => v.word === said).id;
  const days = (new Date(st.srs[id].due) - Date.now()) / 86400000;
  expect(days).toBeGreaterThan(0.9);
  expect(days).toBeLessThan(1.1);
});

test('diagnostic: all correct → at most "B1+"; only A1 correct → A1; never B2/C1', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  const d = readData('diagnostic.json');
  const run = async (correctLevels) => {
    await openLab(page, '?view=assess');
    await page.locator('[data-testid="diag-start"]').click();
    for (const sec of d.sections) {
      for (const it of sec.items) {
        const box = page.locator(`fieldset[data-ex="diag-${it.id}"]`);
        if (correctLevels.includes(it.level)) {
          await solveExercises(page, page.locator('.efl-diag'), [{ ...it, id: `diag-${it.id}` }]);
        } else {
          for (let k = 0; k < 2; k++) {
            if (await box.evaluate((el) => el.classList.contains('is-wrong') || el.classList.contains('is-correct'))) { break; }
            if (it.type === 'mcq') {
              await box.locator('button.efl-opt:not([disabled])', { hasNotText: new RegExp(`^${it.options[it.answer].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
            } else { await box.locator('input').fill('zzz'); await box.locator('button.efl-check').click(); }
          }
          await expect(box).toHaveClass(/is-wrong/);
        }
      }
    }
    await page.locator('[data-testid="diag-finish"]').click();
    return page.locator('[data-testid="diag-result"]');
  };
  let res = await run(['A1', 'A2', 'B1']);
  await expect(res).toContainText(/Rango probable: B1\+|Probable range: B1\+/);
  await expect(res).toContainText(/no puede ubicar|cannot place/);
  await expect(res).toContainText(/Confianza baja|Low confidence/);
  res = await run(['A1']);
  await expect(res).toContainText(/Rango probable: A1$|Probable range: A1$|Rango probable: A1|Probable range: A1/);
  await expect(res).not.toContainText(/A2 \(|B1\+/);
  const st = await state(page);
  expect(st.diagnostic.placement.range).toBe('A1');
  expect(st.diagnostic.confidence).toBe('low');
});

test('English interface: every view, no missing or Spanish UI strings', async ({ page }) => {
  await setSiteLang(page, 'en');
  await page.addInitScript(FAKE_TTS);
  const errors = trackErrors(page);
  const spanishUI = /Siguiente paso|Ruta de aprendizaje|Autoevaluación|Comprobar|Mostrar transcripción|Ajustes|Evaluaciones|Mi progreso|Panel\b/;
  for (const v of ['', '?view=path', '?view=lesson&id=w01-l1', '?view=speaking', '?view=listening', '?view=vocab', '?view=readwrite', '?view=assess', '?view=progress', '?view=settings']) {
    await openLab(page, v);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    const ui = await page.locator('#efl-app').evaluate((el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('.efl-es, [lang="es"]').forEach((n) => n.remove());
      return c.innerText;
    });
    expect(ui, v).not.toMatch(spanishUI);
    expect(await page.evaluate(() => [...window.__efl.missingKeys]), v).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('keyboard only: answer exercises with Tab/Enter, focus is visible', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await openLab(page, '?view=lesson&id=w01-l1');
  const L = readData('lessons/w01-l1.json');
  const v2 = L.steps[0].exercises.find((e) => e.id === 'v2');
  /* tab into the v2 options and press Enter on the correct one */
  await page.locator('fieldset[data-ex="v1"] button.efl-opt').last().focus();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const txt = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
    if (txt === v2.options[v2.answer]) { break; }
  }
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.locator('fieldset[data-ex="v2"]')).toHaveClass(/is-correct/);
  /* tab to the gap input, type and submit with Enter */
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement.closest('fieldset') && document.activeElement.closest('fieldset').dataset.ex === 'v3' && document.activeElement.tagName === 'INPUT')) { break; }
  }
  await page.keyboard.type('meet');
  await page.keyboard.press('Enter');
  await expect(page.locator('fieldset[data-ex="v3"]')).toHaveClass(/is-correct/);
});
