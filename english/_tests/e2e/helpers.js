/* Shared E2E helpers: browser API fakes and a generic lesson solver that
   answers every exercise from the lesson JSON (so a broken answer key or
   an unsolvable exercise fails the test). */
import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');
export const readData = (p) => JSON.parse(readFileSync(join(dataDir, p), 'utf8'));

/* Deterministic speechSynthesis: records every utterance and "speaks"
   instantly. cancel() interrupts like Chrome does. */
export const FAKE_TTS = () => {
  window.__spoken = [];
  let current = null;
  let timer = null;
  class Utterance { constructor(text) { this.text = text; this.rate = 1; this.lang = ''; this.voice = null; } }
  const fake = {
    speaking: false, pending: false, paused: false,
    getVoices() { return [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test-en-us', default: true, localService: true }, { name: 'Test Voice GB', lang: 'en-GB', voiceURI: 'test-en-gb', default: false, localService: true }]; },
    speak(u) {
      window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang });
      current = u; this.speaking = true;
      timer = setTimeout(() => { this.speaking = false; current = null; if (u.onend) { u.onend({}); } }, 40);
    },
    cancel() {
      clearTimeout(timer);
      const u = current; current = null; this.speaking = false;
      if (u && u.onerror) { u.onerror({ error: 'interrupted' }); }
    },
    pause() {}, resume() {}, addEventListener() {}, removeEventListener() {}
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
};

/* Fake recogniser: returns window.__asrTranscript. */
export const FAKE_ASR = () => {
  window.__asrTranscript = window.__asrTranscript || '';
  class Rec {
    start() { setTimeout(() => {
      const t = window.__asrTranscript;
      if (!t) { if (this.onerror) { this.onerror({ error: 'no-speech' }); } return; }
      const alt = [{ transcript: t, confidence: 0.9 }];
      if (this.onresult) { this.onresult({ results: [alt] }); }
      if (this.onend) { this.onend(); }
    }, 30); }
    abort() {} stop() {}
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: Rec, configurable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: Rec, configurable: true });
};

export const NO_ASR = () => {
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
};
export const NO_TTS = () => {
  Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: undefined, configurable: true });
};
export const NO_RECORDER = () => {
  Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true });
};
export const MIC_DENIED = () => {
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
};

export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(`console: ${m.text()}`); } });
  return errors;
}

export async function openLab(page, query = '') {
  await page.goto(`english/index.html${query}`);
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
}

export async function setSiteLang(page, lang) {
  await page.addInitScript((l) => { try { localStorage.setItem('lf-site-lang', l); } catch (e) { /* */ } }, lang);
}

