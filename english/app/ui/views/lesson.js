/* =========================================================================
   lesson.js — the lesson runner.

   A lesson is an ordered list of typed steps (vocab, listening, grammar,
   pronunciation, speaking, interaction, reading, writing, retrieval). Each
   finished step is saved immediately as an activity result; the summary
   applies the lesson's completion criteria and recommends what's next.
   ========================================================================= */

import { h, clear, announce, pick, pct } from '../dom.js';
import { t } from '../../i18n.js';
import { listenButtons, segmentPlayerUI, repeatCard, syntheticNotice } from '../components/audio.js';
import { exerciseSet } from '../components/exercises.js';
import { dialogueRunner, writingTask, speakingChallenge } from '../components/tasks.js';
import { recordActivity, completeLesson, ensureLesson, awardBadge } from '../../core/store.js';
import { newCard, review, qualityFromAttempt } from '../../core/srs.js';
import { recommend } from '../../core/recommender.js';

const STEP_SKILL = {
  vocab: null, listening: 'listening', grammar: null, pronunciation: 'listening',
  speaking: 'speaking', interaction: 'listening', reading: 'reading', writing: 'writing', retrieval: null
};

export function sourceLabel(src) {
  return t(`src.${src}`);
}

export async function renderLesson(ctx, params) {
  const root = h('div', { class: 'efl-lesson' });
  const meta = ctx.data.curriculum.lessons.find((l) => l.id === params.id) || ctx.data.integratives.find((l) => l.id === params.id);
  if (!meta || meta.status !== 'available') {
    root.append(h('h2', { tabindex: '-1' }, t('lesson.notAvailable')), h('p', null, t('lesson.notAvailableBody')),
      h('button', { type: 'button', class: 'efl-btn', onclick: () => ctx.go('path') }, t('nav.path')));
    return root;
  }
  const lesson = await ctx.data.getLesson(params.id);
  const lang = ctx.lang();
  const es = ctx.esOn();
  ctx.store.update((s) => { ensureLesson(s, lesson.id); });
  const rec = () => ctx.store.state.lessons[lesson.id];

  /* header: objective, level, prerequisites, duration */
  root.append(
    h('p', { class: 'efl-eyebrow' }, `${lesson.level} · ${t('lesson.week', { n: lesson.week })} · ${lesson.kind === 'review' ? t('lesson.integrative') : t('lesson.lessonN', { n: lesson.order })}`),
    h('h2', { class: 'efl-h2', tabindex: '-1' }, lesson.title),
    h('div', { class: 'efl-lesson__meta' },
      h('div', null, h('h3', { class: 'efl-h4' }, t('lesson.objectives')),
        h('ul', null, lesson.objectives.map((o) => h('li', null, h('span', { lang: 'en' }, pick(o, 'en')), es && o.es ? h('span', { class: 'efl-es', lang: 'es' }, o.es) : null)))),
      h('dl', { class: 'efl-dl' },
        h('dt', null, t('lesson.level')), h('dd', null, lesson.level),
        h('dt', null, t('lesson.duration')), h('dd', null, t('lesson.minutes', { n: lesson.minutes })),
        h('dt', null, t('lesson.prereq')), h('dd', null, lesson.prerequisitesText ? pick(lesson.prerequisitesText, lang) : t('lesson.none')))
    ),
    syntheticNotice()
  );

  const stepper = h('ol', { class: 'efl-stepper', 'aria-label': t('lesson.steps') });
  const stage = h('section', { class: 'efl-stage', 'aria-live': 'off' });
  root.append(h('nav', { 'aria-label': t('lesson.steps') }, stepper), stage);

  const steps = lesson.steps;
  const drawStepper = (current) => {
    clear(stepper);
    steps.forEach((s, i) => {
      const a = rec().activities[s.id];
      const b = h('button', { type: 'button', class: `efl-stepper__btn${i === current ? ' is-current' : ''}${a ? ' is-done' : ''}`, 'aria-current': i === current ? 'step' : null, 'data-step': s.id },
        h('span', { class: 'efl-stepper__n', 'aria-hidden': 'true' }, a ? '✓' : String(i + 1)),
        h('span', null, t(`step.${s.type}`)),
        h('span', { class: 'efl-sr' }, a ? ` (${t('lesson.done')})` : ''));
      b.addEventListener('click', () => show(i));
      stepper.append(h('li', null, b));
    });
    const sb = h('button', { type: 'button', class: `efl-stepper__btn${current === steps.length ? ' is-current' : ''}`, 'data-step': 'summary' },
      h('span', { class: 'efl-stepper__n', 'aria-hidden': 'true' }, '★'), h('span', null, t('step.summary')));
    sb.addEventListener('click', () => show(steps.length));
    stepper.append(h('li', null, sb));
  };

  const save = (step, result) => {
    const skill = step.skill !== undefined ? step.skill : STEP_SKILL[step.type];
    ctx.store.update((s) => {
      recordActivity(s, lesson.id, step.id, { ...result, skill });
      s.lessons[lesson.id].cursor = steps.indexOf(step) + 1;
    });
  };

  const srsFromResults = (step, results) => {
    const byId = Object.fromEntries((step.exercises || []).map((e) => [e.id, e]));
    ctx.store.update((s) => {
      for (const r of results) {
        const ex = byId[r.id];
        if (ex && ex.vocab && ctx.data.vocab.has(ex.vocab)) {
          const card = s.srs[ex.vocab] || newCard();
          s.srs[ex.vocab] = review(card, qualityFromAttempt({ correct: r.correct, attempts: r.attempts }));
        }
      }
    });
  };

  const show = (i) => {
    drawStepper(i);
    clear(stage);
    if (i >= steps.length) { stage.append(summary()); focusHeading(); return; }
    const step = steps[i];
    const prev = rec().activities[step.id];
    const next = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'next-step', disabled: !prev }, i === steps.length - 1 ? t('lesson.toSummary') : t('lesson.nextStep'), ' →');
    next.addEventListener('click', () => show(i + 1));
    const status = h('p', { class: 'efl-small', 'aria-live': 'polite' }, prev ? t('lesson.stepDonePrev', { score: describe(prev) }) : '');
    const onDone = (result) => {
      save(step, result);
      next.disabled = false;
      status.textContent = t('lesson.stepSaved');
      announce(t('lesson.stepSaved'));
      drawStepper(i);
    };
    stage.append(
      h('h3', { class: 'efl-h3', tabindex: '-1' }, `${i + 1}. ${t(`step.${step.type}`)}: `, h('span', { lang: 'en' }, step.title)),
      step.intro ? h('p', null, pick(step.intro, 'en')) : null,
      step.intro && step.intro.es && es ? h('p', { class: 'efl-es', lang: 'es' }, step.intro.es) : null,
      renderStep(step, lesson, ctx, onDone, srsFromResults),
      h('div', { class: 'efl-stage__foot' }, status, next)
    );
    focusHeading();
  };

  const focusHeading = () => {
    const hd = stage.querySelector('h3, h2');
    if (hd && ctx.focusOnRender) { hd.focus({ preventScroll: false }); }
  };

  const describe = (a) => (a.ratio == null ? sourceLabel(a.source) : `${pct(a.ratio)} (${sourceLabel(a.source)})`);

  const summary = () => {
    const req = steps.map((s) => s.id);
    let res = null;
    ctx.store.update((s) => {
      res = completeLesson(s, lesson.id, req, lesson.completion.reviewThreshold);
      if (res.ok) {
        awardBadge(s, 'firstLesson');
        /* vocabulary enters spaced repetition as NEW cards (not "learned") */
        for (const id of lesson.vocabIds || []) { if (!s.srs[id]) { s.srs[id] = newCard(); } }
        if (lesson.kind === 'review') {
          s.assessments[`week${lesson.week}`] = buildAssessment(s.lessons[lesson.id], lesson);
          awardBadge(s, `week${lesson.week}`);
        }
      }
    });
    const box = h('div', { class: 'efl-summary' }, h('h3', { class: 'efl-h3', tabindex: '-1' }, t('lesson.summaryTitle')));
    if (!res.ok) {
      box.append(h('p', { class: 'efl-warn' }, t('lesson.missingSteps')),
        h('ul', null, res.missing.map((id) => {
          const idx = steps.findIndex((s) => s.id === id);
          return h('li', null, h('button', { type: 'button', class: 'efl-linkbtn', onclick: () => show(idx) }, `${idx + 1}. ${t(`step.${steps[idx].type}`)} — ${steps[idx].title}`));
        })));
      return box;
    }
    const r = rec();
    box.append(
      h('p', { class: 'efl-ok', 'data-testid': 'lesson-complete' }, '✓ ', t('lesson.completed')),
      h('table', { class: 'efl-table' },
        h('caption', { class: 'efl-sr' }, t('lesson.resultsCaption')),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('lesson.activity')), h('th', { scope: 'col' }, t('lesson.result')), h('th', { scope: 'col' }, t('lesson.source')), h('th', { scope: 'col' }, t('lesson.attempts')))),
        h('tbody', null, steps.map((s) => {
          const a = r.activities[s.id];
          return h('tr', null, h('td', null, `${t(`step.${s.type}`)} — `, h('span', { lang: 'en' }, s.title)), h('td', null, a.ratio == null ? '—' : pct(a.ratio)), h('td', null, sourceLabel(a.source)), h('td', null, String(a.attempts)));
        })))
    );
    if (r.weakActivities && r.weakActivities.length) {
      box.append(h('p', { class: 'efl-warn' }, t('lesson.reviewRecommended')),
        h('ul', null, r.weakActivities.map((id) => {
          const idx = steps.findIndex((s) => s.id === id);
          return h('li', null, h('button', { type: 'button', class: 'efl-linkbtn', onclick: () => show(idx) }, `${t(`step.${steps[idx].type}`)} — ${steps[idx].title}`));
        })));
    } else {
      box.append(h('p', null, t('lesson.allGood')));
    }
    if (lesson.feedback) { box.append(h('p', null, pick(lesson.feedback, 'en')), es && lesson.feedback.es ? h('p', { class: 'efl-es', lang: 'es' }, lesson.feedback.es) : null); }
    box.append(h('p', { class: 'efl-small efl-muted' }, t('lesson.vocabToSrs', { n: (lesson.vocabIds || []).length })));
    const recs = recommend(ctx.store.state, ctx.data.curriculum).filter((x) => x.rule !== 'R2');
    const nextRec = recs.find((x) => x.rule === 'R6') || recs[0];
    if (nextRec) {
      box.append(h('div', { class: 'efl-next' }, h('h4', null, t('lesson.whatsNext')),
        h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'next-activity', onclick: () => ctx.go(nextRec.view, nextRec.id ? { id: nextRec.id } : {}) }, t(nextRec.key, nextRec.params))));
    }
    box.append(h('button', { type: 'button', class: 'efl-btn', onclick: () => ctx.go('vocab') }, t('lesson.reviewVocab')));
    return box;
  };

  const start = Math.min(rec().cursor || 0, steps.length);
  show(rec().status === 'completed' ? 0 : start);
  return root;
}

