import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, migrate, validateState, importState, exportState, recordActivity,
  completeLesson, addPracticeMinutes, Store, memoryStorage, STORAGE_KEY, STATE_VERSION, todayKey
} from '../../app/core/store.js';
import { newCard, review, isDue, cardStage, qualityFromAttempt, countDue } from '../../app/core/srs.js';
import {
  normalize, answersMatch, alignWords, closestOption, runWritingChecks, countWords, skillSummary, estimateLevel
} from '../../app/core/scoring.js';
import { recommend, lessonStatus, nextLesson } from '../../app/core/recommender.js';
import { flattenCurriculum, validateCurriculum } from '../../app/core/content.js';
import { placement } from '../../app/core/placement.js';
import { weeklyGoalMinutes, weeksToHours, minutesThisWeek } from '../../app/core/time.js';
import { readFileSync } from 'node:fs';

const curRaw = JSON.parse(readFileSync(new URL('../../data/curriculum.json', import.meta.url), 'utf8'));
const cur = flattenCurriculum(curRaw);

/* ---- store ---------------------------------------------------------- */
test('initial state is valid', () => {
  assert.deepEqual(validateState(createInitialState()), []);
});

test('migrates a v1 document to the current version', () => {
  const v1 = { version: 1, settings: { esSupport: false }, lessonProgress: { 'w01-l1': { status: 'completed', activities: {} } }, minutesByDay: { '2026-11-01': 12 }, evidence: [], srs: {} };
  const s = migrate(v1);
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.lessons['w01-l1'].status, 'completed');
  assert.equal(s.practice['2026-11-01'], 12);
  assert.equal(s.settings.esSupport, false);
  assert.equal(s.settings.studyMode, 'standard', 'missing settings get defaults');
  assert.equal(s.lessonProgress, undefined);
  assert.deepEqual(validateState(s), []);
});

test('migrates an unversioned (v0) document', () => {
  const s = migrate({ lessonProgress: {} });
  assert.equal(s.version, STATE_VERSION);
  assert.deepEqual(validateState(s), []);
});

test('rejects future versions and invalid imports', () => {
  assert.equal(importState(JSON.stringify({ version: 99 })).ok, false);
  assert.equal(importState('{not json').ok, false);
  assert.equal(importState('[1,2]').ok, false);
  assert.equal(importState(JSON.stringify({ app: 'other-app', state: {} })).ok, false);
  const bad = createInitialState();
  bad.evidence.push({ skill: 'dancing', source: 'auto', score: 2 });
  const r = importState(JSON.stringify(bad));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('skill')));
});

test('export -> import round trip', () => {
  const s = createInitialState();
  recordActivity(s, 'w01-l1', 's2', { score: 4, max: 5, source: 'auto', skill: 'listening' });
  const r = importState(exportState(s));
  assert.equal(r.ok, true);
  assert.equal(r.state.lessons['w01-l1'].activities.s2.ratio, 0.8);
});

test('Store recovers from corrupt storage and keeps a backup', () => {
  const mem = memoryStorage();
  const raw = '{"version":2, broken';
  mem.setItem(STORAGE_KEY, raw);
  const written = [];
  const spy = { ...mem, setItem: (k, v) => { written.push([k, v]); mem.setItem(k, v); } };
  const st = new Store(spy);
  assert.equal(st.notice, 'corrupt');
  assert.deepEqual(validateState(st.state), []);
  const backup = written.find(([k]) => k.startsWith(`${STORAGE_KEY}-corrupt-`));
  assert.ok(backup, 'a backup key was written');
  assert.equal(backup[1], raw, 'the backup keeps the original bytes');
});

test('Store persists and reloads', () => {
  const mem = memoryStorage();
  const a = new Store(mem);
  a.update((s) => { recordActivity(s, 'w01-l1', 's1', { score: 3, max: 5, source: 'auto', skill: null }); });
  const b = new Store(mem);
  assert.equal(b.state.lessons['w01-l1'].activities.s1.score, 3);
});

