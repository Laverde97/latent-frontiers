"""CNN opcional (Kather-CRC-2016): ¿ayuda aprender directamente de los píxeles?

Pregunta que responde este script: ¿una CNN pequeña, entrenada directamente
sobre los píxeles H&E, captura información espacial que los 45 descriptores
manuales de color/textura de train_models.py no capturan? No busca el máximo
accuracy posible ni compite en tamaño con arquitecturas de producción — es un
baseline exploratorio, metodológicamente limpio.

Framework: PyTorch (TensorFlow no tiene wheels disponibles para Python 3.14 en
este entorno; ver ../_README_RENDER.md). Entorno: venv dedicado y separado
~/.venvs/lf-crc-cnn (no se reutiliza ~/.venvs/lf-crc-article, para no arriesgar
esa dependencia ya verificada con el árbol de paquetes de PyTorch).

Split: se intenta independencia por grupo (espécimen/lámina) también para la
CNN, igual que en grouped_evaluation.py, pero con un esquema distinto: ahí se
usó LeaveOneGroupOut (CV agrupada, sin un test holdout único); aquí se separan
train/val/test por espécimen con GroupShuffleSplit (semilla fija, programático,
nunca elegido a mano tras ver resultados), reutilizando exactamente el mismo
extract_group_id() que en train_models.py/grouped_evaluation.py. El conjunto de
test NUNCA participa en el entrenamiento, en early stopping ni en la selección
de arquitectura/hiperparámetros — se evalúa una sola vez, al final.

Uso:
    source ~/.venvs/lf-crc-cnn/bin/activate
    python analysis/train_cnn.py
"""

from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.model_selection import GroupShuffleSplit
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    f1_score,
    confusion_matrix,
)

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# NOTA: no se importa train_models.py aquí a propósito. Ese módulo carga, a
# nivel de módulo, scikit-image/xgboost/matplotlib — dependencias del venv
# ~/.venvs/lf-crc-article que no tiene sentido instalar en el venv dedicado de
# la CNN (~/.venvs/lf-crc-cnn) solo para reusar tres funciones pequeñas y
# puras. Se duplican aquí en su lugar (mismo código, mismo contrato).

DATA_ROOT = (
    Path.home() / ".cache" / "lf-crc-2016" / "extracted" / "Kather_texture_2016_image_tiles_5000"
)
ANALYSIS_DIR = Path(__file__).resolve().parent

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

GROUP_ID_PATTERN = re.compile(r"CRC-Prim-HE-(\d{2})")


def extract_group_id(img_path: Path) -> str:
    match = GROUP_ID_PATTERN.search(img_path.name)
    if not match:
        raise ValueError(f"No se pudo extraer group_id de: {img_path.name}")
    return match.group(1)


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


TUMOR_CLASS_ID = "tumor"


def _confusion_category(true_id: str, pred_id: str) -> str:
    if true_id == TUMOR_CLASS_ID and pred_id != TUMOR_CLASS_ID:
        return "tumor_to_non_tumor"
    if true_id != TUMOR_CLASS_ID and pred_id == TUMOR_CLASS_ID:
        return "non_tumor_to_tumor"
    return "non_tumor_to_non_tumor"


def top_confusion_pairs(cm: np.ndarray, class_order, k: int = 3) -> list[dict]:
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


RANDOM_STATE = 42
IMG_SIZE = 150
BATCH_SIZE = 64
MAX_EPOCHS = 60
EARLY_STOPPING_PATIENCE = 8
LEARNING_RATE = 1e-3

CNN_METRICS_PATH = ANALYSIS_DIR / "cnn_metrics.json"
CNN_SPLIT_MANIFEST_PATH = ANALYSIS_DIR / "cnn_split_manifest.json"
BASELINE_METRICS_PATH = ANALYSIS_DIR / "metrics.json"
GROUPED_METRICS_PATH = ANALYSIS_DIR / "grouped_evaluation.json"

VALID_EXTS = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".bmp"}


def set_seeds(seed: int = RANDOM_STATE):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def list_dataset_paths():
    class_order = list(CLASS_MAP.values())
    class_ids = [c[0] for c in class_order]
    paths, labels = [], []
    for folder, (class_id, _label) in CLASS_MAP.items():
        d = DATA_ROOT / folder
        files = sorted(f for f in d.iterdir() if f.suffix.lower() in VALID_EXTS)
        paths.extend(files)
        labels.extend([class_id] * len(files))
    return np.array(paths, dtype=object), np.array(labels), class_ids, [c[1] for c in class_order]


