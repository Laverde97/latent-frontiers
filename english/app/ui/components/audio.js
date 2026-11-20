/* =========================================================================
   audio.js — audio UI: listen buttons, segment player, recorder panel and
   speech-recognition check. All of them degrade to a working alternative
   when an API is missing and say why.
   ========================================================================= */

import { h, clear, announce, nextId, pick } from '../dom.js';
import { t } from '../../i18n.js';
import { speak, stopSpeaking, ttsSupported, SegmentPlayer } from '../../audio/tts.js';
import { startRecording, recordingSupported } from '../../audio/recorder.js';
import { saveRecording } from '../../audio/recording-db.js';
import { asrSupported, recognizeOnce } from '../../audio/asr.js';
import { alignWords } from '../../core/scoring.js';
import { recordActivity } from '../../core/store.js';

export const RATES = [0.6, 0.8, 0.9, 1.0, 1.2];

/* "Listen" button (+ optional slow button). */
/* hideText: for dictations / listening questions the accessible name must
   not contain the text (a screen reader would read the answer aloud). */
export function listenButtons(text, ctx, { slow = true, label, hideText = false } = {}) {
  if (!ttsSupported()) {
    return h('span', { class: 'efl-muted efl-small' }, t('audio.noTtsInline'));
  }
  const play = async (rate, btn) => {
    btn.setAttribute('aria-pressed', 'true');
    ctx.timer.hold();
    try { await speak(text, { rate }); } finally { ctx.timer.release(); btn.setAttribute('aria-pressed', 'false'); }
  };
  const normal = h('button', { type: 'button', class: 'efl-btn efl-btn--audio', 'aria-pressed': 'false', 'aria-label': hideText ? (label || t('audio.listenAudio')) : `${label || t('audio.listen')}: ${text}` }, '▶ ', label || t('audio.listen'));
  normal.addEventListener('click', () => play(ctx.store.state.settings.rate, normal));
  const out = [normal];
  if (slow) {
    const s = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost', 'aria-pressed': 'false', 'aria-label': hideText ? `${t('audio.slow')} — ${t('audio.listenAudio')}` : `${t('audio.slow')}: ${text}` }, '🐢 ', t('audio.slow'));
    s.addEventListener('click', () => play(0.6, s));
    out.push(s);
  }
  return h('span', { class: 'efl-listen' }, out);
}

export function speedSelect(value, onChange) {
  const id = nextId('rate');
  const sel = h('select', { id, class: 'efl-select' }, RATES.map((r) => h('option', { value: String(r), selected: r === value }, `${r}×`)));
  sel.addEventListener('change', () => onChange(Number(sel.value)));
  return h('span', { class: 'efl-field-inline' }, h('label', { for: id }, t('audio.speed')), sel);
}

export function syntheticNotice() {
  if (!ttsSupported()) {
    return h('p', { class: 'efl-notice efl-notice--warn', role: 'note' }, t('audio.noTts'));
  }
  return h('p', { class: 'efl-notice', role: 'note' }, t('audio.syntheticNotice'));
}

/* Multi-line player with segment controls and optional transcript. */
export function segmentPlayerUI(lines, ctx, { transcript = true, onFirstPlay } = {}) {
  const wrap = h('div', { class: 'efl-player' });
  if (!ttsSupported()) {
    wrap.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'note' }, t('audio.noTtsPlayer')));
    wrap.append(transcriptList(lines, ctx, () => {}));
    return wrap;
  }
  let played = false;
  const status = h('span', { class: 'efl-player__status', 'aria-live': 'polite' }, t('audio.ready'));
  const playBtn = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'player-play' }, '▶ ', t('audio.play'));
  const player = new SegmentPlayer(lines, {
    onSegment: (i) => {
      status.textContent = t('audio.segment', { n: i + 1, total: lines.length });
      list.querySelectorAll('li').forEach((li, k) => li.classList.toggle('is-current', k === i));
    },
    onState: (s) => {
      const playing = s === 'playing';
      playBtn.textContent = playing ? `⏸ ${t('audio.pause')}` : `▶ ${t('audio.play')}`;
      playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      if (playing) { ctx.timer.hold(); } else { ctx.timer.release(); }
      if (s === 'ended') { status.textContent = t('audio.ended'); }
      if (s === 'paused') { status.textContent = t('audio.paused'); }
    }
  });
  player.rate = ctx.store.state.settings.rate;
  const first = () => { if (!played) { played = true; if (onFirstPlay) { onFirstPlay(); } } };
  playBtn.addEventListener('click', () => {
    if (player.playing) { player.stop(); return; }
    first();
    player.play();
  });
  const btn = (label, aria, fn, testid) => {
    const b = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost', 'aria-label': aria, 'data-testid': testid }, label);
    b.addEventListener('click', () => { first(); fn(); });
    return b;
  };
  const controls = h('div', { class: 'efl-player__controls', role: 'group', 'aria-label': t('audio.controls') },
    playBtn,
    btn('⏮', t('audio.prev'), () => player.prev(), 'player-prev'),
    btn('🔁', t('audio.repeatSegment'), () => player.replaySegment(), 'player-repeat'),
    btn('⏭', t('audio.next'), () => player.next(), 'player-next'),
    btn('↺', t('audio.restart'), () => player.restart(), 'player-restart'),
    speedSelect(player.rate, (r) => { player.rate = r; }),
    status
  );
  const list = transcriptList(lines, ctx, (i) => { first(); player.playFrom(i, { single: true }); });
  const tid = nextId('tr');
  list.id = tid;
  const toggle = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost', 'aria-expanded': String(transcript), 'aria-controls': tid, 'data-testid': 'transcript-toggle' });
  const setT = (on) => {
    list.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
    toggle.textContent = on ? t('audio.hideTranscript') : t('audio.showTranscript');
  };
  toggle.addEventListener('click', () => setT(list.hidden));
  setT(transcript);
  wrap.append(controls, toggle, list);
  wrap.player = player;
  return wrap;
}

