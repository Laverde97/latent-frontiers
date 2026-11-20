/* =========================================================================
   overview.js — Dashboard, Learning Path and My Progress.
   ========================================================================= */

import { h, pct } from '../dom.js';
import { t } from '../../i18n.js';
import { skillSummary, estimateLevel } from '../../core/scoring.js';
import { recommend, lessonStatus, nextLesson } from '../../core/recommender.js';
import { countDue, cardStage } from '../../core/srs.js';
import { STUDY_MODES, weeklyGoalMinutes, minutesThisWeek, totalMinutes, studyDays } from '../../core/time.js';
import { SKILLS, todayKey } from '../../core/store.js';
import { BADGES } from '../badges.js';

const SKILL_TARGET = { speaking: 40, listening: 35, reading: 15, writing: 10 };

export function levelText(est) {
  if (est.inProgress) {
    return est.reached ? t('level.reachedAndProgress', { reached: est.reached, next: est.level }) : t('level.inProgress', { level: est.level });
  }
  return est.reached ? t('level.reached', { level: est.reached }) : t('level.pre');
}

function skillTile(skill, s) {
  const lines = [];
  if (s.auto) { lines.push(h('p', { class: 'efl-tile__val' }, pct(s.auto.mean), h('span', { class: 'efl-tile__src' }, ` ${t('src.auto')} · n=${s.auto.n}`))); }
  if (s.asr) { lines.push(h('p', { class: 'efl-small' }, `${t('src.asr')}: ${pct(s.asr.mean)} (n=${s.asr.n})`)); }
  if (s.self) { lines.push(h('p', { class: s.auto ? 'efl-small' : 'efl-tile__val' }, pct(s.self.mean), h('span', { class: 'efl-tile__src' }, ` ${t('src.self')} · n=${s.self.n}`))); }
  if (s.pending) { lines.push(h('p', { class: 'efl-small' }, t('src.pendingN', { n: s.pending }))); }
  if (!lines.length) { lines.push(h('p', { class: 'efl-muted' }, t('dash.noEvidence'))); }
  return h('li', { class: `efl-tile efl-tile--${skill}`, 'data-testid': `skill-${skill}` },
    h('h4', null, t(`skill.${skill}`), h('span', { class: 'efl-tile__target' }, ` · ${t('dash.targetShare', { n: SKILL_TARGET[skill] })}`)), ...lines);
}