test('recordActivity tracks attempts, best and evidence by source', () => {
  const s = createInitialState();
  recordActivity(s, 'L', 'a', { score: 1, max: 4, source: 'auto', skill: 'reading' });
  recordActivity(s, 'L', 'a', { score: 3, max: 4, source: 'auto', skill: 'reading' });
  const a = s.lessons.L.activities.a;
  assert.equal(a.attempts, 2);
  assert.equal(a.best, 0.75);
  assert.equal(s.evidence.length, 2);
  recordActivity(s, 'L', 'w', { score: 0, max: 1, source: 'pending', skill: 'writing' });
  assert.equal(s.evidence[2].score, null, 'pending evidence has no score');
});

test('completeLesson requires every step and flags weak auto steps', () => {
  const s = createInitialState();
  recordActivity(s, 'L', 's1', { score: 5, max: 5, source: 'auto', skill: 'listening' });
  let r = completeLesson(s, 'L', ['s1', 's2']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['s2']);
  assert.notEqual(s.lessons.L.status, 'completed', 'never marked complete without content done');
  recordActivity(s, 'L', 's2', { score: 2, max: 5, source: 'auto', skill: 'reading' });
  recordActivity(s, 'L', 's3', { score: 8, max: 16, source: 'self', skill: 'speaking' });
  r = completeLesson(s, 'L', ['s1', 's2', 's3']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.weak, ['s2'], 'self-assessed steps are never flagged as auto failures');
  assert.equal(s.lessons.L.needsReview, true);
  assert.equal(r.autoMean, 0.7);
});

test('practice minutes accumulate per day', () => {
  const s = createInitialState();
  const d = new Date(2026, 10, 20, 10);
  addPracticeMinutes(s, 1.5, d);
  addPracticeMinutes(s, 2, d);
  assert.equal(s.practice[todayKey(d)], 3.5);
  addPracticeMinutes(s, -3, d);
  assert.equal(s.practice[todayKey(d)], 3.5);
});

/* ---- SRS ------------------------------------------------------------ */
test('SM-2 intervals grow with success and reset on lapse', () => {
  const t0 = new Date('2026-11-20T10:00:00Z');
  let c = newCard(t0);
  assert.equal(cardStage(c), 'new');
  c = review(c, 4, t0);
  assert.equal(c.interval, 1);
  c = review(c, 4, t0);
  assert.equal(c.interval, 3);
  assert.equal(cardStage(c), 'learned');
  c = review(c, 5, t0);
  assert.ok(c.interval >= 7, `third interval grows (got ${c.interval})`);
  const ef = c.ef;
  c = review(c, 1, t0);
  assert.equal(c.reps, 0);
  assert.equal(c.lapses, 1);
  assert.ok(c.ef < ef);
  assert.equal(new Date(c.due) - t0, 10 * 60 * 1000, 'relearn in 10 minutes');
  assert.ok(c.ef >= 1.3);
});

test('ease factor never drops below 1.3', () => {
  let c = newCard();
  for (let i = 0; i < 20; i++) { c = review(c, 0); }
  assert.equal(c.ef, 1.3);
});

test('a card is not learned just because it exists (no reviews)', () => {
  const c = newCard();
  assert.notEqual(cardStage(c), 'learned');
  assert.equal(isDue(c), true);
  assert.equal(countDue({ a: c }), 1);
});

test('quality comes from performance', () => {
  assert.equal(qualityFromAttempt({ correct: false }), 1);
  assert.equal(qualityFromAttempt({ correct: true, attempts: 2 }), 3);
  assert.equal(qualityFromAttempt({ correct: true }), 4);
  assert.equal(qualityFromAttempt({ correct: true, fast: true }), 5);
  assert.throws(() => review(newCard(), 7));
});

/* ---- scoring -------------------------------------------------------- */
test('normalisation and contractions', () => {
  assert.equal(normalize('  What’s your NAME?! '), "what's your name");
  assert.ok(answersMatch("We aren't tired.", ["we're not tired"]));
  assert.ok(answersMatch('I am 25', ["I'm 25"]));
  assert.ok(answersMatch('Bogota', ['Bogotá']));
  assert.ok(!answersMatch('', ['x']));
  assert.ok(!answersMatch('fifty', ['fifteen']));
});

