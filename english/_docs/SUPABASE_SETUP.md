# Activar las cuentas personales (Supabase)

Hasta completar estos pasos, `app/config.js` queda vacío y el sitio funciona **solo en modo invitado** (perfiles locales, sin servidor). El modo invitado nunca depende de Supabase.

**Lo que nunca debes compartir** (ni conmigo, ni en el repositorio):
- la contraseña de la base de datos;
- la clave `service_role` o cualquier clave `sb_secret_…`;
- las credenciales SMTP;
- los tokens de acceso de Supabase.

La aplicación solo necesita **dos valores públicos**: la *Project URL* y la clave *anon / publishable*.

---

## 1. Crear el proyecto

1. Entra en https://supabase.com/dashboard → **New project**.
2. Rellena el formulario:
   - **Organization**: la tuya (plan Free).
   - **Project name**: `english-fluency-lab` (o el que prefieras).
   - **Database password**: pulsa *Generate a password* y guárdala en tu gestor de contraseñas. La aplicación no la usa; **no me la envíes**.
   - **Region**: la más cercana a los estudiantes, por ejemplo *South America (São Paulo)*.
   - **Security options**, si aparecen:
     - **Enable Data API: activado**. La app usa la API REST.
     - El resto de opciones con su valor por defecto. La migración concede y revoca los permisos explícitamente, así que funciona con o sin «exponer tablas nuevas automáticamente».
3. Pulsa **Create new project** y espera a que el estado sea *Healthy* (1–2 minutos).

## 2. Aplicar la migración (tablas, RLS y funciones)

1. Menú lateral → **SQL Editor** → **New query**.
2. Pega **todo** el contenido de `supabase/migrations/0001_efl_accounts.sql` y pulsa **Run**.
   - Supabase puede advertir de «operaciones destructivas» porque el script incluye `drop policy if exists` / `drop trigger if exists`. Son idempotentes y no borran datos: confirma.
   - Resultado esperado: *Success. No rows returned*.
3. Comprobación de solo lectura: ejecuta esta consulta en una pestaña nueva del SQL Editor.

   ```sql
   select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
          has_table_privilege('anon', c.oid, 'select')            as anon_select,
          has_table_privilege('authenticated', c.oid, 'truncate') as auth_truncate,
          has_table_privilege('authenticated', c.oid, 'update')   as auth_update
     from pg_class c
    where c.relname in ('efl_profiles', 'efl_learner_state');

   select p.proname, p.prosecdef as security_definer, p.proconfig,
          has_function_privilege('anon', p.oid, 'execute')          as anon_exec,
          has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
     from pg_proc p
    where p.proname in ('efl_save_state', 'efl_delete_my_account');
   ```

   Resultado esperado de la primera consulta:

   | relname | rls | forced | anon_select | auth_truncate | auth_update |
   |---|---|---|---|---|---|
   | efl_profiles | true | true | false | false | **false** |
   | efl_learner_state | true | true | false | false | true |

   Resultado esperado de la segunda consulta:
   - `efl_save_state`: `security_definer = false`, `anon_exec = false`, `auth_exec = true`.
   - `efl_delete_my_account`: `security_definer = true`, `proconfig = {search_path=""}`, `anon_exec = false`, `auth_exec = true`.

   Si algo no coincide, avísame antes de seguir.
4. Opcional: **Advisors → Security Advisor**. Puede señalar que `efl_delete_my_account` es *security definer* y ejecutable por `authenticated`. Es intencionado: así puede borrar en `auth.users`, pero solo la fila del propio usuario. Cualquier otro aviso sobre `efl_*`, compártelo conmigo.

## 3. Autenticación por correo (sin contraseñas)

1. **Authentication → Sign In / Providers**:
   - **Allow new users to sign up: activado**. Sin esto nadie puede crear su cuenta.
   - **Email: activado**, con **Confirm email: activado**.
   - **Email OTP Expiration**: 3600 s (valor por defecto) o menos.
   - **Email OTP Length**: 6 (por defecto). La app acepta hasta 10 dígitos.
   - No actives otros proveedores (Google, teléfono, anónimos…): la app no los usa.
