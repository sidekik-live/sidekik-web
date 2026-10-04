/**
 * What a Capture/Tutor Room offers the MiniERP window it opened. Both are on the same origin and the
 * room is the MiniERP's `window.opener`, so the MiniERP can call it directly; that lets it hand over a
 * MediaStream, which postMessage can't carry.
 */
export interface RoomBridge {
  /** True while the room is in a live session and nothing is shared yet. */
  needsShare(): boolean;
  /** Use this stream (the MiniERP sharing its own window) as the room's shared screen. */
  attachShare(stream: MediaStream): void;
}

const KEY = "__sidekikRoom";
type BridgeWindow = Window & { [KEY]?: RoomBridge };

/** Room side: offer the bridge to windows this room opens. Returns the cleanup. */
export function exposeRoomBridge(bridge: RoomBridge): () => void {
  const w = window as BridgeWindow;
  w[KEY] = bridge;
  return () => {
    if (w[KEY] === bridge) delete w[KEY];
  };
}

/** MiniERP side: the room that opened this window, if any. */
export function openerRoom(): RoomBridge | null {
  try {
    return (window.opener as BridgeWindow | null)?.[KEY] ?? null;
  } catch {
    return null; // opener on another origin, or gone
  }
}
