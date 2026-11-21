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

/* WCAG relative-luminance contrast between two "rgb(r, g, b)" strings */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/* effective look of a checkbox and of the background around it */
const lookOf = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  let bgEl = el.parentElement; let bg = 'rgba(0, 0, 0, 0)';
  while (bgEl && (bg = getComputedStyle(bgEl).backgroundColor) === 'rgba(0, 0, 0, 0)') { bgEl = bgEl.parentElement; }
  return { w: r.width, h: r.height, bw: cs.borderTopWidth, bc: cs.borderTopColor, fill: cs.backgroundColor, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, oc: cs.outlineColor, os: cs.outlineStyle, op: cs.opacity, vis: cs.visibility, around: bg === 'rgba(0, 0, 0, 0)' ? 'rgb(255, 255, 255)' : bg, label: getComputedStyle(document.querySelector(`label[for="${el.id}"]`)).color };
});
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

test('age checkbox: visible, labelled, keyboard-operable, error linked for screen readers, never ticked by code', async ({ browser }) => {
  const { context, page, panel, otp, errors } = await setup(browser, ok);
  const age = panel.getByRole('checkbox', { name: 'Confirmo que tengo 18 años o más.' });
  await expect(age).toBeVisible();
  await expect(age).not.toBeChecked();
  await expect(age).toHaveAttribute('required', '');
  const before = await lookOf(age);
  expect(before.w).toBeGreaterThanOrEqual(20);
  expect(before.h).toBeGreaterThanOrEqual(20);
  expect(before).toMatchObject({ bw: '2px', bc: 'rgb(74, 85, 104)', op: '1', vis: 'visible' });
  expect(contrast(before.bc, before.around)).toBeGreaterThanOrEqual(3);   /* WCAG 1.4.11 */
  /* keyboard: Tab from the email field reaches it; Space toggles it */
  await panel.locator('[data-testid="signin-email"]').focus();
  await page.keyboard.press('Tab');
  await expect(age).toBeFocused();
  await page.keyboard.press('Space');
  await expect(age).toBeChecked();
  await page.keyboard.press('Space');
  await expect(age).not.toBeChecked();
  /* clicking the label also toggles it */
  await panel.getByText('Confirmo que tengo 18 años o más.').click();
  await expect(age).toBeChecked();
  await age.uncheck();
  /* send without it: validation only, visible + announced error on the field */
  await panel.locator('[data-testid="signin-email"]').fill('owner@example.test');
  await panel.locator('[data-testid="signin-terms"]').check();
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'validation');
  await expect(age).toHaveAttribute('aria-invalid', 'true');
  await expect(age).toHaveAccessibleDescription('Las cuentas personales están disponibles únicamente para mayores de 18 años.');
  await expect(age).toBeFocused();
  await expect(age).not.toBeChecked();                                   /* never set automatically */
  /* error state: still a box (dark border on white, NOT the label colour),
     plus a separate red ring and a marked row — all with real contrast */
  const after = await lookOf(age);
  expect(after.bc).toBe('rgb(26, 26, 26)');
  expect(after.fill).toBe('rgb(255, 255, 255)');
  expect(after.os).toBe('solid');
  expect(after.oc).toBe('rgb(164, 14, 38)');                             /* --efl-bad ring */
  expect(after.bc).not.toBe(after.oc);                                   /* box border ≠ error red (the original defect) */
  expect(contrast(after.bc, after.fill)).toBeGreaterThanOrEqual(3);
  expect(contrast(after.oc, after.around)).toBeGreaterThanOrEqual(3);
  expect(contrast(after.label, after.around)).toBeGreaterThanOrEqual(4.5);
  expect(after.around).not.toBe('rgb(255, 255, 255)');                  /* the row is marked */
  /* ticking it clears the error state; still nothing sent until the user sends */
  await page.keyboard.press('Space');
  await expect(age).not.toHaveAttribute('aria-invalid', 'true');
  expect(otp).toHaveLength(0);
  await send(panel).click();
  await expect(msg(panel)).toHaveAttribute('data-state', 'accepted');
  expect(otp).toHaveLength(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('age checkbox stays visible with forced colours and a dark colour scheme', async ({ browser }) => {
  const { context, page, panel } = await setup(browser, ok);
  for (const media of [{ colorScheme: 'dark' }, { forcedColors: 'active' }]) {
    await page.emulateMedia(media);
    const age = panel.getByRole('checkbox', { name: 'Confirmo que tengo 18 años o más.' });
    await expect(age).toBeVisible();
    const box = await age.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(13);
  }
  await context.close();
});

test('guest mode works for anyone: after declining the age confirmation, lessons still save locally and nothing reaches Supabase', async ({ browser }) => {
  const { context, page, panel, otp, other, errors } = await setup(browser, ok);
  await send(panel).click();                                             /* a minor stops here */
  await expect(msg(panel)).toHaveAttribute('data-state', 'validation');
  await openLab(page, '?view=lesson&id=w01-l1');
  await page.evaluate(() => window.__efl.store.update((s) => { s.practice['2026-11-21'] = 5; }));
  await page.reload();
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  const practice = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')).practice);
  expect(practice['2026-11-21']).toBe(5);
  expect(otp).toHaveLength(0);
  expect(other).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test('both required checkboxes are distinguishable in every state (normal, error, checked) with sufficient contrast', async ({ browser }) => {
  const { context, page, panel } = await setup(browser, ok);
  const age = panel.getByRole('checkbox', { name: 'Confirmo que tengo 18 años o más.' });
  const terms = panel.getByRole('checkbox', { name: /Entiendo qué datos se guardan/ });
  /* normal */
  for (const box of [age, terms]) {
    const l = await lookOf(box);
    expect(l.w).toBeGreaterThanOrEqual(20);
    expect(contrast(l.bc, l.around)).toBeGreaterThanOrEqual(3);
  }
  /* the situation reported: terms ticked, age missing → error on age */
  await terms.check();
  await panel.locator('[data-testid="signin-email"]').fill('owner@example.test');
  await send(panel).click();
  const a = await lookOf(age);
  const tm = await lookOf(terms);
  expect(contrast(a.bc, a.fill)).toBeGreaterThanOrEqual(3);              /* age box visible */
  expect(a.os).toBe('solid');                                            /* a separate error ring exists */
  expect(a.oc).toBe('rgb(164, 14, 38)');
  expect(a.bc).not.toBe(a.oc);                                           /* the box is not painted in the error red */
  expect(a.fill).toBe('rgb(255, 255, 255)');
  expect(contrast(a.oc, a.around)).toBeGreaterThanOrEqual(3);            /* error ring visible */
  expect(contrast(tm.fill, tm.around)).toBeGreaterThanOrEqual(3);        /* ticked terms visible */
  await page.locator('[data-testid="account-panel"] .efl-signin').screenshot({ path: test.info().outputPath('age-error-terms-checked.png') });
  /* both ticked */
  await age.check();
  for (const box of [age, terms]) {
    const l = await lookOf(box);
    expect(l.fill).toBe('rgb(29, 78, 137)');
    expect(contrast(l.fill, l.around)).toBeGreaterThanOrEqual(3);
  }
  await expect(age).not.toHaveAttribute('aria-invalid', 'true');
  await context.close();
});
