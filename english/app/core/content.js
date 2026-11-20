/* =========================================================================
   content.js — loading and validating educational content (JSON).

   validateLesson / validateCurriculum are pure and shared with the Node
   validator (english/_tests/validate-content.js), so the same rules run
   in CI and in the browser.
   ========================================================================= */

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
export const STEP_TYPES = ['vocab', 'listening', 'grammar', 'pronunciation', 'speaking', 'interaction', 'reading', 'writing', 'retrieval'];
/* Every available lesson must contain these steps (lesson structure,
   master prompt §7). */
export const REQUIRED_STEPS = ['vocab', 'listening', 'grammar', 'pronunciation', 'speaking', 'interaction', 'reading', 'writing', 'retrieval'];
export const EXERCISE_TYPES = ['mcq', 'gap', 'dictation', 'minimalPair', 'order'];

const isStr = (x) => typeof x === 'string' && x.trim().length > 0;

function validateExercise(ex, where, errors) {
  if (!isStr(ex.id)) { errors.push(`${where}: exercise without id`); }
  if (!EXERCISE_TYPES.includes(ex.type)) { errors.push(`${where}/${ex.id}: unknown exercise type ${ex.type}`); return; }
  if (!isStr(ex.prompt) && ex.type !== 'dictation' && ex.type !== 'minimalPair') { errors.push(`${where}/${ex.id}: missing prompt`); }
  if (ex.type === 'mcq') {
    if (!Array.isArray(ex.options) || ex.options.length < 2) { errors.push(`${where}/${ex.id}: mcq needs >= 2 options`); }
    if (!Number.isInteger(ex.answer) || ex.answer < 0 || ex.answer >= (ex.options || []).length) { errors.push(`${where}/${ex.id}: mcq answer index invalid`); }
    if (ex.options && new Set(ex.options).size !== ex.options.length) { errors.push(`${where}/${ex.id}: duplicate options`); }
  }
  if (ex.type === 'gap' || ex.type === 'dictation') {
    if (!Array.isArray(ex.accept) || !ex.accept.length || !ex.accept.every(isStr)) { errors.push(`${where}/${ex.id}: needs accept[]`); }
  }
  if (ex.type === 'dictation' && !isStr(ex.audio)) { errors.push(`${where}/${ex.id}: dictation needs audio text`); }
  if (ex.type === 'minimalPair') {
    if (!Array.isArray(ex.pair) || ex.pair.length !== 2) { errors.push(`${where}/${ex.id}: minimalPair needs pair[2]`); }
    if (!ex.pair || !ex.pair.includes(ex.say)) { errors.push(`${where}/${ex.id}: say must be one of pair`); }
  }
  if (ex.type === 'order') {
    if (!Array.isArray(ex.words) || ex.words.length < 2) { errors.push(`${where}/${ex.id}: order needs words[]`); }
    if (!Array.isArray(ex.accept) || !ex.accept.length) { errors.push(`${where}/${ex.id}: order needs accept[]`); }
  }
}

