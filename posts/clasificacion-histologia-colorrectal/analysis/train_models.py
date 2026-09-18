"""Pipeline de analisis para "Clasificacion de tejido colorrectal" (Kather-CRC-2016).

Se ejecuta UNA sola vez, fuera de Quarto, dentro de un venv con las dependencias
instaladas (ver ../_README_RENDER.md). No es parte del render del sitio: genera
los assets estaticos que consume index.qmd (crc-metrics.js, las dos figuras PNG,
y 8 parches de ejemplo en ../images/).

Dataset: Kather-CRC-2016 (Kather et al., 2016, Scientific Reports, DOI
10.1038/srep27988), descargado del deposito de datos en Zenodo
(DOI 10.5281/zenodo.53169, CC BY 4.0):
https://zenodo.org/records/53169/files/Kather_texture_2016_image_tiles_5000.zip

Uso:
    source ~/.venvs/lf-crc-article/bin/activate
    python analysis/train_models.py
"""

from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.feature import local_binary_pattern, graycomatrix, graycoprops

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    precision_recall_fscore_support,
    confusion_matrix,
)

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

RANDOM_STATE = 42
TEST_SIZE = 0.20

# Métrica primaria del experimento: 8 clases balanceadas, mismo peso para las 8 al
# comparar modelos -> F1 macro (combina precision y recall). Accuracy se conserva
# como dato secundario en todos los payloads, no se elimina.
PRIMARY_METRIC = "f1_macro"

# Cantidad de imágenes de ejemplo guardadas por cada uno de los top-N pares de
# confusión, para la galería de misclassifications del artículo.
GALLERY_EXAMPLES_PER_PAIR = 2
GALLERY_TOP_K_PAIRS = 3

# Override manual: si el ensemble gana pero la mejora es marginal, fijar en "xgb"
# para mantener la matriz de confusión y el pie de figura existentes.
CONFUSION_MATRIX_MODEL_ID: str | None = None  # None = usar best_id automáticamente

DATA_ROOT = (
    Path.home()
    / ".cache"
    / "lf-crc-2016"
    / "extracted"
    / "Kather_texture_2016_image_tiles_5000"
)
POST_DIR = Path(__file__).resolve().parent.parent
IMAGES_DIR = POST_DIR / "images"
ERRORS_DIR = IMAGES_DIR / "errors"
ANALYSIS_DIR = Path(__file__).resolve().parent
METRICS_JS_PATH = POST_DIR / "crc-metrics.js"
METRICS_JSON_PATH = ANALYSIS_DIR / "metrics.json"
SPLIT_MANIFEST_PATH = ANALYSIS_DIR / "split_manifest.json"
ERROR_ANALYSIS_PATH = ANALYSIS_DIR / "error_analysis.json"

# Patrón confirmado contra los nombres de archivo reales del dataset:
# "<id>_CRC-Prim-HE-<NN>_<sub>.tif_Row_<r>_Col_<c>.tif", donde NN (01-10)
# identifica el espécimen/lámina de origen. El dataset no permite demostrar que
# cada NN sea un paciente distinto, así que nunca se usa el término "paciente".
GROUP_ID_PATTERN = re.compile(r"CRC-Prim-HE-(\d{2})")

VALID_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".bmp"}

# Mapeo carpeta real del dataset -> (id corto, etiqueta en espanol).
# Confirmado contra los nombres reales de carpeta tras descomprimir el zip.
CLASS_MAP = {
    "01_TUMOR": ("tumor", "Tumor"),
    "02_STROMA": ("estroma", "Estroma"),
    "03_COMPLEX": ("estroma_complejo", "Estroma complejo"),
    "04_LYMPHO": ("linfoide", "Tejido linfoide"),
    "05_DEBRIS": ("detritos", "Detritos"),
    "06_MUCOSA": ("mucosa", "Mucosa"),
    "07_ADIPOSE": ("adiposo", "Tejido adiposo"),
    "08_EMPTY": ("fondo", "Fondo"),
}

