/* =========================================================================
   tasks.js — rubric self-assessment, scripted conversations and writing.
   ========================================================================= */

import { h, add, clear, announce, nextId, pick } from '../dom.js';
import { t } from '../../i18n.js';
import { listenButtons, recorderPanel } from './audio.js';
import { speak, ttsSupported, stopSpeaking } from '../../audio/tts.js';
import { asrSupported, recognizeOnce } from '../../audio/asr.js';
import { closestOption, runWritingChecks, countWords } from '../../core/scoring.js';

/* ---- rubric ---------------------------------------------------------------
   criteria: [{ id, label:{en,es}, levels?: [{en,es} x4] }]
   4-point scale. onSubmit({ score, max, ratings }) */
export function rubricForm(criteria, ctx, onSubmit, { title } = {}) {
  const lang = ctx.lang();
  const form = h('form', { class: 'efl-rubric', novalidate: true });
  form.append(h('h4', null, title || t('rubric.title')), h('p', { class: 'efl-small efl-muted' }, t('rubric.help')));
  const scale = [1, 2, 3, 4];
  criteria.forEach((c) => {
    const name = nextId(`rb-${c.id}`);
    const fs = h('fieldset', { class: 'efl-rubric__row' }, h('legend', null, pick(c.label, lang)));
    const opts = h('div', { class: 'efl-rubric__opts' });
    scale.forEach((v) => {
      const id = `${name}-${v}`;
      const desc = c.levels ? pick(c.levels[v - 1], lang) : t(`rubric.level${v}`);
      opts.append(h('span', { class: 'efl-radio' },
        h('input', { type: 'radio', id, name, value: String(v), 'data-criterion': c.id, required: true }),
        h('label', { for: id }, h('strong', null, String(v)), ' ', desc)));
    });
    fs.append(opts);
    form.append(fs);
  });
  const err = h('p', { class: 'efl-warn efl-small', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'efl-btn efl-btn--primary', 'data-testid': 'rubric-submit' }, t('rubric.submit'));
  form.append(err, submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ratings = {};
    for (const c of criteria) {
      const sel = form.querySelector(`input[data-criterion="${c.id}"]:checked`);
      if (!sel) { err.textContent = t('rubric.missing'); return; }
      ratings[c.id] = Number(sel.value);
    }
    err.textContent = '';
    const score = Object.values(ratings).reduce((s, v) => s + v, 0);
    const max = criteria.length * 4;
    form.querySelectorAll('input, button').forEach((x) => { x.disabled = true; });
    form.append(h('p', { class: 'efl-ok' }, t('rubric.saved', { score, max })));
    announce(t('rubric.saved', { score, max }));
    onSubmit({ score, max, ratings });
  });
  return form;
}

/* ---- scripted (branching) conversation ------------------------------------
   Deterministic: replies come from a pre-written tree. The UI says so. */