test('alignWords reports recognised target words, numbers as digits', () => {
  const r = alignWords("I'm thirteen years old", 'I am 13 years')
  assert.equal(r.total, 5); // i am thirteen years old
  assert.equal(r.matchedCount, 4);
  assert.deepEqual(r.words.filter((w) => !w.recognised).map((w) => w.word), ['old']);
});

test('closestOption ignores unrelated speech', () => {
  const opts = ["Fine, thanks. And you?", "I'm from Mexico."];
  assert.equal(closestOption("fine thanks and you", opts).index, 0);
  assert.equal(closestOption('banana keyboard', opts), null);
});

test('writing checks are explicit rules', () => {
  const checks = [
    { id: 'len', type: 'minWords', n: 5 },
    { id: 'name', type: 'includesAny', patterns: ['\\bmy name is\\b'] },
    { id: 'noHave', type: 'excludes', patterns: ['\\bhave \\w+ years\\b'] },
    { id: 'capI', type: 'capitalI' },
    { id: 'caps', type: 'sentenceCase' },
    { id: 'nat', type: 'capitalized', words: ['colombian'] }
  ];
  const good = Object.fromEntries(runWritingChecks('Hello! My name is Ana. I am Colombian.', checks).map((c) => [c.id, c.pass]));
  assert.deepEqual(good, { len: true, name: true, noHave: true, capI: true, caps: true, nat: true });
  const bad = Object.fromEntries(runWritingChecks('hello. i have 25 years and i am colombian', checks).map((c) => [c.id, c.pass]));
  assert.equal(bad.name, false);
  assert.equal(bad.noHave, false);
  assert.equal(bad.capI, false);
  assert.equal(bad.caps, false);
  assert.equal(bad.nat, false);
  assert.equal(countWords("I'm from Perú."), 3);
  assert.throws(() => runWritingChecks('x', [{ id: 'z', type: 'magic' }]));
});

test('skill summary keeps sources separate', () => {
  const s = createInitialState();
  recordActivity(s, 'L', 'a', { score: 1, max: 1, source: 'auto', skill: 'speaking' });
  recordActivity(s, 'L', 'b', { score: 2, max: 4, source: 'self', skill: 'speaking' });
  const sum = skillSummary(s.evidence);
  assert.equal(sum.speaking.auto.mean, 1);
  assert.equal(sum.speaking.self.mean, 0.5);
  assert.equal(sum.listening.auto, null);
});

test('level estimate is evidence-based, never above completed content', () => {
  const s = createInitialState();
  const empty = estimateLevel(s, cur);
  assert.equal(empty.label, 'Pre-A1');
  assert.equal(empty.inProgress, false, 'no lessons done → not "A1 in progress"');
  assert.equal(empty.level, null);
  for (const id of ['w01-l1', 'w01-l2', 'w01-l3', 'w01-l4', 'w01-l5']) { s.lessons[id] = { status: 'completed', activities: {} }; }
  const est = estimateLevel(s, cur);
  assert.equal(est.level, 'A1');
  assert.equal(est.inProgress, true);
  assert.equal(est.reached, null);
});

/* ---- curriculum & recommendations ------------------------------------ */
test('curriculum manifest: 26 weeks, 130 lessons, only week 1 available', () => {
  assert.deepEqual(validateCurriculum(curRaw), []);
  assert.equal(cur.lessons.length, 130);
  assert.deepEqual(cur.lessons.filter((l) => l.status === 'available').map((l) => l.id), ['w01-l1', 'w01-l2', 'w01-l3', 'w01-l4', 'w01-l5']);
  const bad = JSON.parse(JSON.stringify(curRaw));
  bad.weeks[3].lessons[0].status = 'available';
  assert.ok(validateCurriculum(bad, new Set(['w01-l1'])).some((e) => e.includes('w04-l1')));
});

