/* =========================================================================
   main.js — English Fluency Lab bootstrap.

   Wires the store, content, practice timer, i18n and a small query-string
   router (?view=lesson&id=w01-l1). Query strings are used instead of
   "#/routes" so Quarto's own anchor handling is never confused.
   ========================================================================= */

import { h, clear, setLiveRegion, announce } from './ui/dom.js';
import { t, getLang, onLangChange, missingKeys } from './i18n.js';
import { Store, addPracticeMinutes } from './core/store.js';
import { loadJSON, flattenCurriculum } from './core/content.js';
import { PracticeTimer, studyDays } from './core/time.js';
import { configureTTS, ttsHooks } from './audio/tts.js';
import { renderDashboard, renderPath, renderProgress } from './ui/views/overview.js';
import { renderLesson } from './ui/views/lesson.js';
import { renderSpeaking, renderListening, renderVocab, renderReadWrite } from './ui/views/studios.js';
import { renderAssess } from './ui/views/assess.js';
import { renderSettings } from './ui/views/settings.js';

const VIEWS = {
  dashboard: renderDashboard,
  path: renderPath,
  lesson: renderLesson,
  speaking: renderSpeaking,
  listening: renderListening,
  vocab: renderVocab,
  readwrite: renderReadWrite,
  assess: renderAssess,
  progress: renderProgress,
  settings: renderSettings
};
const NAV = ['dashboard', 'path', 'speaking', 'listening', 'vocab', 'readwrite', 'assess', 'progress', 'settings'];

async function loadData() {
  const [rawCur, vocabFile, tipsFile] = await Promise.all([
    loadJSON('curriculum.json'), loadJSON('vocab/a1-w01.json'), loadJSON('pronunciation.json')
  ]);
  const curriculum = flattenCurriculum(rawCur);
  const integratives = rawCur.weeks.map((w) => ({ ...w.integrative, week: w.week, level: w.level, order: 6 }));
  const vocab = new Map(vocabFile.items.map((v) => [v.id, v]));
  const lessonCache = new Map();
  const getLesson = async (id) => {
    if (lessonCache.has(id)) { return lessonCache.get(id); }
    const meta = curriculum.lessons.find((l) => l.id === id) || integratives.find((l) => l.id === id);
    const L = await loadJSON(`lessons/${id}.json`);
    const full = { ...L, order: meta ? meta.order : 0 };
    lessonCache.set(id, full);
    return full;
  };
  return {
    curriculum,
    integratives,
    vocab,
    tips: tipsFile.wordTips,
    pronunciationNotes: tipsFile.notes,
    lessonCache,
    getLesson,
    getDialogue: (id) => loadJSON(`dialogues/${id}.json`),
    allDialogues: () => Promise.all(rawCur.dialogues.map((id) => loadJSON(`dialogues/${id}.json`))),
    getDiagnostic: () => loadJSON('diagnostic.json'),
    availableLessons: () => Promise.all([...curriculum.lessons, ...integratives].filter((l) => l.status === 'available').map((l) => getLesson(l.id)))
  };
}

function readRoute() {
  const p = new URLSearchParams(window.location.search);
  const view = VIEWS[p.get('view')] ? p.get('view') : 'dashboard';
  return { view, params: { id: p.get('id') || undefined } };
}

