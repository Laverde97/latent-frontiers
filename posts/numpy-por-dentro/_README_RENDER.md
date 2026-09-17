# README_RENDER — NumPy por dentro

Instrucciones de entorno, render y validación específicas de este artículo. Todo lo descrito aquí se ejecuta dentro de `posts/numpy-por-dentro/`; no se requiere ni se debe tocar `_quarto.yml`, `theme.scss`, `styles.css` ni el workflow de GitHub Actions del proyecto raíz.

## Archivos de esta publicación

- **`numpy-paper-review.qmd`** — fuente principal (contenido, frontmatter, hero, 12 secciones, chunks Python ejecutables, esqueletos HTML de los 3 laboratorios). Artículo en español únicamente — el toggle ES/EN que tenía originalmente se retiró para alinearlo con la convención del resto del sitio (posts en español; solo las páginas principales son bilingües).
- **`numpy-paper-review.css`** — diseño visual propio, namespace `.np-`.
- **`numpy-paper-review.js`** — barra de progreso de lectura y lógica de los 3 laboratorios interactivos (sin dependencias externas).
- **`references.bib`** — Harris et al. (2020) + documentación oficial de NumPy (broadcasting, `ndarray.strides`).

## Entorno de ejecución Python

Este entorno no tenía NumPy ni Jupyter instalados por defecto, y ningún artículo del sitio ejecutaba código Python hasta ahora. Para que el código de este artículo se ejecute realmente durante el render (sin outputs inventados), se creó un **venv fuera del repositorio** y se registró un kernel Jupyter dedicado. Esto es una dependencia de entorno, no un archivo del proyecto, por lo que vivir fuera de `posts/numpy-por-dentro/` (o del repo) no viola la restricción de alcance.

```bash
python3 -m venv ~/.venvs/lf-numpy-article
source ~/.venvs/lf-numpy-article/bin/activate
pip install --upgrade pip
pip install numpy matplotlib jupyter_core jupyter_client nbformat nbclient ipykernel pyyaml
python -m ipykernel install --user --name lf-numpy-review --display-name "Python (lf-numpy-review)"
quarto check jupyter   # debe listar el venv y el kernel "lf-numpy-review"
```

Versiones verificadas en el último render exitoso:

- Quarto: `1.9.38`
- Python: `3.14.4` (dentro del venv)
- NumPy: `2.5.3`

## Render

```bash
source ~/.venvs/lf-numpy-article/bin/activate
quarto render posts/numpy-por-dentro/numpy-paper-review.qmd --to html
```

**No asumas de antemano dónde cae el output.** Dentro de un proyecto `type: website`, incluso un render de un solo archivo escribe en el `_site/` del proyecto raíz, no junto al `.qmd`:

```bash
find _site -iname 'numpy-paper-review.html'
# -> _site/posts/numpy-por-dentro/numpy-paper-review.html
```

## Freeze: por qué CI no necesita Python

`posts/_metadata.yml` fija `freeze: true` para todo lo que vive en `posts/`, y este artículo ya no lo sobreescribe. Eso significa que, tras ejecutar el render local de arriba una vez, Quarto guarda el resultado de las celdas `{python}` en `_freeze/` (en la raíz del proyecto). Ese directorio **sí se versiona en git** (no está en `.gitignore`), así que el workflow de GitHub Actions (`.github/workflows/publish-quarto.yml`, que no instala Python/Jupyter) reutiliza esa caché en lugar de ejecutar el código — el build en CI no requiere Python.

Si se edita el `.qmd` de forma que cambie el código o su output, hay que repetir el render local (con el venv activado) para regenerar `_freeze/` y commitear la caché actualizada junto con el cambio.

## Checklist de validación aplicado

Todo lo siguiente se verificó de forma automatizada (grep + un script de Playwright headless que abre el HTML renderizado) antes de dar el artículo por terminado:

- ✅ Render sale con código 0, las 9 celdas Python ejecutan sin errores ni tracebacks.
- ✅ Al menos una imagen `data:image/png;base64` embebida (gráfico del benchmark).
- ✅ Exactamente un `id="refs"` (bibliografía), sin marcadores de cita rota (`citation not found`).
- ✅ Sin `TODO`/`FIXME`/`lorem ipsum`/placeholders reales en `.qmd`, `.css` o `.js` (verificado con grep case-sensitive; ojo con falsos positivos de la palabra española "todo/todos" contra un grep `-i` de "TODO").
- ✅ Los 3 laboratorios probados end-to-end con Playwright: Array Explorer actualiza shape/ndim/size/dtype/itemsize/nbytes/strides en vivo; Broadcasting Playground marca correctamente `(2,3)+(3,)→Compatible→(2,3)`, `(4,1,3)+(1,3)→Compatible→(4,1,3)` y `(5,4)+(4,3)→Incompatible`; Strides Explorer calcula `offset[2,1] = 2×16 + 1×4 = 36 bytes` usando el estado compartido de Lab A.
- ✅ Sin overflow horizontal a 375px de viewport (`scrollWidth === clientWidth`); ecuaciones y bloques de código legibles en móvil.
