# Reporte de calidad — English Fluency Lab, Entrega 1 (auditoría funcional)

Fecha: 2026-11-20 · Rama `feat/english-fluency-lab` · PR #12 (borrador, sin fusionar).

**Tipos de evidencia**
- **[A] Automatizada con dispositivos simulados**: Playwright + Chromium 156 en WSL2 (Linux). Micrófono falso de Chromium (`--use-fake-device-for-media-stream`, genera audio real), `speechSynthesis` y `SpeechRecognition` simulados de forma determinista. Sitio servido bajo `/latent-frontiers/`.
- **[W] Navegadores reales de Windows**: Chrome y Edge instalados en Windows, en modo headless (`--dump-dom`) contra el servidor local, consultados desde WSL vía PowerShell. Evidencia real de carga, APIs y voces, **sin interacción**.
- **[M] Manual pendiente**: requiere hardware o interacción humana real. Nada de esto se marca como PASA.

Totales finales: contenido válido · 28/28 unitarias · 33/33 E2E · `quarto render` sin advertencias.

## 1. Vista previa local

| Funcionalidad | Resultado esperado | Resultado obtenido | Estado | Evidencia | Problema | Acción |
|---|---|---|---|---|---|---|
| Rama y árbol de trabajo | `feat/english-fluency-lab`, sin cambios sin guardar | Correcto, árbol limpio | PASA | `git status` | — | — |
| Compilación | `quarto render` sin errores | 26 documentos, sin advertencias | PASA | salida de render | — | — |
| Acceso desde Windows | URLs responden 200 desde Windows | 8/8 URLs 200 vía `Invoke-WebRequest` (inicio, Writings, lab, speaking, listening, lección 1, JSON, módulos) | PASA [W] | PowerShell | El servidor original solo escuchaba en 127.0.0.1 | `serve.js` acepta `HOST`; vista previa con `HOST=0.0.0.0 PORT=8765` |
| Carga en Chrome Windows | `data-ready`, vistas renderizadas | 7 vistas con `data-ready="true"` y su título; sin errores en el registro | PASA [W] | `chrome.exe --headless --dump-dom` | — | — |
| Carga en Edge Windows | Igual | 7 vistas OK; sin errores en el registro | PASA [W] | `msedge.exe --headless --dump-dom` | — | — |

## 2. Speaking

| Funcionalidad | Resultado esperado | Resultado obtenido | Estado | Evidencia | Problema | Acción |
|---|---|---|---|---|---|---|
| Escuchar una frase | Se reproduce el texto | Utterance con el texto exacto | PASA [A] | `audio.spec` Speaking Studio | — | — |
| Cambiar velocidad | Lento = 0,6×; selector 0,6–1,2× | Rate 0,6 registrado; selector aplicado | PASA [A] | `audio.spec` | — | — |
| Voces reales disponibles | Voces en inglés del sistema | Chrome: Mark, Zira, David (en-US), Google US/UK. Edge: además voces neuronales en-GB/en-AU/en-CA | PASA [W] | dump de `?view=settings` | Calidad audible no verificable sin oír | [M] escuchar |
| Consentimiento del micrófono | Aviso propio antes del permiso del navegador | Aviso visible; al aceptar en una tarjeta, todas se actualizan | PASA [A] | `audio.spec`, `audit.spec` | Antes el aviso se repetía en cada tarjeta | Corregido (suscripción al consentimiento) |
| Grabar / detener | Botón con `aria-pressed`, nivel de entrada | OK con micrófono falso | PASA [A] | `recordFor` | — | — |
| Escuchar mi grabación | Blob reproducible con duración real | `blob:`, `currentTime > 0`, duración finita > 0,5 s | PASA [A] | `audit.spec` | El reproductor mostraba «0:00» (WebM sin duración) | Corregido (cálculo forzado de duración) |
| Comparar modelo y grabación | Suena el modelo y luego la grabación | Modelo hablado y reproducción iniciada | PASA [A] | `audio.spec` | — | — |
| Reconocimiento de voz | Transcripción, palabras reconocidas/por revisar, sin «puntuación» | Palabra omitida marcada «?»; aviso «no es una puntuación de pronunciación» | PASA [A] | `audio.spec` | Con ASR real, no verificado | [M] probar en Chrome/Edge reales |
| ASR disponible en navegadores reales | API presente | ✓ en Chrome y Edge Windows | PASA [W] | lista de capacidades | — | — |
| Repetir y registrar intentos | Cada grabación cuenta; «Intento N» visible | `s5-rec-0.attempts = 2`, «Intento 2» visible; sin evidencia de puntuación | PASA [A] | `audit.spec` | Antes solo se registraban los intentos con ASR | Corregido (intentos de práctica sin puntuación) |
| Micrófono denegado | Mensaje claro y alternativa | Alerta «permiso» + «Practiqué en voz alta» | PASA [A] | `audio.spec` | — | [M] bloqueo real en Chrome |
| Sin MediaRecorder | Alternativa funcional | Práctica en voz alta + rúbrica; `recorded: false` | PASA [A] | `audio.spec` | — | — |
| Sin reconocimiento de voz | Explicación + grabar/comparar | Aviso visible, sin botón ASR, comparación disponible | PASA [A] | `audio.spec` | — | — |
| Micrófono físico | Graba la voz real | — | NO VERIFICADO | — | Requiere hardware | [M] guía en la sección 8 |

