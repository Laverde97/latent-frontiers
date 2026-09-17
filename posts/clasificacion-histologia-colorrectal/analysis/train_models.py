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
    confusion_matrix,
)

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

RANDOM_STATE = 42
TEST_SIZE = 0.20

DATA_ROOT = (
    Path.home()
    / ".cache"
    / "lf-crc-2016"
    / "extracted"
    / "Kather_texture_2016_image_tiles_5000"
)
POST_DIR = Path(__file__).resolve().parent.parent
IMAGES_DIR = POST_DIR / "images"
ANALYSIS_DIR = Path(__file__).resolve().parent
METRICS_JS_PATH = POST_DIR / "crc-metrics.js"
METRICS_JSON_PATH = ANALYSIS_DIR / "metrics.json"

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
}

LF_BLUE = "#1D4E89"
LF_NAVY = "#0B1E3D"
LF_MUTED = "#6B7280"
LF_SURFACE = "#F7F9FC"
LF_LINE = "#E2E8F0"


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


def plot_comparison(results: dict, best_id: str, out_path: Path):
    order = sorted(results.items(), key=lambda kv: kv[1]["accuracy"], reverse=True)
    labels = [MODEL_DESCRIPTIONS[k][0] for k, _ in order]
    values = [v["accuracy"] * 100 for _, v in order]
    colors = [LF_BLUE if k == best_id else LF_MUTED for k, _ in order]

    fig, ax = plt.subplots(figsize=(6.4, 0.6 * len(order) + 1.2))
    y_pos = np.arange(len(order))[::-1]
    ax.barh(y_pos, values, color=colors, height=0.55, zorder=3)
    for y, v in zip(y_pos, values):
        ax.text(v + 1.0, y, f"{v:.1f}%", va="center", ha="left", fontsize=10, color="#1A1A1A")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=10.5, color="#1A1A1A")
    ax.set_xlim(0, max(values) + 10)
    ax.set_xlabel("Accuracy (%)", fontsize=9.5, color=LF_MUTED)
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

    best_id = max(results, key=lambda k: results[k]["accuracy"])
    print(f"Mejor modelo: {best_id} ({results[best_id]['accuracy']:.4f} accuracy)")

    class_order = list(CLASS_MAP.values())  # [(id, label), ...] en orden 01..08
    class_ids = [c[0] for c in class_order]
    class_labels = [c[1] for c in class_order]

    cm = confusion_matrix(y_test, results[best_id]["y_pred"], labels=class_ids)
    plot_confusion(cm, class_labels, IMAGES_DIR / "crc-confusion-matrix.png")
    plot_comparison(
        {k: v for k, v in results.items()}, best_id, IMAGES_DIR / "crc-model-comparison.png"
    )

    print("Guardando parches de ejemplo por clase…")
    save_class_samples(paths_test, y_test, CLASS_MAP)

    metrics_payload = {
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
    metrics_payload["models"].sort(key=lambda m: m["accuracy"], reverse=True)

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
