# Privacidad

Privacidad por diseño: la plataforma funciona sin cuentas, sin servidor propio y sin analíticas ni rastreadores.

## Qué se guarda y dónde

| Dato | Dónde | Cómo borrarlo |
|---|---|---|
| Progreso (resultados, intentos, minutos, tarjetas SRS, ajustes) | `localStorage['efl-progress']` en este navegador | Ajustes → «Borrar todo mi progreso» |
| Copia de datos dañados | `localStorage['efl-progress-corrupt-<fecha>']` (solo si hubo corrupción) | Borrar los datos del sitio en el navegador |
| Grabaciones | En memoria mientras la página está abierta. Solo si el usuario activa «Conservar mis grabaciones»: IndexedDB `efl-recordings` | Ajustes → «Borrar todas las grabaciones» |
| Idioma del sitio | `localStorage['lf-site-lang']` (mecanismo existente de Latent Frontiers) | — |

No se pide nombre, correo ni ningún dato personal. Lo que el estudiante escribe en los ejercicios (p. ej. su presentación) se guarda solo localmente, recortado a 2000 caracteres por actividad.

## Micrófono

- No se solicita al cargar la página. Antes del primer uso se muestra una explicación (qué se graba, dónde queda y cómo practicar sin micrófono); el permiso del navegador se pide solo al pulsar «Grabar».
- El stream se detiene al terminar cada grabación.
- La aceptación se puede retirar en Ajustes.
- Todo funciona sin micrófono: «Practiqué en voz alta» + autoevaluación.

## Reconocimiento de voz (opcional)

En algunos navegadores (por ejemplo Google Chrome) `SpeechRecognition` envía el audio a los servidores del fabricante. La interfaz lo indica junto al botón «Comprobar con reconocimiento de voz», que solo se activa por acción explícita del usuario. La plataforma no envía audio por su cuenta a ningún servicio.

## Exportar, importar, sincronizar

- Exportar genera un JSON (`english-fluency-lab-AAAA-MM-DD.json`) con el formato versionado.
- La importación se valida (estructura, versión, fuentes y rangos) y pide confirmación antes de reemplazar.
- No hay sincronización entre dispositivos: se hace exportando e importando.
- Borrar los datos del sitio, usar modo privado o algunos limpiadores elimina el progreso. La interfaz lo advierte.

## Seguridad

No hay claves de API, tokens ni secretos en el código ni en el repositorio. Cualquier integración futura con IA debe pasar por un backend propio que guarde las credenciales en el servidor (ver ARCHITECTURE.md).