export async function renderDashboard(ctx) {
  const st = ctx.store.state;
  const cur = ctx.data.curriculum;
  const est = estimateLevel(st, cur);
  const sum = skillSummary(st.evidence);
  const recs = recommend(st, cur);
  const next = nextLesson(st, cur);
  const completed = cur.lessons.filter((l) => st.lessons[l.id] && st.lessons[l.id].status === 'completed').length;
  const available = cur.lessons.filter((l) => l.status === 'available').length;
  const mode = STUDY_MODES[st.settings.studyMode] || STUDY_MODES.standard;
  const goal = weeklyGoalMinutes(st.settings.studyMode);
  const week = minutesThisWeek(st.practice);
  const today = Math.round(st.practice[todayKey()] || 0);
  const due = countDue(st.srs);
  const in7 = Object.values(st.srs).filter((c) => new Date(c.due) - Date.now() < 7 * 864e5).length;
  const inProg = cur.lessons.find((l) => lessonStatus(st, l) === 'in_progress');
  let pending = 0;
  if (inProg) {
    const L = await ctx.data.getLesson(inProg.id);
    pending = L.steps.filter((s) => !(st.lessons[inProg.id].activities[s.id])).length;
  }

  const root = h('div', { class: 'efl-dash' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.dashboard')));

  root.append(h('div', { class: 'efl-cards' },
    h('section', { class: 'efl-card', 'data-testid': 'level-card' },
      h('h3', { class: 'efl-h4' }, t('dash.level')),
      h('p', { class: 'efl-big' }, levelText(est)),
      h('p', { class: 'efl-small efl-muted' }, t('dash.levelHow'))),
    h('section', { class: 'efl-card' },
      h('h3', { class: 'efl-h4' }, t('dash.current')),
      next ? h('p', { class: 'efl-big' }, t('dash.weekLesson', { w: next.week, l: next.order })) : h('p', { class: 'efl-big' }, t('dash.allAvailableDone')),
      next ? h('p', { lang: 'en' }, next.title) : null,
      next ? h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'dash-continue', onclick: () => ctx.go('lesson', { id: next.id }) }, inProg ? t('dash.continue') : t('dash.start')) : null),
    h('section', { class: 'efl-card' },
      h('h3', { class: 'efl-h4' }, t('dash.progress')),
      h('p', { class: 'efl-big' }, `${completed} / 130`),
      progressBar(completed / 130, t('dash.progressAria', { n: completed })),
      h('p', { class: 'efl-small efl-muted' }, t('dash.availableNow', { n: available }))),
    h('section', { class: 'efl-card' },
      h('h3', { class: 'efl-h4' }, t('dash.time')),
      h('p', { class: 'efl-big' }, t('dash.minutes', { n: totalMinutes(st.practice) })),
      h('p', { class: 'efl-small' }, t('dash.studyDays', { n: studyDays(st.practice) })),
      h('p', { class: 'efl-small' }, t('dash.today', { n: today, goal: mode.dailyMinutes })))
  ));

  root.append(h('h3', { class: 'efl-h3' }, t('dash.skills')), h('p', { class: 'efl-small efl-muted' }, t('dash.skillsHelp')),
    h('ul', { class: 'efl-tiles' }, SKILLS.map((s) => skillTile(s, sum[s]))));

  const goals = h('section', { class: 'efl-card' }, h('h3', { class: 'efl-h4' }, t('dash.weeklyGoals')),
    h('p', null, t('dash.weekMinutes', { n: week, goal })), progressBar(Math.min(1, week / goal), t('dash.weekMinutesAria')),
    h('p', { class: 'efl-small efl-muted' }, t(`mode.${st.settings.studyMode}`)),
    h('p', { class: 'efl-small' }, t('dash.restNote')));

  const reviews = h('section', { class: 'efl-card' }, h('h3', { class: 'efl-h4' }, t('dash.reviews')),
    h('p', { class: 'efl-big' }, String(due)), h('p', { class: 'efl-small' }, t('dash.reviewsDue', { n: due, week: in7 })),
    due ? h('button', { type: 'button', class: 'efl-btn', onclick: () => ctx.go('vocab') }, t('dash.reviewNow')) : null);

  const pend = h('section', { class: 'efl-card' }, h('h3', { class: 'efl-h4' }, t('dash.pending')),
    inProg ? h('p', null, t('dash.pendingSteps', { n: pending, title: inProg.title })) : h('p', null, t('dash.noPending')));

  root.append(h('div', { class: 'efl-cards' }, goals, reviews, pend));

  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h4' }, t('dash.recs')),
    h('p', { class: 'efl-small efl-muted' }, t('dash.recsHow')),
    h('ol', { class: 'efl-recs', 'data-testid': 'recs' }, recs.map((r) => h('li', null,
      r.view ? h('button', { type: 'button', class: 'efl-linkbtn', onclick: () => ctx.go(r.view, r.id ? { id: r.id } : {}) }, t(r.key, r.params)) : t(r.key, r.params),
      h('span', { class: 'efl-small efl-muted' }, ` (${t('dash.rule')} ${r.rule})`))))));

  const earned = BADGES.filter((b) => st.badges[b.id]);
  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h4' }, t('dash.badges')),
    earned.length ? h('ul', { class: 'efl-badges' }, earned.map((b) => h('li', null, h('span', { 'aria-hidden': 'true' }, b.icon), ' ', t(`badge.${b.id}`)))) : h('p', { class: 'efl-muted' }, t('dash.noBadges')),
    h('p', { class: 'efl-small efl-muted' }, t('dash.badgesNote'))));
  return root;
}