async function boot(container) {
  const store = new Store();
  configureTTS({ voiceURI: store.state.settings.voiceURI, rate: store.state.settings.rate });

  const live = h('div', { class: 'efl-sr', 'aria-live': 'polite', role: 'status' });
  setLiveRegion(live);
  const notices = h('div', { class: 'efl-notices' });
  const nav = h('nav', { class: 'efl-nav', 'aria-label': 'English Fluency Lab' });
  const main = h('div', { class: 'efl-main', 'data-testid': 'efl-view' });
  clear(container);
  container.append(nav, notices, main, live);
  main.append(h('p', null, t('loading')));

  let data;
  try {
    data = await loadData();
  } catch (e) {
    clear(main);
    main.append(h('p', { class: 'efl-bad', role: 'alert' }, t('loadError', { msg: e.message })));
    return;
  }

  const timer = new PracticeTimer((minutes) => {
    store.update((s) => {
      addPracticeMinutes(s, minutes);
      if (studyDays(s.practice) >= 7) { s.badges.days7 = s.badges.days7 || new Date().toISOString(); }
    });
  });
  ttsHooks.onStart = () => timer.hold();
  ttsHooks.onEnd = () => timer.release();
  let unloading = false;
  window.addEventListener('pagehide', () => { unloading = true; timer.flush(); });
  window.addEventListener('beforeunload', () => { unloading = true; });

  let route = readRoute();
  let renderToken = 0;
  let firstRender = true;

  const ctx = {
    store,
    data,
    timer,
    lang: getLang,
    esOn: () => !!store.state.settings.esSupport,
    focusOnRender: false,
    go(view, params = {}) {
      const q = new URLSearchParams();
      if (view !== 'dashboard') { q.set('view', view); }
      if (params.id) { q.set('id', params.id); }
      const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
      window.history.pushState({}, '', url);
      route = { view, params };
      render(true);
    }
  };

  const drawNav = () => {
    clear(nav);
    nav.append(h('ul', { class: 'efl-nav__list' }, NAV.map((v) => {
      const href = v === 'dashboard' ? window.location.pathname : `?view=${v}`;
      const a = h('a', { href, class: 'efl-nav__link', 'aria-current': route.view === v || (v === 'path' && route.view === 'lesson') ? 'page' : null, 'data-view': v }, t(`nav.${v}`));
      a.addEventListener('click', (e) => { e.preventDefault(); ctx.go(v); });
      return h('li', null, a);
    })));
    const esToggle = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost efl-nav__es', 'aria-pressed': String(ctx.esOn()), 'data-testid': 'es-toggle' },
      ctx.esOn() ? t('nav.esOn') : t('nav.esOff'));
    esToggle.addEventListener('click', () => { store.update((s) => { s.settings.esSupport = !s.settings.esSupport; }); render(false); });
    nav.append(esToggle);
  };

  const drawNotices = () => {
    clear(notices);
    if (store.notice === 'corrupt') { notices.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'alert' }, t('notice.corrupt'))); }
    if (store.notice === 'migrated') { notices.append(h('p', { class: 'efl-notice' }, t('notice.migrated'))); }
    if (!store.persistent) { notices.append(h('p', { class: 'efl-notice efl-notice--warn' }, t('set.notPersistent'))); }
    if (store.saveError) { notices.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'alert' }, t('notice.saveError'))); }
  };

  async function render(moveFocus) {
    const token = ++renderToken;
    timer.flush();
    drawNav();
    drawNotices();
    ctx.focusOnRender = moveFocus;
    let el;
    try {
      el = await VIEWS[route.view](ctx, route.params);
    } catch (e) {
      /* a navigation that interrupts a pending fetch is not an error */
      if (unloading) { return; }
      el = h('p', { class: 'efl-bad', role: 'alert' }, t('loadError', { msg: e.message }));
      console.error(e);
    }
    if (token !== renderToken) { return; }
    clear(main);
    main.append(el);
    if (moveFocus && !firstRender) {
      const hd = main.querySelector('h2');
      if (hd) { hd.focus(); }
      container.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    firstRender = false;
    document.title = `${t(`nav.${route.view === 'lesson' ? 'path' : route.view}`)} · English Fluency Lab · Latent Frontiers`;
    announce(t(`nav.${route.view === 'lesson' ? 'path' : route.view}`));
  }

  window.addEventListener('popstate', () => { route = readRoute(); render(true); });
  onLangChange(() => render(false));
  store.subscribe(() => { if (store.saveError) { drawNotices(); } });
  window.__efl = { store, ctx, missingKeys };
  await render(false);
  container.setAttribute('data-ready', 'true');
}

const container = document.getElementById('efl-app');
if (container) { boot(container); }
