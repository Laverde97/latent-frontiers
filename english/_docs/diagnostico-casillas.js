/* English Fluency Lab — diagnóstico de las casillas en TU navegador.
   Solo lee estilos (no envía nada, no cambia nada, no lee datos personales).
   Uso: abre «Cuenta y perfiles», pulsa F12 → Console, pega TODO este bloque
   y pulsa Enter. Copia el resultado (se copia solo al portapapeles). */
(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) { return { presente: false }; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const row = el.closest('.efl-check-row');
    const filters = [];
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.filter !== 'none' || c.mixBlendMode !== 'normal' || Number(c.opacity) < 1) { filters.push(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}: filter=${c.filter} blend=${c.mixBlendMode} opacity=${c.opacity}`); }
    }
    return {
      presente: true, marcada: el.checked, invalida: el.getAttribute('aria-invalid') === 'true',
      tamaño: `${r.width.toFixed(1)}×${r.height.toFixed(1)}`, appearance: cs.appearance,
      borde: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, relleno: cs.backgroundColor,
      anillo: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, opacidad: cs.opacity, visibilidad: cs.visibility,
      fondoFila: row ? getComputedStyle(row).backgroundColor : null, colorTexto: row && row.querySelector('label') ? getComputedStyle(row.querySelector('label')).color : null,
      filtrosEnAncestros: filters
    };
  };
  const sheets = [...document.styleSheets].map((s) => s.href || '(inline)');
  const out = {
    eflCss: sheets.filter((h) => h.includes('efl.css')),
    hojasAjenas: sheets.filter((h) => h !== '(inline)' && !h.startsWith(location.origin)).length,
    estilosInyectados: document.querySelectorAll('style:not([id^="quarto"])').length,
    modoOscuroExtension: !!document.documentElement.getAttribute('data-darkreader-scheme') || !!document.querySelector('style.darkreader'),
    zoomAprox: Math.round(window.devicePixelRatio * 100) + '%',
    coloresForzados: matchMedia('(forced-colors: active)').matches,
    esquema: matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro',
    contraste: matchMedia('(prefers-contrast: more)').matches ? 'alto' : 'normal',
    edad: pick('[data-testid="signin-adult"]'),
    datos: pick('[data-testid="signin-terms"]')
  };
  const text = JSON.stringify(out, null, 2);
  try { copy(text); } catch { /* copy() only exists in DevTools */ }
  console.log(text);
  return 'Diagnóstico copiado al portapapeles';
})();
