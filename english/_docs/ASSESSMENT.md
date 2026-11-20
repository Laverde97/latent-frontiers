# Evaluación

## Fuentes de evidencia (nunca se mezclan)

| Fuente | Qué es | Ejemplos |
|---|---|---|
| `auto` | Comprobación con reglas explícitas | opción correcta, texto esperado, reglas de escritura, respuesta adecuada en un diálogo |
| `asr` | Palabras objetivo que el reconocedor del navegador identificó | «4 de 5 palabras reconocidas». Orientativo. **No es una puntuación de pronunciación** |
| `self` | Autoevaluación con rúbrica de 4 niveles | reto oral, shadowing, escritura |
| `pending` | Requiere evaluación humana | reservado para revisión docente (no se usa aún en la interfaz) |

El panel, el progreso y las evaluaciones muestran cada fuente por separado.

## Puntuación de ejercicios

- Correcto al primer intento = 1; al segundo = 0,5; si no = 0. Tras dos fallos se muestra la respuesta con su explicación.
- Las preguntas de dos opciones (pares mínimos, sí/no) permiten un solo intento.
- Normalización: mayúsculas, acentos, comillas tipográficas, puntuación y contracciones frecuentes (`we're` = `we are`).
- Una lección se completa cuando todos sus pasos tienen un resultado guardado. Los pasos automáticos por debajo del 70 % (`completion.reviewThreshold`) marcan la lección como **«Recomendado para repaso»**. Una lección nunca se marca como completada con pasos sin hacer.

## Rúbricas

Escala de 4 niveles: 1 Todavía no · 2 En parte · 3 Casi siempre · 4 Sí, claramente. Criterios inspirados en el *CEFR Companion Volume*:

- **Speaking**: cumplimiento de la tarea, fluidez, coherencia, recursos lingüísticos, inteligibilidad, interacción.
- **Listening**: comprensión global (pregunta de idea principal), específica (detalles), inferencia, seguimiento del discurso.
- **Reading**: comprensión, inferencia, estructura textual, interpretación contextual.
- **Writing**: cumplimiento, organización, vocabulario, gramática, registro.

El acento latinoamericano no se penaliza: los criterios hablan de inteligibilidad.

## Reconocimiento de voz

`alignWords` alinea (LCS) las palabras objetivo con la transcripción, tratando números en palabra y en cifra como equivalentes. Muestra las palabras reconocidas y las que conviene revisar, con consejos de articulación cuando hay uno para esa palabra. No calcula puntuación fonética, de prosodia ni de emoción. Una evaluación fonética real requeriría alineamiento forzado acústico (p. ej. modelos tipo Montreal Forced Aligner o *goodness of pronunciation*) en un servidor, con validación propia: queda fuera de esta entrega.

## Diagnóstico de ubicación (opcional)

20 ítems cerrados etiquetados A1/A2/B1 (instrucciones, vocabulario y gramática, comprensión auditiva), más muestras opcionales de escritura (solo reglas) y oral (autoevaluada).

| Regla | Resultado |
|---|---|
| A1 < 60 % | Pre-A1–A1 → Semana 1 con todo el apoyo |
| A1 ≥ 60 % y A2 < 60 % | A1 → Semana 1, quizá a mayor ritmo |
| A1 ≥ 80 % y A2 ≥ 60 % | A2 probable → Semana 5 |
| A2 ≥ 60 % y B1 ≥ 60 % | «B1 o superior»: la prueba no puede ubicar más alto |

La confianza se informa siempre como **baja**. La prueba nunca asigna B2 ni C1.

## Nivel estimado (panel)

Por evidencia: un nivel se considera alcanzado en la plataforma cuando se completa ≥ 80 % de sus lecciones. Nunca supera el contenido completado. No es una certificación.

## Repetición espaciada (SM-2 adaptado)

- Calidad 0–5 a partir del desempeño: 5 correcto y rápido · 4 correcto · 3 correcto al segundo intento / «Difícil» · 1 incorrecto / «Otra vez».
- Fallo: repetición en 10 minutos (SM-2 usa 1 día), `reps = 0`.
- Acierto: 1 día → 3 días (SM-2 usa 6, más corto para principiantes) → `intervalo × EF`.
- `EF' = max(1.3, EF + 0.1 − (5 − q)(0.08 + (5 − q)·0.02))`.
- Estados: nueva → aprendiendo → **aprendida** (≥ 2 aciertos e intervalo ≥ 3 días) → dominada (intervalo ≥ 21 días). Leer una palabra o completar la lección no la marca como aprendida.

## Recomendaciones (reglas R1–R7)

R1 descanso si ya se cumplió la meta diaria · R2 continuar la lección en curso · R3 repasos vencidos · R4 actividades débiles · R5 habilidad más débil (auto < 70 %, n ≥ 2) · R6 siguiente lección disponible · R7 ningún speaking en 2 días → Speaking Studio. Cada recomendación muestra su regla.

## Tiempo de práctica

Aproximado: se cuentan intervalos de 5 s con la pestaña visible y actividad en los últimos 90 s (clic, tecla, audio o grabación en curso). Las modalidades fijan metas (Essential 30, Standard 75, Extended 120, Intensive 285 min/día; 6 días por semana). Como orientación se citan unas 700–800 horas de aprendizaje guiado para llegar a C1 desde cero; es una referencia aproximada que varía mucho, no una promesa.