## 3. Listening

| Funcionalidad | Resultado esperado | Resultado obtenido | Estado | Evidencia | Problema | Acción |
|---|---|---|---|---|---|---|
| Diálogos y frases | Todas las líneas se reproducen en orden | OK | PASA [A] | `audio.spec`, `lessons.spec` | — | — |
| Segmentos (anterior/repetir/siguiente/inicio) | Control por segmento, línea resaltada | Repetir reproduce el mismo segmento; 1 línea resaltada | PASA [A] | `audio.spec` | — | — |
| Velocidad | Rate aplicado | 0,6 aplicado | PASA [A] | `audio.spec` | — | — |
| Ocultar transcripción | Oculta por defecto; alternar | Oculta → visible | PASA [A] | `audio.spec`, `audit.spec` | — | — |
| Preguntas de comprensión | Corrección y resultado | 5/5 guardado en `studio` | PASA [A] | `audit.spec` | — | — |
| Dictados | Feedback, respuesta tras 2 fallos, nueva serie | OK; resultado 0 % guardado | PASA [A] | `audit.spec` | — | — |
| Sin respuestas antes de responder | Ni clave ni texto del audio visibles o en el nombre accesible | Sin `.is-correct`, feedback vacío, sin texto del dictado en el DOM | PASA [A] | `audit.spec` | **Fuga**: el `aria-label` de «Escuchar» contenía la frase del dictado | Corregido (`hideText` en dictados, preguntas de audio, «escuchar y responder» y shadowing sin texto) |
| Aprendizaje guiado (por diseño) | Ayudas visibles a propósito | Tarjetas de vocabulario antes del quiz; modelos de speaking en «Ver/escuchar» desplegable; texto modelo de escritura tras «Revisar»; transcripción a petición | Documentado | — | — | — |
| Sin síntesis de voz | Aviso + transcripción | OK | PASA [A] | `audio.spec` | — | — |

## 4. Las cinco lecciones A1 + sesión integradora

Una prueba resuelve **cada ejercicio desde el JSON por la interfaz**. Si una clave estuviera mal o un ejercicio fuera irresoluble, falla.

| Lección | Instrucciones / objetivos | Listening | Speaking | Vocab + pronunciación | Reading + writing | Feedback | Finaliza | Guarda | Tras recargar | Estado |
|---|---|---|---|---|---|---|---|---|---|---|
| w01-l1 | ✓ | ✓ 5 ej. | ✓ grabación + rúbrica | ✓ 16 palabras, /h/ | ✓ | ✓ | ✓ | ✓ | ✓ | PASA [A] |
| w01-l2 | ✓ | ✓ | ✓ | ✓ 15, /ð/ /ʃ/ | ✓ | ✓ | ✓ | ✓ | ✓ | PASA [A] |
| w01-l3 | ✓ | ✓ | ✓ | ✓ 15, acento/schwa | ✓ | ✓ | ✓ | ✓ | ✓ | PASA [A] |
| w01-l4 | ✓ | ✓ | ✓ | ✓ 13, /θ/, -teen/-ty | ✓ | ✓ | ✓ | ✓ | ✓ | PASA [A] |
| w01-l5 | ✓ | ✓ | ✓ | ✓ 11, entonación, /ɪ/–/iː/ | ✓ | ✓ | ✓ | ✓ | ✓ | PASA [A] |
| w01-review | ✓ | ✓ 7 ej. | ✓ rúbrica de 5 criterios | repaso mixto | ✓ correo | ✓ | ✓ | ✓ evaluación semanal | ✓ | PASA [A] |
| Calidad pedagógica / lingüística humana | — | — | — | — | — | — | — | — | — | NO VERIFICADO [M] (borrador IA, `pending-human-review`) |