MODEL_DESCRIPTIONS = {
    "logreg": (
        "Regresión logística",
        "Un modelo lineal que estima la probabilidad de cada clase combinando linealmente "
        "las características. Rápido y fácil de interpretar, aunque limitado ante "
        "relaciones no lineales complejas.",
    ),
    "tree": (
        "Árbol de decisión",
        "Divide el espacio de características mediante reglas simples y sucesivas. "
        "Es fácil de interpretar, pero tiende a sobreajustarse a los datos de entrenamiento.",
    ),
    "rf": (
        "Random Forest",
        "Combina muchos árboles de decisión entrenados sobre subconjuntos distintos de "
        "datos y características. Suele generalizar mejor que un árbol individual.",
    ),
    "knn": (
        "k-NN",
        "Clasifica cada imagen según la clase mayoritaria entre sus vecinos más cercanos "
        "en el espacio de características. Simple, pero sensible a la escala de los datos.",
    ),
    "svm": (
        "SVM (RBF)",
        "Busca la frontera de decisión que separa mejor las clases, usando un kernel no "
        "lineal (RBF) para capturar relaciones complejas entre color y textura.",
    ),
    "xgb": (
        "XGBoost",
        "Construye árboles de decisión de forma secuencial, corrigiendo los errores de "
        "los anteriores. Suele ofrecer un desempeño competitivo con ajuste mínimo.",
    ),
    "ensemble": (
        "Ensemble (voto suave)",
        "Promedia las probabilidades de XGBoost, Random Forest, SVM (RBF) y regresión "
        "logística, y elige la clase con mayor probabilidad promedio. Combina modelos "
        "que cometen errores distintos entre sí.",
    ),
}

LF_BLUE = "#1D4E89"
LF_NAVY = "#0B1E3D"
LF_MUTED = "#6B7280"
LF_SURFACE = "#F7F9FC"
LF_LINE = "#E2E8F0"


def extract_group_id(img_path: Path) -> str:
    """Identificador de grupo (espécimen/lámina) a partir del nombre de archivo.

    Nunca se llama "paciente": el dataset solo permite demostrar espécimen/lámina
    (ver GROUP_ID_PATTERN). Usado tanto por la evaluación agrupada (grouped_evaluation.py)
    como, si es viable, por el split de la CNN opcional.
    """
    match = GROUP_ID_PATTERN.search(img_path.name)
    if not match:
        raise ValueError(f"No se pudo extraer group_id de: {img_path.name}")
    return match.group(1)


def extract_features(img_path: Path) -> np.ndarray:
    img = Image.open(img_path).convert("RGB")
    arr = np.asarray(img, dtype=np.float64)

    feats: list[float] = []

    # Histograma de color por canal RGB (8 bins, normalizado) -> 24 dims
    for c in range(3):
        hist, _ = np.histogram(arr[:, :, c], bins=8, range=(0, 255))
        feats.extend((hist / hist.sum()).tolist())

    # Estadisticas basicas de intensidad por canal -> 6 dims
    for c in range(3):
        feats.append(arr[:, :, c].mean() / 255.0)
        feats.append(arr[:, :, c].std() / 255.0)

    gray = np.array(img.convert("L"), dtype=np.uint8)

    # Textura: Local Binary Pattern uniforme -> 10 dims
    lbp = local_binary_pattern(gray, P=8, R=1, method="uniform")
    lbp_hist, _ = np.histogram(lbp, bins=10, range=(0, 10))
    feats.extend((lbp_hist / lbp_hist.sum()).tolist())

    # Textura: descriptores GLCM promediados en 4 orientaciones -> 5 dims
    glcm = graycomatrix(
        gray,
        distances=[1],
        angles=[0, np.pi / 4, np.pi / 2, 3 * np.pi / 4],
        levels=256,
        symmetric=True,
        normed=True,
    )
    for prop in ("contrast", "dissimilarity", "homogeneity", "energy", "correlation"):
        feats.append(float(np.mean(graycoprops(glcm, prop))))

    return np.asarray(feats, dtype=np.float64)


FEATURE_CACHE_PATH = Path.home() / ".cache" / "lf-crc-2016" / "features_cache.npz"


