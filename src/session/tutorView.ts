// What the Tutor Room shows (DESIGN §5), derived from the session state and the Work Map's steps.
import type { MasterySummary, StepOutcome as ContractOutcome } from "./contract";
import type { SessionState } from "./engine";

export type StepOutcome = "independent" | "prompted" | "corrected" | "not_attempted";

export interface WorkMapStep {
  id: string;
  key: string;
  ordinal: number;
  title: string;
  reason_quote: string | null;
  reason_quote_en: string | null;
}

export interface TutorStep {
  step_id: string;
  title: string;
  /** The expert's reason, in English when the Work Map has a translation. */
  expertWords: string;
}

export interface Intervention {
  step_id: string;
  field: string;
  quote: string;
  clipUrl: string | null;
}

export interface MasteryResult {
  steps: { step_id: string; title: string; outcome: StepOutcome }[];
  practiceNext: string[];
}

const OUTCOME: Record<ContractOutcome, StepOutcome> = {
  independent_correct: "independent",
  prompted_correct: "prompted",
  corrected_after_intervention: "corrected",
  not_attempted: "not_attempted",
};

const toTutorStep = (s: WorkMapStep): TutorStep => ({
  step_id: s.id,
  title: s.title,
  expertWords: s.reason_quote_en ?? s.reason_quote ?? "",
});

export function mapMastery(m: MasterySummary, steps: WorkMapStep[]): MasteryResult {
  const titles = new Map(steps.map((s) => [s.id, s.title]));
  return {
    steps: m.steps.map((s) => ({
      step_id: s.step_id,
      title: s.title || titles.get(s.step_id) || s.key,
      outcome: OUTCOME[s.outcome],
    })),
    practiceNext: m.practice_next.map((p) => p.reason),
  };
}

/** The question in the agent's latest turn, while the learner hasn't replied (else null). */
export function openQuestion(state: SessionState | null): string | null {
  if (!state || state.prediction || state.mastery) return null;
  const last = state.transcript.at(-1);
  if (!last || last.role !== "agent") return null;
  const questions = last.text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /\?["”')]*$/.test(s));
  return questions.at(-1) ?? null;
}

export function tutorView(state: SessionState | null, steps: WorkMapStep[]) {
  const ordered = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const byId = new Map(ordered.map((s) => [s.id, s]));
  // The step the tutor is talking about: an intervention, else a prediction, else the first step.
  const focusId = state?.intervention?.step_id ?? state?.prediction?.step_id;
  const focus = (focusId && byId.get(focusId)) || ordered[0];

  let intervention: Intervention | null = null;
  if (state?.intervention) {
    const { step_id, field, text } = state.intervention;
    const replay = state.replay?.step_id === step_id ? state.replay : null;
    const step = byId.get(step_id);
    intervention = {
      step_id,
      field: field ?? "",
      // The expert's own words: the replay's quote, else the step's reason, else the tutor's text.
      quote: replay?.quote || (step && toTutorStep(step).expertWords) || text,
      clipUrl: replay?.clip_url ?? null,
    };
  }

  return {
    currentStep: focus ? toTutorStep(focus) : null,
    predictPrompt: state?.prediction?.prompt ?? null,
    /** Any other question the agent asked, so the learner can always type an answer. */
    openQuestion: openQuestion(state),
    intervention,
    mastery: state?.mastery ? mapMastery(state.mastery, ordered) : null,
  };
}
