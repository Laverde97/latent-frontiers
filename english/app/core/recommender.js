/* =========================================================================
   recommender.js — transparent rule-based recommendations.

   Rules, in priority order (each recommendation carries its reason):
     R1 rest       today's goal already met -> suggest rest / light review
     R2 continue   a lesson is in progress
     R3 reviews    vocabulary cards are due (spaced repetition)
     R4 repair     an auto-scored activity in a completed lesson < 70 %
     R5 weak-skill the weakest skill (auto evidence) is < 70 % -> its lab
     R6 next       the next available lesson whose prerequisites are done
     R7 speaking   no speaking evidence in the last 2 days -> Speaking Studio
   ========================================================================= */

import { countDue } from './srs.js';
import { skillSummary } from './scoring.js';
import { todayKey } from './store.js';
import { STUDY_MODES } from './time.js';

export function lessonStatus(state, lessonMeta) {
  if (lessonMeta.status !== 'available') { return 'planned'; }
  const rec = state.lessons[lessonMeta.id];
  if (rec && rec.status === 'completed') { return rec.needsReview ? 'review' : 'completed'; }
  if (rec && rec.status === 'in_progress') { return 'in_progress'; }
  const prereqsDone = (lessonMeta.prerequisites || []).every(
    (p) => state.lessons[p] && state.lessons[p].status === 'completed'
  );
  return prereqsDone ? 'available' : 'locked';
}

export function nextLesson(state, curriculum) {
  return curriculum.lessons.find((l) => {
    const st = lessonStatus(state, l);
    return st === 'available' || st === 'in_progress';
  }) || null;
}

const SKILL_VIEW = { speaking: 'speaking', listening: 'listening', reading: 'readwrite', writing: 'readwrite' };

export function recommend(state, curriculum, now = new Date()) {
  const recs = [];
  const mode = STUDY_MODES[state.settings.studyMode] || STUDY_MODES.standard;
  const today = state.practice[todayKey(now)] || 0;
  const due = countDue(state.srs, now);

  if (today >= mode.dailyMinutes) {
    recs.push({ rule: 'R1', key: 'rec.rest', params: { minutes: Math.round(today) }, view: due ? 'vocab' : null });
  }

  const inProgress = curriculum.lessons.find((l) => lessonStatus(state, l) === 'in_progress');
  if (inProgress) {
    recs.push({ rule: 'R2', key: 'rec.continue', params: { title: inProgress.title }, view: 'lesson', id: inProgress.id });
  }

  if (due > 0) {
    recs.push({ rule: 'R3', key: 'rec.reviews', params: { n: due }, view: 'vocab' });
  }

  for (const l of curriculum.lessons) {
    const rec = state.lessons[l.id];
    if (rec && rec.status === 'completed' && rec.weakActivities && rec.weakActivities.length) {
      recs.push({ rule: 'R4', key: 'rec.repair', params: { title: l.title }, view: 'lesson', id: l.id });
      break;
    }
  }

  const summary = skillSummary(state.evidence);
  const weak = Object.entries(summary)
    .filter(([, s]) => s.auto && s.auto.n >= 2 && s.auto.mean < 0.7)
    .sort((a, b) => a[1].auto.mean - b[1].auto.mean)[0];
  if (weak) {
    recs.push({ rule: 'R5', key: 'rec.weakSkill', params: { skill: weak[0], pct: Math.round(weak[1].auto.mean * 100) }, view: SKILL_VIEW[weak[0]] });
  }

  const next = nextLesson(state, curriculum);
  if (next && (!inProgress || next.id !== inProgress.id)) {
    recs.push({ rule: 'R6', key: 'rec.next', params: { title: next.title }, view: 'lesson', id: next.id });
  }

  const twoDaysAgo = now.getTime() - 2 * 24 * 3600 * 1000;
  const recentSpeaking = state.evidence.some((e) => e.skill === 'speaking' && new Date(e.at).getTime() >= twoDaysAgo);
  if (!recentSpeaking) {
    recs.push({ rule: 'R7', key: 'rec.speaking', params: {}, view: 'speaking' });
  }

  return recs;
}