export function validateLesson(lesson, { vocabIds = null, dialogueIds = null } = {}) {
  const errors = [];
  const w = lesson && lesson.id ? lesson.id : '(lesson)';
  if (!lesson || typeof lesson !== 'object') { return ['lesson is not an object']; }
  if (!/^w\d{2}-(l[1-5]|review)$/.test(lesson.id || '')) { errors.push(`${w}: id must look like w01-l1 / w01-review`); }
  if (!isStr(lesson.title)) { errors.push(`${w}: missing title`); }
  if (!LEVELS.includes(lesson.level)) { errors.push(`${w}: invalid level`); }
  if (!Number.isInteger(lesson.week) || lesson.week < 1 || lesson.week > 26) { errors.push(`${w}: invalid week`); }
  if (!Array.isArray(lesson.objectives) || !lesson.objectives.length) { errors.push(`${w}: objectives required`); }
  if (!Array.isArray(lesson.prerequisites)) { errors.push(`${w}: prerequisites must be an array`); }
  if (!(lesson.minutes > 0)) { errors.push(`${w}: minutes required`); }
  if (!lesson.review || !isStr(lesson.review.status)) { errors.push(`${w}: review metadata required`); }
  if (!lesson.completion || !(lesson.completion.reviewThreshold > 0)) { errors.push(`${w}: completion criteria required`); }
  const steps = Array.isArray(lesson.steps) ? lesson.steps : [];
  const types = steps.map((s) => s.type);
  const required = lesson.kind === 'review' ? ['listening', 'speaking', 'interaction', 'reading', 'writing'] : REQUIRED_STEPS;
  for (const r of required) {
    if (!types.includes(r)) { errors.push(`${w}: missing step ${r}`); }
  }
  const stepIds = new Set();
  const exIds = new Set();
  for (const s of steps) {
    const where = `${w}/${s.id}`;
    if (!isStr(s.id)) { errors.push(`${w}: step without id`); }
    if (stepIds.has(s.id)) { errors.push(`${where}: duplicate step id`); }
    stepIds.add(s.id);
    if (!STEP_TYPES.includes(s.type)) { errors.push(`${where}: unknown step type ${s.type}`); continue; }
    if (!isStr(s.title)) { errors.push(`${where}: missing title`); }
    for (const ex of s.exercises || []) {
      if (exIds.has(ex.id)) { errors.push(`${where}/${ex.id}: duplicate exercise id`); }
      exIds.add(ex.id);
      validateExercise(ex, where, errors);
    }
    switch (s.type) {
      case 'vocab':
        if (!Array.isArray(s.items) || s.items.length < 4) { errors.push(`${where}: vocab needs >= 4 items`); }
        if (vocabIds) { (s.items || []).forEach((id) => { if (!vocabIds.has(id)) { errors.push(`${where}: unknown vocab id ${id}`); } }); }
        break;
      case 'listening':
        if (!Array.isArray(s.lines) || s.lines.length < 2) { errors.push(`${where}: listening needs >= 2 lines`); }
        (s.lines || []).forEach((ln, i) => { if (!isStr(ln.text) || !isStr(ln.speaker)) { errors.push(`${where}: line ${i} needs speaker & text`); } });
        if (!(s.exercises || []).length) { errors.push(`${where}: listening needs comprehension exercises`); }
        break;
      case 'grammar':
        if (!isStr(s.explanation && s.explanation.en)) { errors.push(`${where}: grammar needs explanation.en`); }
        if (!Array.isArray(s.examples) || s.examples.length < 2) { errors.push(`${where}: grammar needs >= 2 examples`); }
        if (!(s.exercises || []).length) { errors.push(`${where}: grammar needs practice`); }
        break;
      case 'pronunciation':
        if (!isStr(s.focus)) { errors.push(`${where}: pronunciation needs focus`); }
        if (!isStr(s.tip && s.tip.en)) { errors.push(`${where}: pronunciation needs tip.en`); }
        if (!(s.exercises || []).length && !(s.repeat || []).length) { errors.push(`${where}: pronunciation needs exercises or repeat[]`); }
        break;
      case 'speaking':
        if (!Array.isArray(s.repeat) || !s.repeat.length) { errors.push(`${where}: speaking needs repeat[] phrases`); }
        const secs = s.challenge && s.challenge.seconds;
        const secsOk = Array.isArray(secs) ? secs.length === 2 && secs[0] > 0 && secs[1] >= secs[0] : secs > 0;
        if (!s.challenge || !isStr(s.challenge.prompt) || !secsOk) { errors.push(`${where}: speaking needs challenge {prompt, seconds:[min,max]}`); }
        if (!Array.isArray(s.rubric) || s.rubric.length < 3) { errors.push(`${where}: speaking needs rubric (>=3 criteria)`); }
        break;
      case 'interaction':
        if (!isStr(s.dialogue)) { errors.push(`${where}: interaction needs dialogue id`); }
        if (dialogueIds && !dialogueIds.has(s.dialogue)) { errors.push(`${where}: unknown dialogue ${s.dialogue}`); }
        break;
      case 'reading':
        if (!isStr(s.text)) { errors.push(`${where}: reading needs text`); }
        if (!(s.exercises || []).length) { errors.push(`${where}: reading needs exercises`); }
        break;
      case 'writing':
        if (!isStr(s.prompt)) { errors.push(`${where}: writing needs prompt`); }
        if (!Array.isArray(s.checks) || !s.checks.length) { errors.push(`${where}: writing needs rule checks`); }
        if (!Array.isArray(s.rubric) || s.rubric.length < 3) { errors.push(`${where}: writing needs rubric`); }
        if (!isStr(s.model)) { errors.push(`${where}: writing needs a model answer`); }
        break;
      case 'retrieval':
        if ((s.exercises || []).length < 3) { errors.push(`${where}: retrieval needs >= 3 exercises`); }
        break;
      default:
    }
  }
  return errors;
}

