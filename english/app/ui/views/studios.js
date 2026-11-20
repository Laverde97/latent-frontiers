/* =========================================================================
   studios.js — Speaking Studio, Listening Lab, Vocabulary & Pronunciation,
   Reading & Writing. They reuse content from every available lesson so
   learners can practise outside the lesson flow. Results are logged as
   evidence under the pseudo-lesson "studio".
   ========================================================================= */

import { h, clear, announce, nextId, pick } from '../dom.js';
import { t } from '../../i18n.js';
import { listenButtons, segmentPlayerUI, repeatCard, recorderPanel, syntheticNotice } from '../components/audio.js';
import { exerciseSet, renderExercise, shuffle } from '../components/exercises.js';
import { rubricForm, dialogueRunner, writingTask, speakingChallenge } from '../components/tasks.js';
import { recordActivity } from '../../core/store.js';
import { newCard, review, isDue, cardStage, qualityFromAttempt } from '../../core/srs.js';
import { vocabCard } from './lesson.js';
import { ttsSupported } from '../../audio/tts.js';

const STUDIO = 'studio';

function logEvidence(ctx, activityId, result) {
  ctx.store.update((s) => { recordActivity(s, STUDIO, activityId, result); });
}

function lessonPicker(lessons, ctx, onPick, label) {
  const id = nextId('pick');
  const sel = h('select', { id, class: 'efl-select', 'data-testid': 'lesson-picker' }, lessons.map((l) => h('option', { value: l.id }, `${t('lesson.week', { n: l.week })} · ${l.title}`)));
  sel.addEventListener('change', () => onPick(lessons.find((l) => l.id === sel.value)));
  return h('div', { class: 'efl-field-inline' }, h('label', { for: id }, label || t('studio.chooseLesson')), sel);
}

const SHADOW_RUBRIC = [
  { id: 'rhythm', label: { en: 'Rhythm and pauses match the model', es: 'Ritmo y pausas como el modelo' } },
  { id: 'stress', label: { en: 'Stressed words stand out', es: 'Las palabras acentuadas se destacan' } },
  { id: 'linking', label: { en: 'Words are linked, not separated one by one', es: 'Las palabras se enlazan, no van separadas una a una' } }
];

