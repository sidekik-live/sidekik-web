import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFrame, type FrameReason } from "@/capture/frameCodec";
import { FrameScheduler } from "@/capture/frameScheduler";
import { grabJpeg } from "@/capture/grabJpeg";
import { INGEST_URL } from "@/lib/config";
import { ReconnectingSocket, type SocketStatus } from "@/lib/reconnectingSocket";

export interface ScreenCaptureOptions {
  sid: string;
  /** sk_token from POST /v1/sessions. Without it, capture runs but nothing is sent. */
  skToken: string | null;
  /** Off the record: stop taking frames (the share stays open so resuming is instant). */
  paused: boolean;
  /** Session start (epoch ms) that t_ms counts from. Defaults to when sharing starts. */
  tZeroMs?: number | null;
}

export interface ScreenCaptureStats {
  sent: number;
  dropped: number;
  socket: SocketStatus;
}

// MiniERP DOM event kinds (src/sandbox/domEvents.ts) that deserve an extra frame.
const EXTRA_FRAME_REASON: Record<string, FrameReason> = {
  blur: "blur",
  save_attempt: "save",
  save: "save",
  record_open: "nav",
};

/**
 * DESIGN §4 step 3 / ticket 4: share the screen, send a 1280 px JPEG to perception once a
 * second over `/ws/frames/:sid`, plus extra frames on MiniERP blur, save and record changes.
 */
export function useScreenCapture({ sid, skToken, paused, tZeroMs }: ScreenCaptureOptions) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [stats, setStats] = useState<ScreenCaptureStats>({ sent: 0, dropped: 0, socket: "closed" });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<ReconnectingSocket | null>(null);
  const schedulerRef = useRef<FrameScheduler | null>(null);
  const tZeroRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const captureFrame = useCallback(async (reason: FrameReason) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const blob = await grabJpeg(video, canvas);
    if (!blob) return;
    const frame = encodeFrame(
      { t_ms: Date.now() - tZeroRef.current, reason },
      await blob.arrayBuffer(),
    );
    const ok = socketRef.current?.send(frame) ?? false;
    setStats((s) => (ok ? { ...s, sent: s.sent + 1 } : { ...s, dropped: s.dropped + 1 }));
  }, []);

  const stop = useCallback(() => {
    schedulerRef.current?.stop();
    schedulerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
  }, []);

  const start = useCallback(async (): Promise<MediaStream | null> => {
    let next: MediaStream;
    try {
      next = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
    } catch {
      return null; // user cancelled the picker
    }
    stop();
    const video = (videoRef.current ??= document.createElement("video"));
    canvasRef.current ??= document.createElement("canvas");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = next;
    await video.play().catch(() => {});
    next.getVideoTracks()[0]?.addEventListener("ended", stop);

    tZeroRef.current = tZeroMs ?? Date.now();
    streamRef.current = next;
    const scheduler = new FrameScheduler({ capture: captureFrame });
    schedulerRef.current = scheduler;
    if (paused) scheduler.pause();
    scheduler.start();
    setStream(next);
    return next;
  }, [captureFrame, paused, stop, tZeroMs]);

  // One frames socket per session token while sharing.
  useEffect(() => {
    if (!stream || !skToken) return;
    const socket = new ReconnectingSocket({
      url: () =>
        `${INGEST_URL}/ws/frames/${encodeURIComponent(sid)}?t=${encodeURIComponent(skToken)}`,
      onStatus: (socketStatus) => setStats((s) => ({ ...s, socket: socketStatus })),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [sid, skToken, stream]);

  useEffect(() => {
    if (paused) schedulerRef.current?.pause();
    else schedulerRef.current?.resume();
  }, [paused]);

  // Extra frames when the MiniERP (iframe or second tab) reports blur, save or a record change.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: unknown; kind?: unknown } | null;
      if (!d || d.type !== "dom" || typeof d.kind !== "string") return;
      const reason = EXTRA_FRAME_REASON[d.kind];
      if (reason) schedulerRef.current?.request(reason);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => stop, [stop]);

  return { stream, sharing: stream !== null, stats, start, stop };
}
