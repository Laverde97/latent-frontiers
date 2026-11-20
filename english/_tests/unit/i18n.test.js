import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _DICT } from '../../app/i18n.js';
import { BADGES } from '../../app/ui/badges.js';
import { STEP_TYPES, EXERCISE_TYPES } from '../../app/core/content.js';
import { SKILLS, SOURCES } from '../../app/core/store.js';
import { STUDY_MODES } from '../../app/core/time.js';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? jsFiles(p) : (p.endsWith('.js') ? [p] : []);
  });
}

test('ES and EN dictionaries have the same keys', () => {
  const es = Object.keys(_DICT.es).sort();
  const en = Object.keys(_DICT.en).sort();
  assert.deepEqual(es.filter((k) => !_DICT.en[k]), [], 'missing in EN');
  assert.deepEqual(en.filter((k) => !_DICT.es[k]), [], 'missing in ES');
});

test('every static t("key") used in the code exists', () => {
  const missing = new Set();
  for (const f of jsFiles(appDir)) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bt\('([^'$]+)'/g)) {
      if (!_DICT.es[m[1]]) { missing.add(`${m[1]} (${f.split('/app/')[1]})`); }
    }
  }
  assert.deepEqual([...missing], []);
});

test('dynamic key families are complete', () => {
  const need = [
    ...STEP_TYPES.map((s) => `step.${s}`), 'step.summary',
    ...EXERCISE_TYPES.map((s) => `ex.prompt.${s}`),
    ...SKILLS.map((s) => `skill.${s}`), ...SKILLS.map((s) => `as.rubric.${s}`),
    ...SOURCES.map((s) => `src.${s}`), ...SOURCES.map((s) => `src.${s}.desc`),
    ...['available', 'in_progress', 'completed', 'locked', 'review', 'planned'].map((s) => `status.${s}`),
    ...['new', 'learning', 'learned', 'mastered'].map((s) => `stage.${s}`),
    ...Object.keys(STUDY_MODES).map((m) => `mode.${m}`),
    ...BADGES.map((b) => `badge.${b.id}`),
    ...['good', 'ok', 'off'].map((f) => `fit.${f}`),
    ...['rest', 'continue', 'reviews', 'repair', 'weakSkill', 'next', 'speaking'].map((r) => `rec.${r}`),
    ...['A1', 'A2', 'B1', 'B2', 'C1'].map((l) => `level.name.${l}`),
    ...[1, 2, 3, 4].map((n) => `rubric.level${n}`),
    ...['again', 'hard', 'good', 'easy'].map((k) => `vo.${k}`),
    ...['auto', 'self', 'ai', 'human'].flatMap((k) => [`rw.fb.${k}`, `rw.fb.${k}.desc`]),
    ...[1, 2, 3, 4, 5].map((n) => `set.p${n}`),
    ...['pre', 'a1', 'a2', 'b1'].map((k) => `diag.place.${k}`),
    ...['dashboard', 'path', 'speaking', 'listening', 'vocab', 'readwrite', 'assess', 'progress', 'settings'].map((v) => `nav.${v}`),
    ...['idle', 'syncing', 'synced', 'offline', 'error', 'conflict'].map((st) => `sync.${st}`)
  ];
  assert.deepEqual(need.filter((k) => !_DICT.es[k] || !_DICT.en[k]), []);
});
