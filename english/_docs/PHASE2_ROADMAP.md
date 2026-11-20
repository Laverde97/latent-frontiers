# Fase 2 — Arquitectura y plan por etapas

Principio: cada etapa entrega funciones reales y probadas. Se reutiliza el motor existente (lecciones JSON validadas, componentes de audio, ejercicios, rúbricas, diálogos, SRS, evidencias por fuente y recomendador por reglas).

| Etapa | Contenido | Estado |
|---|---|---|
| 1 | Perfiles locales, cuentas opcionales (Supabase Auth + PostgreSQL + RLS), migración voluntaria, sincronización | **Implementada** (pendiente de activar en un proyecto real) |
| 2 | Cinema English | Diseñada |
| 3 | Professional English + biblioteca de vocabulario | Diseñada |
| 4 | Speaking interactivo ampliado, adaptación y tutor IA opcional | Diseñada |
| 5 | Ampliación de contenidos por lotes revisados | Proceso definido |

## Etapa 2 — Cinema English: *Learn English Through Real Conversations*

**Flujo**: Watch → Understand → Repeat → Speak → Remember.

**Datos** `data/cinema/scenes/<id>.json`:
```
id, title, level, goal{en,es}, minutes, topic, register (formal|informal),
media: { provider: "self"|"youtube-nocookie"|"vimeo", src|videoId, license: {type, holder, url, verifiedAt}, allowsSegments: bool, captions: "captions/<id>.vtt" },
cues[]: { start, end, speaker, text, es },        ← diálogo propio o autorizado
vocab[], expressions[]: { text, meaning{en,es}, register, note },
understand: exercises[] (comprensión + contexto + intención),
repeat: cue ids para escuchar y repetir/shadowing,
speak: challenge + rubric (reutiliza speakingChallenge),
remember: ids de vocab/expresiones → SRS,
review: { status, reviewer, date }
```

- **Reproductor por proveedor**:
  - `self` usa `<video>` + WebVTT, con segmentos exactos y velocidad.
  - YouTube/Vimeo usan sus *iframes* oficiales y APIs públicas (`seekTo`, `playbackRate`) solo si la licencia lo permite (`allowsSegments`).
  - Si no se permite, se reproduce la escena completa y la práctica por frases usa el TTS del diálogo, indicándolo.
- **Licencias**: no se descargan ni recortan películas comerciales. El validador exige `license` completa y bloquea `provider` no permitidos.
- **Primer lote**: 6 escenas originales A1–A2 (aeropuerto, restaurante, hotel, universidad, farmacia, entrevista breve). Se producen como guion propio + audio/vídeo propios; hasta tenerlos, la escena funciona en «modo guion» (TTS + ilustración) y se declara así.
- **Seguimiento**: evidencias `listening` (auto) y `speaking` (self/asr) con `lessonId = cinema:<id>`; las expresiones pasan al SRS.

## Etapa 3 — English for Every Career + biblioteca de vocabulario

**Motor por datos** (añadir un sector = añadir carpetas, sin código):
```
data/careers/index.json                      ← sectores, especialidades, estado
data/careers/<sector>/<specialty>/
  terms.json         lema, pos, IPA, definición clara, traducción contextual, colocaciones, ejemplo real, nivel, tags
  expressions.json   frases completas por función comunicativa (explicar un proceso, dar malas noticias…)
  competencies.json  can-do profesionales por nivel (p. ej. "B1: explicar un tratamiento al paciente")
  dialogues/*.json   diálogos situacionales (reutiliza el formato ramificado)
  units/*.json       unidades con los mismos pasos que una lección (listening, speaking, reading, writing, retrieval)
  review.json        revisor especialista, fecha, alcance
```

- **Separación**: términos ≠ expresiones ≠ competencias; las unidades se construyen alrededor de competencias, no de listas.
- **Revisión obligatoria**: `review.status` ∈ `draft | linguist-reviewed | specialist-reviewed`. La interfaz muestra «borrador» y no presenta como validado nada sin revisión de especialista.
- **Primeros módulos completos** (propuesta): Medicine & Healthcare (consulta clínica A2–B1), Data Science (describir un modelo e interpretar resultados B1), Software Engineering (stand-up y revisión de código B1).
- **Biblioteca general** `data/vocab/<area>/*.json` con el formato actual ampliado: `senses[]`, `tags[]`, `related[]`, `audio?`.
  - Lotes de 50–100 entradas revisadas, con validador de duplicados e IPA presente.
  - Interfaz: búsqueda, filtros por nivel y tema, **favoritos** y «mi selección» (en el estado del estudiante, sincronizable).
  - Sin entradas vacías para inflar cobertura.

## Etapa 4 — Speaking interactivo y adaptación

- **Modalidades etiquetadas siempre**: `scripted` (guionizado) · `asr` (reconocimiento) · `self` (autoevaluación) · `ai` (generativo).
- **Nuevas actividades** (reutilizan grabador, rúbrica y diálogos):
  - role-play con objetivos;
  - descripción de imágenes propias o con licencia;
  - presentaciones profesionales cronometradas;
  - entrevistas con preguntas de seguimiento;
  - debates B2–C1;
  - contrastes de pronunciación;
  - ritmo y entonación con shadowing por frases.
- **Tutor IA opcional**:
  - Función serverless (p. ej. Supabase Edge Function) con la clave del proveedor como secreto del servidor.
  - Solo usuarios con cuenta y consentimiento.
  - Límite diario por usuario y tope de gasto global.
  - Registro mínimo y etiqueta «IA» en la interfaz y en la evidencia.
  - Nunca se simula con respuestas predefinidas; lo esencial sigue siendo gratuito sin IA.
- **Recomendador por evidencia**:
  - Amplía R1–R7 con: errores recurrentes por etiqueta (p. ej. `/θ/`, orden de preguntas), dificultad auditiva vs. oral (fuentes separadas), vocabulario vencido, objetivos profesionales elegidos y tiempo disponible.
  - El dominio exige umbrales por habilidad y evidencia reciente, no solo ejercicios terminados.
  - Ruta general + rutas especializadas complementarias.

## Etapa 5 — Ampliación de contenidos

El proceso por lote es:

1. Autoría (plantilla JSON).
2. `npm run validate`.
3. Revisión lingüística.
4. Revisión de especialista (si es contenido profesional).
5. Marcar `available`.

El orden de lotes:

1. Semanas 2–4 (A1).
2. Escenas Cinema A1–A2.
3. Primer sector profesional.
4. Semanas 5–8.
5. Etc.

Ningún lote se publica como validado sin las revisiones correspondientes.
