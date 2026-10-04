import { useCallback, useEffect, useRef, useState } from "react";
import { openerRoom } from "./roomBridge";

/**
 * - `off`: no room to share with, or the room already has a screen.
 * - `asking`: the browser's share prompt is open.
 * - `sharing`: the room sees this window.
 * - `needed`: the prompt was dismissed or the share stopped; the MiniERP offers a button to retry.
 */
export type SelfShareState = "off" | "asking" | "sharing" | "needed";

/** After a share ends, wait this long before asking the room whether it still needs one. */
const SETTLE_MS = 1000;

/**
 * MiniERP opened from a room: share this window with the room as soon as it opens, so the person only
 * has to press Allow. Chrome offers "this tab" first (`preferCurrentTab`). Browsers that need a click
 * for the prompt, or a dismissed prompt, end in `needed`, and `share()` retries from a button.
 */
export function useSelfShare(enabled: boolean) {
  const [state, setState] = useState<SelfShareState>("off");
  const asked = useRef(false);

  const share = useCallback(async () => {
    const room = openerRoom();
    if (!room?.needsShare()) {
      setState("off");
      return;
    }
    setState("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      } as DisplayMediaStreamOptions);
    } catch {
      setState("needed");
      return;
    }
    // The room may have closed or picked another screen while the prompt was open.
    const current = openerRoom();
    if (!current?.needsShare()) {
      stream.getTracks().forEach((t) => t.stop());
      setState("off");
      return;
    }
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      setTimeout(() => setState(openerRoom()?.needsShare() ? "needed" : "off"), SETTLE_MS);
    });
    current.attachShare(stream);
    setState("sharing");
  }, []);

  // Once per window (React runs effects twice in development).
  useEffect(() => {
    if (!enabled || asked.current) return;
    asked.current = true;
    void share();
  }, [enabled, share]);

  return { state, share };
}