export function validateCurriculum(cur, availableIds = null) {
  const errors = [];
  if (!cur || !Array.isArray(cur.weeks)) { return ['curriculum.weeks missing']; }
  if (cur.weeks.length !== 26) { errors.push(`expected 26 weeks, got ${cur.weeks.length}`); }
  const ids = new Set();
  let core = 0;
  cur.weeks.forEach((wk, i) => {
    if (wk.week !== i + 1) { errors.push(`week index mismatch at ${i + 1}`); }
    if (!LEVELS.includes(wk.level)) { errors.push(`week ${wk.week}: invalid level`); }
    if (!isStr(wk.title)) { errors.push(`week ${wk.week}: title`); }
    if (!Array.isArray(wk.lessons) || wk.lessons.length !== 5) { errors.push(`week ${wk.week}: needs 5 core lessons`); }
    (wk.lessons || []).forEach((l, j) => {
      core++;
      const expected = `w${String(wk.week).padStart(2, '0')}-l${j + 1}`;
      if (l.id !== expected) { errors.push(`week ${wk.week}: lesson ${j + 1} id should be ${expected}`); }
      if (ids.has(l.id)) { errors.push(`duplicate id ${l.id}`); }
      ids.add(l.id);
      if (!isStr(l.title)) { errors.push(`${l.id}: title`); }
      if (!['available', 'planned'].includes(l.status)) { errors.push(`${l.id}: status must be available|planned`); }
      if (availableIds && l.status === 'available' && !availableIds.has(l.id)) { errors.push(`${l.id}: marked available but no validated lesson file`); }
      if (availableIds && l.status !== 'available' && availableIds.has(l.id)) { errors.push(`${l.id}: lesson file exists but marked planned`); }
    });
    if (!wk.integrative || !isStr(wk.integrative.id)) { errors.push(`week ${wk.week}: integrative session missing`); }
  });
  if (core !== 130) { errors.push(`expected 130 core lessons, got ${core}`); }
  return errors;
}

/* Flatten weeks -> lessons with level/week, for lookups. */
export function flattenCurriculum(cur) {
  const lessons = [];
  for (const wk of cur.weeks) {
    wk.lessons.forEach((l, i) => {
      lessons.push({
        ...l,
        week: wk.week,
        level: wk.level,
        order: i + 1,
        prerequisites: l.prerequisites || (i > 0 ? [wk.lessons[i - 1].id] : (wk.week > 1 ? [`w${String(wk.week - 1).padStart(2, '0')}-l5`] : []))
      });
    });
  }
  return { ...cur, lessons };
}

/* ---- browser loading ------------------------------------------------------ */
const cache = new Map();

export async function loadJSON(path) {
  if (cache.has(path)) { return cache.get(path); }
  const p = fetch(new URL(`../../data/${path}`, import.meta.url), { cache: 'no-cache' }).then((r) => {
    if (!r.ok) { throw new Error(`HTTP ${r.status} loading ${path}`); }
    return r.json();
  });
  cache.set(path, p);
  try { return await p; } catch (e) { cache.delete(path); throw e; }
}
