import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { useSidekikSession, type SessionStatus } from "@/hooks/useSidekikSession";

export const Route = createFileRoute("/capture/$sid")({
  // `?t=<sk_token>`: dev-only way to test frames against perception until useSidekikSession
  // (ticket 3) gets the real token from POST /v1/sessions.
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    typeof search["t"] === "string" ? { t: search["t"] } : {},
  head: () => ({
    meta: [
      { title: "Capture Room | Sidekik" },
      { name: "description", content: "Share your screen and let Sidekik capture how you work." },
      { property: "og:title", content: "Capture Room | Sidekik" },
      { property: "og:description", content: "Share your screen and let Sidekik capture how you work." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CaptureRoom,
});

const CONSENT_VERSION = "v1";

const STATUS_LABEL: Record<SessionStatus, string> = {
  listening: "Listening",
  asking: "Asking",
  reviewing: "Reviewing",
  debrief: "Debrief",
  offrecord: "OFF THE RECORD",
};

function CaptureRoom() {
  const { sid } = Route.useParams();
  const { t: devToken } = Route.useSearch();
  const s = useSidekikSession(sid);
  const capture = useScreenCapture({ sid, skToken: devToken ?? null, paused: s.offRecord });
  const sharing = capture.sharing;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = capture.stream;
  }, [capture.stream]);

  const shareScreen = async () => {
    const stream = await capture.start();
    if (stream && s.phase === "idle") s.start();
  };

  return (
    <div className="flex h-screen">
      <section className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Capture Room <span className="font-mono text-sm text-muted-foreground">#{sid}</span></h1>
          <button onClick={shareScreen} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            {sharing ? "Change shared screen" : "Share screen"}
          </button>
        </div>
        <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-muted">
          <video id="screen-preview" ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
          {!sharing && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Your shared screen will appear here
            </div>
          )}
        </div>
        {sharing && (
          <p className="text-xs text-muted-foreground">
            Frames sent {capture.stats.sent} · dropped {capture.stats.dropped} · ingest {devToken ? capture.stats.socket : "no session token"}
          </p>
        )}
      </section>

      <aside className="flex w-80 shrink-0 flex-col gap-4 border-l border-border p-4">
        <StatusPill status={s.status} />

        <div className="flex min-h-0 flex-1 flex-col">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live transcript</h2>
          <ul className="flex-1 space-y-2 overflow-auto">
            {s.transcript.length === 0 && <li className="text-sm text-muted-foreground">Nothing yet.</li>}
            {s.transcript.map((t) => (
              <li key={t.id} className={`rounded-md p-2 text-sm ${t.role === "agent" ? "bg-secondary" : "border border-border"}`}>
                <span className="block text-[11px] font-medium text-muted-foreground">{t.role === "agent" ? "Sidekik" : "You"}</span>
                {t.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm">Questions asked: <strong>{s.questionsAsked}</strong></p>

        <button
          onClick={s.toggleOffRecord}
          aria-pressed={s.offRecord}
          className={`rounded-lg border-2 py-4 text-base font-bold ${
            s.offRecord ? "border-destructive bg-destructive text-destructive-foreground" : "border-destructive text-destructive hover:bg-destructive/10"
          }`}
        >
          {s.offRecord ? "Back on the record" : "Off the record"}
        </button>

        <button
          onClick={s.taskDone}
          disabled={s.phase === "reviewing" || s.phase === "debrief"}
          className="rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Task done
        </button>
        {s.phase === "reviewing" && <p className="text-center text-sm text-muted-foreground">Sidekik is reviewing your session…</p>}
      </aside>

      {!consented && <ConsentModal onAccept={() => setConsented(true)} />}
    </div>
  );
}

function StatusPill({ status }: { status: SessionStatus }) {
  const off = status === "offrecord";
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
        off ? "bg-destructive text-destructive-foreground" : "bg-secondary text-secondary-foreground"
      }`}
    >
      <span className={`size-2 rounded-full ${off ? "bg-destructive-foreground" : "bg-primary"}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function ConsentModal({ onAccept }: { onAccept: () => void }) {
  const [c, setC] = useState({ audio: false, screen: false, storage: false });
  const all = c.audio && c.screen && c.storage;
  const items: [keyof typeof c, string][] = [
    ["audio", "I agree to my voice being recorded and transcribed."],
    ["screen", "I agree to my shared screen being captured."],
    ["storage", "I agree to recordings being stored for my organisation's retention period."],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Before we start</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sidekik records this session to learn how you work.</p>
        <div className="mt-4 space-y-3">
          {items.map(([k, label]) => (
            <label key={k} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Consent text {CONSENT_VERSION}</span>
          <button disabled={!all} onClick={onAccept} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            I agree
          </button>
        </div>
      </div>
    </div>
  );
}
