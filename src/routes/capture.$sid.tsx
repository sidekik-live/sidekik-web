import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { openMiniErp } from "@/sandbox/openMiniErp";
import { StartMiniErp } from "@/components/StartMiniErp";
import { exposeRoomBridge } from "@/sandbox/roomBridge";
import { primeMicrophone } from "@/lib/microphone";
import { ConsentModal } from "@/components/ConsentModal";
import { LiveTranscript } from "@/components/LiveTranscript";
import { useSidekikSession, type SessionStatus } from "@/hooks/useSidekikSession";

export const Route = createFileRoute("/capture/$sid")({
  // `?t=<sk_token>`: dev-only way to test frames against perception without a gateway session.
  // Normally the token comes from POST /v1/sessions (useSidekikSession).
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    typeof search["t"] === "string" ? { t: search["t"] } : {},
  head: () => ({
    meta: [
      { title: "Capture Room | Sidekik" },
      { name: "description", content: "Share your screen and let Sidekik capture how you work." },
      { property: "og:title", content: "Capture Room | Sidekik" },
      {
        property: "og:description",
        content: "Share your screen and let Sidekik capture how you work.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CaptureRoom,
});

const STATUS_LABEL: Record<SessionStatus, string> = {
  waiting: "Not started",
  connecting: "Connecting…",
  listening: "Listening",
  asking: "Asking",
  reviewing: "Reviewing",
  debrief: "Debrief",
  offrecord: "OFF THE RECORD",
  ended: "Session ended",
};

const CAPTURE_CONSENT = [
  { key: "audio", label: "I agree to my voice being recorded and transcribed." },
  { key: "screen", label: "I agree to my shared screen being captured." },
  {
    key: "storage",
    label: "I agree to recordings being stored for my organisation's retention period.",
  },
];

function CaptureRoom() {
  const { sid } = Route.useParams();
  const { t: devToken } = Route.useSearch();
  const erpWindow = useRef<Window | null>(null);
  // highlight_field tool and intervene commands: point the MiniERP at a field.
  const s = useSidekikSession(sid, {
    onHighlightField: (field) =>
      erpWindow.current?.postMessage({ type: "highlight_field", field }, window.location.origin),
  });
  const capture = useScreenCapture({
    sid,
    skToken: devToken ?? s.skToken,
    ingestUrl: devToken ? null : s.ingestUrl,
    paused: s.offRecord,
    tZeroMs: s.tZeroMs,
  });
  const sharing = capture.sharing;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = capture.stream;
  }, [capture.stream]);

  // Once the session ends (End debrief), nothing more is captured: release the shared screen.
  const ended = s.phase === "ended";
  const stopCapture = capture.stop;
  useEffect(() => {
    if (ended) stopCapture();
  }, [ended, stopCapture]);

  // The MiniERP window shares itself and hands the stream over (src/sandbox/useSelfShare.ts).
  const endedRef = useRef(ended);
  endedRef.current = ended;
  const { attach, isSharing } = capture;
  useEffect(
    () =>
      exposeRoomBridge({
        needsShare: () => !endedRef.current && !isSharing(),
        attachShare: (stream) => void attach(stream),
      }),
    [attach, isSharing],
  );

  // Open MiniERP (or Share screen) starts the session: consent is recorded and the agent connects.
  const begin = () => {
    if (s.phase === "idle") void s.consent();
  };
  const shareScreen = () => {
    begin();
    void capture.start();
  };
  const live = s.phase === "capture" || s.phase === "reviewing" || s.phase === "debrief";

  // A popup window, not a tab; it keeps `window.opener` pointing here (src/sandbox/openMiniErp.ts).
  const openErp = () => {
    erpWindow.current = openMiniErp(sid, "capture", erpWindow.current);
    begin();
  };

  return (
    <div className="flex h-full">
      <section className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Capture Room <span className="font-mono text-sm text-muted-foreground">#{sid}</span>
          </h1>
          <div className="flex gap-2">
            {sharing && (
              <button
                onClick={openErp}
                className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Open MiniERP
              </button>
            )}
            <button
              onClick={shareScreen}
              disabled={ended}
              className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {sharing ? "Change shared screen" : "Share screen"}
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-muted">
          <video
            id="screen-preview"
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-contain"
          />
          {!sharing &&
            (ended ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Screen sharing stopped.
              </div>
            ) : (
              <StartMiniErp started={s.phase !== "idle"} onOpen={openErp} />
            ))}
        </div>
        {sharing && (
          <p className="text-xs text-muted-foreground">
            Frames sent {capture.stats.sent} · dropped {capture.stats.dropped} · ingest{" "}
            {devToken || s.skToken ? capture.stats.socket : "waiting for consent"}
          </p>
        )}
      </section>

      <aside className="flex w-80 shrink-0 flex-col gap-4 border-l border-border p-4">
        <StatusPill status={s.status} />
        {s.found === false && !devToken && (
          <p
            role="alert"
            className="rounded-md border border-destructive p-2 text-sm text-destructive"
          >
            This session can't be resumed in this tab. Start a new capture from Home.
          </p>
        )}
        {s.error && (
          <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {s.error}
          </p>
        )}

        <LiveTranscript transcript={s.transcript} className="flex-1" />

        <p className="text-sm">
          Questions asked: <strong>{s.questionsAsked}</strong>
        </p>

        <button
          onClick={s.toggleOffRecord}
          disabled={!live}
          aria-pressed={s.offRecord}
          className={`rounded-lg border-2 py-4 text-base font-bold ${
            s.offRecord
              ? "border-destructive bg-destructive text-destructive-foreground"
              : "border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
          }`}
        >
          {s.offRecord ? "Back on the record" : "Off the record"}
        </button>

        {/* One end button per agent: Task done hands the Interviewer over to the debrief agent; End debrief hangs up. */}
        {s.phase === "debrief" ? (
          <>
            <button
              onClick={() => void s.end()}
              className="rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              End debrief
            </button>
            <p className="text-center text-xs text-muted-foreground">
              Ends the debrief agent and the session.
            </p>
          </>
        ) : s.phase === "ended" ? (
          <p className="text-center text-sm text-muted-foreground">
            Session ended.{" "}
            <Link to="/" className="text-primary underline-offset-4 hover:underline">
              Back to Home
            </Link>
          </p>
        ) : (
          <>
            <button
              onClick={s.taskDone}
              disabled={s.phase !== "capture"}
              className="rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Task done
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {s.phase === "reviewing"
                ? "Sidekik is reviewing your session…"
                : "Ends the Interviewer and starts the debrief."}
            </p>
          </>
        )}
      </aside>

      {!consented && s.found && (
        <ConsentModal
          subtitle="Sidekik records this session to learn how you work."
          items={CAPTURE_CONSENT}
          onAccept={() => {
            setConsented(true);
            primeMicrophone();
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SessionStatus }) {
  const off = status === "offrecord";
  const ended = status === "ended";
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
        off
          ? "bg-destructive text-destructive-foreground"
          : "bg-secondary text-secondary-foreground"
      }`}
    >
      <span
        className={`size-2 rounded-full ${
          off ? "bg-destructive-foreground" : ended ? "bg-muted-foreground" : "bg-primary"
        }`}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
