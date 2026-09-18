// AUTO-GENERADO por analysis/train_models.py — no editar a mano.
const CRC_METRICS = {
  "models": [
    {
      "id": "xgb",
      "label": "XGBoost",
      "description": "Construye árboles de decisión de forma secuencial, corrigiendo los errores de los anteriores. Suele ofrecer un desempeño competitivo con ajuste mínimo.",
      "accuracy": 0.944,
      "precision_macro": 0.9462,
      "recall_macro": 0.944,
      "f1_macro": 0.9442
    },
    {
      "id": "ensemble",
      "label": "Ensemble (voto suave)",
      "description": "Promedia las probabilidades de XGBoost, Random Forest, SVM (RBF) y regresión logística, y elige la clase con mayor probabilidad promedio. Combina modelos que cometen errores distintos entre sí.",
      "accuracy": 0.936,
      "precision_macro": 0.9372,
      "recall_macro": 0.936,
      "f1_macro": 0.936
    },
    {
      "id": "rf",
      "label": "Random Forest",
      "description": "Combina muchos árboles de decisión entrenados sobre subconjuntos distintos de datos y características. Suele generalizar mejor que un árbol individual.",
      "accuracy": 0.929,
      "precision_macro": 0.9305,
      "recall_macro": 0.929,
      "f1_macro": 0.929
    },
    {
      "id": "knn",
      "label": "k-NN",
      "description": "Clasifica cada imagen según la clase mayoritaria entre sus vecinos más cercanos en el espacio de características. Simple, pero sensible a la escala de los datos.",
      "accuracy": 0.927,
      "precision_macro": 0.9291,
      "recall_macro": 0.927,
      "f1_macro": 0.927
    },
    {
      "id": "svm",
      "label": "SVM (RBF)",
      "description": "Busca la frontera de decisión que separa mejor las clases, usando un kernel no lineal (RBF) para capturar relaciones complejas entre color y textura.",
      "accuracy": 0.914,
      "precision_macro": 0.9154,
      "recall_macro": 0.914,
      "f1_macro": 0.9138
    },
    {
      "id": "logreg",
      "label": "Regresión logística",
      "description": "Un modelo lineal que estima la probabilidad de cada clase combinando linealmente las características. Rápido y fácil de interpretar, aunque limitado ante relaciones no lineales complejas.",
      "accuracy": 0.913,
      "precision_macro": 0.914,
      "recall_macro": 0.913,
      "f1_macro": 0.913
    },
    {
      "id": "tree",
      "label": "Árbol de decisión",
      "description": "Divide el espacio de características mediante reglas simples y sucesivas. Es fácil de interpretar, pero tiende a sobreajustarse a los datos de entrenamiento.",
      "accuracy": 0.855,
      "precision_macro": 0.855,
      "recall_macro": 0.855,
      "f1_macro": 0.8547
    }
  ],
  "bestModelId": "xgb",
  "nTrain": 4000,
  "nTest": 1000,
  "literature": {
    "label": "Kather et al. (2016)",
    "accuracy": 0.874,
    "note": "Cifra reportada en el resumen del artículo original para el problema de ocho clases. El resumen no especifica un clasificador único para ese resultado, por lo que no se atribuye aquí a un modelo concreto. No es un resultado calculado en este sitio ni directamente comparable metodológicamente (representación y esquema de validación distintos)."
  }
};
