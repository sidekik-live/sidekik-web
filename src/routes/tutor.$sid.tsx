import { LiveTranscript } from "@/components/LiveTranscript";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { openMiniErp } from "@/sandbox/openMiniErp";
import { StartMiniErp } from "@/components/StartMiniErp";
import { exposeRoomBridge } from "@/sandbox/roomBridge";
import { primeMicrophone } from "@/lib/microphone";
import { useTutorSession, type StepOutcome } from "@/hooks/useTutorSession";
import { ReplayModal } from "@/components/ReplayModal";
import { ConsentModal } from "@/components/ConsentModal";

export const Route = createFileRoute("/tutor/$sid")({
  head: () => ({
    meta: [
      { title: "Tutor Room | Sidekik" },
      {
        name: "description",
        content: "Practice a workflow with Sidekik, guided by the expert's own words.",
      },
      { property: "og:title", content: "Tutor Room | Sidekik" },
      {
        property: "og:description",
        content: "Practice a workflow with Sidekik, guided by the expert's own words.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TutorRoom,
});

const OUTCOME: Record<StepOutcome, { label: string; cls: string }> = {
  independent: { label: "Independent", cls: "bg-primary text-primary-foreground" },
  prompted: {
    label: "Prompted",
    cls: "bg-secondary text-secondary-foreground border border-border",
  },
  corrected: { label: "Corrected", cls: "bg-destructive/15 text-destructive" },
  not_attempted: { label: "Not attempted", cls: "bg-muted text-muted-foreground" },
};

// Practice: voice and screen are used live; only the learner's results are kept.
const PRACTICE_CONSENT = [
  { key: "audio", label: "I agree to my voice being heard and transcribed during practice." },
  { key: "screen", label: "I agree to my shared screen being watched during practice." },
  { key: "results", label: "I understand my practice results are saved for my organisation." },
];

function TutorRoom() {
  const { sid } = Route.useParams();
  const erpWindow = useRef<Window | null>(null);
  // intervene commands and the highlight_field tool point the MiniERP at a field.
  const t = useTutorSession(sid, {
    onHighlightField: (field) =>
      erpWindow.current?.postMessage({ type: "highlight_field", field }, window.location.origin),
  });
  const capture = useScreenCapture({
    sid,
    skToken: t.skToken,
    ingestUrl: t.ingestUrl,
    paused: t.offRecord,
    tZeroMs: t.tZeroMs,
  });
  const sharing = capture.sharing;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [prediction, setPrediction] = useState("");

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = capture.stream;
  }, [capture.stream]);

  // End practice: nothing more is watched, so release the shared screen.
  const done = t.phase === "done";
  const stopCapture = capture.stop;
  useEffect(() => {
    if (done) stopCapture();
  }, [done, stopCapture]);

  // The MiniERP window shares itself and hands the stream over (src/sandbox/useSelfShare.ts).
  const doneRef = useRef(done);
  doneRef.current = done;
  const { attach, isSharing } = capture;
  useEffect(
    () =>
      exposeRoomBridge({
        needsShare: () => !doneRef.current && !isSharing(),
        attachShare: (stream) => void attach(stream),
      }),
    [attach, isSharing],
  );

  const [consented, setConsented] = useState(false);
  // Open MiniERP (or Share screen) starts the practice: consent is recorded and the tutor connects.
  const begin = () => {
    if (t.phase === "idle") t.start();
  };
  const shareScreen = () => {
    begin();
    void capture.start();
  };

  // A popup window, not a tab; it keeps `window.opener` pointing here (src/sandbox/openMiniErp.ts).
  const openErp = () => {
    erpWindow.current = openMiniErp(sid, "tutor", erpWindow.current);
    begin();
  };

  return (
    <div className="flex h-full">
      <section className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">
            Tutor Room <span className="font-mono text-sm text-muted-foreground">#{sid}</span>
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
              disabled={done}
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
            (done ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                Screen sharing stopped.
              </div>
            ) : (
              <StartMiniErp started={t.phase !== "idle"} onOpen={openErp} />
            ))}
        </div>
      </section>

      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-auto border-l border-border p-4">
        {t.found === false && (
          <p
            role="alert"
            className="rounded-md border border-destructive p-2 text-sm text-destructive"
          >
            This session can't be resumed in this tab. Start a new practice from Home.
          </p>
        )}
        {t.error && (
          <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
            {t.error}
          </p>
        )}

        {t.intervention && (
          <div role="alert" className="rounded-lg bg-destructive p-3 text-destructive-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide">Hold on</p>
            <p className="mt-1 text-sm">“{t.intervention.quote}”</p>
            <p className="mt-1 text-xs opacity-80">— {t.expertName}</p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => t.intervention && t.openReplay(t.intervention.step_id)}
                className="rounded-md bg-background px-3 py-1.5 text-xs font-semibold text-foreground"
              >
                Replay {t.expertName}'s moment
              </button>
              <button
                onClick={t.dismissIntervention}
                className="rounded-md px-3 py-1.5 text-xs underline"
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {t.currentStep && t.phase !== "done" && (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What {t.expertName} does here
            </p>
            <p className="mt-1 font-medium">{t.currentStep.title}</p>
            <p className="mt-1 text-sm italic text-muted-foreground">
              “{t.currentStep.expertWords}”
            </p>
          </div>
        )}

        {/* Every question gets an answer box: tutor's predict prompts, and anything else the agent asks. */}
        {(t.predictPrompt ?? t.openQuestion) && (
          <div className="rounded-lg border-2 border-primary p-3">
            <p className="text-xs font-semibold uppercase tracking-wide">
              {t.predictPrompt ? "Predict" : "Sidekik asks"}
            </p>
            <p className="mt-1 text-sm">{t.predictPrompt ?? t.openQuestion}</p>
            <input
              value={prediction}
              onChange={(e) => setPrediction(e.target.value)}
              placeholder="Your answer"
              className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
            <button
              onClick={() => {
                t.submitPrediction(prediction);
                setPrediction("");
              }}
              disabled={!prediction.trim()}
              className="mt-2 w-full rounded-md bg-primary py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Submit
            </button>
          </div>
        )}

        {t.phase !== "idle" && <LiveTranscript transcript={t.transcript} className="max-h-72" />}

        {t.finishing && !t.mastery && (
          <p className="text-sm text-muted-foreground">
            Wrapping up… Sidekik is preparing your summary.
          </p>
        )}

        {t.mastery && (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mastery
            </p>
            <ul className="mt-2 space-y-2">
              {t.mastery.steps.map((s) => (
                <li key={s.step_id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{s.title}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OUTCOME[s.outcome].cls}`}
                  >
                    {OUTCOME[s.outcome].label}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Practice next
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {t.mastery.practiceNext.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {t.phase === "practice" && (
          <button
            onClick={t.finish}
            disabled={t.finishing}
            className="mt-auto rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {t.finishing ? "Wrapping up…" : "End practice"}
          </button>
        )}
      </aside>

      {t.replayView && (
        <ReplayModal title={t.replayView.title} src={t.replayView.src} onClose={t.closeReplay} />
      )}

      {!consented && t.phase === "idle" && t.found && (
        <ConsentModal
          subtitle={`Sidekik coaches you through this practice in ${t.expertName}'s words. Nothing starts until you agree.`}
          items={PRACTICE_CONSENT}
          onAccept={() => {
            setConsented(true);
            primeMicrophone();
          }}
        />
      )}
    </div>
  );
}
