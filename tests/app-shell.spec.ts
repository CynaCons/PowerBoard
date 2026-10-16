import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PowerBoardFile } from '../src/contract';
import { createCard } from '../src/core';
import { buildHtml, emptyFile, parseFile } from '../src/app/fileFormat';

const appPath = resolve(import.meta.dirname, '../dist-app/PowerBoard.html');
const appUrl = pathToFileURL(appPath).href;

/** Sidebar entries, one `pb-board-item-<id>` per board. */
const boardItems = () => /^pb-board-item-/;

test.beforeAll(() => {
  expect(existsSync(appPath), `${appPath} should exist (npm run build:app)`).toBe(true);
});

test.describe('standalone PowerBoard app shell', () => {
  test('REQ-PB-111 starts with one empty board', async ({ page }) => {
    await page.goto(appUrl);

    await expect(page.getByRole('heading', { name: 'PowerBoard' })).toBeVisible();
    await expect(page.getByTestId(boardItems())).toHaveCount(1);
    await expect(page.getByTestId('board-title')).toHaveText('My board');
    await expect(page.getByTestId('pb-dirty')).toHaveCount(0);
  });

  test('REQ-PB-112 creates a second board and switches between them', async ({ page }) => {
    await page.goto(appUrl);

    await page.getByTestId('pb-new-board').click();
    const items = page.getByTestId(boardItems());
    await expect(items).toHaveCount(2);

    // The new board becomes active; switching back moves the highlight.
    await expect(items.nth(1)).toHaveClass(/pb-board--active/);
    await items.nth(0).click();
    await expect(items.nth(0)).toHaveClass(/pb-board--active/);
    await expect(items.nth(1)).not.toHaveClass(/pb-board--active/);
    await expect(page.getByTestId('board-title')).toHaveText('My board');
  });

  test('REQ-PB-112 quick add puts a card on the active board', async ({ page }) => {
    await page.goto(appUrl);

    await page.getByTestId('board-add-card-todo').click();
    const input = page.locator('.board-add-input');
    await input.fill('First task');
    await input.press('Enter');

    await expect(page.getByTestId('board-card-1')).toBeVisible();
    await expect(page.getByText('First task')).toBeVisible();
    await expect(page.getByTestId('pb-dirty')).toBeVisible();
  });

  test('REQ-PB-112 renames a board on double-click', async ({ page }) => {
    await page.goto(appUrl);

    const item = page.getByTestId(boardItems()).first();
    await item.dblclick();

    const input = page.getByTestId('pb-rename-input');
    await expect(input).toBeVisible();
    await input.fill('Renamed board');
    await input.press('Enter');

    await expect(item).toContainText('Renamed board');
    await expect(page.getByTestId('board-title')).toHaveText('Renamed board');
  });

  test('REQ-PB-112 deletes a board with an inline confirmation', async ({ page }) => {
    await page.goto(appUrl);

    await page.getByTestId('pb-new-board').click();
    const items = page.getByTestId(boardItems());
    await expect(items).toHaveCount(2);

    const second = items.nth(1);
    await second.getByTestId('pb-delete-board').click();
    await second.getByTestId('pb-delete-confirm').click();

    await expect(items).toHaveCount(1);
    await expect(page.getByTestId('board-title')).toHaveText('My board');
  });

  test('REQ-PB-113 Ctrl+S saves the app and data into the file', async ({ page }) => {
    await page.addInitScript(() => {
      const written: string[] = [];
      (window as unknown as { __pbWritten: string[] }).__pbWritten = written;
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (
        options: { suggestedName?: string },
      ) => ({
        name: options?.suggestedName ?? 'PowerBoard.html',
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable: async () => ({
          write: async (html: string) => {
            written.push(html);
          },
          close: async () => {},
        }),
      });
      (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = async () => {
        throw new Error('not used');
      };
    });

    await page.goto(appUrl);

    // Press until the React effect has registered the shortcut, then check the
    // file was written exactly through the picked handle.
    await expect
      .poll(async () => {
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(100);
        return page.evaluate(
          () => (window as unknown as { __pbWritten: string[] }).__pbWritten.length,
        );
      })
      .toBeGreaterThan(0);

    const html = await page.evaluate(
      () => (window as unknown as { __pbWritten: string[] }).__pbWritten[0],
    );
    expect(html).toContain('powerboard-data');

    const match = html.match(
      /<script id="powerboard-data" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    expect(parseFile(match![1])?.boards).toHaveLength(1);

    await expect(page.getByTestId('pb-dirty')).toHaveCount(0);
  });

  test('REQ-PB-114 opens a file whose embedded data has boards and cards', async ({ page }) => {
    const template = readFileSync(appPath, 'utf-8');
    const seed = emptyFile();
    const firstId = seed.boards[0].id;

    let board = createCard(
      seed.boards[0].board,
      { title: 'Older card', column: 'todo' },
      'you',
      Date.now(),
    );
    board = createCard(board, { title: 'Second older card', column: 'doing' }, 'you', Date.now());

    const file: PowerBoardFile = {
      ...seed,
      title: 'Old notebook',
      boards: [
        { id: firstId, title: 'Legacy board', board },
        { id: 'legacy-2', title: 'Second legacy board', board: seed.boards[0].board },
      ],
      activeBoardId: firstId,
    };

    const dir = mkdtempSync(join(tmpdir(), 'powerboard-e2e-'));
    const target = join(dir, 'Legacy.html');
    writeFileSync(target, buildHtml(template, file), 'utf-8');

    await page.goto(pathToFileURL(target).href);

    await expect(page.getByTestId(boardItems())).toHaveCount(2);
    await expect(page.getByTestId('board-title')).toHaveText('Legacy board');
    await expect(page.getByText('Older card', { exact: true })).toBeVisible();
    await expect(page.getByText('Second older card', { exact: true })).toBeVisible();
  });
});
