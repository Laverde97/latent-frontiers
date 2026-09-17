(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var select = document.getElementById('crc-model-select');
    if (!select || typeof CRC_METRICS === 'undefined') {
      return;
    }

    CRC_METRICS.models.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === CRC_METRICS.bestModelId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    function pct(v) {
      return (v * 100).toFixed(1) + '%';
    }

    function render() {
      var m = CRC_METRICS.models.find(function (x) {
        return x.id === select.value;
      });
      if (!m) {
        return;
      }
      document.getElementById('crc-metric-accuracy').textContent = pct(m.accuracy);
      document.getElementById('crc-metric-precision').textContent = pct(m.precision_macro);
      document.getElementById('crc-metric-recall').textContent = pct(m.recall_macro);
      document.getElementById('crc-metric-f1').textContent = pct(m.f1_macro);
      document.getElementById('crc-switcher-desc').textContent = m.description;
      document.getElementById('crc-switcher-name').textContent = m.label;

      var badge = document.getElementById('crc-switcher-badge');
      if (badge) {
        badge.textContent = m.id === CRC_METRICS.bestModelId ? 'Mejor resultado' : '';
        badge.style.display = m.id === CRC_METRICS.bestModelId ? '' : 'none';
      }
    }

    select.addEventListener('change', render);
    render();
  });
})();