export function progressBar(ratio, label) {
  const v = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return h('div', { class: 'efl-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(v), 'aria-label': label },
    h('span', { class: 'efl-bar__fill', style: `width:${v}%` }));
}

/* ---- Learning path ------------------------------------------------------ */
export function renderPath(ctx) {
  const st = ctx.store.state;
  const cur = ctx.data.curriculum;
  const root = h('div', { class: 'efl-path' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.path')), h('p', null, t('path.intro')),
    h('ul', { class: 'efl-legend', 'aria-label': t('path.legend') }, ['available', 'in_progress', 'completed', 'locked', 'review', 'planned'].map((s) => h('li', null, h('span', { class: `efl-status efl-status--${s}` }, t(`status.${s}`))))));
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
  for (const lv of levels) {
    const weeks = cur.weeks.filter((w) => w.level === lv);
    const sec = h('section', { class: 'efl-level', 'aria-labelledby': `lv-${lv}` },
      h('h3', { class: 'efl-h3', id: `lv-${lv}` }, `${lv} — ${t(`level.name.${lv}`)}`, h('span', { class: 'efl-small efl-muted' }, ` · ${t('path.weeks', { a: weeks[0].week, b: weeks[weeks.length - 1].week })}`)));
    for (const wk of weeks) {
      const lessons = cur.lessons.filter((l) => l.week === wk.week);
      const integ = ctx.data.integratives.find((x) => x.week === wk.week);
      const det = h('details', { class: 'efl-week', open: lessons.some((l) => l.status === 'available') ? true : null },
        h('summary', null, h('strong', null, t('lesson.week', { n: wk.week })), ' — ', h('span', { lang: 'en' }, wk.title)),
        h('ol', { class: 'efl-week__list' }, lessons.map((l) => {
          const s = lessonStatus(st, l);
          const label = h('span', { lang: 'en' }, l.title);
          return h('li', { class: 'efl-week__item', 'data-lesson': l.id },
            l.status === 'available' ? h('button', { type: 'button', class: 'efl-linkbtn', onclick: () => ctx.go('lesson', { id: l.id }) }, label) : label,
            ' ', h('span', { class: `efl-status efl-status--${s}` }, t(`status.${s}`)));
        })),
        integ ? h('p', { class: 'efl-small' }, h('strong', null, t('lesson.integrative')), ': ',
          integ.status === 'available' ? h('button', { type: 'button', class: 'efl-linkbtn', 'data-testid': `integrative-${wk.week}`, onclick: () => ctx.go('lesson', { id: integ.id }) }, integ.title) : h('span', null, integ.title),
          ' ', h('span', { class: `efl-status efl-status--${integrativeStatus(st, integ, lessons)}` }, t(`status.${integrativeStatus(st, integ, lessons)}`))) : null,
        h('p', { class: 'efl-small efl-muted' }, t('path.flexDay')));
      sec.append(det);
    }
    root.append(sec);
  }
  return root;
}

function integrativeStatus(st, integ, lessons) {
  if (integ.status !== 'available') { return 'planned'; }
  const r = st.lessons[integ.id];
  if (r && r.status === 'completed') { return r.needsReview ? 'review' : 'completed'; }
  if (r) { return 'in_progress'; }
  return lessons.every((l) => st.lessons[l.id] && st.lessons[l.id].status === 'completed') ? 'available' : 'locked';
}

/* ---- My progress -------------------------------------------------------- */
export function renderProgress(ctx) {
  const st = ctx.store.state;
  const cur = ctx.data.curriculum;
  const sum = skillSummary(st.evidence);
  const root = h('div', { class: 'efl-progress' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.progress')));

  /* last 14 days of practice */
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(todayKey(d)); }
  const max = Math.max(30, ...days.map((d) => st.practice[d] || 0));
  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h4' }, t('prog.minutes14')),
    h('table', { class: 'efl-chart' },
      h('caption', { class: 'efl-sr' }, t('prog.minutes14')),
      h('tbody', null, h('tr', null, days.map((d) => {
        const m = Math.round(st.practice[d] || 0);
        return h('td', null, h('span', { class: 'efl-chart__bar', style: `height:${Math.round((m / max) * 100)}%`, title: `${d}: ${m} min` }),
          h('span', { class: 'efl-chart__lbl' }, d.slice(8)), h('span', { class: 'efl-sr' }, `${d}: ${m} min`));
      }))))));

  /* strengths / difficulties */
  const ranked = SKILLS.filter((s) => sum[s].auto && sum[s].auto.n >= 2).sort((a, b) => sum[b].auto.mean - sum[a].auto.mean);
  const weakActs = [];
  for (const l of [...cur.lessons, ...ctx.data.integratives]) {
    const r = st.lessons[l.id];
    if (r && r.weakActivities) { r.weakActivities.forEach((a) => weakActs.push({ lesson: l, activity: a })); }
  }
  root.append(h('div', { class: 'efl-cards' },
    h('section', { class: 'efl-card' }, h('h3', { class: 'efl-h4' }, t('prog.strengths')),
      ranked.length ? h('p', null, t(`skill.${ranked[0]}`), ` — ${pct(sum[ranked[0]].auto.mean)}`) : h('p', { class: 'efl-muted' }, t('prog.notEnough'))),
    h('section', { class: 'efl-card' }, h('h3', { class: 'efl-h4' }, t('prog.difficulties')),
      weakActs.length ? h('ul', null, weakActs.slice(0, 6).map((w) => h('li', null, h('button', { type: 'button', class: 'efl-linkbtn', onclick: () => ctx.go('lesson', { id: w.lesson.id }) }, `${w.lesson.title} — ${w.activity}`))))
        : h('p', { class: 'efl-muted' }, ranked.length > 1 ? t('prog.weakest', { skill: t(`skill.${ranked[ranked.length - 1]}`) }) : t('prog.notEnough'))),
    h('section', { class: 'efl-card' }, h('h3', { class: 'efl-h4' }, t('prog.vocab')),
      vocabStages(st))));

  /* lesson history */
  const rows = [...cur.lessons, ...ctx.data.integratives].filter((l) => st.lessons[l.id]).map((l) => {
    const r = st.lessons[l.id];
    return h('tr', null, h('td', { lang: 'en' }, l.title), h('td', null, t(`status.${r.status === 'completed' ? (r.needsReview ? 'review' : 'completed') : 'in_progress'}`)),
      h('td', null, r.autoMean == null ? '—' : pct(r.autoMean)), h('td', null, r.completedAt ? r.completedAt.slice(0, 10) : '—'));
  });
  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h4' }, t('prog.history')),
    rows.length ? h('table', { class: 'efl-table', 'data-testid': 'history' }, h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, t('prog.lesson')), h('th', { scope: 'col' }, t('prog.status')), h('th', { scope: 'col' }, t('prog.autoMean')), h('th', { scope: 'col' }, t('prog.completedAt')))), h('tbody', null, rows))
      : h('p', { class: 'efl-muted' }, t('prog.noHistory'))));

  /* evidence log */
  const recent = st.evidence.slice(-15).reverse();
  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h4' }, t('prog.evidence')),
    h('p', { class: 'efl-small efl-muted' }, t('prog.evidenceHelp')),
    recent.length ? h('table', { class: 'efl-table' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('prog.when')), h('th', { scope: 'col' }, t('prog.skill')), h('th', { scope: 'col' }, t('lesson.source')), h('th', { scope: 'col' }, t('lesson.result')), h('th', { scope: 'col' }, t('prog.where')))),
      h('tbody', null, recent.map((e) => h('tr', null, h('td', null, e.at.slice(0, 16).replace('T', ' ')), h('td', null, t(`skill.${e.skill}`)), h('td', null, t(`src.${e.source}`)), h('td', null, e.score == null ? '—' : pct(e.score)), h('td', null, `${e.lessonId} / ${e.activityId}`))))) : h('p', { class: 'efl-muted' }, t('prog.noHistory'))));

  root.append(h('p', null, h('button', { type: 'button', class: 'efl-btn', onclick: () => ctx.go('settings') }, t('prog.manageData'))));
  return root;
}

function vocabStages(st) {
  const counts = { new: 0, learning: 0, learned: 0, mastered: 0 };
  Object.values(st.srs).forEach((c) => { counts[cardStage(c)] += 1; });
  return h('ul', null, Object.entries(counts).map(([k, v]) => h('li', null, `${t(`stage.${k}`)}: ${v}`)));
}
