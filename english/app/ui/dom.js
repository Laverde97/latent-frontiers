/* =========================================================================
   dom.js — tiny DOM helpers (no framework).
   h('button', {class: 'x', onclick: fn, 'aria-label': '…'}, 'text', child)
   ========================================================================= */

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) { continue; }
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'class') {
        el.className = v;
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, v);
      }
    }
  }
  append(el, children);
  return el;
}

/* Safe version of el.append(...): the native DOM method turns null /
   undefined / false into the literal text "null" / "undefined" / "false".
   Use add() whenever a child may be absent. */
export function add(el, ...children) {
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) { continue; }
    if (Array.isArray(c)) { append(el, c); } else if (c instanceof Node) { el.appendChild(c); } else { el.appendChild(document.createTextNode(String(c))); }
  }
}

export function clear(el) {
  while (el.firstChild) { el.removeChild(el.firstChild); }
  return el;
}

let liveRegion = null;
export function setLiveRegion(el) { liveRegion = el; }

/* Screen-reader announcement (polite). */
export function announce(msg) {
  if (!liveRegion) { return; }
  liveRegion.textContent = '';
  setTimeout(() => { liveRegion.textContent = msg; }, 50);
}

let uid = 0;
export function nextId(prefix = 'efl') {
  uid += 1;
  return `${prefix}-${uid}`;
}

export function pct(x) {
  return x == null ? '—' : `${Math.round(x * 100)} %`;
}

/* Bilingual content field: { en, es } or a plain string. */
export function pick(field, lang) {
  if (field == null) { return ''; }
  if (typeof field === 'string') { return field; }
  return field[lang] || field.en || field.es || '';
}
