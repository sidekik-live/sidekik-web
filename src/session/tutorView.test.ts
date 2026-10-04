import { describe, expect, it } from "vitest";
import type { SessionState } from "./engine";
import { openQuestion, tutorView, type WorkMapStep } from "./tutorView";

const steps: WorkMapStep[] = [
  {
    id: "s4",
    key: "S4",
    ordinal: 4,
    title: "Code the invoice to a cost center",
    reason_quote: "Ab 5000 Euro ist Ausrüstung immer Capex.",
    reason_quote_en: "Equipment over €5,000 is always capex.",
  },
  {
    id: "s1",
    key: "S1",
    ordinal: 1,
    title: "Check the supplier",
    reason_quote: "Neue Lieferanten frage ich nach.",
    reason_quote_en: null,
  },
];

const base: SessionState = {
  stage: "live",
  phase: "tutoring",
  agentMode: "listening",
  offRecord: false,
  transcript: [],
  questionsAsked: 0,
  statusText: null,
  prediction: null,
  intervention: null,
  replay: null,
  mastery: null,
  gatewaySocket: "open",
  screenContext: null,
  error: null,
};

describe("tutorView", () => {
  it("starts on the first step, in the expert's words", () => {
    expect(tutorView(base, steps).currentStep).toEqual({
      step_id: "s1",
      title: "Check the supplier",
      expertWords: "Neue Lieferanten frage ich nach.",
    });
  });

  it("follows the predicted step and shows the prompt", () => {
    const v = tutorView(
      {
        ...base,
        prediction: { step_id: "s4", prompt: "€7,200 spindle motor: which cost center?" },
      },
      steps,
    );
    expect(v.currentStep?.title).toBe("Code the invoice to a cost center");
    expect(v.predictPrompt).toBe("€7,200 spindle motor: which cost center?");
  });

  it("builds the intervention from the replay's quote and clip when they match", () => {
    const v = tutorView(
      {
        ...base,
        intervention: {
          guardrail_id: "g1",
          step_id: "s4",
          text: "G1: equipment over €5,000 is capex.",
          field: "cost_center",
        },
        replay: {
          type: "replay",
          step_id: "s4",
          clip_url: "https://clip/s4.mp4",
          quote: "Ab 5000 Euro…",
          label: "Sabine, 03:12",
        },
      },
      steps,
    );
    expect(v.intervention).toEqual({
      step_id: "s4",
      field: "cost_center",
      quote: "Ab 5000 Euro…",
      clipUrl: "https://clip/s4.mp4",
    });
    expect(v.currentStep?.step_id).toBe("s4");
  });

  it("falls back to the step's English reason before the replay arrives", () => {
    const v = tutorView(
      { ...base, intervention: { guardrail_id: "g1", step_id: "s4", text: "G1" } },
      steps,
    );
    expect(v.intervention).toEqual({
      step_id: "s4",
      field: "",
      quote: "Equipment over €5,000 is always capex.",
      clipUrl: null,
    });
  });

  it("maps the mastery summary to the panel's outcomes", () => {
    const v = tutorView(
      {
        ...base,
        mastery: {
          session_id: "x",
          workmap_id: "w",
          learner_id: "l",
          steps: [
            { step_id: "s1", key: "S1", title: "", outcome: "independent_correct" },
            {
              step_id: "s4",
              key: "S4",
              title: "Code the invoice",
              outcome: "corrected_after_intervention",
            },
          ],
          practice_next: [{ step_id: "s4", reason: "Capex vs opex on equipment" }],
          counts: {
            independent_correct: 1,
            prompted_correct: 0,
            corrected_after_intervention: 1,
            not_attempted: 0,
          },
        },
      },
      steps,
    );
    expect(v.mastery).toEqual({
      steps: [
        { step_id: "s1", title: "Check the supplier", outcome: "independent" },
        { step_id: "s4", title: "Code the invoice", outcome: "corrected" },
      ],
      practiceNext: ["Capex vs opex on equipment"],
    });
  });

  it("handles no session yet", () => {
    expect(tutorView(null, [])).toEqual({
      currentStep: null,
      predictPrompt: null,
      openQuestion: null,
      intervention: null,
      mastery: null,
    });
  });
});

describe("openQuestion", () => {
  const turn = (role: "user" | "agent", text: string, i = 0) => ({
    id: `t${i}`,
    role,
    text,
    t_ms: i,
  });

  it("is the question in the agent's latest turn", () => {
    const s = {
      ...base,
      transcript: [turn("agent", "I hear you. But would you keep it as euros, or change it?")],
    };
    expect(openQuestion(s)).toBe("But would you keep it as euros, or change it?");
  });

  it("is null once the learner replies, or when the agent didn't ask", () => {
    expect(
      openQuestion({
        ...base,
        transcript: [turn("agent", "Why 0400?", 0), turn("user", "Capex.", 1)],
      }),
    ).toBeNull();
    expect(openQuestion({ ...base, transcript: [turn("agent", "Got it, thanks.")] })).toBeNull();
  });

  it("leaves pending predictions and the finished session to their own cards", () => {
    const transcript = [turn("agent", "Which cost center?")];
    expect(
      openQuestion({
        ...base,
        transcript,
        prediction: { step_id: "s4", prompt: "Which cost center?" },
      }),
    ).toBeNull();
    expect(openQuestion(null)).toBeNull();
  });
});