class PatchDataset(Dataset):
    """Carga píxeles RGB crudos (150x150, normalizados a [0,1]). SIN las 45
    features manuales: la CNN debe aprender directamente de la imagen."""

    def __init__(self, paths, labels, class_ids, train: bool):
        self.paths = paths
        self.labels = labels
        self.class_to_idx = {c: i for i, c in enumerate(class_ids)}
        self.train = train

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, idx):
        img = Image.open(self.paths[idx]).convert("RGB")
        if img.size != (IMG_SIZE, IMG_SIZE):
            img = img.resize((IMG_SIZE, IMG_SIZE), Image.LANCZOS)

        if self.train:
            # Augmentation MODERADO, solo en train: flips + rotaciones pequeñas
            # (±15°) + traslaciones pequeñas (hasta ~5% del tamaño del parche).
            # Deliberadamente conservador: nada de cambios de color/tinción, que
            # alterarían artificialmente la señal H&E que este experimento mide.
            if random.random() < 0.5:
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
            if random.random() < 0.5:
                img = img.transpose(Image.FLIP_TOP_BOTTOM)
            angle = random.uniform(-15, 15)
            img = img.rotate(angle, resample=Image.BILINEAR, fillcolor=(255, 255, 255))
            max_shift = int(0.05 * IMG_SIZE)  # ~7px sobre 150px
            dx = random.randint(-max_shift, max_shift)
            dy = random.randint(-max_shift, max_shift)
            img = img.transform(
                img.size, Image.AFFINE, (1, 0, dx, 0, 1, dy), resample=Image.BILINEAR, fillcolor=(255, 255, 255)
            )

        arr = np.asarray(img, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(arr.copy()).permute(2, 0, 1)
        label = self.class_to_idx[self.labels[idx]]
        return tensor, label


class SmallCNN(nn.Module):
    """Conv2D+ReLU+MaxPool x3 -> GlobalAveragePooling2D -> Dense -> Dropout -> Softmax(8).
    Softmax es implícito: la última capa produce logits y se entrena con
    CrossEntropyLoss (equivalente a softmax + NLL), convención estándar en PyTorch."""

    def __init__(self, n_classes: int = 8):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
        )
        self.gap = nn.AdaptiveAvgPool2d(1)
        self.fc1 = nn.Linear(64, 64)
        self.dropout = nn.Dropout(0.3)
        self.fc2 = nn.Linear(64, n_classes)

    def forward(self, x):
        x = self.features(x)
        x = self.gap(x).flatten(1)
        x = torch.relu(self.fc1(x))
        x = self.dropout(x)
        return self.fc2(x)


def run_epoch(model, loader, device, lossfn, optimizer=None):
    train_mode = optimizer is not None
    model.train(train_mode)
    total_loss, n = 0.0, 0
    all_preds, all_labels = [], []
    for x, y in loader:
        x, y = x.to(device), y.to(device)
        if train_mode:
            optimizer.zero_grad()
        with torch.set_grad_enabled(train_mode):
            logits = model(x)
            loss = lossfn(logits, y)
            if train_mode:
                loss.backward()
                optimizer.step()
        total_loss += loss.item() * x.size(0)
        n += x.size(0)
        all_preds.append(logits.argmax(1).detach().cpu().numpy())
        all_labels.append(y.cpu().numpy())
    return total_loss / n, np.concatenate(all_preds), np.concatenate(all_labels)


