import type { SandboxMode } from "./presave";

const WIDTH = 1280;
const HEIGHT = 800;

/**
 * Opens the MiniERP for a session as a separate popup window (not a tab), centred over the room.
 * Opening it this way keeps `window.opener` pointing at the room, so MiniERP events reach it.
 *
 * The window name is per session: a name shared across sessions would make the browser reuse
 * whatever already carries it, including a leftover tab, instead of opening a new window.
 * Clicking again in the same session brings the open MiniERP to the front.
 */
export function openMiniErp(sid: string, mode: SandboxMode, current: Window | null): Window | null {
  if (current && !current.closed) {
    current.focus();
    return current;
  }
  const width = Math.min(WIDTH, window.screen.availWidth);
  const height = Math.min(HEIGHT, window.screen.availHeight);
  const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
  return window.open(
    `/sandbox/erp?sid=${encodeURIComponent(sid)}&mode=${mode}`,
    `sidekik-minierp-${sid}`,
    `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`,
  );
}
