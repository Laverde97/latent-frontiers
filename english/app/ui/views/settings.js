/* =========================================================================
   settings.js — preferences, privacy controls and data management.
   ========================================================================= */

import { h, clear, nextId, announce } from '../dom.js';
import { t } from '../../i18n.js';
import { getEnglishVoices, ttsSupported, configureTTS, speak } from '../../audio/tts.js';
import { recordingSupported } from '../../audio/recorder.js';
import { asrSupported } from '../../audio/asr.js';
import { countRecordings, deleteAllRecordings } from '../../audio/recording-db.js';
import { exportState, importState } from '../../core/store.js';
import { STUDY_MODES, weeklyGoalMinutes, weeksToHours, C1_HOURS_ORIENTATION } from '../../core/time.js';
import { RATES } from '../components/audio.js';

function field(label, control, help) {
  const id = control.id || (control.id = nextId('s'));
  return h('div', { class: 'efl-field' }, h('label', { for: id }, label), control, help ? h('p', { class: 'efl-small efl-muted' }, help) : null);
}

export async function renderSettings(ctx) {
  const st = ctx.store.state;
  const root = h('div', { class: 'efl-settings' });
  root.append(h('h2', { class: 'efl-h2', tabindex: '-1' }, t('nav.settings')));

  /* learning */
  const es = h('input', { type: 'checkbox', checked: st.settings.esSupport, 'data-testid': 'es-support' });
  es.addEventListener('change', () => { ctx.store.update((s) => { s.settings.esSupport = es.checked; }); announce(t('set.saved')); });
  const mode = h('select', { class: 'efl-select', 'data-testid': 'study-mode' }, Object.keys(STUDY_MODES).map((m) => h('option', { value: m, selected: m === st.settings.studyMode }, t(`mode.${m}`))));
  const modeInfo = h('p', { class: 'efl-small' });
  const drawMode = () => {
    const m = mode.value;
    const [lo, hi] = C1_HOURS_ORIENTATION;
    modeInfo.textContent = t('set.modeInfo', { week: weeklyGoalMinutes(m), lo: weeksToHours(m, lo), hi: weeksToHours(m, hi), hlo: lo, hhi: hi });
  };
  mode.addEventListener('change', () => { ctx.store.update((s) => { s.settings.studyMode = mode.value; }); drawMode(); });
  drawMode();
  root.append(h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h3' }, t('set.learning')),
    h('p', { class: 'efl-small' }, t('set.uiLang')),
    h('div', { class: 'efl-field' }, h('span', { class: 'efl-check-row' }, es, h('label', { for: es.id || (es.id = nextId('es')) }, ` ${t('set.esSupport')}`)), h('p', { class: 'efl-small efl-muted' }, t('set.esSupportHelp'))),
    field(t('set.mode'), mode, t('set.modeHelp')), modeInfo,
    h('p', { class: 'efl-small efl-warn' }, t('set.intensiveNote'))));

  /* audio */
  const audioSec = h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h3' }, t('set.audio')));
  audioSec.append(h('ul', { class: 'efl-plain', 'data-testid': 'capabilities' },
    h('li', null, `${ttsSupported() ? '✓' : '✗'} ${t('set.capTts')}`),
    h('li', null, `${recordingSupported() ? '✓' : '✗'} ${t('set.capRec')}`),
    h('li', null, `${asrSupported() ? '✓' : '✗'} ${t('set.capAsr')}`)));
  if (ttsSupported()) {
    const voices = await getEnglishVoices();
    const vs = h('select', { class: 'efl-select', 'data-testid': 'voice' }, h('option', { value: '' }, t('set.voiceAuto')),
      voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === st.settings.voiceURI }, `${v.name} — ${v.lang}`)));
    vs.addEventListener('change', () => { ctx.store.update((s) => { s.settings.voiceURI = vs.value || null; }); configureTTS({ voiceURI: vs.value || null }); });
    const test = h('button', { type: 'button', class: 'efl-btn' }, '▶ ', t('set.testVoice'));
    test.addEventListener('click', () => speak('Hello! Nice to meet you. Where are you from?'));
    audioSec.append(field(t('set.voice'), vs, voices.length ? t('set.voiceHelp') : t('set.noEnglishVoice')), test);
    const rate = h('select', { class: 'efl-select' }, RATES.map((r) => h('option', { value: String(r), selected: r === st.settings.rate }, `${r}×`)));
    rate.addEventListener('change', () => { ctx.store.update((s) => { s.settings.rate = Number(rate.value); }); configureTTS({ rate: Number(rate.value) }); });
    audioSec.append(field(t('set.rate'), rate));
  } else {
    audioSec.append(h('p', { class: 'efl-notice efl-notice--warn' }, t('audio.noTts')));
  }
  root.append(audioSec);

  /* privacy */
  const priv = h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h3' }, t('set.privacy')),
    h('ul', null, ['p1', 'p2', 'p3', 'p4', 'p5'].map((k) => h('li', null, t(`set.${k}`)))));
  const consent = h('p', null, st.settings.micConsent ? t('set.micConsentOn') : t('set.micConsentOff'));
  if (st.settings.micConsent) {
    const revoke = h('button', { type: 'button', class: 'efl-btn' }, t('set.revoke'));
    revoke.addEventListener('click', () => { ctx.store.update((s) => { s.settings.micConsent = false; }); consent.textContent = t('set.micConsentOff'); revoke.remove(); });
    consent.append(' ', revoke);
  }
  const keep = h('input', { type: 'checkbox', checked: st.settings.saveRecordings, id: nextId('keep') });
  keep.addEventListener('change', () => ctx.store.update((s) => { s.settings.saveRecordings = keep.checked; }));
  const recInfo = h('span', { class: 'efl-small' });
  countRecordings().then((n) => { recInfo.textContent = t('set.recCount', { n }); });
  const delRec = h('button', { type: 'button', class: 'efl-btn' }, t('set.deleteRecordings'));
  delRec.addEventListener('click', async () => {
    try { await deleteAllRecordings(); } catch (e) { /* nothing stored */ }
    recInfo.textContent = t('set.recCount', { n: 0 });
    announce(t('set.recordingsDeleted'));
  });
  priv.append(consent, h('p', { class: 'efl-check-row' }, keep, h('label', { for: keep.id }, ` ${t('set.keepRecordings')}`)), h('p', null, recInfo, ' ', delRec));
  root.append(priv);

  /* data */
  const dataSec = h('section', { class: 'efl-card efl-card--wide' }, h('h3', { class: 'efl-h3' }, t('set.data')),
    h('p', { class: 'efl-small' }, t('set.dataLocal')),
    !ctx.store.persistent ? h('p', { class: 'efl-notice efl-notice--warn' }, t('set.notPersistent')) : null);
  const exp = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'export' }, '⤓ ', t('set.export'));
  exp.addEventListener('click', () => {
    const blob = new Blob([exportState(ctx.store.state)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `english-fluency-lab-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', id: nextId('imp'), 'data-testid': 'import-file' });
  const msg = h('p', { 'aria-live': 'polite', class: 'efl-small' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) { return; }
    const res = importState(await f.text());
    clear(msg);
    if (!res.ok) { msg.className = 'efl-bad efl-small'; msg.textContent = t('set.importError', { errors: res.errors.slice(0, 3).join('; ') }); return; }
    if (!window.confirm(t('set.importConfirm'))) { return; }
    ctx.store.replace(res.state);
    msg.className = 'efl-ok efl-small';
    msg.textContent = t('set.imported');
  });
  const reset = h('button', { type: 'button', class: 'efl-btn efl-btn--danger', 'data-testid': 'reset' }, t('set.reset'));
  reset.addEventListener('click', () => {
    if (!window.confirm(t('set.resetConfirm'))) { return; }
    ctx.store.reset();
    msg.className = 'efl-ok efl-small';
    msg.textContent = t('set.resetDone');
  });
  dataSec.append(h('div', { class: 'efl-row efl-row--wrap' }, exp, h('span', null, h('label', { for: fileIn.id }, `${t('set.import')} `), fileIn), reset), msg,
    h('p', { class: 'efl-small efl-muted' }, t('set.noSync')));
  root.append(dataSec);
  return root;
}