def build_dataset():
    if FEATURE_CACHE_PATH.exists():
        cached = np.load(FEATURE_CACHE_PATH, allow_pickle=True)
        print(f"Usando caché de características: {FEATURE_CACHE_PATH}")
        return cached["X"], cached["y"], [Path(p) for p in cached["paths"]]

    class_dirs = sorted(p for p in DATA_ROOT.iterdir() if p.is_dir())
    if len(class_dirs) != 8:
        raise SystemExit(
            f"Se esperaban 8 carpetas de clase, se encontraron {len(class_dirs)}: "
            f"{[d.name for d in class_dirs]}"
        )

    X, y, paths = [], [], []
    t0 = time.time()
    for d in class_dirs:
        if d.name not in CLASS_MAP:
            raise SystemExit(f"Carpeta sin mapeo conocido: {d.name}")
        class_id, class_label = CLASS_MAP[d.name]
        files = sorted(f for f in d.iterdir() if f.suffix.lower() in VALID_EXTS)
        print(f"  {d.name} -> {class_label}: {len(files)} imágenes")
        for f in files:
            X.append(extract_features(f))
            y.append(class_id)
            paths.append(f)
    print(f"Extracción de características: {len(X)} imágenes en {time.time() - t0:.1f}s")
    X_arr, y_arr = np.asarray(X), np.asarray(y)
    np.savez(
        FEATURE_CACHE_PATH,
        X=X_arr,
        y=y_arr,
        paths=np.array([str(p) for p in paths]),
    )
    return X_arr, y_arr, paths


def build_models():
    models = {
        "logreg": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", LogisticRegression(max_iter=2000, random_state=RANDOM_STATE)),
            ]
        ),
        "tree": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", DecisionTreeClassifier(random_state=RANDOM_STATE)),
            ]
        ),
        "rf": Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "clf",
                    RandomForestClassifier(
                        n_estimators=300, random_state=RANDOM_STATE, n_jobs=-1
                    ),
                ),
            ]
        ),
        "knn": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", KNeighborsClassifier(n_neighbors=5)),
            ]
        ),
        "svm": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", SVC(kernel="rbf", random_state=RANDOM_STATE)),
            ]
        ),
    }
    try:
        from xgboost import XGBClassifier

        models["xgb"] = Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "clf",
                    XGBClassifier(
                        n_estimators=300,
                        random_state=RANDOM_STATE,
                        eval_metric="mlogloss",
                    ),
                ),
            ]
        )
    except Exception as exc:  # pragma: no cover - best effort only
        print(f"XGBoost no disponible, se omite del comparativo: {exc}")
    return models


def plot_comparison(
    results: dict,
    best_id: str,
    out_path: Path,
    metric_key: str = PRIMARY_METRIC,
    metric_label: str = "F1 macro (%)",
):
    order = sorted(results.items(), key=lambda kv: kv[1][metric_key], reverse=True)
    labels = [MODEL_DESCRIPTIONS[k][0] for k, _ in order]
    values = [v[metric_key] * 100 for _, v in order]
    colors = [LF_BLUE if k == best_id else LF_MUTED for k, _ in order]

    fig, ax = plt.subplots(figsize=(6.4, 0.6 * len(order) + 1.2))
    y_pos = np.arange(len(order))[::-1]
    ax.barh(y_pos, values, color=colors, height=0.55, zorder=3)
    for y, v in zip(y_pos, values):
        ax.text(v + 1.0, y, f"{v:.1f}%", va="center", ha="left", fontsize=10, color="#1A1A1A")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=10.5, color="#1A1A1A")
    ax.set_xlim(0, max(values) + 10)
    ax.set_xlabel(metric_label, fontsize=9.5, color=LF_MUTED)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(LF_LINE)
    ax.tick_params(axis="x", colors=LF_MUTED, labelsize=9)
    ax.tick_params(axis="y", length=0)
    ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(out_path, dpi=180, facecolor="white")
    plt.close(fig)


def plot_confusion(cm: np.ndarray, class_labels: list[str], out_path: Path):
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)
    cmap = LinearSegmentedColormap.from_list("lf_blues", [LF_SURFACE, LF_BLUE, LF_NAVY])

    fig, ax = plt.subplots(figsize=(6.2, 5.6))
    im = ax.imshow(cm_norm, cmap=cmap, vmin=0, vmax=1)

    ax.set_xticks(range(len(class_labels)))
    ax.set_yticks(range(len(class_labels)))
    ax.set_xticklabels(class_labels, rotation=45, ha="right", fontsize=9)
    ax.set_yticklabels(class_labels, fontsize=9)
    ax.set_xlabel("Predicción del modelo", fontsize=9.5, color=LF_MUTED)
    ax.set_ylabel("Clase real", fontsize=9.5, color=LF_MUTED)

    for i in range(len(class_labels)):
        for j in range(len(class_labels)):
            val = cm_norm[i, j]
            color = "white" if val > 0.5 else "#1A1A1A"
            ax.text(j, i, f"{val * 100:.0f}", ha="center", va="center", fontsize=8, color=color)

    ax.spines[:].set_visible(False)
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="% de la clase real")
    fig.tight_layout()
    fig.savefig(out_path, dpi=180, facecolor="white")
    plt.close(fig)


