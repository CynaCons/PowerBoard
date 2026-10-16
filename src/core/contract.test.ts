import { describe, expect, it } from 'vitest';
import { OWNER_ACTOR, POWERBOARD_BRIDGE_PORT } from './index';

describe('contract (REQ-PB-101)', () => {
  it('REQ-PB-101 exposes the owner actor', () => {
    expect(OWNER_ACTOR).toBe('you');
  });

  it('REQ-PB-101 exposes the bridge port', () => {
    expect(POWERBOARD_BRIDGE_PORT).toBe(41778);
  });
});
