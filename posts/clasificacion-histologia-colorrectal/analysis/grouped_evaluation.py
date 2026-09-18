"""Evaluación agrupada por espécimen/lámina (Kather-CRC-2016).

train_models.py mide el desempeño con un split aleatorio ESTRATIFICADO POR PATCH:
el mismo espécimen puede tener imágenes en train y en test, lo que puede inflar el
resultado si el modelo aprende algo específico de cada espécimen (tinción, escáner,
iluminación) en vez de solo el tipo de tejido. Este script mide, con datos reales,
cuánto cambia el resultado cuando eso se evita por completo.

Estrategia: LeaveOneGroupOut (LOGO), donde el grupo es el espécimen/lámina extraído
del nombre de archivo (patrón "CRC-Prim-HE-<NN>", NN=01..10 — ver extract_group_id
en train_models.py). El dataset solo permite demostrar "espécimen/lámina", nunca
"paciente" (ver _README_RENDER.md), así que ese es el término usado en todo este
script y en el artículo.

Por qué LOGO y no GroupKFold/StratifiedGroupKFold/GroupShuffleSplit: con solo 10
especímenes, y con clases muy concentradas en unos pocos de ellos (p.ej. la clase
"fondo" solo tiene ejemplos en 2 de los 10 especímenes — ver
group_class_crosstab.json), ninguna estrategia de split agrupado garantiza que
cada fold individual cubra las 8 clases en su conjunto de evaluación. LOGO usa los
10 especímenes como 10 folds naturales, sin ningún parámetro arbitrario (ni un k
de folds, ni un tamaño de test elegido a mano), y garantiza que, acumulando los 10
folds, cada una de las 5000 imágenes recibe EXACTAMENTE una predicción out-of-group
(de un modelo que nunca vio su espécimen). Eso es lo único que hace falta para
calcular un F1 macro "pooled out-of-fold" sobre las 8 clases — la métrica PRIMARIA
de este protocolo. El F1 macro calculado por separado en cada fold es inestable
(la mayoría de los folds no tienen ejemplos de "fondo" ni, en algunos casos, de
otras clases) y se reporta solo como diagnóstico secundario de variabilidad, nunca
como sustituto del pooled OOF ni para redefinir qué clases cuenta cada fold.

La elección de especímenes de evaluación es siempre programática (los 10 folds de
LOGO, determinados por los datos, no por conveniencia) — en ningún momento se
selecciona a mano un fold o un subconjunto de especímenes tras ver resultados.

Uso:
    source ~/.venvs/lf-crc-article/bin/activate
    python analysis/grouped_evaluation.py
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from sklearn.model_selection import LeaveOneGroupOut
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.metrics import accuracy_score, f1_score, confusion_matrix
from xgboost import XGBClassifier

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from train_models import (
    RANDOM_STATE,
    CLASS_MAP,
    MODEL_DESCRIPTIONS,
    POST_DIR,
    ANALYSIS_DIR,
    IMAGES_DIR,
    ERRORS_DIR,
    LF_BLUE,
    LF_MUTED,
    LF_LINE,
    build_dataset,
    extract_group_id,
    compute_confusion_payload,
    top_confusion_pairs,
    save_misclassified_gallery,
    plot_confusion,
)

GROUPED_METRICS_JSON_PATH = ANALYSIS_DIR / "grouped_evaluation.json"
CROSSTAB_JSON_PATH = ANALYSIS_DIR / "group_class_crosstab.json"
BASELINE_METRICS_JSON_PATH = ANALYSIS_DIR / "metrics.json"
PROTOCOL_COMPARISON_IMG_PATH = IMAGES_DIR / "crc-split-protocol-comparison.png"
GROUPED_CONFUSION_IMG_PATH = IMAGES_DIR / "crc-confusion-matrix-grouped.png"

INDIVIDUAL_MODEL_IDS = ["logreg", "tree", "rf", "knn", "svm", "xgb"]


def build_fold_models() -> dict[str, Pipeline]:
    """Instancias nuevas de los 6 modelos individuales, entrenadas desde cero en cada fold.

    SVM usa probability=True aquí (a diferencia de la fila "svm" del comparativo
    baseline en train_models.py, que usa probability=False): hace falta de todas
    formas para el ensemble agrupado, y de paso permite reportar una probabilidad
    real (no un decision_score) si SVM resulta ser el mejor modelo individual.
    """
    return {
        "logreg": Pipeline(
            [("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=2000, random_state=RANDOM_STATE))]
        ),
        "tree": Pipeline([("scaler", StandardScaler()), ("clf", DecisionTreeClassifier(random_state=RANDOM_STATE))]),
        "rf": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", RandomForestClassifier(n_estimators=300, random_state=RANDOM_STATE, n_jobs=-1)),
            ]
        ),
        "knn": Pipeline([("scaler", StandardScaler()), ("clf", KNeighborsClassifier(n_neighbors=5))]),
        "svm": Pipeline(
            [("scaler", StandardScaler()), ("clf", SVC(kernel="rbf", random_state=RANDOM_STATE, probability=True))]
        ),
        "xgb": Pipeline(
            [
                ("scaler", StandardScaler()),
                ("clf", XGBClassifier(n_estimators=300, random_state=RANDOM_STATE, eval_metric="mlogloss")),
            ]
        ),
    }


def plot_protocol_comparison(baseline_by_id: dict, grouped_results: dict, out_path: Path):
    model_ids = [m for m in INDIVIDUAL_MODEL_IDS + ["ensemble"] if m in baseline_by_id and m in grouped_results]
    model_ids.sort(key=lambda m: grouped_results[m]["f1MacroPooledOof"], reverse=True)
    labels = [MODEL_DESCRIPTIONS[m][0] for m in model_ids]
    baseline_vals = [baseline_by_id[m]["f1_macro"] * 100 for m in model_ids]
    grouped_vals = [grouped_results[m]["f1MacroPooledOof"] * 100 for m in model_ids]

    x = np.arange(len(model_ids))
    width = 0.36
    fig, ax = plt.subplots(figsize=(7.2, 4.6))
    ax.bar(x - width / 2, baseline_vals, width, label="Aleatorio por patch (baseline)", color=LF_MUTED, zorder=3)
    ax.bar(x + width / 2, grouped_vals, width, label="Agrupado por espécimen (pooled OOF)", color=LF_BLUE, zorder=3)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=20, ha="right", fontsize=9.5, color="#1A1A1A")
    ax.set_ylabel("F1 macro (%)", fontsize=9.5, color=LF_MUTED)
    ax.set_ylim(0, max(baseline_vals + grouped_vals) + 12)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.spines["left"].set_color(LF_LINE)
    ax.spines["bottom"].set_color(LF_LINE)
    ax.tick_params(axis="y", colors=LF_MUTED, labelsize=9)
    ax.legend(frameon=False, fontsize=9, loc="upper right")
    ax.set_axisbelow(True)
    ax.grid(axis="y", color=LF_LINE, linewidth=0.6, zorder=0)
    fig.tight_layout()
    fig.savefig(out_path, dpi=180, facecolor="white")
    plt.close(fig)


def main():
    print("Cargando dataset (usa la caché de características si existe)…")
    X, y, paths = build_dataset()
    n = len(y)
    class_order = list(CLASS_MAP.values())
    class_ids = [c[0] for c in class_order]
    class_labels = [c[1] for c in class_order]

    groups = np.array([extract_group_id(Path(p)) for p in paths])
    unique_groups = sorted(set(groups))
    print(f"Grupos (especímenes/láminas) encontrados: {unique_groups}\n")

    # --- Crosstab espécimen x clase: diagnóstico de viabilidad (Paso 0) ---
    crosstab = {g: {c: 0 for c in class_ids} for g in unique_groups}
    for g, label in zip(groups, y):
        crosstab[g][label] += 1
    missing_by_group = {g: [c for c in class_ids if crosstab[g][c] == 0] for g in unique_groups}
    crosstab_payload = {
        "groups": unique_groups,
        "classIds": class_ids,
        "counts": crosstab,
        "missingClassesByGroup": missing_by_group,
        "note": (
            "Cada fold de LeaveOneGroupOut deja fuera un espécimen como conjunto de "
            "evaluación. 'missingClassesByGroup' indica qué clases no tienen NINGÚN "
            "ejemplo en ese espécimen y por tanto no pueden evaluarse en ese fold "
            "concreto (aunque sí participan en el entrenamiento de ese mismo fold si "
            "aparecen en alguno de los otros 9 especímenes). Esto motiva usar el F1 "
            "macro pooled out-of-fold, sobre los 10 folds acumulados, como métrica "
            "primaria en vez del F1 macro de cada fold por separado."
        ),
    }
    CROSSTAB_JSON_PATH.write_text(json.dumps(crosstab_payload, indent=2, ensure_ascii=False))
    print(f"Escrito {CROSSTAB_JSON_PATH}")

    strategy = "LeaveOneGroupOut"
    strategy_justification = (
        f"Con solo {len(unique_groups)} especímenes y clases muy concentradas en unos "
        "pocos de ellos (p.ej. 'fondo' solo existe en 2 de los 10 — ver "
        "group_class_crosstab.json), StratifiedGroupKFold y GroupKFold con k<10 no "
        "garantizan cobertura de las 8 clases en cada fold, y GroupShuffleSplit "
        "requeriría fijar arbitrariamente cuántos especímenes van a test. "
        "LeaveOneGroupOut usa los 10 especímenes como 10 folds naturales, sin ningún "
        "parámetro libre, y garantiza que cada imagen del dataset recibe exactamente "
        "una predicción out-of-group al acumular los 10 folds — suficiente para un F1 "
        "macro pooled out-of-fold sobre las 8 clases, aunque los folds individuales no "
        "cubran las 8 clases cada uno."
    )
    print(f"Estrategia elegida (programática): {strategy}")
    print(f"  {strategy_justification}\n")

    logo = LeaveOneGroupOut()
    label_encoder = LabelEncoder().fit(y)

    y_pred_oof = {mid: np.empty(n, dtype=object) for mid in INDIVIDUAL_MODEL_IDS}
    y_proba_oof = {mid: np.zeros((n, len(class_ids)), dtype=float) for mid in INDIVIDUAL_MODEL_IDS}
    y_pred_oof_ensemble = np.empty(n, dtype=object)

    per_fold_diagnostics = []
    t_total = time.time()

    for fold_i, (train_idx, test_idx) in enumerate(logo.split(X, y, groups), start=1):
        held_out_group = groups[test_idx[0]]
        assert not (set(groups[train_idx]) & set(groups[test_idx])), (
            f"Fuga de grupo detectada en el fold del espécimen {held_out_group}"
        )
        t0 = time.time()
        models = build_fold_models()
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test_fold = y[train_idx], y[test_idx]

        proba_by_model = {}
        for mid, pipeline in models.items():
            if mid == "xgb":
                pipeline.fit(X_train, label_encoder.transform(y_train))
                proba_raw = pipeline.predict_proba(X_test)
                proba_class_order = list(label_encoder.classes_)
            else:
                pipeline.fit(X_train, y_train)
                proba_raw = pipeline.predict_proba(X_test)
                proba_class_order = list(pipeline.classes_)

            col_idx = [proba_class_order.index(c) for c in class_ids]
            proba = proba_raw[:, col_idx]
            pred = np.array(class_ids)[np.argmax(proba, axis=1)]

            y_pred_oof[mid][test_idx] = pred
            y_proba_oof[mid][test_idx] = proba
            proba_by_model[mid] = proba

        # Ensemble (mismo esquema que train_models.py): xgb+rf+logreg+svm, voto suave.
        proba_ensemble = (
            proba_by_model["xgb"] + proba_by_model["rf"] + proba_by_model["logreg"] + proba_by_model["svm"]
        ) / 4.0
        pred_ensemble = np.array(class_ids)[np.argmax(proba_ensemble, axis=1)]
        y_pred_oof_ensemble[test_idx] = pred_ensemble

        present_classes = sorted(set(y_test_fold))
        fold_f1 = {
            mid: float(
                f1_score(y_test_fold, y_pred_oof[mid][test_idx], labels=present_classes, average="macro", zero_division=0)
            )
            for mid in INDIVIDUAL_MODEL_IDS
        }
        fold_f1["ensemble"] = float(
            f1_score(y_test_fold, pred_ensemble, labels=present_classes, average="macro", zero_division=0)
        )
        per_fold_diagnostics.append(
            {
                "heldOutGroup": held_out_group,
                "nTest": int(len(test_idx)),
                "classesPresentInTest": present_classes,
                "classesMissingInTest": [c for c in class_ids if c not in present_classes],
                "f1MacroPresentClassesOnly": fold_f1,
            }
        )
        print(
            f"  Fold {fold_i}/{len(unique_groups)} (espécimen {held_out_group}, "
            f"n_test={len(test_idx)}, clases ausentes en test={len(class_ids) - len(present_classes)}): "
            f"{time.time() - t0:.1f}s"
        )

    print(f"\nLOGO completo en {time.time() - t_total:.1f}s\n")

    assert all((y_pred_oof[mid] != None).all() for mid in INDIVIDUAL_MODEL_IDS)  # noqa: E711
    assert (y_pred_oof_ensemble != None).all()  # noqa: E711

    results = {}
    for mid in INDIVIDUAL_MODEL_IDS:
        per_fold_vals = [f["f1MacroPresentClassesOnly"][mid] for f in per_fold_diagnostics]
        results[mid] = {
            "accuracyPooledOof": float(accuracy_score(y, y_pred_oof[mid])),
            "f1MacroPooledOof": float(f1_score(y, y_pred_oof[mid], labels=class_ids, average="macro", zero_division=0)),
            "f1MacroPerFoldMean": float(np.mean(per_fold_vals)),
            "f1MacroPerFoldStd": float(np.std(per_fold_vals)),
        }
    ens_per_fold_vals = [f["f1MacroPresentClassesOnly"]["ensemble"] for f in per_fold_diagnostics]
    results["ensemble"] = {
        "accuracyPooledOof": float(accuracy_score(y, y_pred_oof_ensemble)),
        "f1MacroPooledOof": float(f1_score(y, y_pred_oof_ensemble, labels=class_ids, average="macro", zero_division=0)),
        "f1MacroPerFoldMean": float(np.mean(ens_per_fold_vals)),
        "f1MacroPerFoldStd": float(np.std(ens_per_fold_vals)),
    }

    best_individual_model_id = max(INDIVIDUAL_MODEL_IDS, key=lambda m: results[m]["f1MacroPooledOof"])
    print("Resultados (F1 macro pooled out-of-fold, métrica PRIMARIA de este protocolo):")
    for mid in INDIVIDUAL_MODEL_IDS + ["ensemble"]:
        marker = "  <-- mejor INDIVIDUAL" if mid == best_individual_model_id else ""
        print(
            f"  {mid:8s} pooled_oof={results[mid]['f1MacroPooledOof']:.4f}  "
            f"per_fold={results[mid]['f1MacroPerFoldMean']:.4f}±{results[mid]['f1MacroPerFoldStd']:.4f} (secundario)"
            f"{marker}"
        )
    print(f"\nMejor modelo individual bajo evaluación agrupada: {best_individual_model_id}")
    if results["ensemble"]["f1MacroPooledOof"] > results[best_individual_model_id]["f1MacroPooledOof"]:
        print(
            "  Nota: el ensemble agrupado supera a este mejor individual bajo el MISMO "
            "protocolo — se reporta como dato adicional en el JSON, pero la galería/figura "
            "de errores usan el mejor modelo INDIVIDUAL, no el ensemble."
        )

    cm = confusion_matrix(y, y_pred_oof[best_individual_model_id], labels=class_ids)
    confusion_payload = compute_confusion_payload(cm, class_order)
    top_pairs = top_confusion_pairs(cm, class_order)
    plot_confusion(cm, class_labels, GROUPED_CONFUSION_IMG_PATH)
    print(f"Escrito {GROUPED_CONFUSION_IMG_PATH}")

    print(f"\nGuardando galería de misclassifications OUT-OF-GROUP (modelo: {best_individual_model_id})…")
    misclassified_examples = save_misclassified_gallery(
        [Path(p) for p in paths],
        y,
        y_pred_oof[best_individual_model_id],
        top_pairs,
        ERRORS_DIR,
        POST_DIR,
        proba_matrix=y_proba_oof[best_individual_model_id],
        proba_class_order=class_ids,
        probability_type="predict_proba",
        filename_prefix="err-grouped",
    )
    for ex in misclassified_examples:
        ex["sourceProtocol"] = "grouped_out_of_group"

    delta_vs_baseline = {}
    baseline_by_id = {}
    if BASELINE_METRICS_JSON_PATH.exists():
        baseline = json.loads(BASELINE_METRICS_JSON_PATH.read_text())
        baseline_by_id = {m["id"]: m for m in baseline["models"]}
        for mid in INDIVIDUAL_MODEL_IDS + ["ensemble"]:
            if mid in baseline_by_id:
                delta_vs_baseline[mid] = round(results[mid]["f1MacroPooledOof"] - baseline_by_id[mid]["f1_macro"], 4)
        plot_protocol_comparison(baseline_by_id, results, PROTOCOL_COMPARISON_IMG_PATH)
        print(f"Escrito {PROTOCOL_COMPARISON_IMG_PATH}")
    else:
        print(
            f"AVISO: no se encontró {BASELINE_METRICS_JSON_PATH} — ejecutar train_models.py "
            "primero para poder comparar contra el baseline y generar el gráfico comparativo."
        )

    grouped_payload = {
        "protocol": "grouped_specimen_leave_one_group_out",
        "primaryMetric": "f1_macro_pooled_oof",
        "groupIdSource": (
            "Identificador NN extraído de 'CRC-Prim-HE-NN' en el nombre de archivo — "
            "espécimen/lámina de origen. El dataset no permite demostrar que corresponda "
            "a un paciente distinto; nunca se usa el término 'paciente'."
        ),
        "strategy": strategy,
        "strategyJustification": strategy_justification,
        "nGroups": len(unique_groups),
        "nImages": n,
        "crosstabPath": "analysis/group_class_crosstab.json",
        "results": results,
        "bestIndividualModelId": best_individual_model_id,
        "ensembleEvaluated": True,
        "deltaF1MacroPooledOofVsBaseline": delta_vs_baseline,
        "classOrder": class_ids,
        "classLabels": class_labels,
        "confusionMatrix": confusion_payload,
        "topConfusionPairs": top_pairs,
        "misclassifiedExamples": misclassified_examples,
        "perFoldDiagnostics": per_fold_diagnostics,
    }
    GROUPED_METRICS_JSON_PATH.write_text(json.dumps(grouped_payload, indent=2, ensure_ascii=False))
    print(f"Escrito {GROUPED_METRICS_JSON_PATH}")
    print("Listo.")


if __name__ == "__main__":
    main()
