/* Regression: no view may show the literal text "null", "undefined" or
   "NaN" (a linked account showed "null" under the last-sync line, and the
   same pattern was latent in lessons, dialogues, challenges and the
   diagnostic when Spanish help was off). Guest mode, no accounts. */
import { test, expect } from '@playwright/test';
import { FAKE_TTS, openLab } from './helpers.js';

const VIEWS = ['', '?view=path', '?view=speaking', '?view=listening', '?view=vocab', '?view=readwrite', '?view=assess', '?view=progress', '?view=settings', '?view=account'];
const LESSONS = ['w01-l1', 'w01-l2', 'w01-l3', 'w01-l4', 'w01-l5', 'w01-review'];
const BAD = /(^|[^\w-])(null|undefined|NaN)([^\w-]|$)/;

for (const es of [true, false]) {
  test(`no "null"/"undefined"/"NaN" text in any view or lesson step (Spanish help ${es ? 'on' : 'off'})`, async ({ page }) => {
    await page.addInitScript(FAKE_TTS);
    await openLab(page);
    await page.evaluate((on) => window.__efl.store.update((s) => { s.settings.esSupport = on; }), es);
    const leaks = [];
    const check = async (where) => {
      const text = await page.locator('#efl-app').innerText();
      const line = text.split('\n').find((l) => BAD.test(l));
      if (line) { leaks.push(`${where}: «${line.trim().slice(0, 100)}»`); }
    };
    for (const v of VIEWS) { await openLab(page, v); await check(v || 'dashboard'); }
    for (const id of LESSONS) {
      await openLab(page, `?view=lesson&id=${id}`);
      const steps = page.locator('.efl-stepper__btn');
      const n = await steps.count();
      for (let i = 0; i < n; i++) {
        const b = steps.nth(i);
        if (await b.isEnabled()) { await b.click(); await page.waitForTimeout(50); }
        await check(`${id} step ${i + 1}`);
      }
    }
    expect(leaks).toEqual([]);
  });
}
