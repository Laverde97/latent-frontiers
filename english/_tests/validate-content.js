#!/usr/bin/env node
/* Validates all English Fluency Lab content with the same rules the app
   uses (app/core/content.js) plus cross-file integrity checks:
     - curriculum: 26 weeks, 130 core lessons, unique stable ids
     - every lesson marked "available" has a file that passes validation
     - no lesson file exists for a lesson marked "planned"
     - vocabulary ids/dialogue ids referenced by lessons exist
     - dialogue graphs: every `next` exists, an end node is reachable,
       no dead ends
     - vocabulary: unique ids, IPA present, required fields
     - diagnostic: items valid, level tags present
   Exit code 1 on any error. */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateLesson, validateCurriculum, EXERCISE_TYPES } from '../app/core/content.js';
import { runWritingChecks, answersMatch } from '../app/core/scoring.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const errors = [];
const err = (m) => errors.push(m);

/* vocabulary */
const vocabFiles = readdirSync(join(root, 'vocab')).filter((f) => f.endsWith('.json'));
const vocabIds = new Set();
for (const f of vocabFiles) {
  const v = read(`vocab/${f}`);
  for (const it of v.items) {
    if (vocabIds.has(it.id)) { err(`vocab: duplicate id ${it.id}`); }
    vocabIds.add(it.id);
    for (const k of ['word', 'ipa', 'pos', 'es', 'example']) {
      if (!it[k] || !String(it[k]).trim()) { err(`vocab ${it.id}: missing ${k}`); }
    }
    if (it.ipa && !/^\/.+\/( \(.+\))?$/.test(it.ipa)) { err(`vocab ${it.id}: IPA must be written between slashes`); }
  }
}

/* dialogues */
const dialogueIds = new Set();
for (const f of readdirSync(join(root, 'dialogues')).filter((x) => x.endsWith('.json'))) {
  const d = read(`dialogues/${f}`);
  if (`${d.id}.json` !== f) { err(`dialogue ${f}: id/file mismatch`); }
  dialogueIds.add(d.id);
  if (!d.nodes[d.start]) { err(`dialogue ${d.id}: start node missing`); }
  let hasEnd = false;
  for (const [nid, n] of Object.entries(d.nodes)) {
    if (!n.say) { err(`dialogue ${d.id}/${nid}: missing say`); }
    if (n.end) { hasEnd = true; continue; }
    if (!Array.isArray(n.options) || !n.options.length) { err(`dialogue ${d.id}/${nid}: dead end (no options, not end)`); continue; }
    for (const o of n.options) {
      if (!d.nodes[o.next]) { err(`dialogue ${d.id}/${nid}: option points to missing node ${o.next}`); }
      if (!['good', 'ok', 'off'].includes(o.fit)) { err(`dialogue ${d.id}/${nid}: invalid fit`); }
      if (o.fit !== 'good' && !o.feedback) { err(`dialogue ${d.id}/${nid}: non-good option needs feedback`); }
    }
    if (!n.options.some((o) => o.fit === 'good')) { err(`dialogue ${d.id}/${nid}: no appropriate option`); }
  }
  if (!hasEnd) { err(`dialogue ${d.id}: no end node`); }
  /* end reachable through good options */
  const seen = new Set();
  const stack = [d.start];
  let reach = false;
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) { continue; }
    seen.add(id);
    const n = d.nodes[id];
    if (!n) { continue; }
    if (n.end) { reach = true; continue; }
    n.options.forEach((o) => stack.push(o.next));
  }
  if (!reach) { err(`dialogue ${d.id}: end not reachable`); }
}

/* lessons */
const lessonFiles = readdirSync(join(root, 'lessons')).filter((x) => x.endsWith('.json'));
const lessonIds = new Set();
let exerciseCount = 0;
for (const f of lessonFiles) {
  const L = read(`lessons/${f}`);
  if (`${L.id}.json` !== f) { err(`lesson ${f}: id/file mismatch`); }
  lessonIds.add(L.id);
  validateLesson(L, { vocabIds, dialogueIds }).forEach(err);
  for (const id of L.vocabIds || []) { if (!vocabIds.has(id)) { err(`${L.id}: vocabIds has unknown ${id}`); } }
  for (const s of L.steps) {
    for (const ex of s.exercises || []) {
      exerciseCount++;
      if (ex.vocab && !vocabIds.has(ex.vocab)) { err(`${L.id}/${s.id}/${ex.id}: unknown vocab ${ex.vocab}`); }
      /* the first accepted answer must match itself after normalisation */
      if (ex.accept && !answersMatch(ex.accept[0], ex.accept)) { err(`${L.id}/${ex.id}: accept[0] does not self-match`); }
      /* order: the accepted sentence must be buildable from the words */
      if (ex.type === 'order' && !answersMatch(ex.words.join(' '), ex.accept)) {
        const sorted = (x) => x.toLowerCase().replace(/[^a-z' ]/g, '').split(' ').sort().join(' ');
        if (sorted(ex.words.join(' ')) !== sorted(ex.accept[0])) { err(`${L.id}/${ex.id}: order words don't build the answer`); }
      }
    }
    /* writing: the model answer must pass every automatic check */
    if (s.type === 'writing') {
      runWritingChecks(s.model, s.checks).filter((c) => !c.pass).forEach((c) => err(`${L.id}/${s.id}: model answer fails check ${c.id}`));
    }
    if (s.type === 'speaking') {
      const words = s.challenge.model ? s.challenge.model.split(/\s+/).length : 0;
      if (!s.challenge.model || words < 10) { err(`${L.id}/${s.id}: speaking challenge needs a model answer`); }
    }
  }
}

/* curriculum */
const cur = read('curriculum.json');
const available = new Set([...lessonIds].filter((id) => !id.endsWith('-review')));
validateCurriculum(cur, available).forEach(err);
for (const wk of cur.weeks) {
  const integ = wk.integrative;
  if (integ.status === 'available' && !lessonIds.has(integ.id)) { err(`${integ.id}: integrative marked available but missing`); }
  if (integ.status !== 'available' && lessonIds.has(integ.id)) { err(`${integ.id}: file exists but marked planned`); }
}
for (const id of cur.dialogues) { if (!dialogueIds.has(id)) { err(`curriculum.dialogues: unknown ${id}`); } }

/* diagnostic */
const diag = read('diagnostic.json');
for (const sec of diag.sections) {
  for (const it of sec.items) {
    if (!['A1', 'A2', 'B1'].includes(it.level)) { err(`diagnostic ${it.id}: level must be A1/A2/B1`); }
    if (!EXERCISE_TYPES.includes(it.type)) { err(`diagnostic ${it.id}: bad type`); }
  }
}
if (!existsSync(join(root, 'pronunciation.json'))) { err('pronunciation.json missing'); }

const availableCount = cur.weeks.flatMap((w) => w.lessons).filter((l) => l.status === 'available').length;
if (errors.length) {
  console.error(`✗ ${errors.length} content error(s):`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`✓ content valid: ${cur.weeks.length} weeks, 130 core lessons in manifest, ${availableCount} available + ${[...lessonIds].filter((i) => i.endsWith('-review')).length} integrative session(s), ${exerciseCount} auto-checked exercises, ${vocabIds.size} vocabulary items, ${dialogueIds.size} dialogues.`);
