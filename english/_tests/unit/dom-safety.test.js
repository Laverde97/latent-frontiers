/* Regression: the native DOM methods append/prepend/replaceChildren/after/
   before turn null / undefined / false into the literal text "null" … (a
   linked account showed "null" under the last-sync line). Optional children
   must go through add() / h() from ui/dom.js, which skip empty values. This
   test fails if any native call receives a top-level argument that can be
   null / undefined / false. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) { return f === 'vendor' ? [] : files(p); }
  return p.endsWith('.js') ? [p] : [];
});

/* split the argument list of a call at top-level commas */
function topArgs(src) {
  const out = []; let depth = 0; let cur = ''; let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) { cur += ch; if (ch === '\\') { cur += src[++i] || ''; } else if (ch === quote) { quote = null; } continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) { depth++; }
    if (')]}'.includes(ch)) { depth--; }
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else { cur += ch; }
  }
  out.push(cur);
  return out.map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/* variables declared as `cond ? node : null` (or undefined / false) */
function nullableVars(src) {
  const names = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=([^;]*);/g;
  let m;
  while ((m = re.exec(src))) { if (/\?[\s\S]*:\s*(null|undefined|false)\s*$/.test(m[2])) { names.add(m[1]); } }
  return names;
}

export function unsafeNativeAppends(src) {
  const found = [];
  const nullable = nullableVars(src);
  const re = /(?<![\w$])([A-Za-z_$][\w$.]*)\.(append|prepend|replaceChildren|after|before)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex; let depth = 1; const start = i;
    while (depth && i < src.length) { if (src[i] === '(') { depth++; } else if (src[i] === ')') { depth--; } i++; }
    for (const arg of topArgs(src.slice(start, i - 1))) {
      if (/\?[\s\S]*:\s*(null|undefined|false)$/.test(arg) || /^[\w$.()[\]!]+\s*&&/.test(arg) || /^(null|undefined|false)$/.test(arg) || nullable.has(arg)) {
        found.push({ line: src.slice(0, m.index).split('\n').length, call: `${m[1]}.${m[2]}`, arg: arg.slice(0, 80) });
      }
    }
  }
  return found;
}

test('the detector itself catches the pattern and accepts safe calls', () => {
  assert.equal(unsafeNativeAppends("body.append(h('p'), x ? h('p') : null);").length, 1);
  assert.equal(unsafeNativeAppends('el.append(ok && node);').length, 1);
  assert.equal(unsafeNativeAppends("add(body, h('p'), x ? h('p') : null);").length, 0);
  assert.equal(unsafeNativeAppends("el.append(h('p', null, a ? 'x' : null));").length, 0);   /* inside h(): filtered */
  /* a variable that may be null, appended later (Speaking Studio recorder) */
  assert.equal(unsafeNativeAppends("const guide = x ? h('p') : null;\nbody.append(guide, h('div'));").length, 1);
  assert.equal(unsafeNativeAppends("const guide = x ? h('p') : null;\nadd(body, guide, h('div'));").length, 0);
  assert.equal(unsafeNativeAppends("const n = x ? 1 : 2;\nbody.append(h('p'), n);").length, 0);
});

test('no native DOM append/prepend/… receives a possibly-null child', () => {
  const problems = [];
  for (const f of files(appDir)) {
    for (const p of unsafeNativeAppends(readFileSync(f, 'utf8'))) { problems.push(`${f.split('/app/')[1]}:${p.line} ${p.call}(… ${p.arg})`); }
  }
  assert.deepEqual(problems, []);
});

/* h() and add() never print absent values or NaN (minimal DOM in Node) */
test('h() and add() skip null, undefined, false and NaN but keep 0 and empty-looking text', async () => {
  class Node { constructor() { this.children = []; } appendChild(c) { this.children.push(c); return c; } }
  class Text extends Node { constructor(v) { super(); this.value = v; } }
  class El extends Node { setAttribute() {} addEventListener() {} }
  const saved = { Node: globalThis.Node, document: globalThis.document };
  globalThis.Node = Node;
  globalThis.document = { createElement: () => new El(), createTextNode: (v) => new Text(v) };
  try {
    const { h, add } = await import('../../app/ui/dom.js');
    const text = (el) => el.children.map((c) => (c instanceof Text ? c.value : '<el>')).join('|');
    assert.equal(text(h('p', null, 'a', null, undefined, false, Number.NaN, 0, 'b')), 'a|0|b');
    assert.equal(text(add(h('div'), h('p'), null, [undefined, Number.NaN, 'x'])), '<el>|x');
  } finally { globalThis.Node = saved.Node; globalThis.document = saved.document; }
});