test('lesson status: available, locked, in progress, review, planned', () => {
  const s = createInitialState();
  const [l1, l2] = cur.lessons;
  assert.equal(lessonStatus(s, l1), 'available');
  assert.equal(lessonStatus(s, l2), 'locked');
  assert.equal(lessonStatus(s, cur.lessons[10]), 'planned');
  s.lessons[l1.id] = { status: 'in_progress', activities: {} };
  assert.equal(lessonStatus(s, l1), 'in_progress');
  s.lessons[l1.id] = { status: 'completed', needsReview: true, activities: {} };
  assert.equal(lessonStatus(s, l1), 'review');
  assert.equal(lessonStatus(s, l2), 'available');
  assert.equal(nextLesson(s, cur).id, l2.id);
});

test('recommender rules', () => {
  const s = createInitialState();
  let recs = recommend(s, cur);
  assert.ok(recs.find((r) => r.rule === 'R6' && r.id === 'w01-l1'), 'suggests first lesson');
  assert.ok(recs.find((r) => r.rule === 'R7'), 'nudges speaking when there is none');
  s.srs.hello = newCard(new Date(Date.now() - 1000));
  s.practice[todayKey()] = 500;
  recordActivity(s, 'w01-l1', 's2', { score: 1, max: 5, source: 'auto', skill: 'listening' });
  recordActivity(s, 'w01-l1', 's7', { score: 1, max: 4, source: 'auto', skill: 'listening' });
  recordActivity(s, 'w01-l1', 's5', { score: 10, max: 16, source: 'self', skill: 'speaking' });
  recs = recommend(s, cur);
  const rules = recs.map((r) => r.rule);
  assert.equal(rules[0], 'R1', 'rest first once the daily goal is met');
  assert.ok(rules.includes('R2'));
  assert.ok(rules.includes('R3'));
  assert.ok(rules.includes('R5'));
  assert.ok(!rules.includes('R7'));
});

/* ---- placement & time ------------------------------------------------- */
test('placement never goes above B1 and needs A2 for B1', () => {
  assert.equal(placement({ A1: 0.2, A2: 0, B1: 0 }).range, 'Pre-A1–A1');
  assert.equal(placement({ A1: 0.7, A2: 0.3, B1: 0 }).range, 'A1');
  assert.equal(placement({ A1: 1, A2: 0.75, B1: 0.2 }).range, 'A2');
  assert.equal(placement({ A1: 1, A2: 0.9, B1: 1 }).range, 'B1+');
  assert.equal(placement({ A1: 0.5, A2: 0.2, B1: 1 }).range, 'Pre-A1–A1', 'lucky B1 guesses do not jump levels');
});

test('study modes', () => {
  assert.equal(weeklyGoalMinutes('essential'), 180);
  assert.equal(weeklyGoalMinutes('intensive'), 1710);
  assert.equal(weeksToHours('intensive', 700), 25);
  assert.equal(weeklyGoalMinutes('unknown'), weeklyGoalMinutes('standard'));
  const now = new Date(2026, 10, 20); // Friday
  const practice = { [todayKey(now)]: 30, [todayKey(new Date(2026, 10, 16))]: 20, [todayKey(new Date(2026, 10, 15))]: 99 };
  assert.equal(minutesThisWeek(practice, now), 50, 'Monday-based week; Sunday before is excluded');
});

test('PracticeTimer does not count time on non-study screens (account, settings)', async () => {
  const { PracticeTimer } = await import('../../app/core/time.js');
  const flushed = [];
  const doc = { hidden: false, addEventListener() {} };
  const timer = new PracticeTimer((m) => flushed.push(m), { doc, flushEvery: 1e9 });
  clearInterval(timer.tick); clearInterval(timer.flushTimer);
  timer.mark();
  timer.step(); timer.step();                       /* 10 s of study */
  timer.setPaused(true);                            /* → account view: flushes what was studied */
  assert.deepEqual(flushed, [10 / 60]);
  timer.mark();
  timer.step(); timer.step(); timer.step();         /* 15 s signing in: not practice */
  timer.flush();
  assert.deepEqual(flushed, [10 / 60]);
  timer.setPaused(false);
  timer.mark(); timer.step(); timer.flush();        /* back to a lesson */
  assert.deepEqual(flushed, [10 / 60, 5 / 60]);
});