/* ---- Speaking Studio ------------------------------------------------------ */
export async function renderSpeaking(ctx) {
  const lessons = await ctx.data.availableLessons();
  const core = lessons.filter((l) => l.kind !== 'review');
  const root = h('div', { class: 'efl-studio' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.speaking')), h('p', null, t('sp.intro')), syntheticNotice());

  /* A. listen and repeat */
  const repeatSlot = h('div', { class: 'efl-repeat-list' });
  const drawRepeat = (L) => {
    clear(repeatSlot);
    const phrases = L.steps.filter((s) => s.type === 'speaking' || s.type === 'pronunciation').flatMap((s) => s.repeat || []);
    phrases.forEach((p, k) => repeatSlot.append(repeatCard({ ...p, onAsr: (r) => logEvidence(ctx, `repeat-${L.id}-${k}`, { score: r.matched, max: r.total, source: 'asr', skill: 'speaking' }) }, ctx, { key: `studio/${L.id}/${k}`, tips: ctx.data.tips })));
  };
  root.append(section('sp-repeat', t('sp.repeatTitle'), t('sp.repeatHelp'), lessonPicker(core, ctx, drawRepeat), repeatSlot));
  drawRepeat(core[0]);

  /* B. shadowing */
  const shadowSlot = h('div');
  const drawShadow = (L) => {
    clear(shadowSlot);
    const lines = L.steps.find((s) => s.type === 'listening').lines;
    shadowSlot.append(shadowing(lines, ctx, L.id));
  };
  root.append(section('sp-shadow', t('sp.shadowTitle'), t('sp.shadowHelp'), lessonPicker(lessons, ctx, drawShadow), shadowSlot));
  drawShadow(lessons[0]);

  /* C. speaking challenges */
  const chSlot = h('div');
  const levels = h('ul', { class: 'efl-plain' }, [
    ['A1', '20–40 s'], ['A2', '1–2 min'], ['B1', '2–4 min'], ['B2', '3–5 min'], ['C1', '5–8 min']
  ].map(([lv, d]) => h('li', null, h('strong', null, lv), ` · ${d} · `, lv === 'A1' ? t('status.available') : t('status.planned'))));
  const challenges = lessons.map((L) => ({ L, step: L.steps.find((s) => s.type === 'speaking') })).filter((x) => x.step);
  const drawChallenge = (L) => {
    clear(chSlot);
    const st = challenges.find((x) => x.L.id === L.id).step;
    chSlot.append(speakingChallenge(st.challenge, st.rubric, ctx, (r) => logEvidence(ctx, `challenge-${L.id}`, { score: r.rubric.score, max: r.rubric.max, source: 'self', skill: 'speaking' }), { key: `studio/challenge/${L.id}` }));
  };
  root.append(section('sp-challenge', t('sp.challengeTitle'), t('sp.challengeHelp'), levels, lessonPicker(challenges.map((x) => x.L), ctx, drawChallenge), chSlot));
  drawChallenge(challenges[0].L);

  /* D. conversation coach */
  root.append(await coach(ctx));
  return root;
}

function section(id, title, help, ...children) {
  return h('section', { class: 'efl-card efl-card--wide', 'aria-labelledby': id }, h('h3', { class: 'efl-h3', id }, title), help ? h('p', { class: 'efl-small' }, help) : null, ...children);
}

function shadowing(lines, ctx, lessonId) {
  const wrap = h('div', { class: 'efl-shadow' });
  const noText = h('input', { type: 'checkbox', id: nextId('nt') });
  const list = h('ol', { class: 'efl-shadow__list' });
  const draw = () => {
    clear(list);
    lines.forEach((ln, k) => {
      const text = h('span', { lang: 'en', class: 'efl-shadow__text' }, ln.text);
      const reveal = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost' }, t('sp.showText'));
      reveal.addEventListener('click', () => { text.hidden = false; reveal.remove(); });
      if (noText.checked) { text.hidden = true; }
      list.append(h('li', { class: 'efl-shadow__item' },
        h('p', null, h('strong', null, `${ln.speaker}: `), text, noText.checked ? reveal : null),
        listenButtons(ln.text, ctx),
        recorderPanel(ctx, { key: `shadow/${lessonId}/${k}`, maxSeconds: 20, modelText: ln.text })));
    });
  };
  noText.addEventListener('change', draw);
  draw();
  wrap.append(h('p', { class: 'efl-small' }, t('sp.shadowSteps')),
    h('p', null, noText, h('label', { for: noText.id }, ` ${t('sp.noTranscript')}`)),
    segmentPlayerUI(lines, ctx, { transcript: false }), list,
    rubricForm(SHADOW_RUBRIC, ctx, (r) => logEvidence(ctx, `shadow-${lessonId}`, { score: r.score, max: r.max, source: 'self', skill: 'speaking' }), { title: t('sp.shadowRubric') }));
  return wrap;
}

async function coach(ctx) {
  const dialogues = await ctx.data.allDialogues();
  const sec = section('sp-coach', t('coach.title'), t('coach.help'));
  const mk = (label, opts, testid) => {
    const id = nextId('c');
    const sel = h('select', { id, class: 'efl-select', 'data-testid': testid }, opts.map(([v, l, dis]) => h('option', { value: v, disabled: dis || null }, l)));
    return { el: h('div', { class: 'efl-field-inline' }, h('label', { for: id }, label), sel), sel };
  };
  const level = mk(t('coach.level'), [['A1', 'A1'], ['A2', `A2 — ${t('status.planned')}`, true], ['B1', `B1 — ${t('status.planned')}`, true], ['B2', `B2 — ${t('status.planned')}`, true], ['C1', `C1 — ${t('status.planned')}`, true]], 'coach-level');
  const topic = mk(t('coach.topic'), dialogues.map((d) => [d.id, `${d.title} · ${pick(d.goal, ctx.lang())}`]), 'coach-topic');
  const mode = mk(t('coach.mode'), [['guided', t('coach.guided')], ['challenge', t('coach.challenge')]], 'coach-mode');
  const info = h('p', { class: 'efl-small efl-muted' });
  const updateInfo = () => {
    const d = dialogues.find((x) => x.id === topic.sel.value);
    info.textContent = t('coach.info', { min: d.minutes || 3, goal: pick(d.goal, ctx.lang()) });
  };
  topic.sel.addEventListener('change', updateInfo);
  updateInfo();
  const slot = h('div');
  const start = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'coach-start' }, t('coach.start'));
  start.addEventListener('click', () => {
    clear(slot);
    const d = dialogues.find((x) => x.id === topic.sel.value);
    slot.append(dialogueRunner(d, ctx, {
      difficulty: mode.sel.value,
      onComplete: (r) => {
        logEvidence(ctx, `coach-${d.id}`, { score: r.score, max: r.max, source: 'auto', skill: 'listening' });
        slot.append(h('div', { class: 'efl-callout' }, h('h4', null, t('coach.feedback')),
          h('ul', null, r.choices.map((c) => h('li', null, h('span', { lang: 'en' }, c.reply), ` — ${t(`fit.${c.fit}`)}`))),
          h('p', { class: 'efl-small' }, t('coach.feedbackNote'))));
      }
    }));
  });
  sec.append(h('div', { class: 'efl-row efl-row--wrap' }, level.el, topic.el, mode.el), info, start, slot,
    h('p', { class: 'efl-small efl-muted' }, t('coach.aiNote')));
  return sec;
}

