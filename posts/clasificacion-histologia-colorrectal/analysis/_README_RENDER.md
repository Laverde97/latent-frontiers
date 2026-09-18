# README_RENDER — Clasificación de tejido colorrectal

Instrucciones de entorno y reproducción específicas de este artículo. Todo lo descrito
aquí se ejecuta dentro de `posts/clasificacion-histologia-colorrectal/`; no se requiere
ni se debe tocar `_quarto.yml`, `theme.scss`, `styles.css` ni el workflow de GitHub
Actions del proyecto raíz.

## Por qué este post NO ejecuta Python dentro del `.qmd`

A diferencia de `posts/numpy-por-dentro/`, este artículo usa `engine: markdown` y no
tiene celdas de código. El entrenamiento de varios modelos sobre 5.000 imágenes, bajo dos
(o tres, si se ejecuta la CNN) protocolos de evaluación, es un trabajo por lotes, de una
sola vez, que no aporta nada al ejecutarse en cada render del sitio. En su lugar, tres
scripts se ejecutan manualmente y escriben los artefactos estáticos que el `.qmd` consume
directamente:

**`analysis/train_models.py`** (split aleatorio por patch, baseline):
- `../crc-metrics.js` — objeto `CRC_METRICS` con las métricas reales de cada modelo,
  consumido por el selector interactivo en el navegador.
- `metrics.json` — copia de las métricas para inspección/depuración.
- `split_manifest.json` — paths de train/test del split baseline (reproducible sin
  volver a invocar `train_test_split`).
- `error_analysis.json` — métricas por clase, matriz de confusión y galería de errores
  del split aleatorio (queda como referencia en `analysis/`, no es la fuente del
  análisis de errores publicado en el artículo — ver más abajo).
- `../images/crc-model-comparison.png` — gráfica comparativa de F1 macro (baseline).
- `../images/crc-confusion-matrix.png` — matriz de confusión del split aleatorio.
- `../images/crc-class-0N-*.jpg` — un parche real de ejemplo por clase.

**`analysis/grouped_evaluation.py`** (evaluación agrupada por espécimen, LeaveOneGroupOut):
- `group_class_crosstab.json` — conteo de imágenes por clase y espécimen (diagnóstico de
  viabilidad del split agrupado).
- `grouped_evaluation.json` — resultados pooled out-of-fold por modelo, mejor modelo
  individual, matriz de confusión y galería de errores out-of-group (**esta es la fuente
  del análisis de errores publicado en el artículo**).
- `../images/crc-confusion-matrix-grouped.png`, `../images/crc-split-protocol-comparison.png`.
- `../images/errors/err-grouped-*.jpg` — galería de misclassifications reales usada en el
  artículo (las `err-*.jpg` sin "grouped" son del baseline, solo de referencia).

**`analysis/train_cnn.py`** (opcional, venv separado — ver más abajo):
- `cnn_metrics.json`, `cnn_split_manifest.json`.

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
python posts/clasificacion-histologia-colorrectal/analysis/grouped_evaluation.py
```

`grouped_evaluation.py` importa funciones de `train_models.py` (mismo venv) y reutiliza
la caché de características (`~/.cache/lf-crc-2016/features_cache.npz`) si ya existe —
no vuelve a extraer las 45 features si `train_models.py` ya se ejecutó antes.

### CNN opcional (venv separado)

TensorFlow no tiene distribución para Python 3.14 en este entorno (`pip install
tensorflow` falla con "No matching distribution"); se usó **PyTorch** en su lugar. Venv
**separado** de `lf-crc-article` a propósito — PyTorch trae un árbol de dependencias
grande y con restricciones de versión propias que no vale la pena arriesgar contra el
venv ya verificado de scikit-learn/xgboost:

```bash
python3 -m venv ~/.venvs/lf-crc-cnn
source ~/.venvs/lf-crc-cnn/bin/activate
pip install --upgrade pip
pip install torch torchvision pillow numpy scikit-learn

