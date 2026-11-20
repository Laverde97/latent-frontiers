/* =========================================================================
   scoring.js — explicit, rule-based scoring.

   Nothing here estimates pronunciation quality. `alignWords` compares the
   text a speech recogniser returned with the target text; it says which
   target words the recogniser reported, which is useful feedback but is
   NOT a phonetic score (recognisers guess from context, ignore accent
   features and differ between browsers).
   ========================================================================= */

import { SKILLS } from './store.js';

export function normalize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”"]/g, '')
    .replace(/[.,!?;:()¿¡]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Common contractions are accepted in either form. */
const CONTRACTIONS = [
  ["i'm", 'i am'], ["you're", 'you are'], ["he's", 'he is'], ["she's", 'she is'],
  ["it's", 'it is'], ["we're", 'we are'], ["they're", 'they are'], ["what's", 'what is'],
  ["where's", 'where is'], ["isn't", 'is not'], ["aren't", 'are not'], ["i'm not", 'i am not'],
  ["how's", 'how is'], ["that's", 'that is'], ["who's", 'who is']
];

export function expandContractions(s) {
  let out = ` ${s} `;
  for (const [short, long] of CONTRACTIONS) {
    out = out.split(` ${short} `).join(` ${long} `);
  }
  return out.trim();
}

export function answersMatch(given, accepted) {
  const g = expandContractions(normalize(given));
  if (!g) { return false; }
  return accepted.some((a) => expandContractions(normalize(a)) === g);
}

export function tokenize(s) {
  return expandContractions(normalize(s)).split(' ').filter(Boolean);
}

/* Number words <-> digits, so "thirteen" and "13" align. */
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function canonToken(t) {
  const i = NUM.indexOf(t);
  if (i >= 0) { return String(i); }
  if (TENS[t] != null) { return String(TENS[t]); }
  if (t === 'oh') { return '0'; }
  return t;
}

/* Longest-common-subsequence alignment of target vs recognised words.
   Returns per-target-word flags plus counts. */
export function alignWords(target, recognised) {
  const a = tokenize(target);
  const b = tokenize(recognised);
  const A = a.map(canonToken);
  const B = b.map(canonToken);
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Array(n).fill(false);
  const usedB = new Array(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { matched[i] = true; usedB[j] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { i++; } else { j++; }
  }
  return {
    words: a.map((w, k) => ({ word: w, recognised: matched[k] })),
    extra: b.filter((w, k) => !usedB[k]),
    matchedCount: matched.filter(Boolean).length,
    total: n
  };
}

/* Pick the dialogue option closest to what the learner said
   (word-overlap Jaccard). Returns { index, similarity } or null. */
export function closestOption(spoken, options) {
  const s = new Set(tokenize(spoken).map(canonToken));
  if (!s.size) { return null; }
  let best = null;
  options.forEach((opt, index) => {
    const o = new Set(tokenize(opt).map(canonToken));
    const inter = [...o].filter((w) => s.has(w)).length;
    const union = new Set([...o, ...s]).size;
    const similarity = union ? inter / union : 0;
    if (!best || similarity > best.similarity) { best = { index, similarity }; }
  });
  return best && best.similarity >= 0.34 ? best : null;
}

/* ---- writing: transparent rule checks ----------------------------------
   check types:
     minWords {n}            word count >= n
     maxWords {n}            word count <= n
     includesAny {patterns}  at least one regex (case-insensitive) matches
     excludes {patterns}     none of the regexes matches (typical L1 transfer
                             errors such as "I have 25 years")
     capitalized {words}     each listed word, if present, is capitalised
     sentenceCase            every sentence starts with a capital letter
     endsWithPunctuation     every sentence ends with . ! or ?
     capitalI                the pronoun "I" is upper-case                */
export function countWords(text) {
  return (String(text).match(/[A-Za-zÀ-ÿ0-9']+/g) || []).length;
}

export function runWritingChecks(text, checks) {
  const t = String(text || '');
  return checks.map((c) => {
    let pass = false;
    switch (c.type) {
      case 'minWords': pass = countWords(t) >= c.n; break;
      case 'maxWords': pass = countWords(t) <= c.n; break;
      case 'includesAny': pass = c.patterns.some((p) => new RegExp(p, 'i').test(t)); break;
      case 'excludes': pass = !c.patterns.some((p) => new RegExp(p, 'i').test(t)); break;
      case 'capitalized': pass = c.words.every((w) => {
        const re = new RegExp(`\\b${w}\\b`, 'gi');
        const found = t.match(re) || [];
        return found.every((f) => f[0] === f[0].toUpperCase());
      }); break;
      case 'sentenceCase': {
        const sentences = t.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
        pass = sentences.length > 0 && sentences.every((x) => /^[^a-z]/.test(x));
        break;
      }
      case 'endsWithPunctuation': {
        const sentences = t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
        pass = sentences.length > 0 && sentences.every((x) => /[.!?]$/.test(x));
        break;
      }
      case 'capitalI': pass = !/(^|[^A-Za-z'])i([' ]|$)/.test(t); break;
      default: throw new Error(`Unknown writing check ${c.type}`);
    }
    return { id: c.id, pass, label: c.label, hint: c.hint };
  });
}

/* ---- skill summaries ------------------------------------------------------
   Kept separate per source; the UI never blends auto and self scores. */
export function skillSummary(evidence, recent = 20) {
  const out = {};
  for (const skill of SKILLS) {
    const ev = evidence.filter((e) => e.skill === skill);
    const bySource = {};
    for (const src of ['auto', 'asr', 'self']) {
      const list = ev.filter((e) => e.source === src).slice(-recent);
      bySource[src] = list.length
        ? { mean: list.reduce((t, e) => t + e.score, 0) / list.length, n: list.length }
        : null;
    }
    out[skill] = { ...bySource, pending: ev.filter((e) => e.source === 'pending').length, total: ev.length };
  }
  return out;
}

/* Evidence-based level estimate. It only reports what the evidence
   supports: completed lessons per level plus auto-scored comprehension.
   It never infers a level above the content actually completed. */
export function estimateLevel(state, curriculum) {
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
  const reasons = [];
  let reached = null;
  for (const lv of levels) {
    const ids = curriculum.lessons.filter((l) => l.level === lv).map((l) => l.id);
    const done = ids.filter((id) => state.lessons[id] && state.lessons[id].status === 'completed');
    if (!ids.length) { continue; }
    const share = done.length / ids.length;
    reasons.push({ level: lv, done: done.length, total: ids.length });
    if (share < 0.8) {
      const started = done.length > 0 || !!reached;
      return { label: started ? `${lv} (in progress)` : `Pre-${lv}`, level: started ? lv : null, inProgress: started, reached, reasons };
    }
    reached = lv;
  }
  return { label: reached || 'Pre-A1', level: reached, inProgress: false, reached, reasons };
}
