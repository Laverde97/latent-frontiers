import { test, expect } from '@playwright/test';
import { FAKE_TTS, FAKE_ASR, trackErrors, openLab, completeLesson, readData, solveExercises } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_TTS);
  await page.addInitScript(FAKE_ASR);
});

test('Week 1: all five lessons and the integrative session can be completed, and results persist', async ({ page }) => {
  test.setTimeout(420000);
  const errors = trackErrors(page);
  for (const id of ['w01-l1', 'w01-l2', 'w01-l3', 'w01-l4', 'w01-l5', 'w01-review']) {
    await completeLesson(page, id);
    await page.screenshot({ path: `_tests/screenshots/${id}-summary.png`, fullPage: false }).catch(() => {});
  }

  /* reload: everything is still there */
  await page.reload();
  await openLab(page, '?view=progress');
  const history = page.locator('[data-testid="history"] tbody tr');
  await expect(history).toHaveCount(6);
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')));
  for (const id of ['w01-l1', 'w01-l2', 'w01-l3', 'w01-l4', 'w01-l5', 'w01-review']) {
    expect(state.lessons[id].status, id).toBe('completed');
    expect(state.lessons[id].needsReview, id).toBe(false);
    const L = readData(`lessons/${id}.json`);
    for (const s of L.steps) { expect(state.lessons[id].activities[s.id], `${id}/${s.id}`).toBeTruthy(); }
  }
  /* sources are kept apart */
  const sources = new Set(state.evidence.map((e) => e.source));
  expect([...sources].sort()).toEqual(['auto', 'self']);
  expect(state.assessments.week1.bySkill.speaking[0].source).toBe('self');
  expect(state.assessments.week1.bySkill.listening.every((x) => x.source === 'auto')).toBe(true);
  /* vocabulary enters SRS but is never "learned" just by completing lessons */
  expect(Object.keys(state.srs).length).toBeGreaterThan(50);

  /* dashboard reflects it */
  await openLab(page);
  await expect(page.getByText('5 / 130')).toBeVisible();
  await expect(page.locator('[data-testid="skill-speaking"]')).toContainText(/autoevaluada|self-assessed/);
  await openLab(page, '?view=assess');
  await expect(page.locator('[data-testid="assessment-week1"] table')).toBeVisible();
  await page.screenshot({ path: '_tests/screenshots/assessments.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('a step can be repeated and attempts are counted; wrong answers get feedback and the key', async ({ page }) => {
  const errors = trackErrors(page);
  await openLab(page, '?view=lesson&id=w01-l1');
  const stage = page.locator('.efl-stage');
  const L = readData('lessons/w01-l1.json');
  /* answer the first exercise wrong twice → answer revealed, 0 points */
  const v3 = stage.locator('fieldset[data-ex="v3"]');
  await v3.locator('input').fill('see');
  await v3.locator('button.efl-check').click();
  await expect(v3.locator('.efl-feedback')).toContainText(/Todavía no|Not yet/);
  await v3.locator('input').fill('know');
  await v3.locator('button.efl-check').click();
  await expect(v3.locator('.efl-feedback')).toContainText('meet');
  await expect(v3).toHaveClass(/is-wrong/);
  await solveExercises(page, stage, L.steps[0].exercises.filter((e) => e.id !== 'v3'));
  await expect(stage.locator('.efl-score')).toContainText(/4 de 5|4 of 5/);
  await stage.locator('[data-testid="next-step"]').click();
  /* go back and redo the step */
  await page.locator('[data-step="s1"]').click();
  await expect(page.locator('.efl-stage')).toContainText(/Ya hiciste este paso|You already did this step/);
  await solveExercises(page, page.locator('.efl-stage'), L.steps[0].exercises);
  const a = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')).lessons['w01-l1'].activities.s1);
  expect(a.attempts).toBe(2);
  expect(a.best).toBe(1);
  /* SRS got a lapse for the wrong item */
  const card = await page.evaluate(() => JSON.parse(localStorage.getItem('efl-progress')).srs['nice-to-meet-you']);
  expect(card.lapses).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('planned lessons are not presented as available', async ({ page }) => {
  await openLab(page, '?view=path');
  await expect(page.locator('[data-lesson="w01-l1"] .efl-status')).toHaveText(/Disponible|Available/);
  await expect(page.locator('[data-lesson="w01-l2"] .efl-status')).toHaveText(/Pendiente|Pending/);
  await expect(page.locator('[data-lesson="w02-l1"] .efl-status')).toHaveText(/Planificado|Planned/);
  await expect(page.locator('[data-lesson="w26-l5"] button')).toHaveCount(0);
  await openLab(page, '?view=lesson&id=w05-l1');
  await expect(page.getByRole('heading', { name: /todavía no disponible|not available yet/ })).toBeVisible();
});
