# Currículo

Ruta de 26 semanas (`data/curriculum.json`): 5 lecciones principales por semana (130 en total), una sesión integradora y un día flexible de recuperación o descanso. Alineada con los descriptores pertinentes del *CEFR Companion Volume* (Consejo de Europa, 2020).

Los plazos son **orientativos**. Avanzar de nivel depende de completar las lecciones y de la evidencia registrada, no de las semanas transcurridas. Ninguna modalidad garantiza llegar a C1 en seis meses.

| Semanas | Nivel | Bloque | Estado |
|---|---|---|---|
| 1 | A1 | First English Words | **Disponible**: 5 lecciones + sesión integradora |
| 2–4 | A1 | My Everyday Life · People and Places · Everyday Survival English | Planificado |
| 5–8 | A2 | Past · Future · Real-World Conversations · Describing Experiences | Planificado |
| 9–14 | B1 | Extended Conversations · Storytelling · Work and Education · Problem Solving · Natural Conversations · B1 Challenge | Planificado |
| 15–20 | B2 | Argumentation · Professional English · Advanced Listening · Grammar for Fluency · Complex Topics · B2 Challenge | Planificado |
| 21–26 | C1 | Advanced Fluency · Academic English · Complex Listening · Persuasive Communication · Advanced Real-World English · Final Project | Planificado |

Los títulos de las 130 lecciones están en el manifiesto. Solo se marca `available` una lección cuyo archivo existe y supera `npm run validate`; el validador falla si se marca como disponible una lección sin archivo o si existe un archivo marcado como `planned`.

## Semana 1 — First English Words (A1)

| ID | Lección | Speaking | Listening | Pronunciación |
|---|---|---|---|---|
| w01-l1 | Hello! Greetings and spelling your name | Presentarse y deletrear el nombre (20–40 s) | Recepción de una escuela | /h/ (hi–I, heart–art) |
| w01-l2 | I am, you are: the verb to be | Describirse y describir a otros | ¿Quién es ella? | contracciones, /ð/ (they–day), /ʃ/–/s/ |
| w01-l3 | Countries and nationalities | Nacionalidad, origen y ciudad | Intercambio en línea | acento de palabra y schwa /ə/ |
| w01-l4 | Numbers, age and phone numbers | Formulario en voz alta | Inscripción en un gimnasio | /θ/ (three–tree), -teen vs -ty |
| w01-l5 | Personal questions | Autoentrevista (25–45 s) | Intercambio en un café | entonación de preguntas, /ɪ/–/iː/ |
| w01-review | Week 1 communication check | Presentación ante la clase | Noche de bienvenida | repaso mixto |

Cada lección sigue la estructura obligatoria: objetivo observable, nivel, conocimientos previos, activación de vocabulario, input auditivo, estructura breve, comprensión, pronunciación, speaking, interacción (diálogo ramificado), reading, writing, recuperación activa, retroalimentación, registro de progreso y siguiente actividad recomendada.

**Apoyo en español**: A1 lleva traducciones y explicaciones en español en todos los bloques (desactivables). Las semanas siguientes deben reducirlo progresivamente: A2 mixto, B1 puntual, B2 casi nulo, C1 inmersión.

**Revisión**: el contenido de la Semana 1 es un borrador asistido por IA que supera la validación automática (claves de respuesta, referencias, respuestas modelo que cumplen sus propias reglas, IPA presente). **No ha tenido revisión humana experta**: cada archivo lo indica en `review.status = "pending-human-review"`.

## Próximas entregas

1. Semanas 2–4 (15 lecciones + 3 sesiones) y la evaluación integrada A1.
2. Semanas 5–8 (A2) con menos apoyo en español.
3. Audio grabado por personas (estadounidense, británico y otras variedades) con licencia.
4. Continuar por lotes verificables hasta la Semana 26.
