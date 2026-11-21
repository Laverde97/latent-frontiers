/* Sign-in form against the REAL vendored supabase-js (not the fake client).
   config.js points to a fictitious project and every request to it is
   intercepted with page.route: nothing leaves the machine and no email is
   ever sent. It proves (1) signInWithOtp is called only when the form is
   valid and with the right payload, and (2) each provider response is shown
   as what it is — a rejection is never presented as "sent". */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FAKE_TTS, trackErrors, openLab } from './helpers.js';

const PROJECT = 'https://e2e-test.supabase.co';

async function setup(browser, respond) {
  const context = await browser.newContext();
  await context.addInitScript(FAKE_TTS);
  await context.route('**/english/app/config.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export const ACCOUNT_CONFIG = { supabaseUrl: '${PROJECT}', supabaseAnonKey: 'sb_publishable_e2e_only', termsVersion: 'efl-2026-11' };`
  }));
  const otp = [];
  const other = [];
  await context.route(`${PROJECT}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/auth/v1/otp') {
      otp.push({ redirect_to: u.searchParams.get('redirect_to'), body: req.postDataJSON() });
      return respond(route, otp.length);
    }
    other.push(`${req.method()} ${u.pathname}`);
    return route.fulfill({ status: 404, body: '{}' });
  });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await openLab(page, '?view=account');
  const panel = page.locator('[data-testid="account-panel"]');
  return { context, page, panel, otp, other, errors };
}

/* CORS headers exactly as the real project returns them (checked with a GET
   on /auth/v1/settings): the API-version header is exposed to the page */
const cors = (route) => ({
  'access-control-allow-origin': route.request().headers().origin || '*',
  'access-control-allow-credentials': 'true',
  'access-control-expose-headers': 'X-Total-Count, Link, X-Supabase-Api-Version'
});
const ok = (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors(route), body: '{}' });
/* GoTrue error, current API version (supabase-js sends X-Supabase-Api-Version) */
const apiError = (status, code, message) => (route) => route.fulfill({
  status, contentType: 'application/json', headers: { ...cors(route), 'x-supabase-api-version': '2024-01-01' },
  body: JSON.stringify({ code, message })
});
/* legacy GoTrue error body */
const legacyError = (status, code, msg) => (route) => route.fulfill({
  status, contentType: 'application/json', headers: cors(route), body: JSON.stringify({ code: status, error_code: code, msg })
});
/* same error, but the API-version header is NOT exposed (e.g. a proxy):
   the library cannot read the code, the app must still classify it */
const hiddenHeaderError = (status, code, message) => (route) => route.fulfill({
  status, contentType: 'application/json', headers: { 'access-control-allow-origin': route.request().headers().origin || '*', 'x-supabase-api-version': '2024-01-01' },
  body: JSON.stringify({ code, message })
});

async function fill(panel, { email = 'owner@example.test', adult = true, terms = true } = {}) {
  if (email !== null) { await panel.locator('[data-testid="signin-email"]').fill(email); }
  if (adult) { await panel.locator('[data-testid="signin-adult"]').check(); }
  if (terms) { await panel.locator('[data-testid="signin-terms"]').check(); }
}
const msg = (panel) => panel.locator('[data-testid="signin-msg"]');
const send = (panel) => panel.locator('[data-testid="signin-send"]');

test('validation: nothing is sent unless 18+, terms and a valid email are all present', async ({ browser }) => {
  const { context, panel, otp, other, errors } = await setup(browser, ok);
  /* empty form: the age requirement comes first and is never skipped */
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'validation');
  await expect(msg(panel)).toHaveText('Las cuentas personales están disponibles únicamente para mayores de 18 años.');
  await expect(panel.locator('[data-testid="signin-adult"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.locator('[data-testid="signin-adult"]')).not.toBeChecked();
  /* 18+ but no email */
  await panel.locator('[data-testid="signin-adult"]').check();
  await send(panel).click();
  await expect(msg(panel)).toHaveText('Completa los campos obligatorios.');
  await expect(panel.locator('[data-testid="signin-email"]')).toHaveAttribute('aria-invalid', 'true');
  /* email but terms unchecked */
  await panel.locator('[data-testid="signin-email"]').fill('owner@example.test');
  await send(panel).click();
  await expect(msg(panel)).toHaveText('Completa los campos obligatorios.');
  await expect(panel.locator('[data-testid="signin-terms"]')).toHaveAttribute('aria-invalid', 'true');
  /* malformed email */
  await panel.locator('[data-testid="signin-terms"]').check();
  await panel.locator('[data-testid="signin-email"]').fill('owner@example');
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'validation');
  await expect(msg(panel)).toContainText(/correo electrónico válido/);
  expect(otp).toHaveLength(0);
  expect(other).toEqual([]);
  await expect(panel.locator('[data-testid="signin-code"]')).toBeHidden();
  expect(errors).toEqual([]);
  await context.close();
});

test('accepted: exactly one signInWithOtp call with the right payload; delivery is not claimed; resend waits', async ({ browser }) => {
  const { context, page, panel, otp, other, errors } = await setup(browser, ok);
  await fill(panel);
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'accepted');
  await expect(msg(panel)).toHaveText('La solicitud fue aceptada por el proveedor de correo.');
  await expect(panel.locator('[data-testid="signin-note"]')).toContainText(/no confirma la entrega/);
  await expect(panel.locator('[data-testid="signin-code"]')).toBeVisible();
  expect(otp).toHaveLength(1);
  expect(otp[0].body.email).toBe('owner@example.test');
  expect(otp[0].body.create_user).toBe(true);
  expect(otp[0].body.code_challenge).toBeTruthy();                     /* PKCE */
  expect(otp[0].body.password).toBeUndefined();                       /* passwordless */
  expect(otp[0].redirect_to).toBe(new URL('index.html?view=account', page.url()).href);
  /* anti-repeat: the button is disabled with a visible countdown */
  await expect(send(panel)).toBeDisabled();
  await expect(send(panel)).toContainText(/Puedes pedir otro en \d+ s/);
  await send(panel).click({ force: true });
  await page.waitForTimeout(300);
  expect(otp).toHaveLength(1);
  expect(other).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

for (const [label, respond, shownCode] of [
  ['current API format', apiError(400, 'email_address_not_authorized', 'Email address "owner@example.test" cannot be used as it is not authorized'), 'email_address_not_authorized'],
  ['legacy format', legacyError(400, 'email_address_not_authorized', 'Email address not authorized'), 'email_address_not_authorized'],
  ['API-version header hidden', hiddenHeaderError(400, 'email_address_not_authorized', 'Email address "owner@example.test" cannot be used as it is not authorized'), 'http_400']
]) {
  test(`not authorized (${label}): clear message, never "accepted", no code box`, async ({ browser }) => {
    const { context, panel, otp } = await setup(browser, respond);
    await fill(panel);
    await send(panel).click();
    await expect(msg(panel)).toHaveAttribute('data-state', 'rejected');
    await expect(msg(panel)).toHaveAttribute('role', 'alert');
    await expect(msg(panel)).toContainText('Este correo no está autorizado para recibir mensajes con la configuración actual de Supabase.');
    await expect(msg(panel)).toContainText(`(código: ${shownCode})`);
    await expect(msg(panel)).not.toContainText(/aceptada|enviamos|owner@/);
    await expect(panel.locator('[data-testid="signin-code"]')).toBeHidden();
    await expect(panel.locator('[data-testid="signin-note"]')).toBeHidden();
    await expect(send(panel)).toBeEnabled();
    expect(otp).toHaveLength(1);
    await context.close();
  });
}

test('rate limit: specific message and the button waits before another request', async ({ browser }) => {
  const { context, page, panel, otp } = await setup(browser, apiError(429, 'over_email_send_rate_limit', 'email rate limit exceeded'));
  await fill(panel);
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'rejected');
  await expect(msg(panel)).toContainText('Se ha alcanzado el límite temporal de solicitudes.');
  await expect(msg(panel)).toContainText('over_email_send_rate_limit');
  await expect(send(panel)).toBeDisabled();
  await send(panel).click({ force: true });
  await page.waitForTimeout(300);
  expect(otp).toHaveLength(1);
  await context.close();
});

test('network failure and server error: "could not send", never "accepted"', async ({ browser }) => {
  for (const [respond, code] of [[(route) => route.abort('failed'), 'network'], [(route) => route.fulfill({ status: 500, contentType: 'application/json', headers: cors(route), body: '{}' }), 'http_500']]) {
    const { context, panel } = await setup(browser, respond);
    await fill(panel);
    await send(panel).click();
    await expect(msg(panel)).toHaveAttribute('data-state', 'rejected');
    await expect(msg(panel)).toContainText('No fue posible enviar el correo. Revisa la configuración.');
    await expect(msg(panel)).toContainText(code);
    await expect(msg(panel)).not.toContainText(/aceptada/);
    await expect(panel.locator('[data-testid="signin-code"]')).toBeHidden();
    await expect(send(panel)).toBeEnabled();
    await context.close();
  }
});

test('accessibility (axe) of the form with a provider error visible', async ({ browser }) => {
  const { context, page, panel } = await setup(browser, apiError(400, 'email_address_not_authorized', 'not authorized'));
  await fill(panel);
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'rejected');
  const r = await new AxeBuilder({ page }).include('#efl-app').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  await context.close();
});
