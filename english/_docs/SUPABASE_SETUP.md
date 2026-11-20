# Activar las cuentas personales (Supabase)

Hasta completar estos pasos, el sitio funciona solo en modo invitado. Los pasos 1–5 los hace la persona propietaria del proyecto; nunca compartas la clave `service_role`.

## 1. Crear el proyecto
1. https://supabase.com → New project (plan gratuito). Región cercana a los estudiantes (p. ej. `South America (São Paulo)`).
2. Guarda la contraseña de la base de datos en tu gestor de contraseñas (no se usa en el sitio).

## 2. Aplicar la migración
SQL Editor → New query → pega el contenido de `supabase/migrations/0001_efl_accounts.sql` → Run. Comprueba en Table Editor que `efl_profiles` y `efl_learner_state` muestran **RLS enabled**.

## 3. Autenticación por correo (sin contraseñas)
- Authentication → Sign In / Providers → **Email**: activado; «Confirm email» activado.
- Authentication → Email Templates → **Magic Link**: incluye el código para escribirlo en la página, por ejemplo:
  `Tu código para English Fluency Lab es: {{ .Token }}` y el enlace `{{ .ConfirmationURL }}`.
- Recomendado para producción: SMTP propio (el correo integrado de Supabase tiene límites bajos de envío).

## 4. URLs permitidas
Authentication → URL Configuration:
- Site URL: `https://laverde97.github.io/latent-frontiers/english/`
- Redirect URLs:
  - `https://laverde97.github.io/latent-frontiers/english/index.html?view=account`
  - `http://localhost:8765/latent-frontiers/english/index.html?view=account` (vista previa local)

## 5. Datos que necesito
Project Settings → API:
- **Project URL** (`https://xxxx.supabase.co`)
- **anon / publishable key** (pública por diseño)

Se pegan en `english/app/config.js`. **No** envíes la clave `service_role` ni la contraseña de la base de datos.

## 6. Verificación en producción
1. Authentication → Users → Add user (×2, con «auto confirm»), solo para pruebas.
2. En tu terminal (las variables no se guardan en el repositorio):
   ```bash
   cd english
   SUPABASE_URL=… SUPABASE_ANON_KEY=… \
   EFL_TEST_A_EMAIL=… EFL_TEST_A_PASSWORD=… \
   EFL_TEST_B_EMAIL=… EFL_TEST_B_PASSWORD=… \
   npm run verify:supabase
   ```
3. Deben salir todas las comprobaciones con ✓. Después puedes borrar los dos usuarios de prueba.