function buildAssessment(lessonRec, lesson) {
  const bySkill = {};
  for (const s of lesson.steps) {
    const a = lessonRec.activities[s.id];
    const skill = s.skill !== undefined ? s.skill : STEP_SKILL[s.type];
    if (!a || !skill) { continue; }
    (bySkill[skill] = bySkill[skill] || []).push({ ratio: a.ratio, source: a.source, step: s.id });
    const checks = lessonRec.activities[`${s.id}-checks`];
    if (checks) { bySkill[skill].push({ ratio: checks.ratio, source: checks.source, step: `${s.id}-checks` }); }
  }
  return { at: new Date().toISOString(), lessonId: lesson.id, bySkill };
}

/* ---------------------------------------------------------------------- */

function renderStep(step, lesson, ctx, onDone, srsFromResults) {
  const es = ctx.esOn();
  const box = h('div', { class: `efl-step efl-step--${step.type}` });
  const exDone = (r) => {
    srsFromResults(step, r.results);
    onDone({ score: r.score, max: r.max, source: 'auto' });
  };

  switch (step.type) {
    case 'vocab': {
      const grid = h('ul', { class: 'efl-vocab-grid' });
      for (const id of step.items) {
        const v = ctx.data.vocab.get(id);
        grid.append(vocabCard(v, ctx));
      }
      box.append(grid, h('h4', null, t('lesson.quickCheck')), exerciseSet(step.exercises, ctx, exDone));
      break;
    }
    case 'listening': {
      box.append(
        h('p', { class: 'efl-small' }, t('lesson.listenFirst')),
        segmentPlayerUI(step.lines, ctx, { transcript: false }),
        h('h4', null, t('lesson.comprehension')),
        exerciseSet(step.exercises, ctx, exDone)
      );
      break;
    }
    case 'grammar': {
      box.append(h('div', { class: 'efl-explain' },
        h('p', { lang: 'en' }, step.explanation.en),
        es && step.explanation.es ? h('p', { class: 'efl-es', lang: 'es' }, step.explanation.es) : null));
      if (step.table) {
        box.append(h('table', { class: 'efl-table efl-table--grammar' },
          h('thead', null, h('tr', null, step.table.head.map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', { lang: 'en' }, step.table.rows.map((row) => h('tr', null, row.map((c) => h('td', null, c)))))));
      }
      box.append(h('ul', { class: 'efl-examples' }, step.examples.map((ex) => h('li', null,
        h('span', { lang: 'en' }, ex.en), ' ', listenButtons(ex.en, ctx, { slow: false }),
        es && ex.es ? h('span', { class: 'efl-es', lang: 'es' }, ex.es) : null))));
      if (step.watchOut) {
        box.append(h('div', { class: 'efl-callout' }, h('strong', null, t('lesson.watchOut')), ' ', pick(step.watchOut, 'en'),
          es && step.watchOut.es ? h('p', { class: 'efl-es', lang: 'es' }, step.watchOut.es) : null));
      }
      box.append(h('h4', null, t('lesson.practice')), exerciseSet(step.exercises, ctx, exDone));
      break;
    }
    case 'pronunciation': {
      box.append(h('div', { class: 'efl-callout' },
        h('p', null, h('strong', null, t('lesson.focus')), ' ', step.focus),
        h('p', null, step.tip.en), es && step.tip.es ? h('p', { class: 'efl-es', lang: 'es' }, step.tip.es) : null));
      if (step.repeat) {
        box.append(h('h4', null, t('lesson.listenRepeat')), h('div', { class: 'efl-repeat-list' },
          step.repeat.map((p, k) => repeatCard(p, ctx, { key: `${lesson.id}/${step.id}/${k}`, tips: ctx.data.tips, attempt: { lessonId: lesson.id, activityId: `${step.id}-rec-${k}` } }))));
      }
      box.append(h('h4', null, t('lesson.discriminate')), exerciseSet(step.exercises, ctx, exDone));
      break;
    }
    case 'speaking': {
      box.append(h('h4', null, t('lesson.listenRepeat')), h('div', { class: 'efl-repeat-list' },
        step.repeat.map((p, k) => repeatCard({ ...p, onAsr: (r) => ctx.store.update((s) => {
          recordActivity(s, lesson.id, `${step.id}-asr-${k}`, { score: r.matched, max: r.total, source: 'asr', skill: 'speaking' });
        }) }, ctx, { key: `${lesson.id}/${step.id}/${k}`, tips: ctx.data.tips, attempt: { lessonId: lesson.id, activityId: `${step.id}-rec-${k}` } }))));
      box.append(h('h4', null, t('lesson.challenge')),
        speakingChallenge(step.challenge, step.rubric, ctx, (r) => onDone({ score: r.rubric.score, max: r.rubric.max, source: 'self', detail: { recorded: r.recorded, seconds: r.seconds, ratings: r.rubric.ratings } }), { key: `${lesson.id}/${step.id}/challenge`, attempt: { lessonId: lesson.id, activityId: `${step.id}-rec-challenge` } }));
      break;
    }
    case 'interaction': {
      const slot = h('div', null, h('p', null, t('loading')));
      box.append(slot);
      ctx.data.getDialogue(step.dialogue).then((d) => {
        clear(slot);
        slot.append(dialogueRunner(d, ctx, {
          difficulty: step.difficulty || 'guided',
          onComplete: (r) => {
            onDone({ score: r.score, max: r.max, source: 'auto', detail: { choices: r.choices } });
            ctx.store.update((s) => { s.badges.firstConversation = s.badges.firstConversation || new Date().toISOString(); });
          }
        }));
        if (step.followUp) {
          slot.append(h('div', { class: 'efl-callout' }, h('p', null, pick(step.followUp, 'en')), es && step.followUp.es ? h('p', { class: 'efl-es', lang: 'es' }, step.followUp.es) : null));
        }
      }).catch((e) => { clear(slot); slot.append(h('p', { class: 'efl-bad' }, t('loadError', { msg: e.message }))); });
      break;
    }
    case 'reading': {
      box.append(h('article', { class: 'efl-reading', lang: 'en' }, step.text.split(/\n\n+/).map((p) => h('p', null, p))),
        listenButtons(step.text, ctx, { label: t('lesson.listenText') }));
      if (step.glossary && es) {
        box.append(h('details', { class: 'efl-model' }, h('summary', null, t('lesson.glossary')),
          h('dl', { class: 'efl-dl' }, Object.entries(step.glossary).flatMap(([k, v]) => [h('dt', { lang: 'en' }, k), h('dd', { lang: 'es' }, v)]))));
      }
      box.append(h('h4', null, t('lesson.comprehension')), exerciseSet(step.exercises, ctx, exDone));
      break;
    }
    case 'writing': {
      box.append(writingTask(step, ctx, (r) => {
        ctx.store.update((s) => {
          recordActivity(s, lesson.id, `${step.id}-checks`, { score: r.checkScore, max: r.checkMax, source: 'auto', skill: 'writing', detail: { checks: r.checks.map((c) => ({ id: c.id, pass: c.pass })) } });
        });
        onDone({ score: r.rubric.score, max: r.rubric.max, source: 'self', detail: { text: r.text.slice(0, 2000), ratings: r.rubric.ratings } });
      }));
      break;
    }
    case 'retrieval': {
      box.append(h('p', { class: 'efl-small' }, t('lesson.retrievalHelp')), exerciseSet(step.exercises, ctx, exDone));
      break;
    }
    default:
      box.append(h('p', null, `Unknown step ${step.type}`));
  }
  return box;
}

export function vocabCard(v, ctx) {
  const es = ctx.esOn();
  return h('li', { class: 'efl-vcard' },
    h('p', { class: 'efl-vcard__word', lang: 'en' }, v.word),
    h('p', { class: 'efl-ipa' }, v.ipa, v.pos ? h('span', { class: 'efl-pos' }, ` · ${v.pos}`) : null),
    es ? h('p', { class: 'efl-es', lang: 'es' }, v.es) : null,
    listenButtons(v.word, ctx),
    h('p', { class: 'efl-vcard__ex', lang: 'en' }, v.example, ' ', listenButtons(v.example, ctx, { slow: false, label: t('lesson.example') })),
    v.collocations && v.collocations.length ? h('p', { class: 'efl-small' }, h('strong', null, t('vocab.collocations')), ' ', h('span', { lang: 'en' }, v.collocations.join(' · '))) : null,
    v.trap ? h('p', { class: 'efl-small efl-trap' }, h('strong', null, t('vocab.trap')), ' ', pick(v.trap, ctx.lang())) : null
  );
}
