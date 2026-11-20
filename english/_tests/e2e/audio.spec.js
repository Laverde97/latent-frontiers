import { test, expect } from '@playwright/test';
import { FAKE_TTS, FAKE_ASR, NO_ASR, NO_TTS, NO_RECORDER, MIC_DENIED, trackErrors, openLab, recordFor, rateRubric } from './helpers.js';

test.describe('Speaking & listening with full browser support', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await page.addInitScript(FAKE_ASR);
  });

  test('Listening Lab: play, pause, segments, repeat, speed and transcript', async ({ page }) => {
    const errors = trackErrors(page);
    await openLab(page, '?view=listening');
    const player = page.locator('#li-dialogues').locator('..').locator('.efl-player');
    const transcript = player.locator('.efl-transcript');
    await expect(transcript).toBeHidden();
    await player.locator('[data-testid="transcript-toggle"]').click();
    await expect(transcript).toBeVisible();
    await player.locator('select').selectOption('0.6');
    await player.locator('[data-testid="player-play"]').click();
    await page.waitForFunction(() => window.__spoken.length >= 3);
    const spoken = await page.evaluate(() => window.__spoken);
    expect(spoken[0].text).toBe('Good morning! Welcome to City Language School.');
    expect(spoken[0].rate).toBe(0.6);
    await expect(player.locator('.efl-player__status')).toHaveText(/Fin del audio|End of audio/, { timeout: 15000 });
    /* segment controls */
    await page.evaluate(() => { window.__spoken = []; });
    await player.locator('[data-testid="player-restart"]').click();
    await player.locator('[data-testid="player-play"]').click(); // pause
    await page.evaluate(() => { window.__spoken = []; });
    await player.locator('[data-testid="player-next"]').click();
    await player.locator('[data-testid="player-repeat"]').click();
    await page.waitForFunction(() => window.__spoken.length >= 2);
    const seg = await page.evaluate(() => window.__spoken.map((s) => s.text));
    expect(seg[seg.length - 1]).toBe(seg[seg.length - 2]);
    await expect(transcript.locator('li.is-current')).toHaveCount(1);
    /* minimal pairs and dictation exist and give feedback */
    const mp = page.locator('#li-mp').locator('..');
    await mp.locator('.efl-ex').first().locator('button.efl-btn--audio').click();
    await page.waitForFunction(() => window.__spoken.length > 0);
    await mp.locator('.efl-ex').first().locator('button.efl-opt').first().click();
    await expect(mp.locator('.efl-ex').first().locator('.efl-feedback')).not.toBeEmpty();
    expect(errors).toEqual([]);
  });

  test('Speaking Studio: listen, record, play back, compare, repeat and get recognition feedback', async ({ page }) => {
    const errors = trackErrors(page);
    await openLab(page, '?view=speaking');
    const card = page.locator('#sp-repeat').locator('..').locator('.efl-repeat').first();
    const target = (await card.locator('.efl-repeat__text').textContent()).trim();
    /* listen normal + slow */
    await card.locator('.efl-btn--audio').first().click();
    await card.getByRole('button', { name: /Lento|Slow/ }).click();
    await page.waitForFunction(() => window.__spoken.length >= 2);
    const rates = await page.evaluate(() => window.__spoken.map((s) => s.rate));
    expect(rates).toContain(0.6);
    /* consent is required before the microphone */
    await expect(card.locator('[data-testid="mic-consent"]')).toBeVisible();
    const audio = await recordFor(page, card, 1500);
    /* the recording is real audio that plays back */
    const meta = await audio.evaluate(async (a) => {
      await new Promise((r) => { if (a.readyState >= 1) { r(); } else { a.onloadedmetadata = r; setTimeout(r, 3000); } });
      await a.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      return { src: a.src, paused: a.paused, current: a.currentTime };
    });
    expect(meta.src).toMatch(/^blob:/);
    expect(meta.current).toBeGreaterThan(0);
    /* compare: model (TTS) then my recording */
    await page.evaluate(() => { window.__spoken = []; });
    await card.locator('[data-testid="compare"]').click();
    await page.waitForFunction((t) => window.__spoken.some((s) => s.text === t), target);
    /* repeat the exercise: a second recording replaces the first */
    await card.locator('[data-testid="rec-toggle"]').click();
    await page.waitForTimeout(700);
    await card.locator('[data-testid="rec-toggle"]').click();
    await expect(card.locator('[data-testid="my-recording"]')).toHaveCount(1);
    /* speech recognition: missed words are flagged, with a caveat */
    const words = target.replace(/[.,!?]/g, '').split(' ');
    await page.evaluate((t) => { window.__asrTranscript = t; }, words.slice(0, -1).join(' '));
    await card.locator('[data-testid="asr-check"]').click();
    await expect(card.locator('[data-testid="asr-transcript"]')).toBeVisible();
    await expect(card.locator('.efl-word--miss')).toHaveCount(1);
    await expect(card.locator('.efl-asr__out')).toContainText(/no es una puntuación de pronunciación|not a pronunciation score/);
    const badge = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')).badges.firstRecording);
    expect(badge).toBeTruthy();
    await page.screenshot({ path: '_tests/screenshots/speaking-studio.png' });
    expect(errors).toEqual([]);
  });

  test('Shadowing and Conversation Coach (challenge mode, answer by voice)', async ({ page }) => {
    const errors = trackErrors(page);
    await openLab(page, '?view=speaking');
    const sh = page.locator('#sp-shadow').locator('..');
    await sh.getByLabel(/sin transcripción|without the transcript/).check();
    await expect(sh.locator('.efl-shadow__text').first()).toBeHidden();
    await sh.getByRole('button', { name: /Mostrar texto|Show text/ }).first().click();
    await expect(sh.locator('.efl-shadow__text').first()).toBeVisible();
    await rateRubric(sh, 2);
    await expect(sh.locator('.efl-rubric .efl-ok')).toBeVisible();

    const coach = page.locator('#sp-coach').locator('..');
    await coach.locator('[data-testid="coach-topic"]').selectOption('d-w01-meet');
    await coach.locator('[data-testid="coach-mode"]').selectOption('challenge');
    await coach.locator('[data-testid="coach-start"]').click();
    await coach.locator('[data-testid="dlg-start"]').click();
    await expect(coach.locator('.efl-dialogue__turn .efl-opts')).toBeHidden();
    await page.evaluate(() => { window.__asrTranscript = "Hi Mia I'm Carla"; });
    await coach.locator('[data-testid="dlg-voice"]').click();
    await expect(coach.locator('.efl-chat__you')).toContainText("Hi, Mia! I'm [your name].");
    /* an off-topic reply gets corrective feedback */
    await coach.locator('[data-testid="dlg-reveal"]').click();
    await expect(coach.locator('.efl-chat__bot').last()).toContainText('How do you spell');
    expect(errors).toEqual([]);
  });
});

