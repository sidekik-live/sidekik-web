import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getClipUrl } from "@/lib/api";
import type { MasterySummary } from "@/session/contract";
import { mapMastery, tutorView, type WorkMapStep } from "@/session/tutorView";
import { useSidekikSession } from "./useSidekikSession";

// Ticket 8: the Tutor Room on top of the shared session engine (useSidekikSession).

export type { Intervention, MasteryResult, StepOutcome, TutorStep } from "@/session/tutorView";

export interface UseTutorSessionOptions {
  onHighlightField?: (field: string) => void;
}

/** The Work Map the session teaches: its steps and the expert's name (read through RLS). */
function useSessionWorkMap(sid: string) {
  return useQuery({
    queryKey: ["tutor-workmap", sid],
    queryFn: async () => {
      const { data: session, error } = await supabase
        .from("sessions")
        .select("workmap_id")
        .eq("id", sid)
        .maybeSingle();
      if (error) throw error;
      if (!session?.workmap_id)
        return { workmapId: null, steps: [] as WorkMapStep[], expertName: "the expert" };
      const [steps, map] = await Promise.all([
        supabase
          .from("work_map_steps")
          .select("id, key, ordinal, title, reason_quote, reason_quote_en")
          .eq("work_map_id", session.workmap_id),
        supabase
          .from("work_maps")
          .select("experts(display_name)")
          .eq("id", session.workmap_id)
          .maybeSingle(),
      ]);
      const expert = map.data?.experts as unknown as { display_name: string } | null;
      return {
        workmapId: session.workmap_id,
        steps: (steps.data ?? []) as WorkMapStep[],
        expertName: expert?.display_name ?? "the expert",
      };
    },
  });
}

export function useTutorSession(sid: string, opts: UseTutorSessionOptions = {}) {
  const [replayView, setReplayView] = useState<{ title: string; src: string | null } | null>(null);
  const workMap = useSessionWorkMap(sid);
  const expertName = workMap.data?.expertName ?? "the expert";
  const openReplayRef = useRef<(stepId: string) => void>(() => {});

  const s = useSidekikSession(sid, {
    onHighlightField: (f) => opts.onHighlightField?.(f),
    onReplayRequest: (stepId) => openReplayRef.current(stepId),
  });
  const view = useMemo(
    () => tutorView(s.state, workMap.data?.steps ?? []),
    [s.state, workMap.data],
  );
  const done = s.phase === "ended" || !!view.mastery;

  // If the `summary` broadcast is missed, tutor also stored the report in `mastery`.
  const storedMastery = useQuery({
    queryKey: ["tutor-mastery", sid],
    enabled: done && !view.mastery,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data } = await supabase
        .from("mastery")
        .select("summary")
        .eq("session_id", sid)
        .maybeSingle();
      return (data?.summary as unknown as MasterySummary | undefined) ?? null;
    },
  });
  const mastery =
    view.mastery ??
    (storedMastery.data ? mapMastery(storedMastery.data, workMap.data?.steps ?? []) : null);

  const openReplay = useCallback(
    (stepId: string) => {
      const id = stepId === "current" ? view.currentStep?.step_id : stepId;
      const title = `${expertName}'s moment`;
      const replay = s.state?.replay;
      if (replay && replay.step_id === id) {
        setReplayView({ title, src: replay.clip_url });
        return;
      }
      setReplayView({ title, src: null });
      const workmapId = workMap.data?.workmapId;
      if (id && workmapId) {
        getClipUrl(workmapId, id)
          .then((src) => setReplayView((v) => (v ? { ...v, src } : v)))
          .catch(() => {});
      }
    },
    [view.currentStep, expertName, s.state?.replay, workMap.data?.workmapId],
  );
  openReplayRef.current = openReplay;

  // DESIGN §4.5: a `replay` command opens the clip overlay with the expert's quote.
  const lastReplay = useRef<unknown>(null);
  useEffect(() => {
    const replay = s.state?.replay;
    if (!replay || replay === lastReplay.current) return;
    lastReplay.current = replay;
    setReplayView({ title: `${expertName}'s moment: ${replay.label}`, src: replay.clip_url });
  }, [s.state?.replay, expertName]);

  return {
    found: s.found,
    error: s.error,
    phase: (s.phase === "idle" ? "idle" : done ? "done" : "practice") as
      "idle" | "practice" | "done",
    finishing: s.state?.stage === "finishing",
    expertName,
    currentStep: view.currentStep,
    predictPrompt: view.predictPrompt,
    openQuestion: view.openQuestion,
    transcript: s.transcript,
    intervention: view.intervention,
    mastery,
    replayView,
    skToken: s.skToken,
    ingestUrl: s.ingestUrl,
    tZeroMs: s.tZeroMs,
    offRecord: s.offRecord,
    /** Consent and connect. A learner's screen and voice are used live; nothing is stored for them by default. */
    start: () => void s.consent(["audio", "screen"]),
    submitPrediction: (answer: string) => s.say(answer),
    dismissIntervention: s.dismissIntervention,
    openReplay,
    closeReplay: () => setReplayView(null),
    finish: () => void s.finish(),
  };
}