2. **Authentication → Emails → Templates**. Edita **dos** plantillas, porque un usuario nuevo recibe *Confirm signup* y uno existente recibe *Magic Link*:
   - **Confirm signup** y **Magic Link**: añade el código, por ejemplo:

     ```html
     <h2>English Fluency Lab</h2>
     <p>Tu código de acceso es: <strong>{{ .Token }}</strong></p>
     <p>Escríbelo en la página donde lo pediste. Caduca en 1 hora.</p>
     <p>O abre este enlace en el mismo navegador: <a href="{{ .ConfirmationURL }}">entrar</a></p>
     <p>Si no lo pediste, ignora este correo.</p>
     ```

   - El **código** funciona en cualquier navegador. El **enlace** solo funciona en el mismo navegador donde se pidió (flujo PKCE). Por eso la interfaz recomienda el código.

### Envío de correos: decisión importante

El servidor de correo integrado de Supabase tiene dos límites:
1. Solo entrega a direcciones de los **miembros del equipo** de tu organización.
2. Tiene un límite muy bajo de envíos por hora.

| Uso | Qué hacer |
|---|---|
| **Verificación** (pasos 6–7) | Dos buzones distintos que sean miembros del equipo. Ve a **Organization → Team → Invite** e invita tu segundo correo (rol *Developer* basta). Otra opción es configurar SMTP propio desde ya |
| **Estudiantes reales** | **Obligatorio SMTP propio**: Authentication → Emails → SMTP Settings (por ejemplo Resend, Brevo o Amazon SES). Las credenciales SMTP se introducen solo en el panel de Supabase; **no me las envíes** |

Las cuentas **no deben anunciarse a estudiantes** hasta tener SMTP propio.

## 4. URLs permitidas

La app siempre pide volver a la dirección canónica `…/english/index.html?view=account`, aunque el estudiante entre por `…/english/`.

**Authentication → URL Configuration**:
- **Site URL**: `https://laverde97.github.io/latent-frontiers/english/index.html`
- **Redirect URLs** (*Add URL*, una por una):
  1. `https://laverde97.github.io/latent-frontiers/english/index.html?view=account` (GitHub Pages)
  2. `http://localhost:8765/latent-frontiers/english/index.html?view=account` (vista previa local)
  3. `http://127.0.0.1:8765/latent-frontiers/english/index.html?view=account` (vista previa por IP)

No uses comodines amplios como `https://laverde97.github.io/**`: así solo esta sección puede recibir sesiones.

## 5. Copiar los dos valores públicos

**Project Settings → API Keys** y **Project Settings → Data API**. En proyectos antiguos ambas cosas están en **Settings → API**.

| Valor | Dónde | Formato | ¿Público? |
|---|---|---|---|
| **Project URL** | Data API / API → *Project URL* | `https://<ref>.supabase.co` | Sí |
| **Clave pública** | API Keys → **Publishable key** (`sb_publishable_…`) o la *legacy* **anon public** (`eyJ…`) | una línea | Sí, está diseñada para el navegador |
| ~~Secret / service_role~~ | API Keys → *Secret keys* | `sb_secret_…` / `eyJ…` con `service_role` | **NO. Nunca la copies** |

### Configuración local (sin tocar el repositorio)

Pega los dos valores en `english/_local/config.js`. Ese archivo está en `.gitignore` y, como la carpeta empieza por `_`, Quarto no lo copia ni lo publica.

```js
export const ACCOUNT_CONFIG = {
  supabaseUrl: 'https://<ref>.supabase.co',        // sin barra final
  supabaseAnonKey: 'sb_publishable_…',              // nunca sb_secret_…
  termsVersion: 'efl-2026-11'
};
```

