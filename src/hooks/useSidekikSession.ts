import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { gatewayClient } from "@/lib/api";
import {
  openGatewaySocket,
  startElevenLabsConversation,
  subscribeAgentCommands,
} from "@/session/adapters";
import {
  SessionEngine,
  type ConsentScope,
  type SessionState,
  type TranscriptEntry,
} from "@/session/engine";
import { clearSessionStart, loadSessionStart, type SessionStart } from "@/session/handoff";

// Ticket 3: the live session for the Capture/Debrief Room (and the Tutor Room, ticket 8).
// The engine (src/session/engine.ts) does the work; this hook gives it to React.

export type SessionStatus = "listening" | "asking" | "reviewing" | "debrief" | "offrecord";
export type SessionPhase = "idle" | "capture" | "reviewing" | "debrief" | "ended";
export type TranscriptTurn = TranscriptEntry;

export interface UseSidekikSessionOptions {
  onHighlightField?: (field: string) => void;
  onReplayRequest?: (stepId: string) => void;
}

// One engine per session id. React mounts twice in development, so a room that unmounts only
// ends its session if it isn't mounted again right away.
const engines = new Map<
  string,
  {
    engine: SessionEngine;
    start: SessionStart;
    mounts: number;
    endTimer?: ReturnType<typeof setTimeout>;
  }
>();

function acquire(sid: string, start: SessionStart, opts: UseSidekikSessionOptions) {
  let entry = engines.get(sid);
  if (!entry) {
    const engine = new SessionEngine(
      {
        session: start.response,
        kind: start.kind,
        language: start.language,
        tZeroMs: start.startedAt,
        onHighlightField: (f) => opts.onHighlightField?.(f),
        onReplayRequest: (s) => opts.onReplayRequest?.(s),
      },
      {
        gateway: gatewayClient,
        startConversation: startElevenLabsConversation,
        openClientSocket: (onStatus) => openGatewaySocket(sid, start.response.sk_token, onStatus),
        subscribeCommands: (onCommand) => subscribeAgentCommands(sid, onCommand),
      },
    );
    entry = { engine, start, mounts: 0 };
    engines.set(sid, entry);
  }
  if (entry.endTimer) clearTimeout(entry.endTimer);
  entry.mounts += 1;
  return entry.engine;
}

function release(sid: string) {
  const entry = engines.get(sid);
  if (!entry) return;
  entry.mounts -= 1;
  if (entry.mounts > 0) return;
  entry.endTimer = setTimeout(() => {
    engines.delete(sid);
    void entry.engine.end();
  }, 250);
}

const emptySubscribe = () => () => {};

export function useSidekikSession(sid: string, opts: UseSidekikSessionOptions = {}) {
  // sessionStorage only exists in the browser; the route also renders on the server.
  const [start, setStart] = useState<SessionStart | null | undefined>(undefined);
  const [engine, setEngine] = useState<SessionEngine | null>(null);

  useEffect(() => {
    const s = engines.get(sid)?.start ?? loadSessionStart(sid);
    setStart(s);
    if (!s) return;
    // One use only: the ElevenLabs token is single-use and the session moves on (debrief, ended), so a
    // reload or Back must start a new session from Home, not restart this one. The live engine above
    // keeps React's development double mount working.
    clearSessionStart(sid);
    const e = acquire(sid, s, opts);
    setEngine(e);
    return () => release(sid);
    // The callbacks are read through `opts` at call time; re-creating the engine would end the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  const state: SessionState | null = useSyncExternalStore(
    engine?.subscribe ?? emptySubscribe,
    () => engine?.getState() ?? null,
    () => null,
  );

  // MiniERP DOM events (second tab or iframe) go to the gateway through the engine.
  useEffect(() => {
    if (!engine) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: unknown } | null;
      if (d && typeof d === "object" && d.type === "dom") engine.relayDom(d);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [engine]);

  const consent = useCallback((scopes?: ConsentScope[]) => engine?.consent(scopes), [engine]);
  const say = useCallback((text: string) => engine?.say(text), [engine]);
  const finish = useCallback(() => engine?.finish(), [engine]);
  const toggleOffRecord = useCallback(() => void engine?.toggleOffRecord(), [engine]);
  const taskDone = useCallback(() => void engine?.taskDone(), [engine]);
  const end = useCallback(() => engine?.end(), [engine]);

  return useMemo(() => {
    const stage = state?.stage;
    const status: SessionStatus = state?.offRecord
      ? "offrecord"
      : stage === "reviewing"
        ? "reviewing"
        : stage === "debrief"
          ? "debrief"
          : state?.agentMode === "speaking"
            ? "asking"
            : "listening";
    const phase: SessionPhase =
      !stage || stage === "awaiting_consent"
        ? "idle"
        : stage === "reviewing"
          ? "reviewing"
          : stage === "debrief"
            ? "debrief"
            : stage === "ended" || stage === "finishing"
              ? "ended"
              : "capture";
    const connected = !!stage && stage !== "awaiting_consent" && stage !== "error";
    return {
      /** undefined while loading, false when this tab has no start data for the session. */
      found: start === undefined ? undefined : start !== null,
      state,
      status,
      phase,
      transcript: state?.transcript ?? [],
      questionsAsked: state?.questionsAsked ?? 0,
      offRecord: state?.offRecord ?? false,
      error: state?.error ?? null,
      /** Frames may only flow once consent is recorded (perception refuses before that). */
      skToken: connected ? (start?.response.sk_token ?? null) : null,
      ingestUrl: start?.response.ingest_url ?? null,
      tZeroMs: start?.startedAt ?? null,
      consent,
      toggleOffRecord,
      taskDone,
      end,
      say,
      finish,
      dismissIntervention: () => engine?.dismissIntervention(),
      dismissReplay: () => engine?.dismissReplay(),
    };
  }, [state, start, engine, consent, toggleOffRecord, taskDone, end, say, finish]);
}
