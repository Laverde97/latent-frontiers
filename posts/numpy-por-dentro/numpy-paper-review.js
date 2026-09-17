/* =========================================================================
   numpy-paper-review.js
   Script propio del articulo "NumPy por dentro" (Latent Frontiers).
   Sin dependencias externas. IIFE unica para no contaminar el scope global.
   Contiene: barra de progreso y los tres laboratorios interactivos
   (Array Explorer, Broadcasting Playground, Strides / Memory Offset).
   ========================================================================= */
(function () {
  'use strict';

  /* -----------------------------------------------------------------------
     Utilidades generales
     ----------------------------------------------------------------------- */
  function byId(id) {
    return document.getElementById(id);
  }

  var DTYPE_BYTES = { int8: 1, int16: 2, int32: 4, float64: 8 };

  /* -----------------------------------------------------------------------
     Funciones puras (sin DOM) - shape / strides / broadcasting
     ----------------------------------------------------------------------- */

  // Strides en C-order para una matriz 2D rows x cols.
  function computeStrides(rows, cols, itemsize) {
    return [cols * itemsize, itemsize];
  }

  function computeArrayMeta(rows, cols, dtype) {
    var itemsize = DTYPE_BYTES[dtype];
    var size = rows * cols;
    return {
      shape: [rows, cols],
      ndim: 2,
      size: size,
      dtype: dtype,
      itemsize: itemsize,
      nbytes: size * itemsize,
      strides: computeStrides(rows, cols, itemsize)
    };
  }

  function computeOffset(i, j, strides) {
    return i * strides[0] + j * strides[1];
  }

  // "(8,1,6,1)" -> [8,1,6,1]; "(3,)" -> [3]
  function parseShape(str) {
    var inner = str.trim().replace(/^\(/, '').replace(/\)$/, '');
    return inner
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; })
      .map(Number);
  }

  function formatShape(shape) {
    if (shape.length === 1) {
      return '(' + shape[0] + ',)';
    }
    return '(' + shape.join(', ') + ')';
  }

  // Regla de broadcasting de NumPy: alinear desde la derecha; dos
  // dimensiones son compatibles si son iguales o si alguna es 1.
  function broadcastShapes(shapeA, shapeB) {
    var maxLen = Math.max(shapeA.length, shapeB.length);
    var perDim = [];
    var compatible = true;

    for (var k = 0; k < maxLen; k++) {
      var ai = shapeA[shapeA.length - 1 - k];
      var bi = shapeB[shapeB.length - 1 - k];
      var aVal = ai === undefined ? 1 : ai;
      var bVal = bi === undefined ? 1 : bi;
      var ok = aVal === bVal || aVal === 1 || bVal === 1;
      if (!ok) { compatible = false; }
      perDim.unshift({
        a: ai,
        b: bi,
        ok: ok,
        result: ok ? Math.max(aVal, bVal) : null
      });
    }

    return {
      compatible: compatible,
      perDim: perDim,
      resultShape: compatible ? perDim.map(function (d) { return d.result; }) : null
    };
  }

  /* -----------------------------------------------------------------------
     Microcopy usado por los labs (generado en runtime, por eso no vive
     directamente en el HTML como el resto de la prosa).
     ----------------------------------------------------------------------- */
  var DICT = {
    compatible: 'Compatible',
    incompatible: 'Incompatible',
    resultShapeLabel: 'Forma resultante',
    noResult: 'Sin forma resultante: dimensiones incompatibles',
    clickCell: 'Haz clic en una celda de la matriz para calcular su offset.',
    offsetPrefix: 'offset',
    offsetBytesSuffix: 'bytes',
    cellSelected: 'Celda seleccionada',
    usesLabA: 'Usa la matriz configurada en el Laboratorio A.'
  };

  function t(key) {
    return DICT[key];
  }

  /* -----------------------------------------------------------------------
     Barra de progreso de lectura
     ----------------------------------------------------------------------- */
  function initProgressBar() {
    var bar = byId('np-progress-bar');
    if (!bar) { return; }

    function update() {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
      bar.style.width = pct + '%';
    }

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* -----------------------------------------------------------------------
     Estado compartido entre Lab A y Lab C
     ----------------------------------------------------------------------- */
  var sharedState = { rows: 3, cols: 4, dtype: 'int32' };
  var stateListeners = [];

  function setSharedState(patch) {
    sharedState = Object.assign({}, sharedState, patch);
    for (var i = 0; i < stateListeners.length; i++) {
      stateListeners[i](sharedState);
    }
  }

  function onSharedStateChange(fn) {
    stateListeners.push(fn);
  }

  /* -----------------------------------------------------------------------
     Lab A - Array Explorer
     ----------------------------------------------------------------------- */
  function renderMatrixGrid(container, rows, cols, options) {
    options = options || {};
    container.innerHTML = '';
    container.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(2.2rem, 1fr))';
    container.setAttribute('role', options.clickable ? 'grid' : 'img');
    container.setAttribute('aria-label', 'Matriz de ' + rows + ' por ' + cols);

    for (var i = 0; i < rows; i++) {
      for (var j = 0; j < cols; j++) {
        var cell = document.createElement('div');
        cell.className = 'np-cell' + (options.clickable ? ' np-cell--clickable' : '');
        cell.textContent = i + ',' + j;
        cell.dataset.row = String(i);
        cell.dataset.col = String(j);

        if (options.clickable) {
          cell.setAttribute('role', 'button');
          cell.setAttribute('tabindex', '0');
          cell.setAttribute('aria-label', 'Celda ' + i + ', ' + j);
          cell.addEventListener('click', function () {
            options.onCellActivate(this);
          });
          cell.addEventListener('keydown', function (evt) {
            if (evt.key === 'Enter' || evt.key === ' ') {
              evt.preventDefault();
              options.onCellActivate(this);
            }
          });
        }

        container.appendChild(cell);
      }
    }
  }

  function renderMetaList(container, meta) {
    var rows = [
      ['shape', formatShape(meta.shape)],
      ['ndim', String(meta.ndim)],
      ['size', String(meta.size)],
      ['dtype', meta.dtype],
      ['itemsize', meta.itemsize + ' B'],
      ['nbytes', meta.nbytes + ' B'],
      ['strides', formatShape(meta.strides)]
    ];

    container.innerHTML = rows
      .map(function (row) {
        return '<li><code>' + row[0] + '</code><span class="np-meta-value">' + row[1] + '</span></li>';
      })
      .join('');
  }

  function initLabA() {
    var rowsInput = byId('np-lab-a-rows');
    var colsInput = byId('np-lab-a-cols');
    var dtypeSelect = byId('np-lab-a-dtype');
    var rowsValue = byId('np-lab-a-rows-value');
    var colsValue = byId('np-lab-a-cols-value');
    var grid = byId('np-lab-a-grid');
    var meta = byId('np-lab-a-meta');

    if (!rowsInput || !colsInput || !dtypeSelect || !grid || !meta) { return; }

    function render() {
      var rows = parseInt(rowsInput.value, 10);
      var cols = parseInt(colsInput.value, 10);
      var dtype = dtypeSelect.value;

      rowsValue.textContent = String(rows);
      colsValue.textContent = String(cols);

      var arrayMeta = computeArrayMeta(rows, cols, dtype);
      renderMatrixGrid(grid, rows, cols, { clickable: false });
      renderMetaList(meta, arrayMeta);

      setSharedState({ rows: rows, cols: cols, dtype: dtype });
    }

    rowsInput.addEventListener('input', render);
    colsInput.addEventListener('input', render);
    dtypeSelect.addEventListener('change', render);

    render();
  }

  /* -----------------------------------------------------------------------
     Lab B - Broadcasting Playground
     ----------------------------------------------------------------------- */
  function renderDimChip(value, ok, isFiller) {
    var cls = 'np-dim-chip';
    if (isFiller) {
      cls += ' np-dim-chip--filler';
    } else {
      cls += ok ? ' np-dim-chip--ok' : ' np-dim-chip--bad';
    }
    return '<span class="' + cls + '">' + value + '</span>';
  }

  function renderBroadcastResult(container, shapeAStr, shapeBStr) {
    var shapeA = parseShape(shapeAStr);
    var shapeB = parseShape(shapeBStr);
    var result = broadcastShapes(shapeA, shapeB);

    var rowA = '<div class="np-broadcast-row"><span>A ' + formatShape(shapeA) + '</span>';
    var rowB = '<div class="np-broadcast-row"><span>B ' + formatShape(shapeB) + '</span>';

    result.perDim.forEach(function (dim) {
      rowA += renderDimChip(dim.a === undefined ? '—' : dim.a, dim.ok, dim.a === undefined);
      rowB += renderDimChip(dim.b === undefined ? '—' : dim.b, dim.ok, dim.b === undefined);
    });

    rowA += '</div>';
    rowB += '</div>';

    var verdictClass = result.compatible ? 'np-lab-verdict--ok' : 'np-lab-verdict--bad';
    var verdictText = result.compatible ? t('compatible') : t('incompatible');
    var resultShapeText = result.compatible
      ? t('resultShapeLabel') + ': ' + formatShape(result.resultShape)
      : t('noResult');

    var summaryLine = formatShape(shapeA) + ' ⊕ ' + formatShape(shapeB) + ' → ' +
      verdictText + (result.compatible ? ' → ' + formatShape(result.resultShape) : '');

    container.innerHTML =
      rowA + rowB +
      '<div class="np-lab-output"><span class="np-lab-verdict ' + verdictClass + '">' + summaryLine + '</span></div>' +
      '<p class="np-lab__desc" style="margin-top:0.6rem;">' + resultShapeText + '</p>';
  }

  function initLabB() {
    var shapeASelect = byId('np-lab-b-shape-a');
    var shapeBSelect = byId('np-lab-b-shape-b');
    var result = byId('np-lab-b-result');

    if (!shapeASelect || !shapeBSelect || !result) { return; }

    function render() {
      renderBroadcastResult(result, shapeASelect.value, shapeBSelect.value);
    }

    shapeASelect.addEventListener('change', render);
    shapeBSelect.addEventListener('change', render);

    render();
  }

  /* -----------------------------------------------------------------------
     Lab C - Strides / Memory Offset
     ----------------------------------------------------------------------- */
  function initLabC() {
    var grid = byId('np-lab-c-grid');
    var output = byId('np-lab-c-output');

    if (!grid || !output) { return; }

    var selected = null;

    function renderOutput() {
      if (!selected) {
        output.textContent = t('clickCell');
        output.classList.add('np-lab-output--empty');
        return;
      }

      var meta = computeArrayMeta(sharedState.rows, sharedState.cols, sharedState.dtype);
      var i = selected.row;
      var j = selected.col;
      var offset = computeOffset(i, j, meta.strides);

      output.classList.remove('np-lab-output--empty');
      output.textContent =
        t('offsetPrefix') + '[' + i + ',' + j + '] = ' +
        i + '×' + meta.strides[0] + ' + ' + j + '×' + meta.strides[1] +
        ' = ' + offset + ' ' + t('offsetBytesSuffix');
    }

    function renderGrid() {
      var rows = sharedState.rows;
      var cols = sharedState.cols;

      // Si la celda seleccionada ya no existe tras cambiar filas/columnas,
      // se limpia la seleccion para evitar un offset fuera de rango.
      if (selected && (selected.row >= rows || selected.col >= cols)) {
        selected = null;
      }

      renderMatrixGrid(grid, rows, cols, {
        clickable: true,
        onCellActivate: function (cellEl) {
          var prevSelected = grid.querySelector('.np-cell--selected');
          if (prevSelected) { prevSelected.classList.remove('np-cell--selected'); }
          cellEl.classList.add('np-cell--selected');
          selected = { row: parseInt(cellEl.dataset.row, 10), col: parseInt(cellEl.dataset.col, 10) };
          renderOutput();
        }
      });

      if (selected) {
        var toReselect = grid.querySelector('[data-row="' + selected.row + '"][data-col="' + selected.col + '"]');
        if (toReselect) { toReselect.classList.add('np-cell--selected'); }
      }

      renderOutput();
    }

    onSharedStateChange(renderGrid);

    renderGrid();
  }

  /* -----------------------------------------------------------------------
     Arranque
     ----------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initProgressBar();
    initLabA();
    initLabB();
    initLabC();
  });
})();