/* ---- Listening Lab --------------------------------------------------------- */
export async function renderListening(ctx) {
  const lessons = await ctx.data.availableLessons();
  const root = h('div', { class: 'efl-studio' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.listening')), h('p', null, t('li.intro')), syntheticNotice());

  /* A. dialogues + comprehension */
  const slot = h('div');
  const draw = (L) => {
    clear(slot);
    const step = L.steps.find((s) => s.type === 'listening');
    slot.append(segmentPlayerUI(step.lines, ctx, { transcript: false }),
      exerciseSet(step.exercises.map((e) => ({ ...e, id: `lab-${e.id}` })), ctx, (r) => logEvidence(ctx, `listening-${L.id}`, { score: r.score, max: r.max, source: 'auto', skill: 'listening' })));
  };
  root.append(section('li-dialogues', t('li.dialoguesTitle'), t('li.dialoguesHelp'), lessonPicker(lessons, ctx, draw), slot));
  draw(lessons[0]);

  /* B. dictation */
  const dict = lessons.flatMap((L) => L.steps.flatMap((s) => (s.exercises || []).filter((e) => e.type === 'dictation')));
  const dictSlot = h('div');
  const runDict = () => {
    clear(dictSlot);
    const pickN = shuffle(dict, String(Date.now())).slice(0, 5).map((e, i) => ({ ...e, id: `dict-${i}-${e.id}` }));
    dictSlot.append(exerciseSet(pickN, ctx, (r) => logEvidence(ctx, 'dictation', { score: r.score, max: r.max, source: 'auto', skill: 'listening' })));
  };
  const again = h('button', { type: 'button', class: 'efl-btn' }, t('li.newSet'));
  again.addEventListener('click', runDict);
  root.append(section('li-dict', t('li.dictTitle'), t('li.dictHelp'), again, dictSlot));
  runDict();

  /* C. minimal pairs */
  const pairs = lessons.flatMap((L) => L.steps.flatMap((s) => (s.exercises || []).filter((e) => e.type === 'minimalPair')));
  const mpSlot = h('div');
  const runMp = () => {
    clear(mpSlot);
    const set = shuffle(pairs, String(Date.now())).slice(0, 6).map((e, i) => ({ ...e, id: `mp-${i}-${e.id}` }));
    mpSlot.append(exerciseSet(set, ctx, (r) => logEvidence(ctx, 'minimal-pairs', { score: r.score, max: r.max, source: 'auto', skill: 'listening' })));
  };
  const again2 = h('button', { type: 'button', class: 'efl-btn' }, t('li.newSet'));
  again2.addEventListener('click', runMp);
  root.append(section('li-mp', t('li.mpTitle'), t('li.mpHelp'), again2, mpSlot));
  runMp();

  /* D. listen and respond orally */
  const qs = lessons.flatMap((L) => L.steps.filter((s) => s.type === 'listening').flatMap((s) => s.lines.filter((l) => /\?$/.test(l.text.trim()))));
  const uniq = [...new Map(qs.map((q) => [q.text, q])).values()];
  const respSlot = h('div');
  const runResp = () => {
    clear(respSlot);
    const q = uniq[Math.floor(Math.random() * uniq.length)];
    const hidden = h('p', { lang: 'en', hidden: true }, q.text);
    const show = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost' }, t('sp.showText'));
    show.addEventListener('click', () => { hidden.hidden = false; show.remove(); });
    respSlot.append(listenButtons(q.text, ctx, { label: t('li.playQuestion') }), show, hidden,
      recorderPanel(ctx, { key: 'respond', maxSeconds: 30, onRecorded: () => announce(t('li.respondDone')) }));
  };
  const nextQ = h('button', { type: 'button', class: 'efl-btn' }, t('li.nextQuestion'));
  nextQ.addEventListener('click', runResp);
  root.append(section('li-respond', t('li.respondTitle'), t('li.respondHelp'), nextQ, respSlot));
  if (uniq.length) { runResp(); }
  return root;
}

/* ---- Vocabulary & pronunciation ---------------------------------------------- */
export async function renderVocab(ctx) {
  const lessons = await ctx.data.availableLessons();
  const root = h('div', { class: 'efl-studio' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.vocab')), h('p', null, t('vo.intro')));
  const st = ctx.store.state;
  const cardIds = Object.keys(st.srs).filter((id) => ctx.data.vocab.has(id));
  const due = cardIds.filter((id) => isDue(st.srs[id])).sort((a, b) => new Date(st.srs[a].due) - new Date(st.srs[b].due));

  /* A. review session */
  const rev = h('div', { 'data-testid': 'srs-session' });
  if (!cardIds.length) {
    rev.append(h('p', { class: 'efl-muted' }, t('vo.noCards')));
  } else if (!due.length) {
    const nextDue = cardIds.map((id) => new Date(st.srs[id].due)).sort((a, b) => a - b)[0];
    rev.append(h('p', null, t('vo.noneDue', { when: nextDue.toLocaleString() })));
  } else {
    rev.append(reviewSession(due.slice(0, 20), ctx));
  }
  root.append(section('vo-review', t('vo.reviewTitle'), t('vo.reviewHelp'), rev));

  /* B. browse */
  const lessonVocab = [...new Set(lessons.flatMap((L) => L.vocabIds || []))];
  const browseList = h('ul', { class: 'efl-vocab-grid' });
  const filter = h('input', { type: 'search', class: 'efl-input', id: nextId('f'), placeholder: t('vo.filter') });
  const drawBrowse = () => {
    clear(browseList);
    const q = filter.value.trim().toLowerCase();
    lessonVocab.map((id) => ctx.data.vocab.get(id)).filter((v) => v && (!q || v.word.toLowerCase().includes(q) || (v.es || '').toLowerCase().includes(q))).forEach((v) => {
      const card = vocabCard(v, ctx);
      card.append(h('p', { class: 'efl-small efl-muted' }, t(`stage.${cardStage(st.srs[v.id])}`)));
      browseList.append(card);
    });
  };
  filter.addEventListener('input', drawBrowse);
  drawBrowse();
  root.append(section('vo-browse', t('vo.browseTitle'), t('vo.browseHelp'), h('label', { for: filter.id, class: 'efl-sr' }, t('vo.filter')), filter, browseList));

  /* C. pronunciation tips */
  root.append(section('vo-tips', t('vo.tipsTitle'), t('vo.tipsHelp'),
    h('ul', { class: 'efl-tips' }, ctx.data.pronunciationNotes.map((n) => h('li', null, h('strong', null, n.sound), ' — ', pick(n.text, ctx.lang()),
      ' ', h('span', { lang: 'en', class: 'efl-small' }, n.examples.join(', ')), ' ', listenButtons(n.examples.join(', '), ctx, { slow: true }))))));
  return root;
}

function reviewSession(ids, ctx) {
  const wrap = h('div', { class: 'efl-srs' });
  let i = 0;
  let correctCount = 0;
  const draw = () => {
    clear(wrap);
    if (i >= ids.length) {
      wrap.append(h('p', { class: 'efl-ok', 'data-testid': 'srs-done' }, t('vo.sessionDone', { n: ids.length })));
      ctx.store.update((s) => {
        const total = Object.values(s.srs).reduce((n, c) => n + c.history.length, 0);
        if (total >= 10) { s.badges.reviews10 = s.badges.reviews10 || new Date().toISOString(); }
      });
      return;
    }
    const v = ctx.data.vocab.get(ids[i]);
    /* alternate modes: recall meaning (from word + audio) / listen and type */
    const typeMode = i % 2 === 1 && ttsSupported();
    wrap.append(h('p', { class: 'efl-small efl-muted' }, t('vo.cardN', { n: i + 1, total: ids.length })));
    if (typeMode) {
      const ex = { id: `srs-${v.id}-${i}`, type: 'dictation', audio: v.word, accept: [v.word, ...(v.accept || [])], prompt: t('vo.listenType') };
      wrap.append(renderExercise(ex, ctx, (r) => {
        const q = qualityFromAttempt({ correct: r.correct, attempts: r.attempts });
        if (r.correct) { correctCount += 1; }
        ctx.store.update((s) => { s.srs[v.id] = review(s.srs[v.id] || newCard(), q); });
        const nx = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'srs-next' }, t('vo.next'));
        nx.addEventListener('click', () => { i += 1; draw(); });
        wrap.append(vocabCard(v, ctx), nx);
        nx.focus();
      }));
      return;
    }
    const back = h('div', { hidden: true }, vocabCard(v, ctx));
    const grade = h('div', { class: 'efl-row efl-row--wrap', hidden: true, role: 'group', 'aria-label': t('vo.grade') },
      [[1, 'again'], [3, 'hard'], [4, 'good'], [5, 'easy']].map(([q, k]) => {
        const b = h('button', { type: 'button', class: 'efl-btn', 'data-testid': `srs-${k}` }, t(`vo.${k}`));
        b.addEventListener('click', () => {
          ctx.store.update((s) => { s.srs[v.id] = review(s.srs[v.id] || newCard(), q); });
          if (q >= 3) { correctCount += 1; }
          i += 1;
          draw();
        });
        return b;
      }));
    const showBtn = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'srs-show' }, t('vo.show'));
    showBtn.addEventListener('click', () => { back.hidden = false; grade.hidden = false; showBtn.remove(); grade.querySelector('button').focus(); });
    wrap.append(h('div', { class: 'efl-flash' }, h('p', { class: 'efl-vcard__word', lang: 'en' }, v.word), listenButtons(v.word, ctx),
      h('p', { class: 'efl-small' }, t('vo.recallPrompt'))), showBtn, back, grade,
    h('p', { class: 'efl-small efl-muted' }, t('vo.gradeHelp')));
  };
  draw();
  return wrap;
}