def main():
    set_seeds(RANDOM_STATE)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Dispositivo: {device}")
    if device == "cuda":
        print(f"  GPU: {torch.cuda.get_device_name(0)}")

    paths, labels, class_ids, class_labels = list_dataset_paths()
    groups = np.array([extract_group_id(Path(p)) for p in paths])
    n = len(paths)
    print(f"Dataset: {n} imágenes, {len(set(groups))} especímenes.")

    # --- Split group-disjoint train/val/test (GroupShuffleSplit, semilla fija) ---
    gss_test = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
    trainval_idx, test_idx = next(gss_test.split(paths, labels, groups))

    gss_val = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=RANDOM_STATE)
    train_idx_rel, val_idx_rel = next(
        gss_val.split(paths[trainval_idx], labels[trainval_idx], groups[trainval_idx])
    )
    train_idx = trainval_idx[train_idx_rel]
    val_idx = trainval_idx[val_idx_rel]

    test_groups = sorted(set(groups[test_idx]))
    val_groups = sorted(set(groups[val_idx]))
    train_groups = sorted(set(groups[train_idx]))
    assert not (set(train_groups) & set(val_groups) & set(test_groups))
    assert not (set(train_groups) & set(test_groups))
    assert not (set(val_groups) & set(test_groups))
    assert not (set(train_groups) & set(val_groups))
    group_disjoint = True

    print(f"Split group-disjoint (GroupShuffleSplit, random_state={RANDOM_STATE}):")
    print(f"  train: {len(train_idx)} imágenes, especímenes {train_groups}")
    print(f"  val:   {len(val_idx)} imágenes, especímenes {val_groups}")
    print(f"  test:  {len(test_idx)} imágenes, especímenes {test_groups}")

    split_manifest = {
        "splitType": "group_disjoint_specimen_gss",
        "randomState": RANDOM_STATE,
        "groupDisjoint": group_disjoint,
        "nTrain": int(len(train_idx)),
        "nVal": int(len(val_idx)),
        "nTest": int(len(test_idx)),
        "trainGroups": train_groups,
        "valGroups": val_groups,
        "testGroups": test_groups,
        "note": (
            "Split distinto al LeaveOneGroupOut de grouped_evaluation.py (aquí "
            "train/val/test fijos, allá CV agrupada de 10 folds), pero igualmente "
            "group-disjoint: ningún espécimen aparece en más de uno de los tres "
            "conjuntos. El conjunto de test no participó en el entrenamiento ni en "
            "el early stopping."
        ),
    }
    CNN_SPLIT_MANIFEST_PATH.write_text(json.dumps(split_manifest, indent=2, ensure_ascii=False))
    print(f"Escrito {CNN_SPLIT_MANIFEST_PATH}")

    train_ds = PatchDataset(paths[train_idx], labels[train_idx], class_ids, train=True)
    val_ds = PatchDataset(paths[val_idx], labels[val_idx], class_ids, train=False)
    test_ds = PatchDataset(paths[test_idx], labels[test_idx], class_ids, train=False)

    g = torch.Generator().manual_seed(RANDOM_STATE)
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True, generator=g, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False, num_workers=0)

    model = SmallCNN(n_classes=len(class_ids)).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Parámetros del modelo: {n_params}")

    optimizer = torch.optim.Adam(model.parameters(), lr=LEARNING_RATE)
    lossfn = nn.CrossEntropyLoss()

    best_val_loss = float("inf")
    best_state = None
    best_epoch = 0
    epochs_without_improvement = 0
    history = []

    t_total = time.time()
    for epoch in range(1, MAX_EPOCHS + 1):
        t0 = time.time()
        train_loss, _, _ = run_epoch(model, train_loader, device, lossfn, optimizer=optimizer)
        val_loss, val_preds, val_labels = run_epoch(model, val_loader, device, lossfn)
        val_acc = float((val_preds == val_labels).mean())
        history.append(
            {"epoch": epoch, "trainLoss": train_loss, "valLoss": val_loss, "valAccuracy": val_acc}
        )
        print(
            f"  Epoch {epoch:2d}/{MAX_EPOCHS}: train_loss={train_loss:.4f} "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.4f} ({time.time() - t0:.1f}s)"
        )

        if val_loss < best_val_loss - 1e-4:
            best_val_loss = val_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            best_epoch = epoch
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            if epochs_without_improvement >= EARLY_STOPPING_PATIENCE:
                print(f"  Early stopping en epoch {epoch} (sin mejora en {EARLY_STOPPING_PATIENCE} epochs).")
                break

    training_time_s = time.time() - t_total
    print(f"Entrenamiento completo en {training_time_s:.1f}s. Mejor epoch: {best_epoch} (val_loss={best_val_loss:.4f}).")

    model.load_state_dict(best_state)

    # --- Evaluación ÚNICA sobre el test set intacto ---
    print("Evaluando UNA sola vez sobre el test set (nunca usado antes de este punto)…")
    _, test_preds, test_labels = run_epoch(model, test_loader, device, lossfn)
    test_preds_ids = np.array([class_ids[i] for i in test_preds])
    test_labels_ids = np.array([class_ids[i] for i in test_labels])

    accuracy = float(accuracy_score(test_labels_ids, test_preds_ids))
    precision, recall, f1, support = precision_recall_fscore_support(
        test_labels_ids, test_preds_ids, labels=class_ids, average=None, zero_division=0
    )
    f1_macro = float(np.mean(f1))
    precision_macro = float(np.mean(precision))
    recall_macro = float(np.mean(recall))

    per_class = [
        {
            "classId": cid,
            "label": lbl,
            "precision": round(float(p), 4),
            "recall": round(float(r), 4),
            "f1": round(float(f), 4),
            "support": int(s),
        }
        for cid, lbl, p, r, f, s in zip(class_ids, class_labels, precision, recall, f1, support)
    ]

    class_order = list(zip(class_ids, class_labels))
    cm = confusion_matrix(test_labels_ids, test_preds_ids, labels=class_ids)
    confusion_payload = compute_confusion_payload(cm, class_order)
    top_pairs = top_confusion_pairs(cm, class_order)

    print(f"Test — accuracy={accuracy:.4f}  F1 macro={f1_macro:.4f}")

    # --- Comparación con XGBoost, SOLO bajo protocolos equivalentes (group-disjoint) ---
    comparison = {"note": "Comparaciones solo entre protocolos group-disjoint equivalentes."}
    if GROUPED_METRICS_PATH.exists():
        grouped = json.loads(GROUPED_METRICS_PATH.read_text())
        xgb_grouped_f1 = grouped["results"]["xgb"]["f1MacroPooledOof"]
        comparison["xgbGroupedF1MacroPooledOof"] = xgb_grouped_f1
        comparison["cnnF1MacroGroupDisjointTest"] = f1_macro
        comparison["deltaCnnMinusXgb"] = round(f1_macro - xgb_grouped_f1, 4)
        comparison["protocolCaveat"] = (
            "Ambos números son group-disjoint (ningún espécimen compartido entre "
            "train y evaluación), pero NO es el mismo split exacto: XGBoost usa "
            "LeaveOneGroupOut (10 folds, pooled sobre las 5000 imágenes) y la CNN "
            "usa un holdout fijo de especímenes distintos. Se comparan como "
            "protocolos equivalentes en el sentido de independencia por grupo, "
            "no como el mismo conjunto de evaluación exacto."
        )

    cnn_payload = {
        "framework": "pytorch",
        "device": device,
        "architecture": "Conv2D(16)+ReLU+MaxPool -> Conv2D(32)+ReLU+MaxPool -> Conv2D(64)+ReLU+MaxPool -> GlobalAveragePooling2D -> Dense(64)+ReLU -> Dropout(0.3) -> Dense(8, logits)",
        "nParameters": int(n_params),
        "randomState": RANDOM_STATE,
        "split": split_manifest,
        "maxEpochs": MAX_EPOCHS,
        "earlyStoppingPatience": EARLY_STOPPING_PATIENCE,
        "bestEpoch": best_epoch,
        "epochsRun": len(history),
        "bestValLoss": best_val_loss,
        "trainingTimeSeconds": round(training_time_s, 1),
        "history": history,
        "test": {
            "accuracy": round(accuracy, 4),
            "precisionMacro": round(precision_macro, 4),
            "recallMacro": round(recall_macro, 4),
            "f1Macro": round(f1_macro, 4),
            "perClass": per_class,
            "confusionMatrix": confusion_payload,
            "topConfusionPairs": top_pairs,
        },
        "comparisonVsXgboostGrouped": comparison,
        "reproducibilityNote": (
            "Semillas fijas para Python, NumPy y PyTorch (incl. CUDA). El entrenamiento "
            "en GPU puede introducir variaciones numéricas menores entre hardware/backends "
            "incluso con semillas fijas (operaciones no completamente deterministas en cuDNN)."
        ),
    }
    CNN_METRICS_PATH.write_text(json.dumps(cnn_payload, indent=2, ensure_ascii=False))
    print(f"Escrito {CNN_METRICS_PATH}")
    print("Listo.")


if __name__ == "__main__":
    main()
