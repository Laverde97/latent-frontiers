/* Parses the magic link of Supabase's default email template, for the
   production verification script (see verify-supabase.js). */
/* the magic link of the default template:
   https://<ref>.supabase.co/auth/v1/verify?token=<hash>&type=magiclink|signup&redirect_to=…
   (also unwraps "safe links" that carry it in a url= parameter) */
export function parseMagicLink(value) {
  let u;
  try { u = new URL(value); } catch { return null; }
  const wrapped = u.searchParams.get('url') || u.searchParams.get('u');
  if (!u.pathname.includes('/auth/v1/verify') && wrapped) { return parseMagicLink(wrapped); }
  const token = u.searchParams.get('token');
  const type = u.searchParams.get('type');
  if (!u.pathname.includes('/auth/v1/verify') || !token || !type) { return null; }
  if (token.startsWith('pkce_')) { throw new Error('this link was issued for a browser (PKCE) sign-in; request it with --send'); }
  return { token_hash: token, type };
}