/* ---- Reading & Writing ---------------------------------------------------- */
export async function renderReadWrite(ctx) {
  const lessons = await ctx.data.availableLessons();
  const root = h('div', { class: 'efl-studio' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.readwrite')), h('p', null, t('rw.intro')));
  const rSlot = h('div');
  const drawR = (L) => {
    clear(rSlot);
    const s = L.steps.find((x) => x.type === 'reading');
    rSlot.append(h('article', { class: 'efl-reading', lang: 'en' }, s.text.split(/\n\n+/).map((p) => h('p', null, p))),
      listenButtons(s.text, ctx, { label: t('lesson.listenText') }),
      exerciseSet(s.exercises.map((e) => ({ ...e, id: `rw-${e.id}` })), ctx, (r) => logEvidence(ctx, `reading-${L.id}`, { score: r.score, max: r.max, source: 'auto', skill: 'reading' })));
  };
  root.append(section('rw-read', t('rw.readTitle'), t('rw.readHelp'), lessonPicker(lessons, ctx, drawR), rSlot));
  drawR(lessons[0]);

  const wSlot = h('div');
  const drawW = (L) => {
    clear(wSlot);
    const s = L.steps.find((x) => x.type === 'writing');
    wSlot.append(writingTask(s, ctx, (r) => {
      logEvidence(ctx, `writing-checks-${L.id}`, { score: r.checkScore, max: r.checkMax, source: 'auto', skill: 'writing' });
      logEvidence(ctx, `writing-${L.id}`, { score: r.rubric.score, max: r.rubric.max, source: 'self', skill: 'writing' });
    }));
  };
  root.append(section('rw-write', t('rw.writeTitle'), t('rw.writeHelp'),
    h('ul', { class: 'efl-plain efl-small' }, ['auto', 'self', 'ai', 'human'].map((k) => h('li', null, h('strong', null, t(`rw.fb.${k}`)), ' — ', t(`rw.fb.${k}.desc`)))),
    lessonPicker(lessons, ctx, drawW), wSlot));
  drawW(lessons[0]);
  return root;
}