export function dialogueRunner(dialogue, ctx, { difficulty = 'guided', onComplete } = {}) {
  const lang = ctx.lang();
  const es = ctx.esOn();
  const wrap = h('div', { class: 'efl-dialogue' });
  add(wrap,
    h('p', { class: 'efl-notice', role: 'note' }, t('dlg.scripted')),
    h('p', { class: 'efl-dialogue__setting' }, h('strong', null, t('dlg.situation')), ' ', pick(dialogue.setting, 'en')),
    es && dialogue.setting.es ? h('p', { class: 'efl-es', lang: 'es' }, dialogue.setting.es) : null
  );
  const log = h('ol', { class: 'efl-chat', 'aria-live': 'polite', 'aria-label': t('dlg.log') });
  const turn = h('div', { class: 'efl-dialogue__turn' });
  wrap.append(log, turn);
  let goodPoints = 0;
  let turns = 0;
  const choices = [];

  const botSay = async (node) => {
    log.append(h('li', { class: 'efl-chat__bot' }, h('strong', null, `${dialogue.roles.bot}: `), h('span', { lang: 'en' }, node.say),
      es && node.es ? h('span', { class: 'efl-es', lang: 'es' }, node.es) : null));
    if (ttsSupported()) {
      ctx.timer.hold();
      try { await speak(node.say, { rate: ctx.store.state.settings.rate }); } finally { ctx.timer.release(); }
    }
  };

  const go = async (id) => {
    const node = dialogue.nodes[id];
    clear(turn);
    await botSay(node);
    if (node.end) {
      const max = turns || 1;
      const score = goodPoints;
      turn.append(h('p', { class: 'efl-ok' }, t('dlg.finished', { score: Math.round((score / max) * 100) })));
      announce(t('dlg.finishedShort'));
      if (onComplete) { onComplete({ score, max, choices }); }
      return;
    }
    renderTurn(node);
  };

  const choose = (node, opt) => {
    stopSpeaking();
    turns += 1;
    const fit = opt.fit || 'good';
    goodPoints += fit === 'good' ? 1 : fit === 'ok' ? 0.5 : 0;
    choices.push({ node: node.say, reply: opt.text, fit });
    log.append(h('li', { class: 'efl-chat__you' }, h('strong', null, `${t('dlg.you')}: `), h('span', { lang: 'en' }, opt.text)));
    if (opt.feedback) {
      log.append(h('li', { class: `efl-chat__fb efl-chat__fb--${fit}` }, pick(opt.feedback, lang)));
    }
    go(opt.next);
  };

  const renderTurn = (node) => {
    const replay = listenButtons(node.say, ctx, { slow: true, label: t('dlg.replay') });
    turn.append(h('p', { class: 'efl-small' }, t('dlg.yourTurn')), replay);
    const opts = h('div', { class: 'efl-opts efl-opts--stack', role: 'group', 'aria-label': t('dlg.replies') });
    node.options.forEach((o) => {
      const b = h('button', { type: 'button', class: 'efl-opt', lang: 'en' }, o.text);
      b.addEventListener('click', () => choose(node, o));
      opts.append(b);
    });
    if (difficulty === 'challenge') {
      opts.hidden = true;
      const reveal = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'dlg-reveal' }, t('dlg.reveal'));
      reveal.addEventListener('click', () => { opts.hidden = false; reveal.remove(); opts.querySelector('button').focus(); });
      turn.append(h('p', { class: 'efl-small' }, t('dlg.challengeHelp')), reveal);
    }
    if (asrSupported()) {
      const out = h('p', { class: 'efl-small', 'aria-live': 'polite' });
      const v = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'dlg-voice' }, '🎙 ', t('dlg.answerByVoice'));
      v.addEventListener('click', async () => {
        stopSpeaking();
        v.disabled = true;
        out.textContent = t('asr.listening');
        try {
          const r = await recognizeOnce();
          const best = closestOption(r.transcript, node.options.map((o) => o.text.replace(/\[[^\]]*\]/g, ' ')));
          if (best) { out.textContent = t('dlg.heardMatched', { heard: r.transcript }); choose(node, node.options[best.index]); } else { out.textContent = t('dlg.heardNoMatch', { heard: r.transcript }); opts.hidden = false; }
        } catch (e) {
          out.textContent = t('asr.noSpeech');
          opts.hidden = false;
        } finally { v.disabled = false; }
      });
      turn.append(v, out);
    } else {
      turn.append(h('p', { class: 'efl-small efl-muted' }, t('dlg.noAsr')));
    }
    turn.append(opts);
  };

  const start = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'dlg-start' }, '▶ ', t('dlg.start'));
  start.addEventListener('click', () => { start.remove(); go(dialogue.start); });
  turn.append(start);
  return wrap;
}

/* ---- writing task -----------------------------------------------------------
   step: { prompt, promptEs, minWords, checks[], rubric[], model }
   onSubmit({ checks, checkScore, checkMax, rubric }) */