## 5. Progreso y evaluación

| Funcionalidad | Resultado esperado | Resultado obtenido | Estado | Evidencia | Problema | Acción |
|---|---|---|---|---|---|---|
| Panel se actualiza | Minutos, pasos pendientes, habilidades | ≥ 1 min tras 2 min simulados de actividad; «Te quedan 7 pasos»; listening 100 % | PASA [A] | `audit.spec` (reloj simulado) | Tras reabrir el navegador mostraba 0 pasos pendientes (lección no cargada) | Corregido (el panel carga la lección) |
| Intentos | Contados por actividad | attempts = 2, mejor resultado conservado | PASA [A] | `lessons.spec` | — | — |
| Resultados por fuente | Auto / ASR / auto-evaluado separados | Fuentes separadas en evidencia y evaluación | PASA [A] | `lessons.spec` | — | — |
| Persistencia al cerrar el navegador | Progreso intacto en un navegador nuevo | Perfil persistente cerrado y reabierto: progreso, «Continuar» y pasos | PASA [A] | `audit.spec` | — | [M] cerrar Chrome real |
| SRS | Fallo → ~10 min; acierto → ~1 día | 8–11 min y 0,9–1,1 días | PASA [A] | `audit.spec` | — | — |
| Diagnóstico | Rango + confianza baja; nunca B2/C1 | Todo correcto → «B1+» con «no puede ubicar»; solo A1 → «A1» | PASA [A] | `audit.spec`, `site.spec` | — | — |
| Exportar / importar / corrupción / reset | Archivo válido; inválido rechazado; copia de datos dañados | OK | PASA [A] | `site.spec` | — | — |
| Nivel estimado | Sin lecciones → Pre-A1 | «Inicio (Pre-A1)» | PASA [A] | unitaria | Mostraba «A1 en desarrollo» sin evidencia | Corregido |

## 6. Compatibilidad

| Funcionalidad | Resultado esperado | Resultado obtenido | Estado | Evidencia | Problema | Acción |
|---|---|---|---|---|---|---|
| Chrome Windows | Carga y APIs | Carga ✓, TTS ✓, grabación ✓, ASR ✓ | PASA [W] (no interactivo) | dump-dom | — | [M] uso interactivo |
| Edge Windows | Igual | Igual | PASA [W] (no interactivo) | dump-dom | Playwright no puede manejar Edge desde Linux | [M] uso interactivo |
| Vista móvil (375 px) | Sin scroll horizontal | 7 páginas OK | PASA [A] | `site.spec @mobile` | — | [M] teléfono real |
| Teclado | Solo con Tab/Enter, foco visible | Ejercicios respondidos y outline visible | PASA [A] | `audit.spec`, `site.spec` | — | — |
| Interfaz en español | Por defecto | OK | PASA [A] | varias | — | — |
| Interfaz en inglés | Todas las vistas en inglés, sin claves faltantes | 10 vistas sin textos de interfaz en español; `missingKeys` vacío | PASA [A] | `audit.spec` | — | — |
| Accesibilidad axe WCAG 2.2 AA | Sin violaciones serias/críticas | 5 páginas OK | PASA [A] | `site.spec` | Contraste de etiquetas en tarjetas | Corregido (Entrega 1) |
| Lector de pantalla real | Anuncios y navegación | — | NO VERIFICADO | — | — | [M] NVDA / Narrador |
| Safari / iOS | — | — | NO VERIFICADO | — | No disponible en este entorno | [M] |
| Firefox | Sin ASR, TTS sí | — | NO VERIFICADO | — | No instalado | [M] |

## 7. Defectos corregidos en esta auditoría
1. **Fuga de respuesta (accesibilidad)**: los botones de audio exponían la frase de dictados y preguntas en `aria-label`.
2. **Intentos de grabación no registrados**: ahora cada grabación es un intento de práctica sin puntuación, visible como «Intento N».
3. **Duración 0:00** en grabaciones WebM.
4. **Panel tras reabrir**: pasos pendientes en 0 → ahora carga la lección.
5. **Vista previa** inaccesible desde Windows → `HOST` configurable.

Ningún criterio de prueba se relajó: cada defecto se corrigió en la aplicación.

## 8. Pendiente (manual, con hardware real)
Micrófono físico (grabar, escuchar, comparar); reconocimiento de voz real con acento latinoamericano; calidad audible de voces en Chrome y Edge; permiso bloqueado desde el candado del navegador; cierre real del navegador; teléfono físico; lector de pantalla; revisión pedagógica humana del contenido.
