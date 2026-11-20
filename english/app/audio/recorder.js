/* =========================================================================
   recorder.js — microphone recording (getUserMedia + MediaRecorder).

   - The microphone is requested only after the learner presses "Record"
     and has accepted the in-app explanation (consent stored in settings).
   - Audio stays on this device. By default recordings live only in memory
     for the current page; if the learner opts in, they are also saved in
     IndexedDB (recording-db.js) and can be deleted at any time.
   - The stream is stopped as soon as a recording ends, so the browser's
     microphone indicator turns off.
   ========================================================================= */

export function recordingSupported() {
  return !!(typeof navigator !== 'undefined' && navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia && typeof window.MediaRecorder === 'function');
}

function pickMime() {
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (!window.MediaRecorder.isTypeSupported) { return ''; }
  return cands.find((c) => window.MediaRecorder.isTypeSupported(c)) || '';
}

/* Start a recording. Returns a controller:
     { stop(): Promise<{blob, url, seconds}>, level(): 0..1, cancel() }
   maxSeconds stops automatically. */
export async function startRecording({ maxSeconds = 60, onAutoStop } = {}) {
  if (!recordingSupported()) { throw new Error('recording-unsupported'); }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = pickMime();
  const rec = new window.MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) { chunks.push(e.data); } };

  /* Live input level (real signal, RMS of the waveform) so learners can
     see the microphone is picking them up. */
  let analyser = null;
  let ctx = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
    }
  } catch (e) { analyser = null; }
  const buf = analyser ? new Uint8Array(analyser.fftSize) : null;

  const started = performance.now();
  rec.start(250);
  let stopped = null;
  let timer = null;

  const cleanup = () => {
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    if (ctx) { ctx.close().catch(() => {}); }
  };

  const stop = () => {
    if (stopped) { return stopped; }
    stopped = new Promise((resolve) => {
      rec.onstop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
        resolve({ blob, url: URL.createObjectURL(blob), seconds: (performance.now() - started) / 1000 });
      };
      if (rec.state !== 'inactive') { rec.stop(); } else { rec.onstop(); }
    });
    return stopped;
  };

  timer = setTimeout(() => { stop().then((r) => onAutoStop && onAutoStop(r)); }, maxSeconds * 1000);

  return {
    stop,
    cancel: () => { stop(); },
    elapsed: () => (performance.now() - started) / 1000,
    level: () => {
      if (!analyser) { return null; }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }
  };
}
