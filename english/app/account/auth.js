/* =========================================================================
   auth.js — optional personal accounts (Supabase Auth, passwordless).

   Sign-in uses a one-time code / magic link sent by email (PKCE flow, so
   the link returns with ?code=… instead of tokens in the URL hash). The
   Supabase library is vendored (app/vendor) and loaded only when accounts
   are configured. Sessions are stored by the library in this browser's
   localStorage.
   ========================================================================= */

import { ACCOUNT_CONFIG } from '../config.js';

export function accountsConfigured(cfg = ACCOUNT_CONFIG) {
  return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && /^https:\/\/[a-z0-9-]+\.supabase\.co$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cfg.supabaseUrl));
}

function loadLibrary() {
  if (window.supabase && window.supabase.createClient) { return Promise.resolve(window.supabase); }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/supabase-js-2.119.2.umd.js', import.meta.url).href;
    s.onload = () => (window.supabase && window.supabase.createClient ? resolve(window.supabase) : reject(new Error('supabase library missing')));
    s.onerror = () => reject(new Error('could not load the accounts library'));
    document.head.append(s);
  });
}

export class AuthService {
  constructor(cfg = ACCOUNT_CONFIG) {
    this.cfg = cfg;
    this.client = null;
    this.user = null;
    this.listeners = new Set();
  }

  get configured() { return accountsConfigured(this.cfg); }

  async init() {
    if (!this.configured) { return null; }
    const lib = await loadLibrary();
    this.client = lib.createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'efl-auth' }
    });
    const { data } = await this.client.auth.getSession();
    this.user = data && data.session ? data.session.user : null;
    this.client.auth.onAuthStateChange((_event, session) => {
      const next = session ? session.user : null;
      const changed = (next && next.id) !== (this.user && this.user.id);
      this.user = next;
      if (changed) { this.listeners.forEach((fn) => fn(this.user)); }
    });
    /* remove the one-time ?code= from the address bar after sign-in */
    const url = new URL(window.location.href);
    if (url.searchParams.has('code')) {
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
    }
    return this.user;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async sendCode(email) {
    /* always the same canonical address (…/english/index.html?view=account),
       so it matches the Redirect URLs allow-list in Supabase */
    const path = window.location.pathname.replace(/\/(index\.html)?$/, '/index.html');
    const redirect = `${window.location.origin}${path}?view=account`;
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
    if (error) { throw error; }
  }

  async verifyCode(email, token) {
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) { throw error; }
    this.user = data.user || (data.session && data.session.user) || this.user;
    return this.user;
  }

  async signOut() {
    await this.client.auth.signOut({ scope: 'local' });
    this.user = null;
    this.listeners.forEach((fn) => fn(null));
  }
}