def save_class_samples(paths, y, class_labels_by_id):
    rng = random.Random(RANDOM_STATE)
    by_class: dict[str, list[Path]] = {}
    for p, label in zip(paths, y):
        by_class.setdefault(label, []).append(p)

    order = list(CLASS_MAP.values())
    for idx, (class_id, class_label) in enumerate(order, start=1):
        candidates = by_class.get(class_id, [])
        if not candidates:
            continue
        # Entre una muestra de candidatos reales de la clase, se elige el que
        # tiene mayor riqueza de detalle visual (desviación estándar de
        # intensidad), para evitar parches casi en blanco (frecuentes en
        # clases como "Fondo") que lucirían como una imagen rota en el hero.
        sample_pool = rng.sample(candidates, k=min(40, len(candidates)))
        scored = []
        for cand in sample_pool:
            gray = np.asarray(Image.open(cand).convert("L"), dtype=np.float64)
            scored.append((gray.std(), cand))
        scored.sort(key=lambda t: t[0], reverse=True)
        chosen = scored[len(scored) // 4][1]  # detallado pero no un valor atípico extremo
        img = Image.open(chosen).convert("RGB").resize((300, 300), Image.LANCZOS)
        slug = class_id.replace("_", "-")
        out_path = IMAGES_DIR / f"crc-class-{idx:02d}-{slug}.jpg"
        img.save(out_path, "JPEG", quality=82, optimize=True)
        print(f"  Guardado {out_path.name} ({out_path.stat().st_size / 1024:.1f} KB)")


def compute_split_manifest(paths_train, paths_test, data_root: Path) -> dict:
    """Guarda el split train/test (paths relativos a data_root) para que pueda
    reproducirse exactamente en otros procesos/venvs (p.ej. la CNN opcional) sin
    volver a invocar train_test_split y confiar en que el RNG coincida."""

    def rel(paths):
        return [str(Path(p).relative_to(data_root)) for p in paths]

    return {
        "randomState": RANDOM_STATE,
        "testSize": TEST_SIZE,
        "stratify": "y",
        "nTrain": len(paths_train),
        "nTest": len(paths_test),
        "trainPaths": rel(paths_train),
        "testPaths": rel(paths_test),
    }


TUMOR_CLASS_ID = "tumor"


def compute_per_class_metrics(y_test, y_pred, class_order) -> list[dict]:
    class_ids = [c[0] for c in class_order]
    class_labels = {c[0]: c[1] for c in class_order}
    precision, recall, f1, support = precision_recall_fscore_support(
        y_test, y_pred, labels=class_ids, average=None, zero_division=0
    )
    return [
        {
            "classId": cid,
            "label": class_labels[cid],
            "precision": round(float(p), 4),
            "recall": round(float(r), 4),
            "f1": round(float(f), 4),
            "support": int(s),
        }
        for cid, p, r, f, s in zip(class_ids, precision, recall, f1, support)
    ]


def compute_confusion_payload(cm: np.ndarray, class_order) -> dict:
    class_ids = [c[0] for c in class_order]
    class_labels = [c[1] for c in class_order]
    row_sums = cm.sum(axis=1, keepdims=True)
    row_norm = np.divide(
        cm.astype(float), row_sums, out=np.zeros(cm.shape, dtype=float), where=row_sums != 0
    )
    return {
        "classIds": class_ids,
        "classLabels": class_labels,
        "counts": cm.tolist(),
        "rowNormalizedPct": (row_norm * 100).round(2).tolist(),
    }


def _confusion_category(true_id: str, pred_id: str) -> str:
    if true_id == TUMOR_CLASS_ID and pred_id != TUMOR_CLASS_ID:
        return "tumor_to_non_tumor"
    if true_id != TUMOR_CLASS_ID and pred_id == TUMOR_CLASS_ID:
        return "non_tumor_to_tumor"
    return "non_tumor_to_non_tumor"


def top_confusion_pairs(cm: np.ndarray, class_order, k: int = GALLERY_TOP_K_PAIRS) -> list[dict]:
    class_ids = [c[0] for c in class_order]
    class_labels = {c[0]: c[1] for c in class_order}
    pairs = []
    for i, true_id in enumerate(class_ids):
        for j, pred_id in enumerate(class_ids):
            if i == j:
                continue
            count = int(cm[i, j])
            if count == 0:
                continue
            row_total = int(cm[i].sum())
            pairs.append(
                {
                    "trueClassId": true_id,
                    "trueClassLabel": class_labels[true_id],
                    "predClassId": pred_id,
                    "predClassLabel": class_labels[pred_id],
                    "count": count,
                    "pctOfTrueClass": round(100.0 * count / row_total, 2) if row_total else 0.0,
                    "category": _confusion_category(true_id, pred_id),
                }
            )
    pairs.sort(key=lambda p: p["count"], reverse=True)
    return pairs[:k]


def save_misclassified_gallery(
    paths_test,
    y_test,
    y_pred,
    top_pairs: list[dict],
    out_dir: Path,
    post_dir: Path,
    proba_matrix: np.ndarray | None = None,
    proba_class_order: list[str] | None = None,
    probability_type: str | None = "predict_proba",
    n_per_pair: int = GALLERY_EXAMPLES_PER_PAIR,
    filename_prefix: str = "err",
) -> list[dict]:
    """Guarda hasta n_per_pair imágenes reales de test por cada par de confusión.

    Si se da proba_matrix (predict_proba o, si probability_type="decision_score",
    un score de decisión — nunca se llama "probabilidad" a un decision_score), se usa
    para elegir un ejemplo de alta confianza equivocada y uno límite/casi empatado por
    par, y para registrar el valor en cada ejemplo. Sin proba_matrix, la selección es
    determinística (los primeros n_per_pair encontrados) y no se reporta confianza.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    paths_arr = np.asarray([str(p) for p in paths_test])
    y_test_arr = np.asarray(y_test)
    y_pred_arr = np.asarray(y_pred)
    class_idx = {cid: i for i, cid in enumerate(proba_class_order)} if proba_class_order else None

    examples = []
    for pair in top_pairs:
        true_id, pred_id = pair["trueClassId"], pair["predClassId"]
        idxs = np.where((y_test_arr == true_id) & (y_pred_arr == pred_id))[0]
        if len(idxs) == 0:
            print(f"  (sin ejemplos reales para {true_id} -> {pred_id})")
            continue

        if proba_matrix is not None and class_idx is not None:
            by_pred_conf = sorted(idxs, key=lambda i: proba_matrix[i][class_idx[pred_id]], reverse=True)
            by_margin = sorted(
                idxs,
                key=lambda i: abs(
                    proba_matrix[i][class_idx[pred_id]] - proba_matrix[i][class_idx[true_id]]
                ),
            )
            chosen = [by_pred_conf[0]]
            for i in by_margin:
                if i not in chosen:
                    chosen.append(i)
                    break
        else:
            chosen = list(idxs[:n_per_pair])

        for n, idx in enumerate(chosen[:n_per_pair], start=1):
            src = Path(paths_arr[idx])
            img = Image.open(src).convert("RGB").resize((300, 300), Image.LANCZOS)
            true_slug, pred_slug = true_id.replace("_", "-"), pred_id.replace("_", "-")
            out_name = f"{filename_prefix}-{true_slug}-as-{pred_slug}-{n:02d}.jpg"
            out_path = out_dir / out_name
            img.save(out_path, "JPEG", quality=82, optimize=True)

            example = {
                "trueClassId": true_id,
                "predClassId": pred_id,
                "imagePath": str(out_path.relative_to(post_dir)),
                "category": pair["category"],
            }
            if proba_matrix is not None and class_idx is not None:
                example["predScore"] = round(float(proba_matrix[idx][class_idx[pred_id]]), 4)
                example["trueScore"] = round(float(proba_matrix[idx][class_idx[true_id]]), 4)
                example["probabilityType"] = probability_type
            else:
                example["probabilityType"] = None
            examples.append(example)
            print(f"  Guardado {out_name}")

    return examples


def compute_clinical_scenarios(per_class_metrics: list[dict]) -> list[dict]:
    tumor = next(m for m in per_class_metrics if m["classId"] == TUMOR_CLASS_ID)
    macro_f1 = float(np.mean([m["f1"] for m in per_class_metrics]))
    return [
        {
            "id": "minimize_missed_tumor",
            "label": "Minimizar regiones tumorales no detectadas",
            "relevantMetric": "recall",
            "classFocus": "tumor",
            "value": tumor["recall"],
        },
        {
            "id": "minimize_false_alerts",
            "label": "Reducir falsas alertas relacionadas con tumor",
            "relevantMetric": "precision",
            "classFocus": "tumor",
            "value": tumor["precision"],
        },
        {
            "id": "balance_tumor",
            "label": "Equilibrar ambos tipos de error en la clase Tumor",
            "relevantMetric": "f1",
            "classFocus": "tumor",
            "value": tumor["f1"],
        },
        {
            "id": "balanced_eight_classes",
            "label": "Evaluación equilibrada de las 8 clases",
            "relevantMetric": "f1_macro",
            "classFocus": None,
            "value": round(macro_f1, 4),
        },
    ]


def main():
    print("Cargando dataset y extrayendo características…")
    X, y, paths = build_dataset()

    X_train, X_test, y_train, y_test, paths_train, paths_test = train_test_split(
        X, y, paths, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    print(f"Split: {len(X_train)} entrenamiento / {len(X_test)} prueba (estratificado)")

    label_encoder = LabelEncoder().fit(y)

    models = build_models()
    results = {}
    for model_id, pipeline in models.items():
        t0 = time.time()
        if model_id == "xgb":
            # XGBoost requires integer-encoded class labels.
            pipeline.fit(X_train, label_encoder.transform(y_train))
            y_pred = label_encoder.inverse_transform(pipeline.predict(X_test))
        else:
            pipeline.fit(X_train, y_train)
            y_pred = pipeline.predict(X_test)
        results[model_id] = {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision_macro": float(
                precision_score(y_test, y_pred, average="macro", zero_division=0)
            ),
            "recall_macro": float(
                recall_score(y_test, y_pred, average="macro", zero_division=0)
            ),
            "f1_macro": float(f1_score(y_test, y_pred, average="macro", zero_division=0)),
            "y_pred": y_pred,
        }
        print(
            f"  {model_id}: accuracy={results[model_id]['accuracy']:.4f} "
            f"({time.time() - t0:.1f}s)"
        )

    # --- Ensemble (voto suave): XGBoost + Random Forest + SVM(RBF) + LogReg ---
    # Reusa los pipelines YA AJUSTADOS de xgb/rf/logreg (mismo split, sin reentrenar).
    # SVM necesita una instancia NUEVA y SEPARADA con probability=True: la fila
    # "svm" del comparativo (SVC(probability=False), sin cambios) NO se toca.
    print("Entrenando SVM auxiliar (probability=True) solo para el ensemble…")
    svm_for_ensemble = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", SVC(kernel="rbf", random_state=RANDOM_STATE, probability=True)),
        ]
    )
    svm_for_ensemble.fit(X_train, y_train)

    proba_xgb = models["xgb"].predict_proba(X_test)
    proba_rf = models["rf"].predict_proba(X_test)
    proba_logreg = models["logreg"].predict_proba(X_test)
    proba_svm = svm_for_ensemble.predict_proba(X_test)

    # Verificación de orden de clases antes de promediar columnas de probabilidad.
    # rf/logreg/svm exponen las clases originales (strings) en .classes_, en el
    # mismo orden que label_encoder.classes_ (ambos ordenan alfabéticamente).
    assert list(label_encoder.classes_) == list(models["rf"].classes_)
    assert list(label_encoder.classes_) == list(models["logreg"].classes_)
    assert list(label_encoder.classes_) == list(svm_for_ensemble.classes_)
    # xgb fue entrenado con labels codificadas por label_encoder, así que sus
    # clases son enteros 0..7 — por construcción de LabelEncoder, la columna j
    # de proba_xgb corresponde a label_encoder.classes_[j]. Se verifica esa
    # suposición explícitamente en vez de asumirla en silencio.
    assert list(models["xgb"].classes_) == list(range(len(label_encoder.classes_)))

    proba_ensemble = (proba_xgb + proba_rf + proba_logreg + proba_svm) / 4.0
    y_pred_ensemble = label_encoder.classes_[np.argmax(proba_ensemble, axis=1)]

    results["ensemble"] = {
        "accuracy": float(accuracy_score(y_test, y_pred_ensemble)),
        "precision_macro": float(
            precision_score(y_test, y_pred_ensemble, average="macro", zero_division=0)
        ),
        "recall_macro": float(
            recall_score(y_test, y_pred_ensemble, average="macro", zero_division=0)
        ),
        "f1_macro": float(f1_score(y_test, y_pred_ensemble, average="macro", zero_division=0)),
        "y_pred": y_pred_ensemble,
    }
    print(f"  ensemble: accuracy={results['ensemble']['accuracy']:.4f}")

    best_id = max(results, key=lambda k: results[k][PRIMARY_METRIC])
    print(
        f"Mejor modelo (por {PRIMARY_METRIC}): {best_id} "
        f"({results[best_id][PRIMARY_METRIC]:.4f}, accuracy={results[best_id]['accuracy']:.4f})"
    )

    xgb_metric = results["xgb"][PRIMARY_METRIC]
    ens_metric = results["ensemble"][PRIMARY_METRIC]
    delta_pp = (ens_metric - xgb_metric) * 100
    if best_id == "ensemble":
        marginal = abs(delta_pp) < 1.0
        print(
            f"\n>>> EL ENSEMBLE SUPERA A XGBOOST EN {PRIMARY_METRIC.upper()}: "
            f"{ens_metric:.4f} vs {xgb_metric:.4f} (+{delta_pp:.2f} pp). CASO 'GANA'.\n"
            "    Acciones manuales requeridas en index.qmd:\n"
            "    - Hero #crc-hero-result -> 'Ensemble' + nueva cifra\n"
            "    - Prosa de ## Compara los modelos -> mencionar Ensemble como mejor\n"
            "    - bestModelId ya quedó en 'ensemble' automáticamente (ver metrics.json)\n"
            + (
                "    - Mejora marginal (<1 pp): se recomienda mantener "
                "CONFUSION_MATRIX_MODEL_ID='xgb' y NO tocar la matriz de confusión "
                "ni su pie de figura."
                if marginal
                else "    - Mejora no marginal (>=1 pp): considerar regenerar la "
                "matriz de confusión para el ensemble."
            )
        )
    else:
        print(
            f"\n>>> EL ENSEMBLE NO SUPERA A XGBOOST EN {PRIMARY_METRIC.upper()}: "
            f"{ens_metric:.4f} vs {xgb_metric:.4f} ({delta_pp:+.2f} pp). CASO 'NO GANA'.\n"
            "    Acciones manuales requeridas en index.qmd: ninguna en hero/bestModelId/"
            "matriz de confusión (siguen siendo XGBoost). El ensemble se reporta en la "
            "prosa como experimento ya evaluado que no mejoró el resultado del mejor "
            "modelo individual — no como línea de trabajo futura.\n"
        )

    class_order = list(CLASS_MAP.values())  # [(id, label), ...] en orden 01..08
    class_ids = [c[0] for c in class_order]
    class_labels = [c[1] for c in class_order]

    cm_model_id = CONFUSION_MATRIX_MODEL_ID or best_id
    print(f"Matriz de confusión generada para: {cm_model_id}")
    cm = confusion_matrix(y_test, results[cm_model_id]["y_pred"], labels=class_ids)
    plot_confusion(cm, class_labels, IMAGES_DIR / "crc-confusion-matrix.png")
    plot_comparison(
        {k: v for k, v in results.items()}, best_id, IMAGES_DIR / "crc-model-comparison.png"
    )

    print("Guardando parches de ejemplo por clase…")
    save_class_samples(paths_test, y_test, CLASS_MAP)

    print("Guardando manifiesto del split (baseline, aleatorio por patch)…")
    split_manifest = compute_split_manifest(paths_train, paths_test, DATA_ROOT)
    SPLIT_MANIFEST_PATH.write_text(json.dumps(split_manifest, indent=2, ensure_ascii=False))
    print(f"Escrito {SPLIT_MANIFEST_PATH}")

    print(f"Calculando métricas por clase y análisis de errores para: {cm_model_id}…")
    per_class_metrics = compute_per_class_metrics(y_test, results[cm_model_id]["y_pred"], class_order)
    confusion_payload = compute_confusion_payload(cm, class_order)
    top_pairs = top_confusion_pairs(cm, class_order)
    clinical_scenarios = compute_clinical_scenarios(per_class_metrics)

    # Confianza para la galería: XGBoost/RF/LogReg exponen predict_proba de forma
    # nativa; si cm_model_id fuera SVM con probability=False, no se reporta score
    # (ver manejo especial en grouped_evaluation.py, que sí puede reentrenar con
    # probability=True cuando corresponde).
    proba_matrix, proba_class_order, probability_type = None, None, None
    baseline_model = models.get(cm_model_id)
    if baseline_model is not None and hasattr(baseline_model, "predict_proba"):
        if cm_model_id == "xgb":
            proba_matrix = baseline_model.predict_proba(X_test)
            proba_class_order = [label_encoder.classes_[i] for i in range(len(label_encoder.classes_))]
        elif cm_model_id != "svm" or getattr(baseline_model.named_steps["clf"], "probability", False):
            proba_matrix = baseline_model.predict_proba(X_test)
            proba_class_order = list(baseline_model.classes_)
        probability_type = "predict_proba" if proba_matrix is not None else None

    print("Guardando galería de misclassifications (baseline, referencia en analysis/)…")
    misclassified_examples = save_misclassified_gallery(
        paths_test,
        y_test,
        results[cm_model_id]["y_pred"],
        top_pairs,
        ERRORS_DIR,
        POST_DIR,
        proba_matrix=proba_matrix,
        proba_class_order=proba_class_order,
        probability_type=probability_type,
    )

    error_analysis_payload = {
        "protocol": "baseline_patch_split",
        "modelId": cm_model_id,
        "primaryMetric": PRIMARY_METRIC,
        "classOrder": class_ids,
        "classLabels": class_labels,
        "perClass": per_class_metrics,
        "confusionMatrix": confusion_payload,
        "topConfusionPairs": top_pairs,
        "misclassifiedExamples": misclassified_examples,
        "clinicalScenarios": clinical_scenarios,
    }
    ERROR_ANALYSIS_PATH.write_text(json.dumps(error_analysis_payload, indent=2, ensure_ascii=False))
    print(f"Escrito {ERROR_ANALYSIS_PATH}")

    metrics_payload = {
        "primaryMetric": PRIMARY_METRIC,
        "protocol": "random_patch_split",
        "models": [
            {
                "id": model_id,
                "label": MODEL_DESCRIPTIONS[model_id][0],
                "description": MODEL_DESCRIPTIONS[model_id][1],
                "accuracy": round(results[model_id]["accuracy"], 4),
                "precision_macro": round(results[model_id]["precision_macro"], 4),
                "recall_macro": round(results[model_id]["recall_macro"], 4),
                "f1_macro": round(results[model_id]["f1_macro"], 4),
            }
            for model_id in results
        ],
        "bestModelId": best_id,
        "nTrain": len(X_train),
        "nTest": len(X_test),
        "literature": {
            "label": "Kather et al. (2016)",
            "accuracy": 0.874,
            "note": (
                "Cifra reportada en el resumen del artículo original para el problema de "
                "ocho clases. El resumen no especifica un clasificador único para ese "
                "resultado, por lo que no se atribuye aquí a un modelo concreto. No es un "
                "resultado calculado en este sitio ni directamente comparable "
                "metodológicamente (representación y esquema de validación distintos)."
            ),
        },
    }
    metrics_payload["models"].sort(key=lambda m: m[PRIMARY_METRIC], reverse=True)

    METRICS_JSON_PATH.write_text(json.dumps(metrics_payload, indent=2, ensure_ascii=False))

    js_content = (
        "// AUTO-GENERADO por analysis/train_models.py — no editar a mano.\n"
        "const CRC_METRICS = "
        + json.dumps(metrics_payload, indent=2, ensure_ascii=False)
        + ";\n"
    )
    METRICS_JS_PATH.write_text(js_content)

    print(f"Escrito {METRICS_JS_PATH}")
    print(f"Escrito {METRICS_JSON_PATH}")
    print("Listo.")


if __name__ == "__main__":
    main()
