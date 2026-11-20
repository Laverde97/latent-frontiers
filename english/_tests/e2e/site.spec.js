import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_TTS, trackErrors, openLab, setSiteLang } from './helpers.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('home: navbar links to the lab, labels stay correct in both languages', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('index.html');
  const nav = page.locator('.navbar-nav');
  await expect(nav.getByRole('link', { name: 'Inglés', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Inicio', exact: true })).toBeVisible();
  await page.locator('a[href$="#lang-toggle"]').click();
  await expect(nav.getByRole('link', { name: 'English Lab', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByText('Data Science & Artificial Intelligence')).toBeVisible();
  await nav.getByRole('link', { name: 'English Lab', exact: true }).click();
  await expect(page).toHaveURL(/\/latent-frontiers\/english\/(index\.html)?$/);
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  expect(errors).toEqual([]);
});

test('writings keeps every article and shows the lab promo', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('writings.html');
  const postDirs = readdirSync(join(repo, 'posts')).filter((d) => statSync(join(repo, 'posts', d)).isDirectory());
  const rows = page.locator('#listing-listing table tbody tr');
  await expect(rows).toHaveCount(postDirs.length);
  const promo = page.locator('.lf-efl-promo');
  await expect(promo).toContainText('English Fluency Lab');
  await expect(promo).toContainText('A1 · A2 · B1 · B2 · C1');
  await promo.locator('a').click();
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  expect(errors).toEqual([]);
});

test('lab UI follows the site ES/EN toggle; Spanish support is separate', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  const errors = trackErrors(page);
  await openLab(page);
  await expect(page.locator('.efl-nav a[data-view="dashboard"]')).toHaveText('Panel');
  await page.locator('a[href$="#lang-toggle"]').click();
  await expect(page.locator('.efl-nav a[data-view="dashboard"]')).toHaveText('Dashboard');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('.efl-nav a[data-view="dashboard"]')).toHaveText('Dashboard');
  /* Spanish support toggle */
  await openLab(page, '?view=lesson&id=w01-l1');
  await expect(page.locator('.efl-es').first()).toBeVisible();
  await page.locator('[data-testid="es-toggle"]').click();
  await expect(page.locator('.efl-es')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('progress export, validated import, corrupt data and reset', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  const errors = trackErrors(page);
  await openLab(page, '?view=lesson&id=w01-l1');
  await page.locator('fieldset[data-ex="v3"] input').fill('meet');
  await page.locator('fieldset[data-ex="v3"] button.efl-check').click();
  await openLab(page, '?view=settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid="export"]').click()]);
  const path = await download.path();
  const exported = JSON.parse((await import('node:fs')).readFileSync(path, 'utf8'));
  expect(exported.app).toBe('english-fluency-lab');
  expect(exported.state.version).toBe(2);

  /* invalid file is rejected without touching progress */
  const bad = join(dirname(path), 'bad.json');
  writeFileSync(bad, JSON.stringify({ app: 'english-fluency-lab', state: { version: 2, evidence: [{ skill: 'x', source: 'auto', score: 9 }] } }));
  await page.locator('[data-testid="import-file"]').setInputFiles(bad);
  await expect(page.locator('.efl-settings .efl-bad')).toContainText(/no válido|Invalid file/);

  /* reset, then import the export back */
  page.on('dialog', (d) => d.accept());
  await page.locator('[data-testid="reset"]').click();
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')));
  expect(Object.keys(st.lessons)).toEqual([]);
  await page.locator('[data-testid="import-file"]').setInputFiles(path);
  await expect(page.locator('.efl-settings .efl-ok')).toHaveText(/Progreso importado|Progress imported/);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')));
  expect(st.lessons['w01-l1']).toBeTruthy();

  /* corrupt storage → notice, fresh state, backup kept */
  await page.evaluate(() => localStorage.setItem('efl-progress', '{"version":2,'));
  await openLab(page);
  await expect(page.getByRole('alert').first()).toContainText(/dañados|damaged/);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.some((k) => k.startsWith('efl-progress-corrupt-'))).toBe(true);
  expect(errors).toEqual([]);
});

