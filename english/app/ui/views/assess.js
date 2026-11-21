/* =========================================================================
   assess.js — optional placement diagnostic and per-week assessments.

   Placement rules (transparent, see _docs/ASSESSMENT.md):
     share(level) = points / items at that level (1st try = 1, 2nd = 0.5)
     A1 < 0.6                      -> range Pre-A1–A1, start Week 1
     A1 >= 0.6 and A2 < 0.6        -> range A1, start Week 1 (faster pace)
     A1 >= 0.8, A2 >= 0.6, B1 < .6 -> range A2 (probable), start Week 5
     B1 >= 0.6                     -> "B1 or above": this test cannot place
                                      higher; productive skills need review
   Confidence is always reported as low: only selected/typed answers are
   scored automatically. Speaking and writing samples are stored as
   self-assessed / pending and never change the placement by themselves.
   ========================================================================= */

import { h, add, clear, pick, pct } from '../dom.js';
import { t } from '../../i18n.js';
import { exerciseSet } from '../components/exercises.js';
import { speakingChallenge } from '../components/tasks.js';
import { syntheticNotice } from '../components/audio.js';
import { runWritingChecks, countWords } from '../../core/scoring.js';
import { awardBadge, SKILLS } from '../../core/store.js';
import { sourceLabel } from './lesson.js';
import { placement } from '../../core/placement.js';

export async function renderAssess(ctx) {
  const st = ctx.store.state;
  const root = h('div', { class: 'efl-assess' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.assess')),
    h('p', null, t('as.intro')),
    h('ul', { class: 'efl-plain efl-small' }, ['auto', 'asr', 'self', 'pending'].map((s) => h('li', null, h('strong', null, t(`src.${s}`)), ' — ', t(`src.${s}.desc`)))),
    h('p', { class: 'efl-notice', role: 'note' }, t('as.notCert')));

  /* diagnostic */
  const diagSec = h('section', { class: 'efl-card efl-card--wide', 'aria-labelledby': 'as-diag' }, h('h3', { class: 'efl-h3', id: 'as-diag' }, t('diag.title')));
  const slot = h('div');
  const drawIntro = () => {
    clear(slot);
    if (st.diagnostic) { slot.append(diagResult(st.diagnostic, ctx)); }
    const start = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'diag-start' }, st.diagnostic ? t('diag.repeat') : t('diag.start'));
    start.addEventListener('click', async () => { clear(slot); slot.append(await runDiagnostic(ctx, () => { clear(slot); slot.append(diagResult(ctx.store.state.diagnostic, ctx)); })); });
    const zero = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'diag-zero', onclick: () => ctx.go('lesson', { id: 'w01-l1' }) }, t('diag.fromZero'));
    slot.append(h('p', null, t('diag.help')), h('div', { class: 'efl-row efl-row--wrap' }, start, zero));
  };
  drawIntro();
  diagSec.append(slot);
  root.append(diagSec);

  /* week assessments */
  const weekSec = h('section', { class: 'efl-card efl-card--wide', 'aria-labelledby': 'as-weeks' }, h('h3', { class: 'efl-h3', id: 'as-weeks' }, t('as.weekly')));
  for (const integ of ctx.data.integratives) {
    const a = st.assessments[`week${integ.week}`];
    const row = h('div', { class: 'efl-assess__week', 'data-testid': `assessment-week${integ.week}` },
      h('h4', null, `${t('lesson.week', { n: integ.week })} — `, h('span', { lang: 'en' }, integ.title)));
    if (integ.status !== 'available') {
      row.append(h('p', { class: 'efl-muted' }, t('status.planned')));
    } else if (!a) {
      row.append(h('p', null, t('as.notTaken')), h('button', { type: 'button', class: 'efl-btn', onclick: () => ctx.go('lesson', { id: integ.id }) }, t('as.take')));
    } else {
      row.append(h('table', { class: 'efl-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('prog.skill')), h('th', { scope: 'col' }, t('lesson.result')), h('th', { scope: 'col' }, t('lesson.source')))),
        h('tbody', null, SKILLS.flatMap((sk) => (a.bySkill[sk] || []).map((r) => h('tr', null, h('td', null, t(`skill.${sk}`)), h('td', null, r.ratio == null ? '—' : pct(r.ratio)), h('td', null, sourceLabel(r.source))))))),
      h('p', { class: 'efl-small efl-muted' }, t('as.takenAt', { d: a.at.slice(0, 10) })),
      h('button', { type: 'button', class: 'efl-btn', onclick: () => ctx.go('lesson', { id: integ.id }) }, t('as.retake')));
    }
    weekSec.append(row);
    if (integ.week >= 4) { break; }
  }
  weekSec.append(h('p', { class: 'efl-small efl-muted' }, t('as.moreLater')));
  root.append(weekSec);

  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h3' }, t('as.rubricsTitle')),
    h('p', { class: 'efl-small' }, t('as.rubricsHelp')),
    h('ul', null, ['speaking', 'listening', 'reading', 'writing'].map((s) => h('li', null, h('strong', null, t(`skill.${s}`)), ': ', t(`as.rubric.${s}`))))));
  return root;
}

