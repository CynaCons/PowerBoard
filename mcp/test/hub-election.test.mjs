/**
 * Hub/peer election (REQ-PB-130). Two server processes share one port: the first
 * to bind becomes the hub and owns the app connection, the second becomes a peer
 * and forwards tool calls to the hub over the same loopback port.
 *
 * Run: npm test --prefix mcp
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freePort, startServer, connectApp, waitUntil } from './helpers.mjs';

let hub;
let peer;
let board;
let port;

before(async () => {
  port = await freePort();
  // Start the hub first and wait until it owns the port, so the race is decided.
  hub = startServer({ port, agentName: 'hub-1' });
  await hub.ready();
  // The second process finds the port taken and becomes a peer of the first.
  peer = startServer({ port, agentName: 'peer-1' });
  await peer.ready({ hub: false });
  board = connectApp(port);
  await waitUntil(() => board.control.some((item) => item.type === 'agents'));
});

after(() => {
  board?.close();
  peer?.stop();
  hub?.stop();
});

test('REQ-PB-130 exactly one process is the hub and the other logs in as a peer', () => {
  assert.match(hub.stderr, /listening on/);
  assert.doesNotMatch(hub.stderr, /joined the hub/);
  assert.match(peer.stderr, /joined the hub/);
  assert.doesNotMatch(peer.stderr, /Hub: listening on/);
});

test('REQ-PB-130 the agents frame pushed to the app names both hub and peer', async () => {
  const frame = await waitUntil(() =>
    board.control.find(
      (item) =>
        item.type === 'agents' &&
        item.agents.some((agent) => agent.label === 'hub-1') &&
        item.agents.some((agent) => agent.label === 'peer-1'),
    ),
  );
  const peerAgent = frame.agents.find((agent) => agent.label === 'peer-1');
  assert.equal(peerAgent.role, 'peer');
});

test('REQ-PB-130 the peer forwards board_list through the hub to the app', async () => {
  const result = await peer.call('board_list', {});
  assert.equal(result.isError, false, result.text);
  const payload = JSON.parse(result.text);
  assert.equal(payload.ran, 'board_list');
  assert.equal(payload._agent.role, 'peer');

  const frame = board.frames.find((item) => item.cmd === 'board_list');
  assert.ok(frame, 'peer board_list did not reach the app through the hub');
});
