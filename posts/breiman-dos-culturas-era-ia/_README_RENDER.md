# Notas de mantenimiento — Más allá de las dos culturas

Revisión crítica de Breiman (2001), *Statistical Modeling: The Two Cultures*, *Statistical Science* 16(3), 199–231, doi:10.1214/ss/1009213726.
Este archivo empieza por `_`, así que Quarto no lo renderiza ni lo lista.

## Archivos

- **`index.qmd`**: versión web. Usa `engine: markdown` y no ejecuta código. Su YAML declara `resources: [paper.pdf]` para que Quarto copie el PDF a `_site/`, y el botón «Descargar artículo en PDF» enlaza a `paper.pdf`.
- **`paper.tex`**: versión LaTeX (A4, XeLaTeX, biblatex + biber). Su contenido es **equivalente** al de `index.qmd`. El cuerpo se convirtió una sola vez desde `index.qmd` con el pandoc de Quarto (`--biblatex`) y luego se revisó a mano: se añadieron el bloque de título, el resumen, las ecuaciones numeradas, las figuras en TikZ y los anchos de tabla. **Cualquier cambio de contenido debe hacerse en los dos archivos.** La versión actual (auditoría del 5 de noviembre de 2026) se regeneró del mismo modo a partir del `index.qmd` condensado, conservando el preámbulo y las figuras ya revisadas.
- **`paper.pdf`**: PDF compilado a partir de `paper.tex` (17 páginas A4).
- **`references.bib`**: bibliografía compartida por `index.qmd` (citeproc) y `paper.tex` (biber). Todas las entradas se verificaron el 5 de noviembre de 2026 contra Crossref, arXiv, PubMed/Europe PMC o la página oficial.
- **`dos-culturas.css`**: estilos locales con el espacio de nombres `.dc-`. Reutiliza los tokens `--lf-*` de `theme.scss`.
- **`images/*.svg`**: diagramas propios generados por script y validados como XML. Las figuras 1 y 2 de `paper.tex` son sus equivalentes en TikZ.

## Compilar el PDF

Requiere TeX Live o TinyTeX con XeLaTeX, biber, `tex-gyre`, `mathpazo`, `tcolorbox`, `needspace` y `biblatex`. Las fuentes se cargan por **nombre de archivo** (`texgyrepagella-*.otf`), así que no dependen de fontconfig.

```bash
cd posts/breiman-dos-culturas-era-ia
latexmk -xelatex paper.tex      # ejecuta biber automáticamente
latexmk -c                      # limpia auxiliares (.aux, .bcf, .log, ...)
```

En la última compilación (6 de noviembre de 2026, TeX Live 2026 / TinyTeX, biber 2.22), el registro no tenía advertencias de LaTeX, cajas desbordadas (ni *overfull* ni *underfull*) ni referencias sin resolver, y biber no emitió advertencias.

## Verificar la publicación

Después de `quarto render`, comprobar que existe `_site/posts/breiman-dos-culturas-era-ia/paper.pdf` y que su SHA-256 coincide con el de `paper.pdf`.
