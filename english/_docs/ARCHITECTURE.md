# Arquitectura

## Decisiones

- **JavaScript modular nativo (ES modules), sin framework ni build.** GitHub Pages sirve los módulos tal cual. Quarto solo genera la página contenedora. React/Vue no aportarían lo suficiente para justificar un paso de build adicional en un sitio Quarto.
- **Contenido en JSON**, separado de la lógica y validado por las mismas funciones en el navegador y en CI (`app/core/content.js`).
- **Rutas por query string** (`?view=lesson&id=w01-l1`), no `#/rutas`, para no interferir con el manejo de anclas de Quarto.
- **Rutas relativas a los módulos** (`new URL('../../data/…', import.meta.url)`), así funcionan bajo `/latent-frontiers/` y en local.
- **Integración mínima con el sitio**: un ítem en la navbar (`_quarto.yml`), un parche de 8 líneas en `assets/js/lang-toggle.js` y una tarjeta en `writings.qmd`. El resto vive en `english/`.

## Estructura

```
english/
  index.qmd                 página Quarto (hero bilingüe + contenedor #efl-app)
  app/
    main.js                 arranque, router, contexto compartido (ctx)
    i18n.js                 textos de la interfaz ES/EN; sigue <html lang> del sitio
    core/                   lógica pura, testeable en Node
      store.js              estado, persistencia, versión, migraciones, import/export
      srs.js                repetición espaciada (SM-2 adaptado)
      scoring.js            normalización, coincidencias, alineación ASR, reglas de escritura, resúmenes
      recommender.js        recomendaciones por reglas transparentes (R1–R7)
      placement.js          regla de ubicación del diagnóstico
      content.js            validación y carga de contenido
      time.js               modalidades de estudio y medición aproximada del tiempo
    audio/                  APIs del navegador, aisladas
      tts.js                speechSynthesis + reproductor por segmentos
      recorder.js           getUserMedia + MediaRecorder + nivel de entrada (Web Audio)
      recording-db.js       IndexedDB opcional para grabaciones
      asr.js                SpeechRecognition opcional
    ui/
      dom.js                helpers h(), anuncios aria-live
      badges.js             logros (sin rachas ni rankings)
      components/           audio.js, exercises.js, tasks.js (rúbrica, diálogo, escritura, reto oral)
      views/                lesson, overview (dashboard/ruta/progreso), studios, assess, settings
    styles/efl.css          estilos con los tokens --lf-* del sitio, aislados en #efl-app
  data/                     contenido educativo (JSON)
  _docs/  _tests/           ignorados por Quarto (prefijo _)
```

## Capas

| Capa | Módulos |
|---|---|
| Presentación | `ui/views/*`, `ui/components/*`, `styles/efl.css` |
| Datos educativos | `data/*.json`, `core/content.js` |
| Estado de aprendizaje | `core/store.js` |
| Evaluación | `core/scoring.js`, `core/placement.js`, `ui/components/tasks.js` (rúbricas) |
| Audio | `audio/tts.js`, `audio/recorder.js`, `audio/recording-db.js` |
| Reconocimiento de voz | `audio/asr.js` |
| Persistencia | `core/store.js` (localStorage), `audio/recording-db.js` (IndexedDB) |
| Analíticas (locales) | `core/time.js`, `core/recommender.js`, `scoring.skillSummary` |
| Configuración | `ui/views/settings.js`, `state.settings` |

## Flujo de una actividad

1. La vista renderiza un paso de la lección a partir del JSON.
2. El componente (ejercicio, grabador, rúbrica, diálogo) llama a `onDone(result)` con `{score, max, source}`.
3. `store.recordActivity` guarda el resultado, cuenta intentos y añade una **evidencia** etiquetada por habilidad y fuente (`auto`, `asr`, `self`, `pending`).
4. `store.save()` persiste en `localStorage['efl-progress']`.
5. Al final, `completeLesson` aplica los criterios de finalización y `recommend` propone la siguiente actividad.

## Estado y migraciones

`STATE_VERSION = 2`. Cada documento lleva `version`; `migrate()` aplica pasos `N → N+1` (`MIGRATIONS` en `store.js`). Para cambiar el formato: sube `STATE_VERSION`, añade el paso de migración y una prueba en `_tests/unit/core.test.js`. Si los datos no se pueden leer, se guarda una copia en `efl-progress-corrupt-<timestamp>` y se empieza de cero con un aviso.

## Idioma

`lang-toggle.js` (del sitio) cambia `<html lang>` y oculta todo `[data-lang]` que no coincida. La app **no** usa `[data-lang]` dentro de `#efl-app`: observa `<html lang>` con un `MutationObserver` y vuelve a renderizar con `i18n.js`. Las ayudas pedagógicas en español son otro ajuste (`settings.esSupport`).

## Extender

- **Nueva vista**: crea `ui/views/x.js` que exporte `renderX(ctx, params)`, regístrala en `VIEWS`/`NAV` de `main.js` y añade `nav.x` en ES y EN (`i18n.test.js` falla si falta).
- **Nuevo tipo de ejercicio**: añade el caso en `renderExercise` (`exercises.js`), su validación en `content.js` (`EXERCISE_TYPES`) y el resolvedor en `_tests/e2e/helpers.js`.
- **Nueva semana**: ver CONTENT_AUTHORING.md.

## Modo avanzado con IA (diseño, no implementado)

Requisitos para implementarlo sin comprometer la seguridad:

1. Un backend propio (p. ej. función serverless) que guarde la clave del proveedor como secreto del servidor. **Nunca** en el JavaScript público ni en el repositorio.
2. El navegador envía solo el texto transcrito y el contexto de la tarea, con consentimiento explícito y un aviso de que el texto sale del dispositivo.
3. Límite de uso por sesión, sin cuentas obligatorias, y registro mínimo.
4. Las respuestas de IA se etiquetan como tales en la interfaz y en la evidencia (`source: 'ai'`), separadas de `auto` y `self`.
5. El modo local guionizado sigue siendo el predeterminado y gratuito.

Mientras no exista esa infraestructura, la interfaz dice explícitamente que el modo IA no está disponible.