test.describe('Fallbacks when browser APIs are missing', () => {
  test('no speech recognition: functional alternative and explanation', async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await page.addInitScript(NO_ASR);
    const errors = trackErrors(page);
    await openLab(page, '?view=speaking');
    const card = page.locator('#sp-repeat').locator('..').locator('.efl-repeat').first();
    await expect(card.locator('.efl-asr')).toContainText(/no ofrece reconocimiento de voz|has no speech recognition/);
    await expect(card.locator('[data-testid="asr-check"]')).toHaveCount(0);
    await recordFor(page, card, 600);
    await expect(card.locator('[data-testid="compare"]')).toBeVisible();
    /* conversation still works: say aloud, then pick */
    const coach = page.locator('#sp-coach').locator('..');
    await coach.locator('[data-testid="coach-start"]').click();
    await coach.locator('[data-testid="dlg-start"]').click();
    await expect(coach.locator('.efl-dialogue__turn')).toContainText(/Sin reconocimiento de voz|No speech recognition/);
    await coach.locator('.efl-dialogue__turn button.efl-opt').first().click();
    await expect(coach.locator('.efl-chat__you')).toHaveCount(1);
    await openLab(page, '?view=settings');
    await expect(page.locator('[data-testid="capabilities"]')).toContainText('✗');
    expect(errors).toEqual([]);
  });

  test('no MediaRecorder: practise aloud and self-assess', async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await page.addInitScript(NO_RECORDER);
    const errors = trackErrors(page);
    await openLab(page, '?view=lesson&id=w01-l1');
    await page.locator('[data-step="s5"]').click();
    const ch = page.locator('.efl-challenge');
    await expect(ch).toContainText(/no permite grabar|cannot record/);
    await ch.locator('[data-testid="practised-aloud"]').click();
    await rateRubric(ch, 2);
    await expect(page.locator('[data-testid="next-step"]')).toBeEnabled();
    const a = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')).lessons['w01-l1'].activities.s5);
    expect(a.source).toBe('self');
    expect(a.detail.recorded).toBe(false);
    expect(errors).toEqual([]);
  });

  test('microphone permission denied: clear message and alternative', async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await page.addInitScript(MIC_DENIED);
    await openLab(page, '?view=speaking');
    const card = page.locator('#sp-repeat').locator('..').locator('.efl-repeat').first();
    await card.locator('[data-testid="mic-consent"]').click();
    await card.locator('[data-testid="rec-toggle"]').click();
    await expect(card.getByRole('alert')).toContainText(/permiso|permission/);
    await expect(card.locator('[data-testid="practised-aloud"]')).toBeVisible();
  });

  test('no speech synthesis: notices and transcripts instead of audio', async ({ page }) => {
    await page.addInitScript(NO_TTS);
    const errors = trackErrors(page);
    await openLab(page, '?view=listening');
    await expect(page.locator('.efl-notice--warn').first()).toContainText(/síntesis de voz|speech synthesis/);
    await expect(page.locator('.efl-player .efl-transcript').first()).toBeVisible();
    await expect(page.locator('[data-testid="player-play"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