async function runDiagnostic(ctx, onFinish) {
  const d = await ctx.data.getDiagnostic();
  const wrap = h('div', { class: 'efl-diag' });
  wrap.append(syntheticNotice(), h('p', { class: 'efl-small' }, t('diag.how')));
  const levelPoints = {};
  const levelItems = {};
  const sectionsDone = new Set();
  let writing = null;
  let speaking = null;
  const finishBtn = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', disabled: true, 'data-testid': 'diag-finish' }, t('diag.finish'));
  const check = () => { finishBtn.disabled = sectionsDone.size < d.sections.length; };

  for (const sec of d.sections) {
    const items = sec.items.map((x) => ({ ...x, id: `diag-${x.id}` }));
    wrap.append(h('h4', null, pick(sec.title, ctx.lang())),
      exerciseSet(items, ctx, (r) => {
        r.results.forEach((res) => {
          const it = items.find((x) => x.id === res.id);
          levelPoints[it.level] = (levelPoints[it.level] || 0) + res.score;
          levelItems[it.level] = (levelItems[it.level] || 0) + 1;
        });
        sectionsDone.add(sec.id);
        check();
      }));
  }

  /* writing sample: rule checks only */
  const ta = h('textarea', { class: 'efl-textarea', rows: '4', lang: 'en', id: 'diag-writing', spellcheck: 'false' });
  add(wrap, h('h4', null, t('diag.writingTitle')), h('label', { for: 'diag-writing', lang: 'en' }, d.writing.prompt),
    d.writing.promptEs && ctx.esOn() ? h('p', { class: 'efl-es efl-small', lang: 'es' }, d.writing.promptEs) : null, ta,
    h('p', { class: 'efl-small efl-muted' }, t('diag.writingNote')));

  /* speaking sample: recorded + self-rated, optional */
  wrap.append(h('h4', null, t('diag.speakingTitle')), h('p', { class: 'efl-small efl-muted' }, t('diag.speakingNote')),
    speakingChallenge(d.speaking.challenge, d.speaking.rubric, ctx, (r) => { speaking = { score: r.rubric.score, max: r.rubric.max, recorded: r.recorded }; }, { key: 'diagnostic/speaking' }));

  finishBtn.addEventListener('click', () => {
    const text = ta.value.trim();
    if (text) {
      const checks = runWritingChecks(text, d.writing.checks);
      writing = { words: countWords(text), passed: checks.filter((c) => c.pass).length, total: checks.length };
    }
    const shares = {};
    for (const lv of Object.keys(levelItems)) { shares[lv] = levelPoints[lv] / levelItems[lv]; }
    const place = placement(shares);
    ctx.store.update((s) => {
      s.diagnostic = { at: new Date().toISOString(), shares, items: levelItems, placement: place, writing, speaking, confidence: 'low' };
      awardBadge(s, 'diagnostic');
    });
    onFinish();
  });
  wrap.append(finishBtn);
  return wrap;
}

function diagResult(diag, ctx) {
  const p = diag.placement;
  return h('div', { class: 'efl-callout', 'data-testid': 'diag-result' },
    h('h4', null, t('diag.resultTitle')),
    h('p', { class: 'efl-big' }, t('diag.range', { range: p.range })),
    h('p', null, t(p.key)),
    h('p', { class: 'efl-warn efl-small' }, t('diag.uncertainty')),
    h('ul', { class: 'efl-small' }, Object.keys(diag.shares).sort().map((lv) => h('li', null, `${lv}: ${pct(diag.shares[lv])} (${t('diag.nItems', { n: diag.items[lv] })})`))),
    diag.writing ? h('p', { class: 'efl-small' }, t('diag.writingResult', { words: diag.writing.words, passed: diag.writing.passed, total: diag.writing.total })) : h('p', { class: 'efl-small efl-muted' }, t('diag.noWriting')),
    diag.speaking ? h('p', { class: 'efl-small' }, t('diag.speakingResult', { score: diag.speaking.score, max: diag.speaking.max })) : h('p', { class: 'efl-small efl-muted' }, t('diag.noSpeaking')),
    p.startWeek > 1 ? h('p', { class: 'efl-small' }, t('diag.notYet', { w: p.startWeek })) : null,
    h('button', { type: 'button', class: 'efl-btn efl-btn--primary', onclick: () => ctx.go('lesson', { id: 'w01-l1' }) }, t('diag.goWeek1')),
    h('p', { class: 'efl-small efl-muted' }, t('diag.takenAt', { d: diag.at.slice(0, 10) })));
}