/* ---- solving ---------------------------------------------------------- */
async function solveExercise(page, scope, ex) {
  const box = scope.locator(`fieldset[data-ex="${ex.id}"]`);
  await expect(box).toBeVisible();
  switch (ex.type) {
    case 'mcq':
      await box.locator('button.efl-opt', { hasText: new RegExp(`^${escapeRe(ex.options[ex.answer])}$`) }).click();
      break;
    case 'gap':
    case 'dictation':
      await box.locator('input.efl-input').fill(ex.accept[0]);
      await box.locator('button.efl-check').click();
      break;
    case 'minimalPair':
      await box.locator('button.efl-opt', { hasText: new RegExp(`^${escapeRe(ex.say)}( |$)`) }).first().click();
      break;
    case 'order': {
      const tokens = ex.accept[0].split(' ');
      for (const tk of tokens) {
        await box.locator('button.efl-chip:not([disabled])', { hasText: new RegExp(`^${escapeRe(tk)}$`) }).first().click();
      }
      await box.locator('button.efl-check', { hasText: /Comprobar|Check/ }).click();
      break;
    }
    default: throw new Error(`unknown type ${ex.type}`);
  }
  await expect(box).toHaveClass(/is-correct/);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function solveExercises(page, scope, exercises, idPrefix = '') {
  for (const ex of exercises) { await solveExercise(page, scope, { ...ex, id: `${idPrefix}${ex.id}` }); }
}

export async function rateRubric(scope, value = 3) {
  const rows = scope.locator('.efl-rubric__row');
  const n = await rows.count();
  for (let i = 0; i < n; i++) { await rows.nth(i).locator(`input[value="${value}"]`).check(); }
  await scope.locator('[data-testid="rubric-submit"]').click();
}

export async function recordFor(page, scope, ms = 1200) {
  const consent = scope.locator('[data-testid="mic-consent"]');
  if (await consent.count()) { await consent.first().click(); }
  const btn = scope.locator('[data-testid="rec-toggle"]').first();
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(ms);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  const audio = scope.locator('[data-testid="my-recording"]').first();
  await expect(audio).toBeVisible();
  return audio;
}

export async function runDialogue(page, scope, dialogue) {
  await scope.locator('[data-testid="dlg-start"]').click();
  for (let guard = 0; guard < 20; guard++) {
    const done = scope.locator('.efl-dialogue__turn .efl-ok');
    await expect(scope.locator('.efl-dialogue__turn .efl-opts, .efl-dialogue__turn .efl-ok')).toHaveCount(1);
    if (await done.count()) { return; }
    const lastBot = (await scope.locator('.efl-chat__bot span[lang="en"]').last().textContent()).trim();
    const node = Object.values(dialogue.nodes).find((n) => n.say === lastBot);
    if (!node) { throw new Error(`unknown bot line ${lastBot}`); }
    if (node.end) { await expect(done).toBeVisible(); return; }
    /* wait until the learner's turn is rendered (after the bot line is spoken) */
    await expect(scope.locator('.efl-dialogue__turn .efl-opts')).toHaveCount(1);
    const reveal = scope.locator('[data-testid="dlg-reveal"]');
    if (await reveal.count()) { await reveal.click(); }
    const good = node.options.find((o) => o.fit === 'good');
    const before = await scope.locator('.efl-chat__bot').count();
    await scope.locator('.efl-dialogue__turn button.efl-opt', { hasText: good.text }).click();
    await expect(scope.locator('.efl-chat__bot')).toHaveCount(before + 1);
  }
  throw new Error('dialogue did not finish');
}

/* Complete one lesson through the UI, step by step. */
export async function completeLesson(page, lessonId) {
  const L = readData(`lessons/${lessonId}.json`);
  await openLab(page, `?view=lesson&id=${lessonId}`);
  for (let i = 0; i < L.steps.length; i++) {
    const step = L.steps[i];
    const stage = page.locator('.efl-stage');
    await expect(stage.locator('h3').first()).toContainText(step.title);
    switch (step.type) {
      case 'listening':
        await stage.locator('[data-testid="player-play"]').click();
        await page.waitForFunction((n) => window.__spoken.length >= n, step.lines.length);
        await solveExercises(page, stage, step.exercises);
        break;
      case 'vocab': case 'grammar': case 'reading': case 'retrieval': case 'pronunciation':
        await solveExercises(page, stage, step.exercises);
        break;
      case 'speaking': {
        const ch = stage.locator('.efl-challenge');
        await recordFor(page, ch, 800);
        await rateRubric(ch, 3);
        break;
      }
      case 'interaction':
        await runDialogue(page, stage, readData(`dialogues/${step.dialogue}.json`));
        break;
      case 'writing':
        await stage.locator('[data-testid="writing-input"]').fill(step.model);
        await stage.locator('[data-testid="writing-check"]').click();
        await expect(stage.locator('.efl-checklist .efl-warn')).toHaveCount(0);
        await rateRubric(stage, 4);
        break;
      default: throw new Error(step.type);
    }
    const next = stage.locator('[data-testid="next-step"]');
    await expect(next).toBeEnabled();
    await next.click();
  }
  await expect(page.locator('[data-testid="lesson-complete"]')).toBeVisible();
  return L;
}
