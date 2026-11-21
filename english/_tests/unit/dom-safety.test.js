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

export function unsafeNativeAppends(src) {
  const found = [];
  const re = /(?<![\w$])([A-Za-z_$][\w$.]*)\.(append|prepend|replaceChildren|after|before)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex; let depth = 1; const start = i;
    while (depth && i < src.length) { if (src[i] === '(') { depth++; } else if (src[i] === ')') { depth--; } i++; }
    for (const arg of topArgs(src.slice(start, i - 1))) {
      if (/\?[\s\S]*:\s*(null|undefined|false)$/.test(arg) || /^[\w$.()[\]!]+\s*&&/.test(arg) || /^(null|undefined|false)$/.test(arg)) {
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
});

test('no native DOM append/prepend/… receives a possibly-null child', () => {
  const problems = [];
  for (const f of files(appDir)) {
    for (const p of unsafeNativeAppends(readFileSync(f, 'utf8'))) { problems.push(`${f.split('/app/')[1]}:${p.line} ${p.call}(… ${p.arg})`); }
  }
  assert.deepEqual(problems, []);
});
