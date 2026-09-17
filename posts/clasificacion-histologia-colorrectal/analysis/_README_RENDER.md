# README_RENDER — Clasificación de tejido colorrectal

Instrucciones de entorno y reproducción específicas de este artículo. Todo lo descrito
aquí se ejecuta dentro de `posts/clasificacion-histologia-colorrectal/`; no se requiere
ni se debe tocar `_quarto.yml`, `theme.scss`, `styles.css` ni el workflow de GitHub
Actions del proyecto raíz.

## Por qué este post NO ejecuta Python dentro del `.qmd`

A diferencia de `posts/numpy-por-dentro/`, este artículo usa `engine: markdown` y no
tiene celdas de código. El entrenamiento de 6 modelos sobre 5.000 imágenes es un trabajo
por lotes, de una sola vez, que no aporta nada al ejecutarse en cada render del sitio.
En su lugar, `analysis/train_models.py` se ejecuta manualmente una vez y escribe los
artefactos estáticos que el `.qmd` consume directamente:

- `../crc-metrics.js` — objeto `CRC_METRICS` con las métricas reales de cada modelo,
  consumido por el selector interactivo en el navegador.
- `../images/crc-model-comparison.png` — gráfica comparativa de accuracy.
- `../images/crc-confusion-matrix.png` — matriz de confusión del mejor modelo.
- `../images/crc-class-0N-*.jpg` — un parche real de ejemplo por clase.
- `metrics.json` — copia de las métricas para inspección/depuración.

Esto evita depender de Jupyter/`freeze` para un cómputo que de todas formas nunca
debería re-ejecutarse en CI (el workflow de GitHub Actions no instala Python).

## Dataset

Kather-CRC-2016 (Kather et al., 2016, *Scientific Reports*, DOI `10.1038/srep27988`),
depósito de datos en Zenodo (DOI `10.5281/zenodo.53169`, CC BY 4.0):

```
https://zenodo.org/records/53169/files/Kather_texture_2016_image_tiles_5000.zip
```

5.000 imágenes RGB de 150×150 px, 8 clases de tejido, ~625 imágenes por clase. El zip
(~246 MB) se descarga a `~/.cache/lf-crc-2016/` (fuera del repo) y **no se commitea**.

## Entorno Python

```bash
python3 -m venv ~/.venvs/lf-crc-article
source ~/.venvs/lf-crc-article/bin/activate
pip install --upgrade pip
pip install numpy pandas scikit-learn pillow scikit-image matplotlib requests xgboost
```

Versiones verificadas en el último run exitoso (Python 3.14.4):

- numpy 2.5.3
- pandas 3.0.5
- scikit-learn 1.9.1
- scikit-image 0.26.0
- matplotlib 3.11.2
- xgboost 3.4.1

## Reproducir el análisis

```bash
mkdir -p ~/.cache/lf-crc-2016
curl -L -o ~/.cache/lf-crc-2016/Kather_texture_2016_image_tiles_5000.zip \
  https://zenodo.org/records/53169/files/Kather_texture_2016_image_tiles_5000.zip
unzip -q ~/.cache/lf-crc-2016/Kather_texture_2016_image_tiles_5000.zip \
  -d ~/.cache/lf-crc-2016/extracted

source ~/.venvs/lf-crc-article/bin/activate
python posts/clasificacion-histologia-colorrectal/analysis/train_models.py
```

## Metodología (resumen)

- Cada una de las 5.000 imágenes se trata como una observación independiente (no se
  subdividen en parches más pequeños), evitando el riesgo de fuga de datos por
  "parche de un parche".
- Representación: histograma de color RGB (24 dims) + estadísticas de intensidad por
  canal (6 dims) + Local Binary Pattern uniforme (10 dims) + descriptores de Haralick /
  GLCM promediados en 4 orientaciones (5 dims) ≈ 45 dimensiones por imagen. No se usan
  los píxeles crudos directamente.
- Split estratificado 80/20 por imagen (`train_test_split`, `random_state=42`,
  `stratify=y`). `StandardScaler` ajustado solo con el conjunto de entrenamiento.
- **Nota sobre independencia por paciente/lámina**: los nombres de archivo del dataset
  siguen el patrón `..._CRC-Prim-HE-<NN>_<sub>.tif_Row_<r>_Col_<c>.tif`, donde `NN` (01–10)
  identifica el espécimen/lámina de origen. Verificado con ese identificador sobre el
  split real usado (mismo `random_state=42`): los 10 especímenes aparecen tanto en train
  como en test, y el 100% de los parches de test (1000/1000) provienen de un espécimen
  también presente en entrenamiento. Es decir, el split logra independencia a nivel de
  imagen/parche, pero **no** a nivel de paciente o lámina.
- Modelos: Logistic Regression, Decision Tree, Random Forest, k-NN, SVM (RBF) y XGBoost
  (si la instalación es exitosa), todos con `random_state=42` donde aplica.
- Sin búsqueda de hiperparámetros: se usan configuraciones estándar razonables para
  mantener el pipeline simple, rápido y reproducible.
- Métricas sobre el conjunto de prueba: accuracy, precision macro, recall macro,
  f1 macro. El "mejor modelo" se define por accuracy.
- La cifra de 87,4% de Kather et al. (2016) es un resultado de literatura, tomado
  textualmente del abstract del artículo original (el abstract no especifica un
  clasificador único para esa cifra, por lo que no se le atribuye uno aquí). Se cita
  únicamente como contexto histórico y no como comparación directa: usa una
  representación de características y un esquema de validación distintos a los de este
  análisis.

## Checklist de validación

- [ ] Las 8 carpetas extraídas del zip corresponden 1:1 al `CLASS_MAP` del script.
- [ ] `python analysis/train_models.py` corre sin errores y reporta accuracy > 0 para
      cada modelo.
- [ ] `crc-metrics.js` contiene solo modelos realmente entrenados (sin XGBoost si falló).
- [ ] Las imágenes de clase (`crc-class-0N-*.jpg`) pesan cada una menos de ~40 KB.
- [ ] `quarto render posts/clasificacion-histologia-colorrectal/index.qmd` sale con
      código 0.
