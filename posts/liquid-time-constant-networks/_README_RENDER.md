# Notas de mantenimiento — Liquid Time-Constant Networks

Lectura guiada de Hasani et al., "Liquid Time-constant Networks" (AAAI 2021, arXiv:2006.04439).
Este archivo empieza por `_`, así que Quarto no lo renderiza ni lo lista.

## Archivos

- **`index.qmd`** — el artículo. `engine: markdown`: no ejecuta código durante el render, así que CI no necesita Python.
- **`ltc.css`** — estilos propios (namespace `.ltc-`, más reglas sobre `main.content`). El contenido **no** va envuelto en un div para que los encabezados entren en la tabla de contenido de Quarto.
- **`slides.qmd`**, **`slides.scss`** — presentación RevealJS de 16 diapositivas.
- **`timer.html`** — temporizador de la presentación, incluido con `include-after-body`.
- **`references.bib`** — metadatos tomados de Crossref (DOI), arXiv, PMLR y la documentación oficial de cada librería.
- **`images/*.svg`** — diagramas originales generados por script y validados como XML.
- **`analysis/`** — el código Python que se muestra en el artículo.
- **`media/redes-ltc-analisis.mp4`** — video complementario (43.676.198 bytes, 1280×720, 8 min 03 s).

`writings.qmd` excluye `slides.qmd` del listado.

## Cambiar la duración del temporizador

En `timer.html`, una sola constante:

```js
const PRESENTATION_MINUTES = 15;
```

Controles: clic o `T` inicia/pausa; `Shift`+`T` o doble clic reinicia. No se usa `R` porque Quarto ya la asigna a la vista de desplazamiento de RevealJS. Los avisos de color se activan a 5:00 y 2:00 (`WARNING_SECONDS`, `URGENT_SECONDS`).

## Código Python

El artículo muestra código estático, pero todo se ejecutó. Para repetirlo, con un venv fuera del repositorio:

```bash
python3 -m venv ~/.venvs/lf-ltc-article
source ~/.venvs/lf-ltc-article/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install numpy ncps
cd posts/liquid-time-constant-networks/analysis
python -B smoke_test.py     # implementación manual: formas, gradientes, álgebra de la Ec. (3), cotas
python -B ncps_example.py   # ejemplo con la librería ncps
```

Versiones del último run: Python 3.14.4, PyTorch 2.14.1 (CPU), ncps 1.0.1, NumPy 2.5.3.

Si se edita `analysis/ltc_manual.py`, hay que actualizar el bloque de código del artículo y, si cambia, la salida citada de `smoke_test.py`: ambos se copian literalmente.

`ltc_manual.py` implementa la Ec. (3) tal como está escrita en el paper (una `f` por neurona). **No** es la parametrización por sinapsis del repositorio oficial ni de `ncps`, y no se ha entrenado sobre los datasets del paper.

## Render

```bash
quarto render          # sitio completo
quarto render posts/liquid-time-constant-networks/index.qmd
```

La salida va a `_site/posts/liquid-time-constant-networks/` (`index.html`, `slides.html`).

## Validación aplicada

Con Chromium headless (Playwright) sobre el sitio renderizado:

- Artículo: ecuaciones MathJax sin errores, anclas internas resueltas, 25 referencias sin citas rotas, figuras cargadas, video reproducible con ruta relativa, sin desbordamiento horizontal a 375 px, comparación en una columna en móvil.
- Diapositivas: 16 diapositivas, ecuaciones y código renderizados, sin contenido fuera del marco.
- Temporizador: no arranca solo; `T` y clic inician y pausan; persiste entre diapositivas; `Shift`+`T` y doble clic reinician; se detiene en 00:00; oculto en impresión y en `?print-pdf`.
- Fidelidad: cada fila de las Tablas 2–6 del paper se comparó automáticamente con la fuente LaTeX de arXiv.
