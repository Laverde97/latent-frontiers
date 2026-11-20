/* =========================================================================
   asr.js — optional speech recognition (Web Speech API).

   Availability varies: Chromium-based browsers and Safari expose
   (webkit)SpeechRecognition; Firefox does not. In some browsers (e.g.
   Google Chrome) the audio is sent to the vendor's servers to be
   transcribed — the UI says so before first use.

   The result is a transcript. We compare it with the target words
   (scoring.alignWords) and never turn it into a "pronunciation score".
   ========================================================================= */

export function asrSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/* Listen once; resolves { transcript, alternatives } or rejects with an
   Error whose message is the API error code (e.g. 'no-speech',
   'not-allowed', 'network'). */
export function recognizeOnce({ lang = 'en-US', timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!asrSupported()) { reject(new Error('asr-unsupported')); return; }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 3;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(t); fn(v); } };
    const t = setTimeout(() => { try { r.abort(); } catch (e) { /* ignore */ } finish(reject, new Error('timeout')); }, timeoutMs);
    r.onresult = (e) => {
      const res = e.results[0];
      const alternatives = [];
      for (let i = 0; i < res.length; i++) { alternatives.push(res[i].transcript); }
      finish(resolve, { transcript: alternatives[0] || '', alternatives });
    };
    r.onerror = (e) => finish(reject, new Error(e.error || 'error'));
    r.onend = () => finish(reject, new Error('no-speech'));
    r.start();
  });
}
