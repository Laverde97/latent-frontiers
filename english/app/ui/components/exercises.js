/* =========================================================================
   exercises.js — reusable, auto-checked exercises.

   Scoring rule (shown to learners in ASSESSMENT.md):
     correct on 1st attempt = 1 point, on 2nd attempt = 0.5, otherwise 0
     (after 2 wrong attempts the correct answer is shown with its
     explanation). Two-option items (minimal pairs) allow one attempt.
   Types: mcq, gap (typed), dictation (listen & type), minimalPair
   (listen & choose), order (build the sentence).
   ========================================================================= */

import { h, clear, announce, nextId, pick } from '../dom.js';
import { t, getLang } from '../../i18n.js';
import { answersMatch } from '../../core/scoring.js';
import { listenButtons } from './audio.js';
import { speak, ttsSupported } from '../../audio/tts.js';

const MAX_ATTEMPTS = 2;

function feedbackBox() {
  return h('div', { class: 'efl-feedback', role: 'status', 'aria-live': 'polite' });
}

function explain(ex, ctx) {
  const parts = [];
  if (ex.explanation) { parts.push(h('p', { class: 'efl-small' }, pick(ex.explanation, 'en'))); }
  if (ex.explanation && ex.explanation.es && ctx.esOn()) { parts.push(h('p', { class: 'efl-es efl-small', lang: 'es' }, ex.explanation.es)); }
  return parts;
}

