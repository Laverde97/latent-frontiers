/* =========================================================================
   tts.js — text-to-speech through the browser's speechSynthesis.

   Audio in this release is SYNTHETIC: it comes from the voices installed
   in the learner's browser/OS. We list a voice's declared language tag
   (e.g. en-GB) exactly as the browser reports it and never claim an accent
   beyond that tag.
   ========================================================================= */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

export function ttsSupported() {
  return !!synth && typeof window.SpeechSynthesisUtterance === 'function';
}

let voicesPromise = null;
export function getEnglishVoices() {
  if (!ttsSupported()) { return Promise.resolve([]); }
  if (!voicesPromise) {
    voicesPromise = new Promise((resolve) => {
      const pick = () => synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
      const now = pick();
      if (now.length) { resolve(now); return; }
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(pick()); } };
      synth.addEventListener && synth.addEventListener('voiceschanged', finish, { once: true });
      setTimeout(finish, 1500);
    });
  }
  return voicesPromise;
}

let preferredURI = null;
let defaultRate = 0.9;
export function configureTTS({ voiceURI, rate } = {}) {
  if (voiceURI !== undefined) { preferredURI = voiceURI; }
  if (rate) { defaultRate = rate; }
}

async function chooseVoice(langHint) {
  const voices = await getEnglishVoices();
  if (!voices.length) { return null; }
  if (preferredURI) {
    const v = voices.find((x) => x.voiceURI === preferredURI);
    if (v) { return v; }
  }
  if (langHint) {
    const v = voices.find((x) => x.lang.replace('_', '-').toLowerCase() === langHint.toLowerCase());
    if (v) { return v; }
  }
  return voices.find((x) => /en-US/i.test(x.lang)) || voices[0];
}

/* Speak text; resolves when finished or cancelled. Hooks let the UI show
   which segment is playing and keep the practice timer active. */
export const ttsHooks = { onStart: null, onEnd: null };

export async function speak(text, { rate, lang } = {}) {
  if (!ttsSupported()) { throw new Error('tts-unsupported'); }
  const voice = await chooseVoice(lang);
  return new Promise((resolve) => {
    const u = new window.SpeechSynthesisUtterance(text);
    u.rate = rate || defaultRate;
    u.lang = voice ? voice.lang : (lang || 'en-US');
    if (voice) { u.voice = voice; }
    let settled = false;
    const end = (reason) => {
      if (settled) { return; }
      settled = true;
      if (ttsHooks.onEnd) { ttsHooks.onEnd(); }
      resolve(reason);
    };
    u.onend = () => end('ended');
    u.onerror = (e) => end(e && e.error === 'interrupted' ? 'cancelled' : 'error');
    if (ttsHooks.onStart) { ttsHooks.onStart(text); }
    synth.speak(u);
  });
}

export function stopSpeaking() {
  if (ttsSupported()) { synth.cancel(); }
}

/* Sequential player for multi-line audio (dialogues). Pause is
   implemented as "stop after/at the current segment and resume from it",
   because native speechSynthesis.pause() is unreliable across browsers. */
export class SegmentPlayer {
  constructor(lines, { onSegment, onState } = {}) {
    this.lines = lines;
    this.index = 0;
    this.playing = false;
    this.rate = defaultRate;
    this.onSegment = onSegment || (() => {});
    this.onState = onState || (() => {});
    this.runId = 0;
  }

  async playFrom(i = this.index, { single = false } = {}) {
    this.stop(false);
    const run = ++this.runId;
    this.playing = true;
    this.onState('playing');
    for (let k = i; k < this.lines.length; k++) {
      if (run !== this.runId) { return; }
      this.index = k;
      this.onSegment(k);
      const r = await speak(this.lines[k].text, { rate: this.rate, lang: this.lines[k].lang });
      if (run !== this.runId || r === 'cancelled') { return; }
      if (single) { break; }
      await new Promise((res) => setTimeout(res, 350));
    }
    if (run === this.runId) {
      this.playing = false;
      this.onState('ended');
    }
  }

  play() { return this.playFrom(this.index >= this.lines.length - 1 && !this.playing ? 0 : this.index); }
  replaySegment() { return this.playFrom(this.index, { single: true }); }
  next() { this.index = Math.min(this.lines.length - 1, this.index + 1); return this.playFrom(this.index, { single: true }); }
  prev() { this.index = Math.max(0, this.index - 1); return this.playFrom(this.index, { single: true }); }
  restart() { this.index = 0; return this.playFrom(0); }

  stop(notify = true) {
    this.runId++;
    stopSpeaking();
    this.playing = false;
    if (notify) { this.onState('paused'); }
  }
}