- La vista previa lo sirve en lugar de `app/config.js` **solo** si se inicia con `EFL_LOCAL_CONFIG=1`:

  ```bash
  EFL_LOCAL_CONFIG=1 HOST=0.0.0.0 PORT=8765 node english/_tests/serve.js
  ```

- El `app/config.js` del repositorio sigue vacío, así que GitHub Pages continúa en modo invitado. Rellenarlo será un paso aparte, autorizado, antes de publicar.
- Si por error se pega una clave secreta, la app desactiva las cuentas y lo indica en la consola.
- `supabase-js` 2.119.2 reconoce las claves `sb_publishable_` de forma nativa.

## 6. Verificación automática contra el proyecto real

El script entra sin contraseñas, como la app (`signInWithOtp`). Acepta dos respuestas al correo:
- el **enlace** de la plantilla predeterminada: copia el enlace con clic derecho → «Copiar dirección del enlace» y **no lo abras**, porque es de un solo uso;
- el **código**, si la plantilla incluye `{{ .Token }}`.

Lee la URL y la clave de `_local/config.js`. Crea las dos cuentas de prueba la primera vez. Necesitas dos buzones distintos que reciban correo (ver el paso 3). Las variables viven solo en tu terminal.

```bash
cd english
export EFL_TEST_A_EMAIL='<buzón de prueba A>'
export EFL_TEST_B_EMAIL='<buzón de prueba B>'

# 1) envía los dos correos
npm run verify:supabase -- --send

# 2) con los enlaces copiados (válidos 1 h, un solo uso):
EFL_TEST_A_LINK='<enlace A>' EFL_TEST_B_LINK='<enlace B>' \
  npm run verify:supabase -- --delete-test-accounts
# (o EFL_TEST_A_CODE=… EFL_TEST_B_CODE=… si la plantilla trae código)
```

Puedes ejecutar los comandos tú en tu terminal o escribirlos en esta sesión con el prefijo `!`. Los códigos de un solo uso de cuentas de prueba no son claves del proyecto.

El script comprueba:
- **Acceso**: A y B entran por código.
- **18+**: sin la confirmación no se guarda progreso; `adult_confirmed = false` se rechaza; la fila 18+ no se puede editar.
- **Guardado y concurrencia**: cada uno guarda lo suyo y un `rev` antiguo produce conflicto.
- **Intentos de A contra B**: A no puede leer, actualizar, borrar, mover filas ni insertar como B. Los intentos de inserción deben fallar **por RLS**; un error de clave duplicada no cuenta como éxito.
- **Clave anon sola**: no lee, no inserta y no llama a las funciones.
- **Integridad de B**: sus datos siguen intactos tras todos los intentos.
- **Sincronización real**: A en dos «dispositivos» con el motor de la app. Ambos terminan con la unión del progreso y la misma revisión, el documento guardado es válido y nada llega a B.
- **Eliminación** (con `--delete-test-accounts`): A elimina su cuenta y sus datos desaparecen, B no se ve afectado, y después B se elimina (limpieza).

**Con una sola cuenta**: omite `EFL_TEST_B_EMAIL`.
- Se ejecutan las comprobaciones de una cuenta: acceso, 18+, conflicto de `rev`, inserciones falsificadas contra un id ajeno, clave anon y sincronización entre dos dispositivos.
- Las de aislamiento A↔B se listan como **PENDING**, no como superadas.
- Seguridad: el script se niega a tocar una cuenta que ya tenga progreso real.
- Privacidad: no imprime enlaces, códigos ni tokens, y enmascara los correos.
- Es mejor pegar los enlaces cuando el script los pida en tu terminal que ponerlos en variables de entorno, porque así no quedan en el historial del shell.

Resultado esperado: `N/N checks passed against <ref>.supabase.co`. Si falla una comprobación, **no actives las cuentas para estudiantes** y comparte la salida conmigo (no contiene claves).