function transcriptList(lines, ctx, onPlayLine) {
  const es = ctx.esOn();
  return h('ol', { class: 'efl-transcript' }, lines.map((ln, i) => h('li', null,
    h('button', { type: 'button', class: 'efl-linkbtn', 'aria-label': `${t('audio.playLine')} ${i + 1}`, onclick: () => onPlayLine(i) }, '▶'),
    h('strong', null, `${ln.speaker}: `),
    h('span', { lang: 'en' }, ln.text),
    es && ln.es ? h('span', { class: 'efl-es', lang: 'es' }, ln.es) : null
  )));
}

/* ---- consent ------------------------------------------------------------ */
function consentBox(ctx, onAccept) {
  const box = h('div', { class: 'efl-consent', role: 'region', 'aria-label': t('mic.consentTitle') },
    h('h4', null, t('mic.consentTitle')),
    h('p', null, t('mic.consentBody')),
    h('ul', null, h('li', null, t('mic.consent1')), h('li', null, t('mic.consent2')), h('li', null, t('mic.consent3'))));
  const yes = h('button', { type: 'button', class: 'efl-btn efl-btn--primary', 'data-testid': 'mic-consent' }, t('mic.accept'));
  yes.addEventListener('click', () => {
    ctx.store.update((s) => { s.settings.micConsent = true; });
    onAccept();
  });
  box.append(yes);
  return box;
}

/* ---- recorder ------------------------------------------------------------
   opts: key (storage key), maxSeconds, modelText (for compare),
         targetSeconds [min,max] (shows guidance), onRecorded(result),
         attempt {lessonId, activityId}: every real recording is logged as a
         practice attempt (no score: a recording is not graded)            */