python posts/clasificacion-histologia-colorrectal/analysis/train_cnn.py
```

Versiones verificadas en el último run exitoso (Python 3.14.4, GPU NVIDIA RTX 4060
Laptop vía CUDA 13.0): `torch==2.14.0+cu130`, `numpy==2.5.3`, `pillow==12.3.0`,
`scikit-learn==1.9.1`. `train_cnn.py` **no** importa `train_models.py` (para no arrastrar
scikit-image/xgboost/matplotlib a este venv): duplica localmente las tres funciones
pequeñas y puras que necesita (`extract_group_id`, `compute_confusion_payload`,
`top_confusion_pairs`).

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
- **Nota sobre independencia por espécimen/lámina** (nunca "paciente" — el paper original
  solo confirma "10 láminas H&E anonimizadas", no que cada una sea un paciente distinto):
  los nombres de archivo siguen el patrón `..._CRC-Prim-HE-<NN>_<sub>.tif_Row_<r>_Col_<c>.tif`,
  `NN` (01–10) identifica el espécimen/lámina. Verificado sobre el split real usado (mismo
  `random_state=42`): los 10 especímenes aparecen tanto en train como en test, y el 100%
  de los parches de test (1000/1000) provienen de un espécimen también presente en
  entrenamiento. El split logra independencia a nivel de imagen/parche, pero **no** a
  nivel de espécimen/lámina — por eso existe `grouped_evaluation.py`.
- Modelos: Logistic Regression, Decision Tree, Random Forest, k-NN, SVM (RBF) y XGBoost
  (si la instalación es exitosa), todos con `random_state=42` donde aplica.
- Sin búsqueda de hiperparámetros: se usan configuraciones estándar razonables para
  mantener el pipeline simple, rápido y reproducible.
- Métricas sobre el conjunto de prueba: accuracy, precision macro, recall macro,
  f1 macro. **El "mejor modelo" se define por F1 macro** (`PRIMARY_METRIC` en
  `train_models.py`), no por accuracy — 8 clases balanceadas, mismo peso para todas.
- La cifra de 87,4% de Kather et al. (2016) es un resultado de literatura, tomado
  textualmente del abstract del artículo original (el abstract no especifica un
  clasificador único para esa cifra, por lo que no se le atribuye uno aquí). Se cita
  únicamente como contexto histórico y no como comparación directa: usa una
  representación de características y un esquema de validación distintos a los de este
  análisis.

### Evaluación agrupada (`grouped_evaluation.py`)

- Estrategia: `LeaveOneGroupOut` sobre los 10 especímenes — elegida programáticamente
  (nunca a mano) porque con solo 10 grupos y clases muy concentradas en unos pocos
  (p.ej. "Fondo" solo en 2 especímenes, ver `group_class_crosstab.json`), ni
  `StratifiedGroupKFold`/`GroupKFold` con menos folds ni `GroupShuffleSplit` garantizan
  cobertura de las 8 clases por fold.
- Métrica primaria: **F1 macro pooled out-of-fold** (acumulado sobre las 5.000
  predicciones out-of-group, 8 clases) — no la media entre folds, que es secundaria y se
  calcula solo sobre las clases presentes en cada fold (evita que un fold sin ejemplos de
  una clase arrastre esa clase a F1=0 sin evidencia real).
- El ensemble (xgb+rf+logreg+svm, voto suave) también se evaluó bajo este protocolo
  (`ensembleEvaluated: true` en el JSON), pero `bestIndividualModelId` solo compara entre
  los 6 modelos individuales — nunca se afirma "el mejor modelo" sin esa calificación
  cuando el ensemble participa.
- La galería de misclassifications y la matriz de confusión publicadas en el artículo
  provienen de las predicciones out-of-group del `bestIndividualModelId` — no del split
  aleatorio.

## Checklist de validación

- [x] Las 8 carpetas extraídas del zip corresponden 1:1 al `CLASS_MAP` del script.
- [x] `python analysis/train_models.py` corre sin errores; `bestModelId` se calcula por
      F1 macro (no accuracy) y coincide con el mejor `f1_macro` real del payload.
- [x] `crc-metrics.js` contiene solo modelos realmente entrenados (sin XGBoost si falló).
- [x] Las imágenes de clase (`crc-class-0N-*.jpg`) pesan cada una menos de ~40 KB.
- [x] `split_manifest.json` existe y es consistente con `metrics.json` (`nTrain`/`nTest`).
- [x] `python analysis/grouped_evaluation.py` corre sin errores; el chequeo interno de
      "ningún grupo en train y test del mismo fold" pasa (assert en el propio script).
- [x] `grouped_evaluation.json`: `bestIndividualModelId` se calculó con
      `argmax(f1MacroPooledOof)`, no se asumió igual al baseline.
- [x] Si se ejecutó la CNN: `cnn_split_manifest.json` confirma que train/val/test son
      group-disjoint (ningún espécimen repetido entre los tres); el test no participó en
      el entrenamiento ni en la selección del mejor epoch (early stopping solo con val).
- [x] Cada cifra en `index.qmd` coincide exactamente con `metrics.json` /
      `error_analysis.json` / `grouped_evaluation.json` / `cnn_metrics.json` (verificado
      con un chequeo automático número por número al cerrar esta ronda).
- [x] `references.bib` sin entradas huérfanas ni citas `[@key]` sin definir.
- [x] Revisión visual en 1440px (desktop) y 390px (mobile) — sin overflow horizontal
      (las tablas usan scroll horizontal en mobile, `crc-histologia.css`).
- [x] `quarto render posts/clasificacion-histologia-colorrectal/index.qmd` sale con
      código 0.
- [x] `quarto render` del sitio completo sale con código 0.
- [x] `git diff --check` sin errores de espacios en blanco.
