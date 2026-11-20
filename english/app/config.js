/* =========================================================================
   config.js — public configuration for optional personal accounts.

   Leave both values empty and the site works exactly as before (guest mode
   only). To enable accounts, follow english/_docs/SUPABASE_SETUP.md and
   paste the project URL and the PUBLIC anon (publishable) key.

   The anon key is designed to be public: every table is protected by Row
   Level Security. NEVER put a service_role / secret key here.
   ========================================================================= */
export const ACCOUNT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  /* version of the privacy terms the learner accepts when creating an
     account; bump it when PRIVACY.md changes materially */
  termsVersion: 'efl-2026-11'
};
