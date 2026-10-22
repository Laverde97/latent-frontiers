/* =========================================================================
   ltc-lab.js — Laboratorio interactivo del artículo sobre LTC.
   Sin dependencias. Solo actúa si encuentra #ltc-lab-tau y #ltc-lab-state.

   Simulador 1: constante de tiempo efectiva τ_sys = τ / (1 + τ f).
   Simulador 2: trayectorias con f CONGELADA (simplificación explícita):
     CT-RNN  dx/dt = −x/τ + f              →  x(t) = x* + (x0 − x*) e^(−t/τ),      x* = τ f
     LTC     dx/dt = −(1/τ + f) x + f A    →  x(t) = x* + (x0 − x*) e^(−t/τ_sys),  x* = τ_sys f A
   y los pasos de la Ec. (3) (Fused ODE Solver) con la misma f fija.
   Con f ≥ 0 y x0 ∈ [min(0, A), max(0, A)] la trayectoria LTC no sale de ese
   intervalo (hipótesis del Teorema 2); por eso x0 se restringe a él.
   ========================================================================= */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var COLOR_LTC = '#2E6DB4';
  var COLOR_CTRNN = '#C2410C';

  /* Números con coma decimal y signo menos tipográfico, como el resto del artículo */
  function fmt(value, digits) {
    var text = value.toFixed(digits).replace('.', ',');
    return text.charAt(0) === '-' ? '−' + text.slice(1) : text;
  }

  function tauSys(tau, f) {
    var denominator = 1 + tau * f;
    return denominator > 0 ? tau / denominator : NaN; // con f ∈ [0, 1] y τ > 0 siempre es > 0
  }

  function bindRange(root, name, onInput) {
    var input = root.querySelector('[data-param="' + name + '"]');
    var output = root.querySelector('[data-out="' + name + '"]');
    var digits = Number(input.getAttribute('data-digits') || 2);
    function sync() {
      output.textContent = fmt(Number(input.value), digits);
      input.setAttribute('aria-valuetext', output.textContent);
    }
    input.addEventListener('input', function () { sync(); onInput(); });
    sync();
    return { input: input, sync: sync, get: function () { return Number(input.value); } };
  }

  function el(tag, attrs, parent) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceTicks(min, max, count) {
    var span = max - min || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = span / count / step;
    step *= err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    var ticks = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < 1e-12 ? 0 : v);
    return ticks;
  }

  /* ---------------- Simulador 1: τ_sys ---------------- */
  function initTauLab(root) {
    var tau, f;
    var out = root.querySelector('[data-out="tausys"]');
    var ratio = root.querySelector('[data-out="ratio"]');
    var text = root.querySelector('[data-out="explain"]');
    var barTau = root.querySelector('[data-bar="tau"]');
    var barSys = root.querySelector('[data-bar="tausys"]');
    var labelTau = root.querySelector('[data-bar-label="tau"]');
    var labelSys = root.querySelector('[data-bar-label="tausys"]');
    var maxTau = 5;

    function update() {
      var t = tau.get(), fv = f.get();
      var ts = tauSys(t, fv);
      out.textContent = fmt(ts, 2);
      ratio.textContent = fmt(ts / t, 2);
      barTau.style.width = (100 * t / maxTau) + '%';
      barSys.style.width = (100 * ts / maxTau) + '%';
      labelTau.textContent = fmt(t, 2);
      labelSys.textContent = fmt(ts, 2);
      if (fv === 0) {
        text.innerHTML = 'Con <i>f</i> = 0 no hay modulación: τ<sub>sys</sub> = τ = ' + fmt(t, 2) +
          '. La neurona se comporta como una unidad con fuga pasiva, igual que en una CT-RNN.';
      } else {
        // Solo se insertan números formateados: no hay texto del usuario en innerHTML
        text.innerHTML = 'Con <i>f</i> = ' + fmt(fv, 2) + ', el denominador vale 1 + τ<i>f</i> = ' + fmt(1 + t * fv, 2) +
          ', mayor que 1, así que τ<sub>sys</sub> = ' + fmt(ts, 2) + ' es menor que τ: con <i>f</i> fija en este valor, la neurona responde ' +
          fmt(t / ts, 2) + ' veces más rápido que con <i>f</i> = 0. Dentro de <i>f</i> ∈ [0, 1], aumentar <i>f</i> siempre reduce τ<sub>sys</sub>.';
      }
    }

    tau = bindRange(root, 'tau', update);
    f = bindRange(root, 'f', update);
    root.querySelector('[data-action="reset"]').addEventListener('click', function () {
      tau.input.value = tau.input.defaultValue;
      f.input.value = f.input.defaultValue;
      tau.sync(); f.sync(); update();
    });
    update();
  }

  /* ---------------- Simulador 2: evolución del estado ---------------- */
  function initStateLab(root) {
    var chart = root.querySelector('[data-chart]');
    var tooltip = root.querySelector('[data-tooltip]');
    var tableBody = root.querySelector('[data-table] tbody');
    var showSteps = root.querySelector('[data-param="steps"]');
    var showBand = root.querySelector('[data-param="band"]');
    var outs = {};
    ['tausys', 'targetLtc', 'targetCt', 'first', 'exact', 'interval'].forEach(function (key) {
      outs[key] = root.querySelector('[data-out="' + key + '"]');
    });
    var p = {};
    var state = null;

    function clampX0() {
      // Hipótesis del Teorema 2: x(0) dentro de [min(0, A), max(0, A)]
      var a = p.A.get();
      var lo = Math.min(0, a), hi = Math.max(0, a);
      p.x0.input.min = lo.toFixed(2);
      p.x0.input.max = hi.toFixed(2);
      var x0 = Math.min(hi, Math.max(lo, p.x0.get()));
      p.x0.input.value = x0;
      p.x0.input.disabled = lo === hi;
      p.x0.sync();
      outs.interval.textContent = '[' + fmt(lo, 2) + ', ' + fmt(hi, 2) + ']';
    }

    function compute() {
      var tau = p.tau.get(), f = p.f.get(), A = p.A.get(), x0 = p.x0.get(), dt = p.dt.get();
      var ts = tauSys(tau, f);
      var targetLtc = ts * f * A;
      var targetCt = tau * f;
      var tMax = Math.min(25, 5 * tau);
      var n = 240, ltc = [], ct = [], steps = [];
      for (var i = 0; i <= n; i++) {
        var t = tMax * i / n;
        ltc.push([t, targetLtc + (x0 - targetLtc) * Math.exp(-t / ts)]);
        ct.push([t, targetCt + (x0 - targetCt) * Math.exp(-t / tau)]);
      }
      // Ec. (3) con f fija: x ← (x + Δt f A) / (1 + Δt (1/τ + f))
      var x = x0;
      for (var k = 0; k * dt <= tMax + 1e-9; k++) {
        steps.push([k * dt, x]);
        x = (x + dt * f * A) / (1 + dt * (1 / tau + f));
      }
      return { tau: tau, f: f, A: A, x0: x0, dt: dt, ts: ts, targetLtc: targetLtc, targetCt: targetCt,
               tMax: tMax, ltc: ltc, ct: ct, steps: steps };
    }

    function draw() {
      var s = state;
      var width = Math.max(280, chart.clientWidth);
      var height = Math.round(Math.min(340, Math.max(230, width * 0.52)));
      var m = { l: 46, r: 14, t: 14, b: 42 };
      var lo = Math.min(0, s.A), hi = Math.max(0, s.A);
      var ys = [lo, hi, s.x0, s.targetCt, s.targetLtc];
      var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
      if (yMax - yMin < 0.2) { yMax += 0.1; yMin -= 0.1; }
      var pad = (yMax - yMin) * 0.08;
      yMin -= pad; yMax += pad;
      function X(t) { return m.l + (width - m.l - m.r) * t / s.tMax; }
      function Y(v) { return m.t + (height - m.t - m.b) * (yMax - v) / (yMax - yMin); }

      chart.textContent = '';
      var svg = el('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
        role: 'img', 'aria-labelledby': 'ltc-lab-state-title' }, chart);

      // Intervalo del Teorema 2 (solo LTC)
      if (showBand.checked && hi > lo) {
        el('rect', { x: m.l, y: Y(hi), width: width - m.l - m.r, height: Y(lo) - Y(hi),
          fill: COLOR_LTC, 'fill-opacity': 0.08 }, svg);
      }
      // Rejilla y ejes
      niceTicks(yMin, yMax, 5).forEach(function (v) {
        el('line', { x1: m.l, x2: width - m.r, y1: Y(v), y2: Y(v), stroke: '#E2E8F0', 'stroke-width': 1 }, svg);
        var label = el('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: '#6B7280' }, svg);
        label.textContent = fmt(v, 1);
      });
      niceTicks(0, s.tMax, 6).forEach(function (t) {
        var label = el('text', { x: X(t), y: height - m.b + 18, 'text-anchor': 'middle', 'font-size': 12, fill: '#6B7280' }, svg);
        label.textContent = fmt(t, 0);
      });
      el('line', { x1: m.l, x2: width - m.r, y1: height - m.b, y2: height - m.b, stroke: '#9CA3AF', 'stroke-width': 1 }, svg);
      var xLabel = el('text', { x: (m.l + width - m.r) / 2, y: height - 6, 'text-anchor': 'middle', 'font-size': 12, fill: '#6B7280' }, svg);
      xLabel.textContent = 't (unidades de tiempo)';
      var yLabel = el('text', { x: 12, y: (m.t + height - m.b) / 2, 'text-anchor': 'middle', 'font-size': 12, fill: '#6B7280',
        transform: 'rotate(-90 12 ' + (m.t + height - m.b) / 2 + ')' }, svg);
      yLabel.textContent = 'estado x(t)';

      function path(points) {
        return points.map(function (pt, i) { return (i ? 'L' : 'M') + X(pt[0]).toFixed(1) + ' ' + Y(pt[1]).toFixed(1); }).join(' ');
      }
      el('path', { d: path(s.ct), fill: 'none', stroke: COLOR_CTRNN, 'stroke-width': 2, 'stroke-dasharray': '6 4',
        'stroke-linecap': 'round', 'data-series': 'ctrnn' }, svg);
      el('path', { d: path(s.ltc), fill: 'none', stroke: COLOR_LTC, 'stroke-width': 2, 'stroke-linejoin': 'round',
        'stroke-linecap': 'round', 'data-series': 'ltc' }, svg);
      if (showSteps.checked) {
        s.steps.forEach(function (pt) {
          el('circle', { cx: X(pt[0]), cy: Y(pt[1]), r: 4, fill: COLOR_LTC, stroke: '#FFFFFF', 'stroke-width': 2, 'data-series': 'fused' }, svg);
        });
      }

      // Capa de lectura: línea vertical + tooltip
      var cross = el('line', { y1: m.t, y2: height - m.b, stroke: '#9CA3AF', 'stroke-width': 1, visibility: 'hidden' }, svg);
      var hit = el('rect', { x: m.l, y: m.t, width: width - m.l - m.r, height: height - m.t - m.b, fill: 'transparent' }, svg);
      function show(evt) {
        var box = svg.getBoundingClientRect();
        var t = Math.max(0, Math.min(s.tMax, (evt.clientX - box.left - m.l) / (width - m.l - m.r) * s.tMax));
        var i = Math.round(t / s.tMax * (s.ltc.length - 1));
        cross.setAttribute('x1', X(s.ltc[i][0])); cross.setAttribute('x2', X(s.ltc[i][0]));
        cross.setAttribute('visibility', 'visible');
        tooltip.innerHTML = 't = ' + fmt(s.ltc[i][0], 2) + '<br>LTC: ' + fmt(s.ltc[i][1], 3) + '<br>CT-RNN: ' + fmt(s.ct[i][1], 3);
        tooltip.hidden = false;
        var left = X(s.ltc[i][0]) + 12;
        tooltip.style.left = (left + tooltip.offsetWidth > width ? X(s.ltc[i][0]) - tooltip.offsetWidth - 12 : left) + 'px';
        tooltip.style.top = (m.t + 4) + 'px';
      }
      function hide() { cross.setAttribute('visibility', 'hidden'); tooltip.hidden = true; }
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', hide);
    }

    function fillTable() {
      var s = state;
      var rows = [];
      var step = s.dt;
      for (var k = 0; k < s.steps.length && k <= 12; k++) {
        var t = k * step;
        var ltc = s.targetLtc + (s.x0 - s.targetLtc) * Math.exp(-t / s.ts);
        var ct = s.targetCt + (s.x0 - s.targetCt) * Math.exp(-t / s.tau);
        rows.push('<tr><td>' + fmt(t, 2) + '</td><td>' + fmt(ltc, 3) + '</td><td>' + fmt(s.steps[k][1], 3) +
                  '</td><td>' + fmt(ct, 3) + '</td></tr>');
      }
      tableBody.innerHTML = rows.join('');
    }

    function update() {
      clampX0();
      state = compute();
      outs.tausys.textContent = fmt(state.ts, 2);
      outs.targetLtc.textContent = fmt(state.targetLtc, 3);
      outs.targetCt.textContent = fmt(state.targetCt, 3);
      outs.first.textContent = fmt(state.steps[1] ? state.steps[1][1] : state.x0, 3);
      outs.exact.textContent = fmt(state.targetLtc + (state.x0 - state.targetLtc) * Math.exp(-state.dt / state.ts), 3);
      draw();
      fillTable();
    }

    ['tau', 'f', 'A', 'x0', 'dt'].forEach(function (name) { p[name] = bindRange(root, name, update); });
    showSteps.addEventListener('change', update);
    showBand.addEventListener('change', update);
    root.querySelector('[data-action="reset"]').addEventListener('click', function () {
      ['tau', 'f', 'A', 'x0', 'dt'].forEach(function (name) {
        p[name].input.value = p[name].input.defaultValue;
        p[name].sync();
      });
      showSteps.checked = true;
      showBand.checked = true;
      update();
    });
    if (window.ResizeObserver) {
      var lastWidth = 0;
      new ResizeObserver(function () {
        if (state && chart.clientWidth !== lastWidth) { lastWidth = chart.clientWidth; draw(); }
      }).observe(chart);
    }
    update();
  }

  function init() {
    var tauLab = document.getElementById('ltc-lab-tau');
    var stateLab = document.getElementById('ltc-lab-state');
    if (tauLab) initTauLab(tauLab);
    if (stateLab) initStateLab(stateLab);
    document.querySelectorAll('.ltc-lab__js').forEach(function (node) { node.hidden = false; });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
