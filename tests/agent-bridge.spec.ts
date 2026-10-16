/**
 * End-to-end agent bridge (REQ-PB-120, REQ-PB-121, REQ-BOARD-014, REQ-BOARD-024).
 *
 * This is the real thing: a `powerboard-mcp` child process over MCP stdio on a
 * free loopback port, the built PowerBoard.html in Chromium, the bridge toggle
 * switched on by hand, then a card created through MCP and expected on screen
 * with the agent's chip in the strip.
 */

import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const appPath = resolve(import.meta.dirname, '../dist-app/PowerBoard.html');
const appUrl = pathToFileURL(appPath).href;
const serverPath = resolve(import.meta.dirname, '../mcp/server.js');

/** Ask the OS for a free loopback port so the bridge never collides. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        resolvePort(typeof address === 'object' && address ? address.port : 0),
      );
    });
  });
}

interface ToolResult {
  isError: boolean;
  text: string;
}

test.describe('agent bridge end to end', () => {
  let port: number;
  let client: Client;

  test.beforeAll(async () => {
    expect(existsSync(appPath), `${appPath} should exist (npm run build:app)`).toBe(true);
    expect(existsSync(serverPath), `${serverPath} should exist`).toBe(true);

    port = await freePort();
    client = new Client({ name: 'powerboard-e2e', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: {
          POWERBOARD_BRIDGE_PORT: String(port),
          POWERBOARD_AGENT_NAME: 'e2e-agent',
        },
      }),
    );
  });

  test.afterAll(async () => {
    await client?.close();
  });

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    return {
      isError: (result as { isError?: boolean }).isError === true,
      text: content?.[0]?.type === 'text' ? content[0].text ?? '' : '',
    };
  }

  test('REQ-PB-120/121 an agent creates a card the app shows', async ({ page }) => {
    // Only the port override is seeded; the bridge itself stays OFF until the
    // toggle is ticked, exactly as a real user would leave it.
    await page.addInitScript((bridgePort: number) => {
      localStorage.setItem('powerboard-bridge-port', String(bridgePort));
    }, port);

    await page.goto(appUrl);

    // REQ-PB-120: off by default, with a status dot and the opt-in checkbox.
    await page.getByTestId('pb-settings').click();
    const toggle = page.getByTestId('pb-bridge-toggle');
    await expect(toggle).not.toBeChecked();
    await expect(page.getByTestId('pb-bridge-status')).toHaveAttribute('data-state', 'off');

    await toggle.check();
    await expect(page.getByTestId('pb-bridge-status')).toHaveAttribute('data-state', 'connected');
    expect(await page.evaluate(() => localStorage.getItem('powerboard-bridge-enabled'))).toBe('true');

    // The MCP server now sees the app.
    await expect
      .poll(async () => {
        const status = await callTool('bridge_status', {});
        try {
          return (JSON.parse(status.text) as { boardConnected?: boolean }).boardConnected === true;
        } catch {
          return false;
        }
      })
      .toBe(true);

    const listed = await callTool('board_list', {});
    expect(listed.isError).toBe(false);
    const boardId = (JSON.parse(listed.text) as { boards: Array<{ id: string }> }).boards[0].id;

    const created = await callTool('card_create', {
      me: 'e2e-agent',
      boardId,
      title: 'Agent-made card',
    });
    expect(created.isError).toBe(false);
    expect(JSON.parse(created.text)).toMatchObject({ title: 'Agent-made card', number: 1 });

    // REQ-BOARD-014: the card is on screen; REQ-BOARD-024: the actor has a chip.
    await expect(page.getByTestId('board-card-1')).toBeVisible();
    await expect(page.getByText('Agent-made card', { exact: true })).toBeVisible();
    await expect(page.getByTestId('board-agent-e2e-agent')).toBeVisible();

    // Closing the popover leaves the connection up.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pb-bridge-toggle')).toHaveCount(0);
  });
});
