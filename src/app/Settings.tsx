/**
 * The app's Settings popover, opened from the gear button in the top bar
 * (REQ-PB-120). It holds the Agent bridge toggle: an opt-in that lets a local
 * MCP agent work on these boards. Off by default and stored in localStorage,
 * never in the file, so a PowerBoard.html sent to someone else arrives silent.
 */

import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { useBridgeStore, type BridgeStatus } from './bridge/client';

const STATUS_LABEL: Record<BridgeStatus, string> = {
  off: 'Off',
  connecting: 'Connecting…',
  connected: 'Connected',
  displaced: 'Displaced',
};

export function Settings() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  const enabled = useBridgeStore((state) => state.enabled);
  const status = useBridgeStore((state) => state.status);
  const reason = useBridgeStore((state) => state.reason);
  const setEnabled = useBridgeStore((state) => state.setEnabled);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="pb-settings" ref={root}>
      <button
        type="button"
        className="pb-button pb-settings__button"
        data-testid="pb-settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsIcon size={14} />
        Settings
      </button>

      {open && (
        <div className="pb-settings__popover" role="dialog" aria-label="Settings">
          <h2 className="pb-settings__title">Agent bridge</h2>

          <label className="pb-settings__row">
            <input
              type="checkbox"
              className="pb-settings__checkbox"
              data-testid="pb-bridge-toggle"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>Let a local agent work on these boards</span>
          </label>

          <div className="pb-settings__status">
            <span
              className="pb-settings__dot"
              data-testid="pb-bridge-status"
              data-state={status}
              aria-hidden="true"
            />
            <span className="pb-settings__status-text">{STATUS_LABEL[status]}</span>
          </div>

          {status === 'displaced' && reason && (
            <p className="pb-settings__hint pb-settings__hint--warn" data-testid="pb-bridge-reason">
              {reason}
            </p>
          )}

          <p className="pb-settings__hint">
            Off by default. Only enable on your own machine — anything that can reach
            this port can edit these boards.
          </p>
        </div>
      )}
    </div>
  );
}
