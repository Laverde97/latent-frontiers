# Cuentas y perfiles (Fase 2 · Etapa 1)

## Dos modalidades

| | Modo invitado | Cuenta personal (opcional) |
|---|---|---|
| Registro | No | Correo + código de un solo uso (sin contraseña) |
| Edad | Cualquiera | Solo 18+ (confirmación obligatoria guardada en el servidor) |
| Dónde vive el progreso | `localStorage` de este navegador, por perfil | Este navegador **y** la cuenta (PostgreSQL en Supabase) |
| Varias personas en un navegador | Un perfil local por persona (`efl-progress:<id>`) | Una cuenta vinculada a un perfil local |
| Entre dispositivos | Exportar / importar JSON | Sincronización automática |
| Grabaciones de voz | Solo en el dispositivo | Solo en el dispositivo (nunca se sincronizan) |

El perfil «Principal» sigue usando la clave original `efl-progress`, así que el progreso anterior a esta fase no se toca.

## Arquitectura

```
app/core/profiles.js     ProfileRegistry: perfiles locales, clave por perfil, vínculo con cuenta
app/core/sync.js         mergeStates (fusión determinista) + SyncEngine (rev optimista)
app/account/auth.js      AuthService: carga la librería vendorizada, PKCE, código OTP, sesión
app/account/backend.js   única capa que llama a tablas/funciones (nunca envía user_id)
app/account/controller.js vincular, migrar, sincronizar, cerrar sesión, eliminar cuenta
app/ui/views/account.js  vista «Cuenta y perfiles»
app/config.js            URL y clave pública anon (vacías = cuentas desactivadas)
app/vendor/              @supabase/supabase-js 2.119.2 (UMD, MIT), fijado y sin CDN
supabase/migrations/0001_efl_accounts.sql   tablas, RLS, funciones
```

## Modelo de datos

- `efl_profiles(user_id pk → auth.users, adult_confirmed = true, terms_version, created_at)`
- `efl_learner_state(user_id pk → auth.users, state jsonb, state_version, rev, device, updated_at)`. El documento es el mismo formato versionado que el progreso local (`STATE_VERSION`), así que la migración local ↔ cuenta no necesita conversión. Límite: 2 MB; debe ser un objeto JSON.

Con un documento por estudiante, la sincronización es atómica y simple. El historial de speaking/listening, el vocabulario, el SRS y las evaluaciones viajan dentro del documento. Si en el futuro hiciera falta consultar por separado, se pueden añadir tablas normalizadas con la misma política RLS.

## Seguridad (modelo de amenazas)

| Amenaza | Defensa |
|---|---|
| Leer o modificar datos de otro estudiante manipulando peticiones | RLS **forzado** en todas las tablas; políticas `user_id = auth.uid()` en lectura y escritura; `with check` en insert/update. `auth.uid()` sale del JWT firmado por Supabase, nunca del cuerpo de la petición |
| Enviar un `user_id` ajeno | El cliente nunca envía `user_id` (valor por defecto `auth.uid()`). Si alguien lo fuerza, RLS lo rechaza; un trigger impide cambiar `user_id` |
| Uso de la clave pública | La clave anon es pública por diseño; el rol `anon` no tiene privilegios sobre las tablas ni las funciones |
| Clave administrativa en el frontend | No existe: solo URL + anon key en `config.js`. `verify-supabase.js` se niega a correr con una clave `service_role` |
| Sobrescribir progreso entre dispositivos | `efl_save_state` con `rev` esperado; un conflicto obliga a fusionar y reintentar |
| Borrar la cuenta de otro | `efl_delete_my_account()` no recibe parámetros: solo borra `auth.uid()` |
| XSS que robe la sesión | La sesión vive en `localStorage` (estándar de supabase-js). Mitigación: sin HTML de terceros, contenido estático propio y librería vendorizada y fijada. Pendiente: Content-Security-Policy (GitHub Pages no permite cabeceras; evaluar `<meta http-equiv>`) |
| Menores | Cuentas solo 18+. La confirmación es declarativa (no se verifica identidad); los menores tienen el modo invitado sin datos en servidor |

## Migración voluntaria del progreso local

Al iniciar sesión por primera vez en un perfil:

| Este navegador | Cuenta | Qué pasa |
|---|---|---|
| vacío | vacía | se vincula y se crea la copia en la cuenta |
| vacío | con datos | se vincula y se descarga la cuenta |
| con datos | vacía | **pregunta**: subir este progreso, o usar la cuenta en un perfil nuevo |
| con datos | con datos | **pregunta**: combinar (recomendado) / usar la cuenta / reemplazar la cuenta (doble confirmación) |

Antes de combinar o de usar la copia de la cuenta se guarda `efl-progress-backup:<perfil>:<fecha>` en este navegador.

## Fusión (`mergeStates`)

Es determinista e idempotente, y nunca pierde evidencias.
- **Actividades:** gana la más reciente; se conservan el máximo de intentos y el mejor resultado.
- **Lecciones:** si está completada en un lado, queda completada.
- **Evidencias:** unión de ambos lados.
- **Tarjetas SRS:** gana la revisión más reciente.
- **Minutos:** máximo por día.
- **Ajustes:** los del dispositivo actual.

## Cerrar sesión y eliminar la cuenta

- **Cerrar sesión**: conservar el progreso aquí (queda como invitado) o borrarlo de este navegador (sigue en la cuenta).
- **Eliminar cuenta**: hay que escribir «ELIMINAR». Borra la cuenta y todas sus filas en cascada; el progreso local queda como invitado.

## Pruebas y su alcance

| Prueba | Qué demuestra | Qué **no** demuestra |
|---|---|---|
| `npm run test:db` (13) | La migración y RLS en PostgreSQL 17 real (PGlite), con `auth.uid()` emulado igual que Supabase | Configuración de un proyecto Supabase real |
| `npm run test:unit` | Perfiles, fusión, motor de sincronización (conflictos, offline) | — |
| E2E `accounts.spec.js` | Interfaz completa; los datos pasan por PostgreSQL con RLS real. Incluye manipulación de peticiones A→B | Autenticación real, correo y red (simulados) |
| `npm run verify:supabase` | RLS en el **proyecto real** con dos usuarios de prueba | — (**pendiente**: requiere el proyecto) |