export function recorderPanel(ctx, opts = {}) {
  const wrap = h('div', { class: 'efl-recorder' });
  const { maxSeconds = 60, modelText, targetSeconds, onRecorded, key, attempt } = opts;

  if (!recordingSupported()) {
    wrap.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'note' }, t('mic.unsupported')));
    const b = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'practised-aloud' }, t('mic.practisedAloud'));
    b.addEventListener('click', () => {
      b.disabled = true;
      b.textContent = `✓ ${t('mic.practisedAloudDone')}`;
      if (onRecorded) { onRecorded({ fallback: true }); }
    });
    wrap.append(b);
    return wrap;
  }

  const body = h('div', { class: 'efl-recorder__body' });
  wrap.append(body);

  const render = () => {
    clear(body);
    if (!ctx.store.state.settings.micConsent) {
      body.append(consentBox(ctx, render));
      return;
    }
    const recBtn = h('button', { type: 'button', class: 'efl-btn efl-btn--rec', 'aria-pressed': 'false', 'data-testid': 'rec-toggle' }, '● ', t('mic.record'));
    const time = h('span', { class: 'efl-recorder__time', 'aria-live': 'off' }, '0.0 s');
    const meter = h('span', { class: 'efl-meter', role: 'img', 'aria-label': t('mic.level') }, h('span', { class: 'efl-meter__bar' }));
    const out = h('div', { class: 'efl-recorder__out', 'aria-live': 'polite' });
    const guide = targetSeconds ? h('p', { class: 'efl-small efl-muted' }, t('mic.target', { min: targetSeconds[0], max: targetSeconds[1] })) : null;
    body.append(guide, h('div', { class: 'efl-recorder__row' }, recBtn, time, meter), out);

    let ctl = null;
    let raf = 0;
    const loop = () => {
      if (!ctl) { return; }
      time.textContent = `${ctl.elapsed().toFixed(1)} s`;
      const lv = ctl.level();
      meter.firstChild.style.width = lv == null ? '0%' : `${Math.round(lv * 100)}%`;
      raf = requestAnimationFrame(loop);
    };
    const finished = (res) => {
      if (!ctl) { return; }
      ctl = null;
      cancelAnimationFrame(raf);
      ctx.timer.release();
      recBtn.setAttribute('aria-pressed', 'false');
      recBtn.textContent = `● ${t('mic.recordAgain')}`;
      recBtn.classList.remove('is-recording');
      meter.firstChild.style.width = '0%';
      showResult(res);
    };
    const showResult = (res) => {
      clear(out);
      const audio = h('audio', { controls: true, src: res.url, 'data-testid': 'my-recording', preload: 'auto' });
      /* Chrome's MediaRecorder WebM has no duration header, so the native
         player shows 0:00. Seeking far forward forces it to compute the
         real duration; then we rewind. */
      audio.addEventListener('loadedmetadata', () => {
        if (audio.duration === Infinity || Number.isNaN(audio.duration)) {
          const fix = () => { audio.removeEventListener('durationchange', fix); audio.currentTime = 0; };
          audio.addEventListener('durationchange', fix);
          audio.currentTime = 1e101;
        }
      });
      const secs = res.seconds;
      let attemptNo = null;
      if (attempt) {
        ctx.store.update((s) => {
          attemptNo = recordActivity(s, attempt.lessonId, attempt.activityId, { score: 0, max: 0, source: 'practice', skill: null, detail: { seconds: Math.round(secs * 10) / 10 } }).attempts;
        });
      }
      const items = [h('p', { class: 'efl-small', 'data-testid': 'rec-info' }, attemptNo ? `${t('mic.attempt', { n: attemptNo })} · ` : '', t('mic.recorded', { s: secs.toFixed(1) })), audio];
      if (targetSeconds) {
        const ok = secs >= targetSeconds[0] && secs <= targetSeconds[1] + 5;
        items.push(h('p', { class: ok ? 'efl-ok efl-small' : 'efl-warn efl-small' }, ok ? t('mic.durationOk') : t('mic.durationOff', { min: targetSeconds[0], max: targetSeconds[1] })));
      }
      if (modelText && ttsSupported()) {
        const cmp = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'compare' }, '⇄ ', t('mic.compare'));
        cmp.addEventListener('click', async () => {
          ctx.timer.hold();
          try {
            await speak(modelText, { rate: ctx.store.state.settings.rate });
            audio.currentTime = 0;
            await audio.play().catch(() => {});
          } finally { ctx.timer.release(); }
        });
        items.push(h('div', { class: 'efl-recorder__row' }, listenButtons(modelText, ctx, { slow: true, label: t('mic.model') }), cmp));
      }
      const del = h('button', { type: 'button', class: 'efl-btn efl-btn--ghost' }, t('mic.delete'));
      del.addEventListener('click', () => { URL.revokeObjectURL(res.url); clear(out); out.append(h('p', { class: 'efl-small efl-muted' }, t('mic.deleted'))); });
      items.push(del);
      out.append(...items);
      announce(t('mic.recordedAnnounce'));
      ctx.store.update((s) => { s.badges.firstRecording = s.badges.firstRecording || new Date().toISOString(); });
      if (ctx.store.state.settings.saveRecordings && key) {
        saveRecording(`${ctx.profileId || 'default'}/${key}`, res.blob, { seconds: secs }).catch(() => {});
      }
      if (onRecorded) { onRecorded(res); }
    };
    recBtn.addEventListener('click', async () => {
      if (ctl) {
        finished(await ctl.stop());
        return;
      }
      stopSpeaking();
      try {
        ctl = await startRecording({ maxSeconds, onAutoStop: finished });
      } catch (e) {
        clear(out);
        out.append(h('p', { class: 'efl-notice efl-notice--warn', role: 'alert' }, e && e.name === 'NotAllowedError' ? t('mic.denied') : t('mic.error', { msg: e.message || e.name })));
        const b = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'practised-aloud' }, t('mic.practisedAloud'));
        b.addEventListener('click', () => { b.disabled = true; if (onRecorded) { onRecorded({ fallback: true }); } });
        out.append(b);
        return;
      }
      ctx.timer.hold();
      recBtn.setAttribute('aria-pressed', 'true');
      recBtn.classList.add('is-recording');
      recBtn.textContent = `■ ${t('mic.stop')}`;
      announce(t('mic.recording'));
      loop();
    });
  };
  render();
  /* once consent is given in any recorder, the others update too */
  if (!ctx.store.state.settings.micConsent) {
    const off = ctx.store.subscribe((st) => {
      if (!wrap.isConnected && wrap.dataset.mounted) { off(); return; }
      if (wrap.isConnected) { wrap.dataset.mounted = '1'; }
      if (st.settings.micConsent && body.querySelector('.efl-consent')) { off(); render(); }
    });
  }
  return wrap;
}