/* Generic shell: renders an exercise, handles attempts, calls done(). */
export function renderExercise(ex, ctx, done) {
  const box = h('fieldset', { class: 'efl-ex', 'data-ex': ex.id });
  const legendId = nextId('lg');
  box.append(h('legend', { id: legendId, class: 'efl-ex__prompt' }, ex.prompt ? h('span', { lang: 'en' }, ex.prompt) : t(`ex.prompt.${ex.type}`)));
  if (ex.promptEs && ctx.esOn()) { box.append(h('p', { class: 'efl-es efl-small', lang: 'es' }, ex.promptEs)); }
  const fb = feedbackBox();
  let attempts = 0;
  let finished = false;
  /* binary choices get one attempt, otherwise a second try is a free guess */
  const maxAttempts = ex.type === 'minimalPair' || (ex.options && ex.options.length === 2) ? 1 : MAX_ATTEMPTS;

  const finish = (correct) => {
    finished = true;
    const score = correct ? (attempts === 1 ? 1 : 0.5) : 0;
    box.classList.add(correct ? 'is-correct' : 'is-wrong');
    box.querySelectorAll('input, button.efl-opt, button.efl-chip, .efl-check').forEach((el) => { el.disabled = true; });
    done({ id: ex.id, correct, attempts, score });
  };

  /* returns true when finished */
  const judge = (correct, correctText) => {
    if (finished) { return; }
    attempts += 1;
    clear(fb);
    if (correct) {
      fb.append(h('p', { class: 'efl-ok' }, '✓ ', attempts === 1 ? t('ex.correct') : t('ex.correctSecond')), ...explain(ex, ctx));
      announce(t('ex.correct'));
      finish(true);
    } else if (attempts < maxAttempts) {
      fb.append(h('p', { class: 'efl-warn' }, '✗ ', t('ex.tryAgain')), ex.hint ? h('p', { class: 'efl-small' }, t('ex.hint'), ' ', pick(ex.hint, 'en')) : null);
      announce(t('ex.tryAgain'));
    } else {
      fb.append(h('p', { class: 'efl-bad' }, '✗ ', t('ex.answerWas'), ' ', h('strong', { lang: 'en' }, correctText)), ...explain(ex, ctx));
      announce(`${t('ex.answerWas')} ${correctText}`);
      finish(false);
    }
  };

  switch (ex.type) {
    case 'mcq': {
      if (ex.audio) { box.append(h('div', { class: 'efl-ex__audio' }, listenButtons(ex.audio, ctx, { hideText: true }))); }
      const opts = h('div', { class: 'efl-opts', role: 'group', 'aria-labelledby': legendId });
      /* options are shuffled (deterministically) so the key is never
         simply "the first one"; 2-option yes/no items keep their order */
      const order = ex.options.length > 2 ? shuffle(ex.options.map((o, i) => i), `${ex.id}:${ex.prompt}`) : ex.options.map((o, i) => i);
      let correctBtn = null;
      order.forEach((i) => {
        const b = h('button', { type: 'button', class: 'efl-opt', lang: 'en' }, ex.options[i]);
        if (i === ex.answer) { correctBtn = b; }
        b.addEventListener('click', () => {
          if (finished) { return; }
          const ok = i === ex.answer;
          b.classList.add(ok ? 'is-correct' : 'is-wrong');
          if (!ok) { b.disabled = true; }
          judge(ok, ex.options[ex.answer]);
          if (finished) { correctBtn.classList.add('is-correct'); }
        });
        opts.append(b);
      });
      box.append(opts);
      break;
    }
    case 'gap':
    case 'dictation': {
      if (ex.type === 'dictation') {
        box.append(h('div', { class: 'efl-ex__audio' }, ttsSupported()
          ? listenButtons(ex.audio, ctx, { hideText: true })
          : h('p', { class: 'efl-notice efl-notice--warn' }, t('ex.dictationNoTts'), ' ', h('q', { lang: 'en' }, ex.audio))));
      } else if (ex.audio) {
        box.append(h('div', { class: 'efl-ex__audio' }, listenButtons(ex.audio, ctx, { hideText: true })));
      }
      const id = nextId('in');
      const input = h('input', { id, type: 'text', class: 'efl-input', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: 'en', 'aria-describedby': legendId });
      const check = h('button', { type: 'button', class: 'efl-btn efl-check' }, t('ex.check'));
      const submit = () => { if (input.value.trim()) { judge(answersMatch(input.value, ex.accept), ex.accept[0]); } };
      check.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      box.append(h('div', { class: 'efl-row' }, h('label', { for: id, class: 'efl-sr' }, t('ex.yourAnswer')), input, check));
      break;
    }
    case 'minimalPair': {
      const play = h('button', { type: 'button', class: 'efl-btn efl-btn--audio' }, '▶ ', t('ex.playWord'));
      play.addEventListener('click', async () => {
        ctx.timer.hold();
        try { await speak(ex.say, { rate: ctx.store.state.settings.rate }); } finally { ctx.timer.release(); }
      });
      box.append(ttsSupported() ? play : h('p', { class: 'efl-notice efl-notice--warn' }, t('ex.minimalNoTts')));
      const opts = h('div', { class: 'efl-opts', role: 'group', 'aria-labelledby': legendId });
      ex.pair.forEach((w) => {
        const b = h('button', { type: 'button', class: 'efl-opt', lang: 'en' }, w, ex.ipa && ex.ipa[w] ? h('span', { class: 'efl-ipa' }, ` ${ex.ipa[w]}`) : null);
        b.addEventListener('click', () => {
          if (finished) { return; }
          const ok = w === ex.say;
          b.classList.add(ok ? 'is-correct' : 'is-wrong');
          if (!ok) { b.disabled = true; }
          judge(ok, ex.say);
        });
        opts.append(b);
      });
      box.append(opts);
      break;
    }
    case 'order': {
      const chosen = [];
      const line = h('p', { class: 'efl-order__line', lang: 'en', 'aria-live': 'polite' });
      const bank = h('div', { class: 'efl-opts', role: 'group', 'aria-label': t('ex.wordBank') });
      const words = shuffle(ex.words.map((w, i) => ({ w, i })), ex.id);
      const redraw = () => { line.textContent = chosen.map((c) => c.w).join(' ') || '…'; };
      words.forEach((item) => {
        const b = h('button', { type: 'button', class: 'efl-chip', lang: 'en' }, item.w);
        b.addEventListener('click', () => { if (finished) { return; } chosen.push(item); b.disabled = true; redraw(); });
        item.btn = b;
        bank.append(b);
      });
      const reset = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost efl-check' }, t('ex.reset'));
      reset.addEventListener('click', () => { chosen.length = 0; words.forEach((x) => { x.btn.disabled = false; }); redraw(); });
      const check = h('button', { type: 'button', class: 'efl-btn efl-check' }, t('ex.check'));
      check.addEventListener('click', () => {
        if (chosen.length !== ex.words.length) { clear(fb); fb.append(h('p', { class: 'efl-small' }, t('ex.useAllWords'))); return; }
        judge(answersMatch(chosen.map((c) => c.w).join(' '), ex.accept), ex.accept[0]);
        if (!finished) { reset.click(); }
      });
      redraw();
      box.append(line, bank, h('div', { class: 'efl-row' }, reset, check));
      break;
    }
    default:
      box.append(h('p', null, `Unknown exercise ${ex.type}`));
  }
  box.append(fb);
  return box;
}

/* Deterministic shuffle (seeded by id) so a page reload shows the same
   order and tests are reproducible; never the solution order for >2. */
export function shuffle(arr, seedStr) {
  let seed = 0;
  for (const ch of String(seedStr)) { seed = (seed * 31 + ch.charCodeAt(0)) >>> 0; }
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 2 && a.every((x, i) => x === arr[i])) { a.push(a.shift()); }
  return a;
}

/* A list of exercises; onComplete({score, max, results}) once all done. */
export function exerciseSet(exercises, ctx, onComplete) {
  const wrap = h('div', { class: 'efl-exset' });
  const results = new Map();
  const summary = h('div', { class: 'efl-exset__summary', 'aria-live': 'polite' });
  exercises.forEach((ex, i) => {
    const el = renderExercise(ex, ctx, (r) => {
      results.set(ex.id, r);
      if (results.size === exercises.length) {
        const score = [...results.values()].reduce((s, x) => s + x.score, 0);
        clear(summary);
        summary.append(h('p', { class: 'efl-score' }, t('ex.setScore', { score, max: exercises.length })));
        onComplete({ score, max: exercises.length, results: [...results.values()] });
      }
    });
    el.querySelector('legend').prepend(h('span', { class: 'efl-ex__num' }, `${i + 1}. `));
    wrap.append(el);
  });
  wrap.append(summary);
  return wrap;
}

export { getLang };
