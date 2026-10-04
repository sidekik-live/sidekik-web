import { useCallback, useEffect, useRef, useState } from "react";
import { extraFrameReason } from "@/capture/extraFrameReason";
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
  /** Full frames URL from POST /v1/sessions (`ingest_url`); defaults to INGEST_URL/ws/frames/:sid. */
  ingestUrl?: string | null;
}

export interface ScreenCaptureStats {
  sent: number;
  dropped: number;
  socket: SocketStatus;
}

/**
 * DESIGN §4 step 3 / ticket 4: share the screen, send a 1280 px JPEG to perception once a
 * second over `/ws/frames/:sid`, plus extra frames on MiniERP blur, save and record changes.
 */
export function useScreenCapture({
  sid,
  skToken,
  paused,
  tZeroMs,
  ingestUrl,
}: ScreenCaptureOptions) {
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

  /** Share this stream: from the picker (start) or from the MiniERP sharing its own window. */
  const attach = useCallback(
    async (next: MediaStream): Promise<MediaStream> => {
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
    },
    [captureFrame, paused, stop, tZeroMs],
  );

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
    return attach(next);
  }, [attach]);

  /** Read at call time (the MiniERP window asks), so it never sees a stale render. */
  const isSharing = useCallback(() => streamRef.current !== null, []);

  // One frames socket per session token while sharing.
  useEffect(() => {
    if (!stream || !skToken) return;
    const socket = new ReconnectingSocket({
      url: () =>
        `${ingestUrl ?? `${INGEST_URL}/ws/frames/${encodeURIComponent(sid)}`}?t=${encodeURIComponent(skToken)}`,
      onStatus: (socketStatus) => setStats((s) => ({ ...s, socket: socketStatus })),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [sid, skToken, stream, ingestUrl]);

  useEffect(() => {
    if (paused) schedulerRef.current?.pause();
    else schedulerRef.current?.resume();
  }, [paused]);

  // Extra frames when the MiniERP (iframe or second tab) reports blur, save or a record change.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const reason = extraFrameReason(e.data);
      if (reason) schedulerRef.current?.request(reason);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => stop, [stop]);

  return { stream, sharing: stream !== null, stats, start, attach, stop, isSharing };
}