/* ---- speech recognition check -------------------------------------------
   Shows target vs recognised words. tips: { word: 'tip text' }.
   onResult({ matched, total, transcript }) */
export function asrPanel(target, ctx, { tips = {}, onResult } = {}) {
  const wrap = h('div', { class: 'efl-asr' });
  if (!asrSupported()) {
    wrap.append(h('p', { class: 'efl-notice', role: 'note' }, t('asr.unsupported')));
    return wrap;
  }
  const out = h('div', { class: 'efl-asr__out', 'aria-live': 'polite' });
  const btn = h('button', { type: 'button', class: 'efl-btn', 'data-testid': 'asr-check' }, '🎙 ', t('asr.check'));
  const notice = h('p', { class: 'efl-small efl-muted' }, t('asr.privacy'));
  btn.addEventListener('click', async () => {
    stopSpeaking();
    btn.disabled = true;
    clear(out);
    out.append(h('p', { class: 'efl-small' }, t('asr.listening')));
    ctx.timer.hold();
    try {
      const res = await recognizeOnce();
      const al = alignWords(target, res.transcript);
      clear(out);
      out.append(
        h('p', { class: 'efl-small' }, h('strong', null, t('asr.target')), ' ',
          h('span', { lang: 'en', class: 'efl-words' }, al.words.map((w) => h('span', { class: w.recognised ? 'efl-word efl-word--ok' : 'efl-word efl-word--miss' }, w.recognised ? w.word : `${w.word}?`)))),
        h('p', { class: 'efl-small' }, h('strong', null, t('asr.heard')), ' ', h('q', { lang: 'en', 'data-testid': 'asr-transcript' }, res.transcript || '…')),
        h('p', { class: 'efl-small' }, t('asr.summary', { n: al.matchedCount, total: al.total }))
      );
      const missed = al.words.filter((w) => !w.recognised).map((w) => w.word);
      const tipList = [...new Set(missed)].filter((w) => tips[w]).map((w) => h('li', null, h('strong', { lang: 'en' }, w), ': ', pick(tips[w], ctx.lang())));
      if (missed.length) {
        out.append(h('p', { class: 'efl-small' }, t('asr.review', { words: [...new Set(missed)].join(', ') })));
      }
      if (tipList.length) { out.append(h('ul', { class: 'efl-tips' }, tipList)); }
      out.append(h('p', { class: 'efl-small efl-muted' }, t('asr.caveat')));
      announce(t('asr.summary', { n: al.matchedCount, total: al.total }));
      if (onResult) { onResult({ matched: al.matchedCount, total: al.total, transcript: res.transcript }); }
    } catch (e) {
      clear(out);
      const msg = e.message === 'not-allowed' ? t('asr.notAllowed') : e.message === 'network' ? t('asr.network') : t('asr.noSpeech');
      out.append(h('p', { class: 'efl-warn efl-small', role: 'alert' }, msg));
    } finally {
      ctx.timer.release();
      btn.disabled = false;
    }
  });
  wrap.append(btn, notice, out);
  return wrap;
}

/* Listen + record + compare + optional ASR for one phrase. */
export function repeatCard(phrase, ctx, { key, tips, onPractised, attempt } = {}) {
  const es = ctx.esOn();
  let done = false;
  const mark = () => { if (!done) { done = true; card.classList.add('is-done'); if (onPractised) { onPractised(); } } };
  const card = h('div', { class: 'efl-repeat' },
    h('p', { class: 'efl-repeat__text', lang: 'en' }, phrase.text),
    phrase.ipa ? h('p', { class: 'efl-ipa' }, phrase.ipa) : null,
    es && phrase.es ? h('p', { class: 'efl-es', lang: 'es' }, phrase.es) : null,
    listenButtons(phrase.text, ctx),
    recorderPanel(ctx, { key, attempt, maxSeconds: 15, modelText: phrase.text, onRecorded: mark }),
    asrPanel(phrase.text, ctx, { tips, onResult: (r) => { mark(); if (phrase.onAsr) { phrase.onAsr(r); } } })
  );
  return card;
}
