/* English Fluency Lab — evidencia de sincronización (SOLO LECTURA).
   Uso: en «Cuenta y perfiles», F12 → Console, pega TODO el bloque y Enter.
   Muestra el estado y una HUELLA del progreso: si Chrome y Edge muestran la
   misma huella y la misma revisión, tienen exactamente el mismo progreso.
   Después vigila 60 s cuántas escrituras al servidor ocurren (en reposo
   deben ser 0). No lee la sesión ni tokens, no imprime correos ni enlaces,
   no envía nada y no cambia nada. El resultado se copia al portapapeles. */
(async () => {
  const efl = window.__efl;
  if (!efl || !efl.store) { return 'Abre English Fluency Lab (página de la app) y vuelve a pegarlo.'; }
  const { canonicalJSON, summarize } = await import(new URL('app/core/sync.js', document.baseURI).href);
  const state = efl.store.state;
  const shared = canonicalJSON({ ...state, settings: undefined, updatedAt: undefined });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shared));
  const huella = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
  const id = efl.ctx.profileId;
  const perfil = efl.ctx.profiles.active();
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(`efl-sync:${id}`) || 'null'); } catch { meta = null; }
  const acts = Object.values(state.lessons || {}).reduce((n, l) => n + Object.keys(l.activities || {}).length, 0);
  const out = {
    navegador: /Edg\//.test(navigator.userAgent) ? 'Edge' : /Chrome\//.test(navigator.userAgent) ? 'Chrome' : 'otro',
    hora: new Date().toLocaleString(),
    perfil: perfil && perfil.name,
    vinculado: !!(perfil && perfil.account),
    estado: efl.ctx.account ? efl.ctx.account.status : 'sin cuentas',
    revision: meta ? meta.rev : null,
    cambiosSinSubir: meta ? !!meta.dirty : null,
    ultimaSincronizacion: meta && meta.lastSyncedAt ? new Date(meta.lastSyncedAt).toLocaleString() : null,
    huella,
    resumen: { ...summarize(state), actividades: acts },
    escriturasEn60s: 'midiendo…'
  };
  console.log(JSON.stringify(out, null, 2));
  /* count server writes for 60 s (resource timing: only URL path + method-free) */
  const isWrite = (u) => /\/rest\/v1\/rpc\/efl_save_state|\/rest\/v1\/rpc\/efl_delete/.test(u);
  const isRead = (u) => /\/rest\/v1\/efl_learner_state/.test(u);
  let writes = 0; let reads = 0;
  const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) { if (isWrite(e.name)) { writes++; } else if (isRead(e.name)) { reads++; } } });
  po.observe({ type: 'resource', buffered: false });
  await new Promise((r) => setTimeout(r, 60000));
  po.disconnect();
  out.escriturasEn60s = writes;
  out.lecturasEn60s = reads;
  const text = JSON.stringify(out, null, 2);
  try { copy(text); } catch { /* copy() only exists in DevTools */ }
  console.log(text);
  return 'Listo: resultado copiado al portapapeles';
})();
