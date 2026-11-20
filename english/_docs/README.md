# English Fluency Lab — Learn English from A1 to C1

> *Listen more. Speak every day. Think in English. Communicate confidently.*

Plataforma interactiva de inglés para hispanohablantes de Latinoamérica, integrada en Latent Frontiers como sección independiente (`/latent-frontiers/english/`). Prioriza **speaking (40 %)** y **listening (35 %)**; reading (15 %) y writing (10 %) completan la distribución objetivo del tiempo de práctica (no es una ponderación del MCER).

Funciona íntegramente en el navegador: sin backend, sin cuentas, sin rastreadores.

## Estado de esta entrega (Entrega 1)

| Área | Estado |
|---|---|
| Motor (estado, persistencia, migraciones, SRS, puntuación, recomendaciones) | Implementado y con pruebas unitarias |
| Dashboard, Learning Path, Speaking Studio, Listening Lab, Vocabulary & Pronunciation, Reading & Writing, Assessments, My Progress, Ajustes | Implementado y con pruebas E2E |
| Manifiesto curricular de 26 semanas / 130 lecciones | Completo (títulos y estado). Solo la Semana 1 está **disponible** |
| Contenido: Semana 1 (5 lecciones + sesión integradora), 68 palabras con IPA, 6 diálogos, diagnóstico | Completo y validado automáticamente; **pendiente de revisión humana experta** |
| Semanas 2–26 | **Planificadas**: se muestran como «Planificado (en desarrollo)», nunca como disponibles |
| Modo de conversación con IA | No implementado (requiere backend seguro; ver ARCHITECTURE.md) |
| Audio grabado por personas | No incluido: se usa la síntesis de voz del navegador, y la interfaz lo indica |

## Ejecutar localmente

```bash
# desde la raíz del repositorio
quarto preview                 # servidor con recarga
# o
quarto render && npx http-server _site   # cualquier servidor estático
```

La página queda en `english/index.html`. Abrirla con `file://` no funciona (los módulos ES y `fetch` necesitan HTTP).

## Compilar y publicar

No hay paso de build propio: Quarto copia `english/app/**` y `english/data/**` gracias a `resources:` en `english/index.qmd`. El flujo existente `.github/workflows/publish-quarto.yml` (push a `main` → `quarto render` → GitHub Pages) publica la sección sin cambios. Las carpetas `_docs/` y `_tests/` empiezan por `_`, así que Quarto las ignora y no se publican.

## Pruebas

```bash
cd english
npm install                      # solo para las pruebas (Playwright + axe)
npm run validate                 # integridad del contenido
npm run test:unit                # pruebas unitarias (node:test)
npm run test:db                  # RLS en PostgreSQL local (PGlite)
quarto render ..                 # (desde la raíz) genera _site
npm run test:e2e                 # Playwright contra _site servido bajo /latent-frontiers/
```

En sistemas que Playwright aún no soporta (p. ej. Ubuntu 26.04) usa un Chromium local:
`PW_CHROMIUM_PATH=/ruta/a/chrome npm run test:e2e`.

## Compatibilidad de navegador

| Función | API | Navegadores | Si falta |
|---|---|---|---|
| Escuchar | `speechSynthesis` | Chrome, Edge, Safari, Firefox (voces según SO) | Transcripción + aviso de que no sustituye la escucha |
| Grabarse | `getUserMedia` + `MediaRecorder` | Navegadores modernos con micrófono | «Practiqué en voz alta» + autoevaluación |
| Reconocimiento (opcional) | `SpeechRecognition` / `webkitSpeechRecognition` | Chrome, Edge, Safari | Grabar–comparar + rúbrica; aviso visible |
| Grabaciones guardadas (opcional) | IndexedDB | Todos los modernos | Grabaciones solo en memoria |
| Progreso | `localStorage` | Todos | Aviso «modo privado»: el progreso no persiste |

## Documentación

- [ARCHITECTURE.md](ARCHITECTURE.md): estructura, módulos, flujo de datos, cómo extender, modo IA futuro.
- [CURRICULUM.md](CURRICULUM.md): ruta de 26 semanas y qué está disponible.
- [CONTENT_AUTHORING.md](CONTENT_AUTHORING.md): cómo añadir lecciones, vocabulario, diálogos y audio.
- [ASSESSMENT.md](ASSESSMENT.md): reglas de puntuación, fuentes de evidencia, diagnóstico, repaso espaciado.
- [PRIVACY.md](PRIVACY.md): datos, micrófono y almacenamiento.
- [QA_CHECKLIST.md](QA_CHECKLIST.md): verificación manual y automática.
- [ACCOUNTS.md](ACCOUNTS.md): perfiles locales, cuentas opcionales, RLS, migración y modelo de amenazas (Fase 2 · Etapa 1).
- [SUPABASE_SETUP.md](SUPABASE_SETUP.md): cómo activar las cuentas en un proyecto Supabase y verificarlo.
- [PHASE2_ROADMAP.md](PHASE2_ROADMAP.md): arquitectura de Cinema English, Professional English, biblioteca de vocabulario, speaking ampliado y adaptación.

## Lo que la plataforma no hace (a propósito)

- No emite certificados ni equivale a un examen MCER/CEFR.
- No da una «puntuación de pronunciación»: el reconocimiento de voz solo transcribe.
- No presenta respuestas guionizadas como inteligencia artificial.
- No promete C1 en seis meses: el calendario es orientativo y el avance depende de la evidencia.
