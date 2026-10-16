import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appPath = resolve(import.meta.dirname, '../dist-app/PowerBoard.html');

test.describe('standalone PowerBoard.html', () => {
  test('REQ-PB-110 opens offline and renders the board heading', async ({ page }) => {
    expect(existsSync(appPath), `${appPath} should exist (npm run build:app)`).toBe(true);

    await page.goto(pathToFileURL(appPath).href);
    await expect(page.getByRole('heading', { name: 'PowerBoard' })).toBeVisible();
  });
});
