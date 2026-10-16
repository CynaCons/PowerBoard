/**
 * The app's E2E hook (src/app/main.tsx) is opt-in: a shipped PowerBoard.html
 * exposes nothing extra until a harness sets `window.__POWERBOARD_E2E__` before
 * the page loads. These specs keep that guard honest.
 */
import { expect, test } from '@playwright/test';
import { appUrl, enableE2EHook, waitForBridgeReady } from './helpers';

test('E2E hook is absent when the page loads normally', async ({ page }) => {
  await page.goto(appUrl);
  await expect(page.getByTestId('board-view')).toBeVisible();
  expect(await page.evaluate(() => '__POWERBOARD_BRIDGE__' in window)).toBe(false);
});

test('E2E hook appears only after the harness opts in', async ({ page }) => {
  await enableE2EHook(page);
  await page.goto(appUrl);
  await waitForBridgeReady(page);
  const keys = await page.evaluate(() =>
    Object.keys((window as unknown as { __POWERBOARD_BRIDGE__: object }).__POWERBOARD_BRIDGE__).sort(),
  );
  expect(keys).toEqual(['getFile', 'handleServerFrame', 'run']);
});
