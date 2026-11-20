# Cómo crear contenido

Todo el contenido está en `english/data/`. Después de cualquier cambio ejecuta `cd english && npm run validate`.

## Añadir una lección

1. Crea `data/lessons/wNN-lK.json` (copia una lección de la Semana 1 como plantilla).
2. Campos obligatorios: `id`, `kind` (`core` | `review`), `title`, `level`, `week`, `minutes`, `objectives[]` ({en, es}), `prerequisites[]`, `prerequisitesText`, `vocabIds[]`, `completion.reviewThreshold`, `review` {status, author, date}, `feedback`, `steps[]`.
3. `steps` debe incluir, en este orden recomendado: `vocab`, `listening`, `grammar`, `pronunciation`, `speaking`, `interaction`, `reading`, `writing`, `retrieval`. Las sesiones integradoras (`kind: review`) requieren `listening`, `speaking`, `interaction`, `reading`, `writing`.
4. En `data/curriculum.json` cambia el `status` de esa lección a `"available"`.
5. `npm run validate`, `npm run test:unit`, `quarto render` y `npm run test:e2e` (el E2E resuelve todas las lecciones disponibles de la Semana 1; añade las nuevas a `lessons.spec.js`).

## Tipos de paso

| Tipo | Campos | Se guarda como |
|---|---|---|
| `vocab` | `items[]` (ids de vocabulario), `exercises[]` | auto (sin habilidad) |
| `listening` | `lines[]` {speaker, text, es}, `exercises[]` | auto · listening |
| `grammar` | `explanation` {en, es}, `table` {head, rows}, `examples[]`, `watchOut`, `exercises[]` | auto (sin habilidad) |
| `pronunciation` | `focus`, `tip` {en, es}, `repeat[]`, `exercises[]` (pares mínimos) | auto · listening (percepción) |
| `speaking` | `repeat[]` {text, ipa?, es}, `challenge` {prompt, promptEs, seconds:[min,max], prepare[], model}, `rubric[]` | self · speaking (+ asr si se usa) |
| `interaction` | `dialogue` (id), `difficulty` (`guided`/`challenge`), `followUp` | auto · listening (adecuación de la respuesta) |
| `reading` | `text` (párrafos separados por línea en blanco), `glossary`, `exercises[]` | auto · reading |
| `writing` | `prompt`, `promptEs`, `checks[]`, `rubric[]`, `model` | self · writing + auto · writing (reglas) |
| `retrieval` | `exercises[]` (≥3; usa `vocab` para alimentar el SRS) | auto |

## Tipos de ejercicio

| Tipo | Campos | Corrección |
|---|---|---|
| `mcq` | `prompt`, `options[]`, `answer` (índice), `audio?`, `explanation?` | opciones barajadas de forma determinista |
| `gap` | `prompt`, `accept[]` | normaliza mayúsculas, acentos, puntuación y contracciones |
| `dictation` | `audio`, `accept[]` | igual que `gap` |
| `minimalPair` | `pair[2]`, `say`, `ipa` | un solo intento |
| `order` | `words[]`, `accept[]` | las palabras deben formar `accept[0]` |

Campo opcional `vocab`: id de vocabulario cuyo repaso espaciado se actualiza con el resultado.

## Reglas de escritura (`checks`)

`minWords {n}`, `maxWords {n}`, `includesAny {patterns}`, `excludes {patterns}` (errores típicos de transferencia como «I have 25 years»), `capitalized {words}`, `sentenceCase`, `endsWithPunctuation`, `capitalI`. Cada una lleva `label` {en, es} y opcionalmente `hint`. El validador exige que la respuesta `model` cumpla todas las reglas.

## Vocabulario

`data/vocab/*.json` → `items[]` con `id`, `word`, `ipa` (entre barras, General American, transcripción amplia), `pos`, `es`, `example`, `collocations[]`, `trap` {en, es} (errores frecuentes de hispanohablantes) y `accept[]` opcional. Verifica la IPA con un diccionario de referencia (Cambridge, Oxford Learner's o Merriam-Webster).

## Diálogos

`data/dialogues/<id>.json`: `start`, `nodes` {id: {say, es, options[] | end:true}}. Cada opción tiene `text`, `next` y `fit` (`good` | `ok` | `off`); las opciones que no son `good` necesitan `feedback`. El validador comprueba que no haya nodos sin salida ni referencias rotas, que haya un final alcanzable y que cada nodo tenga una respuesta adecuada. Registra el id en `curriculum.json → dialogues`. Usa `[corchetes]` para lo que el estudiante completa con su información.

## Audio

Esta entrega usa la síntesis de voz del navegador (`speechSynthesis`), así que cualquier texto del JSON se puede escuchar. Para incorporar grabaciones reales:

1. Usa solo audio original o con licencia que permita su uso, alojado en el repositorio (`english/data/audio/…`). No enlaces audio externo.
2. Formato recomendado: AAC `.m4a` o Opus `.webm`, mono, 64–96 kbps, normalizado.
3. Añade `audioSrc` a la línea o ejercicio y amplía `SegmentPlayer`/`listenButtons` para preferir `<audio>` cuando exista (mantén TTS como alternativa).
4. Documenta la variedad (en-US, en-GB…) solo si está verificada; nunca atribuyas un acento a una voz sintética.