> Si `efl_delete_my_account` falla con *permission denied for table users*, tu proyecto restringe al rol `postgres` sobre el esquema `auth`. Alternativa segura: una Edge Function que use la clave secreta **como secreto del servidor** (`auth.admin.deleteUser(user.id)` tras validar el JWT del llamante). Nunca se resolvería poniendo esa clave en el navegador.

## No llega el correo: diagnóstico

El formulario distingue tres estados (atributo `data-state` del mensaje):

| Mensaje en la página | Qué significa | Qué hacer |
|---|---|---|
| «Las cuentas personales están disponibles únicamente para mayores de 18 años» / «Completa los campos obligatorios» / correo no válido | **Validación**: no se envió nada | Completar el formulario |
| «La solicitud fue aceptada por el proveedor de correo» | Supabase aceptó la petición. **No confirma la entrega** | Esperar unos minutos, revisar spam y comprobar el evento de envío en el registro de Auth |
| «Este correo no está autorizado…» (`email_address_not_authorized`) | El correo integrado de Supabase solo entrega a los miembros del equipo de la organización | Usar el correo del propietario, o configurar SMTP propio (autorización pendiente) |
| «Se ha alcanzado el límite temporal de solicitudes» (`over_email_send_rate_limit`, `over_request_rate_limit`, 429) | Cupo por hora del correo integrado, o menos de 60 s desde el último envío a esa dirección | Esperar. El botón se bloquea 60 s. No reintentar en bucle |
| «No fue posible enviar el correo. Revisa la configuración» (`network`, `http_5xx`, `email_provider_disabled`…) | Sin conexión, error del servidor o proveedor de correo desactivado | Revisar la conexión y Authentication → Sign In / Providers |

**Cómo leer el registro sin compartir datos:**
1. En el panel de Supabase abre **Logs → Auth** (o Authentication → Logs).
2. Filtra por la hora del intento y la ruta `/otp`.
3. Anota solo el estado HTTP, el `error_code` y si aparece un evento de envío de correo.
4. No copies el correo completo, enlaces ni tokens.

**Límites del correo integrado:**
- solo entrega a miembros del equipo;
- muy pocos mensajes por hora en todo el proyecto;
- 60 s mínimo entre envíos a la misma dirección;
- el remitente genérico suele caer en spam.

**Para estudiantes reales hace falta SMTP propio** (Authentication → Emails → SMTP Settings). Requiere elegir y autorizar un proveedor externo; no se ha contratado ni conectado ninguno.

## 7. Prueba manual de la interfaz (vista previa local)

Con `config.js` relleno, la vista previa sigue en `http://localhost:8765/latent-frontiers/english/index.html?view=account`:

1. Sin cuenta: perfiles locales, lecciones, audio y progreso funcionan igual (modo invitado).
2. Entrar con correo + casillas 18+ y términos → **abrir el enlace del correo en el mismo Chrome** (o escribir el código) → vuelve a `?view=account` → «Cuenta vinculada». El enlace no funciona en otro navegador (PKCE).
3. Con progreso local previo, aparece la elección de migración (subir / combinar / usar el de la cuenta / reemplazar).
4. Abrir la misma cuenta en otro navegador (Edge): el progreso aparece y los cambios se combinan.
5. Cerrar sesión conservando o borrando la copia local.
6. Eliminar la cuenta escribiendo «ELIMINAR».

## Estado

| Comprobación | Dónde | Estado |
|---|---|---|
| Migración + RLS + privilegios (18 pruebas) | PostgreSQL local (PGlite), con `auth.uid()` y los privilegios por defecto de Supabase emulados | ✓ en verde; no equivale a producción |
| Interfaz de cuentas (9 E2E) | Navegador con Supabase **simulado** sobre PGlite | ✓ en verde; autenticación y correo simulados |
| Pasos 1–5 | Tu proyecto Supabase | Pendiente |
| Paso 6 `verify:supabase` | Supabase real | Pendiente |
| Paso 7 manual | Vista previa + Supabase real | Pendiente |
| SMTP propio | Tu proyecto | Pendiente; obligatorio antes de abrir cuentas a estudiantes |