export function writingTask(step, ctx, onSubmit) {
  const lang = ctx.lang();
  const wrap = h('div', { class: 'efl-writing' });
  const id = nextId('wr');
  const ta = h('textarea', { id, class: 'efl-textarea', rows: '6', lang: 'en', spellcheck: 'false', 'data-testid': 'writing-input' });
  const count = h('span', { class: 'efl-small efl-muted', 'aria-live': 'off' }, t('wr.words', { n: 0 }));
  ta.addEventListener('input', () => { count.textContent = t('wr.words', { n: countWords(ta.value) }); });
  const checksOut = h('div', { class: 'efl-checks', 'aria-live': 'polite' });
  const after = h('div');
  const check = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'writing-check' }, t('wr.check'));
  let lastChecks = null;
  check.addEventListener('click', () => {
    if (!ta.value.trim()) { clear(checksOut); checksOut.append(h('p', { class: 'efl-warn' }, t('wr.empty'))); return; }
    lastChecks = runWritingChecks(ta.value, step.checks);
    clear(checksOut);
    checksOut.append(
      h('h4', null, t('wr.autoTitle')),
      h('p', { class: 'efl-small efl-muted' }, t('wr.autoCaveat')),
      h('ul', { class: 'efl-checklist' }, lastChecks.map((c) => h('li', { class: c.pass ? 'efl-ok' : 'efl-warn' }, c.pass ? '✓ ' : '✗ ', pick(c.label, lang), !c.pass && c.hint ? h('span', { class: 'efl-small' }, ` — ${pick(c.hint, lang)}`) : null)))
    );
    if (!after.childNodes.length) {
      after.append(
        h('details', { class: 'efl-model' }, h('summary', null, t('wr.model')), h('p', { lang: 'en' }, step.model)),
        rubricForm(step.rubric, ctx, (rub) => {
          ta.readOnly = true;
          check.disabled = true;
          const passed = lastChecks.filter((c) => c.pass).length;
          onSubmit({ checks: lastChecks, checkScore: passed, checkMax: lastChecks.length, rubric: rub, text: ta.value });
        }, { title: t('wr.selfTitle') })
      );
    }
  });
  add(wrap,
    h('label', { for: id, class: 'efl-label' }, h('span', { lang: 'en' }, step.prompt)),
    step.promptEs && ctx.esOn() ? h('p', { class: 'efl-es efl-small', lang: 'es' }, step.promptEs) : null,
    ta, h('div', { class: 'efl-row' }, count, check), checksOut, after
  );
  return wrap;
}

/* ---- timed speaking challenge ------------------------------------------------
   challenge: { prompt, promptEs, seconds:[min,max], prepare[], model }
   rubric: criteria. onSubmit({ rubric, recorded, seconds }) */
export function speakingChallenge(challenge, rubric, ctx, onSubmit, { key, attempt } = {}) {
  const wrap = h('div', { class: 'efl-challenge' });
  let recorded = null;
  const rubricSlot = h('div');
  const showRubric = () => {
    if (rubricSlot.childNodes.length) { return; }
    rubricSlot.append(rubricForm(rubric, ctx, (r) => onSubmit({ rubric: r, recorded: !!(recorded && !recorded.fallback), seconds: recorded && recorded.seconds })));
  };
  const range = Array.isArray(challenge.seconds) ? challenge.seconds : [Math.round(challenge.seconds * 0.5), challenge.seconds];
  add(wrap,
    h('p', { class: 'efl-challenge__prompt', lang: 'en' }, challenge.prompt),
    challenge.promptEs && ctx.esOn() ? h('p', { class: 'efl-es', lang: 'es' }, challenge.promptEs) : null,
    challenge.prepare ? h('div', { class: 'efl-prepare' }, h('h4', null, t('sp.prepare')), h('ul', null, challenge.prepare.map((p) => h('li', { lang: 'en' }, pick(p, 'en'))))) : null,
    challenge.model ? h('details', { class: 'efl-model' }, h('summary', null, t('sp.modelAnswer')), h('p', { lang: 'en' }, challenge.model), listenButtons(challenge.model, ctx)) : null,
    recorderPanel(ctx, { key, attempt, maxSeconds: range[1] + 30, targetSeconds: range, modelText: null, onRecorded: (r) => { recorded = r; showRubric(); } }),
    rubricSlot
  );
  return wrap;
}
