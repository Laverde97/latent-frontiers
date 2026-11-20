/* =========================================================================
   time.js — study modes and approximate practice-time tracking.

   Practice time is approximate: the timer counts seconds only while the
   page is visible AND the learner interacted (click, key, audio playing,
   recording) within the last IDLE_MS. It is never inferred from calendar
   days.
   ========================================================================= */

import { todayKey } from './store.js';

export const STUDY_MODES = {
  essential: { dailyMinutes: 30, studyDays: 6 },
  standard: { dailyMinutes: 75, studyDays: 6 },
  extended: { dailyMinutes: 120, studyDays: 6 },
  intensive: { dailyMinutes: 285, studyDays: 6 }
};

/* Rough guided-learning-hour orientation commonly cited for reaching C1
   from zero (order of magnitude ~700–800 h). Used only to show how the
   calendar stretches with less daily time — not a promise. */
export const C1_HOURS_ORIENTATION = [700, 800];

export function weeklyGoalMinutes(mode) {
  const m = STUDY_MODES[mode] || STUDY_MODES.standard;
  return m.dailyMinutes * m.studyDays;
}

export function weeksToHours(mode, hours) {
  return Math.ceil((hours * 60) / weeklyGoalMinutes(mode));
}

/* Monday-based week start for a date. */
export function weekStart(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return d;
}

export function minutesThisWeek(practice, now = new Date()) {
  const start = weekStart(now);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    total += practice[todayKey(d)] || 0;
  }
  return Math.round(total);
}

export function totalMinutes(practice) {
  return Math.round(Object.values(practice).reduce((t, m) => t + m, 0));
}

export function studyDays(practice) {
  return Object.values(practice).filter((m) => m >= 1).length;
}

const IDLE_MS = 90 * 1000;

export class PracticeTimer {
  constructor(onFlush, { flushEvery = 30000, doc = globalThis.document } = {}) {
    this.onFlush = onFlush;
    this.lastActivity = 0;
    this.accumulated = 0;
    this.doc = doc;
    this.busy = 0;
    const mark = () => { this.lastActivity = Date.now(); };
    if (doc) {
      ['pointerdown', 'keydown', 'input'].forEach((ev) => doc.addEventListener(ev, mark, { passive: true }));
      doc.addEventListener('visibilitychange', () => { if (doc.hidden) { this.flush(); } });
    }
    this.tick = setInterval(() => this.step(), 5000);
    this.flushTimer = setInterval(() => this.flush(), flushEvery);
    this.mark = mark;
  }

  /* audio playing / recording keeps the timer active */
  hold() { this.busy += 1; this.mark(); }
  release() { this.busy = Math.max(0, this.busy - 1); this.mark(); }

  step() {
    const visible = !this.doc || !this.doc.hidden;
    const active = this.busy > 0 || Date.now() - this.lastActivity < IDLE_MS;
    if (visible && active) { this.accumulated += 5; }
  }

  flush() {
    if (this.accumulated > 0) {
      const minutes = this.accumulated / 60;
      this.accumulated = 0;
      this.onFlush(minutes);
    }
  }
}