test('diagnostic shows a range with uncertainty and never claims B2/C1', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  const errors = trackErrors(page);
  await openLab(page, '?view=assess');
  await page.locator('[data-testid="diag-start"]').click();
  /* answer everything with the first visible option / a wrong word */
  const boxes = page.locator('.efl-diag fieldset.efl-ex');
  await expect(boxes.first()).toBeVisible();
  const n = await boxes.count();
  expect(n).toBe(20);
  for (let i = 0; i < n; i++) {
    const b = boxes.nth(i);
    for (let k = 0; k < 2; k++) {
      if (await b.evaluate((el) => el.classList.contains('is-correct') || el.classList.contains('is-wrong'))) { break; }
      if (await b.locator('input.efl-input').count()) { await b.locator('input.efl-input').fill('zzz'); await b.locator('button.efl-check').click(); } else { await b.locator('button.efl-opt:not([disabled])').first().click(); }
    }
  }
  await page.locator('[data-testid="diag-finish"]').click();
  const res = page.locator('[data-testid="diag-result"]');
  await expect(res).toContainText(/Rango probable|Probable range/);
  await expect(res).toContainText(/Confianza baja|Low confidence/);
  await expect(res).not.toContainText(/B2|C1/);
  expect(errors).toEqual([]);
});

test('every view renders without console errors', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  const errors = trackErrors(page);
  for (const v of ['', '?view=path', '?view=speaking', '?view=listening', '?view=vocab', '?view=readwrite', '?view=assess', '?view=progress', '?view=settings']) {
    await openLab(page, v);
    await expect(page.locator('.efl-main h2').first()).toBeVisible();
  }
  /* keyboard: the app nav is reachable and activates with Enter */
  await openLab(page);
  await page.locator('.efl-nav a[data-view="path"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/view=path/);
  await expect(page.locator('.efl-main h2')).toBeFocused();
  expect(errors).toEqual([]);
});

for (const [name, url] of [['dashboard', 'english/index.html'], ['lesson', 'english/index.html?view=lesson&id=w01-l1'], ['speaking', 'english/index.html?view=speaking'], ['settings', 'english/index.html?view=settings'], ['writings', 'writings.html']]) {
  test(`accessibility (axe, WCAG 2.2 AA): ${name}`, async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await page.goto(url);
    if (url.startsWith('english')) { await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true'); }
    const scope = url.startsWith('english') ? '#efl-app' : '.lf-efl-promo';
    const results = await new AxeBuilder({ page }).include(scope).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0].target}`)).toEqual([]);
  });
}

test('@mobile no horizontal scrolling on phone width', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  for (const url of ['index.html', 'writings.html', 'english/index.html', 'english/index.html?view=lesson&id=w01-l1', 'english/index.html?view=speaking', 'english/index.html?view=path', 'english/index.html?view=progress']) {
    await page.goto(url);
    if (url.startsWith('english')) { await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true'); }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, url).toBeLessThanOrEqual(0);
  }
  await page.goto('english/index.html?view=lesson&id=w01-l1');
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: '_tests/screenshots/mobile-lesson.png', fullPage: false });
  await page.goto('english/index.html');
  await expect(page.locator('#efl-app')).toHaveAttribute('data-ready', 'true');
  await page.screenshot({ path: '_tests/screenshots/mobile-dashboard.png', fullPage: false });
});

test('desktop screenshots for the PR', async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await setSiteLang(page, 'es');
  await page.goto('writings.html');
  await page.locator('.lf-efl-promo').screenshot({ path: '_tests/screenshots/writings-promo.png' });
  await openLab(page);
  await page.screenshot({ path: '_tests/screenshots/dashboard.png', fullPage: true });
  await openLab(page, '?view=lesson&id=w01-l1');
  await page.screenshot({ path: '_tests/screenshots/lesson.png' });
  await openLab(page, '?view=path');
  await page.screenshot({ path: '_tests/screenshots/path.png' });
});
