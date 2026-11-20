# QA checklist

## Automático

| Verificación | Comando | Cubre |
|---|---|---|
| Contenido | `npm run validate` | 26 semanas / 130 IDs, lecciones disponibles ⇔ archivos, esquema de pasos y ejercicios, claves de respuesta, respuestas modelo que cumplen sus reglas, IPA, grafos de diálogo, diagnóstico |
| Unitarias (28) | `npm run test:unit` | migraciones, import/export, datos corruptos, actividades e intentos, finalización de lección, SRS, normalización, alineación ASR, reglas de escritura, nivel estimado, recomendaciones, ubicación, modalidades, cobertura i18n ES/EN |
| Compilación | `quarto render` (raíz) | sitio completo; `_site/english/{app,data}` copiados; `_docs`/`_tests` excluidos |
| E2E | `npm run test:e2e` | ver abajo |

E2E (Playwright, Chromium con micrófono simulado y `speechSynthesis`/`SpeechRecognition` simulados, servido bajo `/latent-frontiers/`):

- Semana 1 completa por la interfaz (5 lecciones + integradora), recarga y persistencia, fuentes separadas, evaluación semanal.
- Repetir un paso: intentos, mejor resultado, retroalimentación de error, lapso SRS.
- Lecciones planificadas no aparecen como disponibles.
- Listening Lab: reproducir, pausa, segmentos, repetir, velocidad, transcripción.
- Speaking Studio: consentimiento, grabación real (blob reproducible), comparar modelo y grabación, regrabar, reconocimiento con palabras a revisar.
- Shadowing sin transcripción + rúbrica; Conversation Coach en modo reto con respuesta por voz.
- Alternativas: sin `SpeechRecognition`, sin `MediaRecorder`, micrófono denegado, sin `speechSynthesis`.
- Sitio: navbar ES/EN (Inicio/Home intactos), Writings conserva todas las filas + promo, interfaz del lab sigue el selector.
- Datos: exportar, importación inválida rechazada, reset, reimportar, datos corruptos con copia de respaldo.
- Diagnóstico: rango + incertidumbre, nunca B2/C1.
- Todas las vistas sin errores de consola; navegación por teclado y foco.
- axe (WCAG 2.0/2.1/2.2 A y AA) en dashboard, lección, speaking, ajustes y promo de Writings: sin violaciones serias ni críticas.
- Móvil 375 px: sin scroll horizontal en inicio, Writings y vistas del lab.

## Manual (dispositivos reales)

Las simulaciones no sustituyen estas comprobaciones:

- [ ] Voces reales: Chrome/Edge (Windows), Safari (macOS/iOS), Chrome (Android). Calidad y velocidad.
- [ ] Micrófono físico: permiso, nivel de entrada, grabación y reproducción en iOS Safari (formato `audio/mp4`).
- [ ] Reconocimiento de voz real con acento latinoamericano (Chrome, Safari).
- [ ] Lector de pantalla (NVDA + Firefox, VoiceOver + Safari): anuncios de feedback, pasos, rúbricas.
- [ ] Zoom 200 % y modo de movimiento reducido.
- [ ] Revisión pedagógica y lingüística humana del contenido de la Semana 1 (IPA, naturalidad, claves).
