import { describe, expect, it, vi } from "vitest";
import type { AgentCommand, CreateSessionResponse } from "./contract";
import {
  SessionEngine,
  type ConversationCallbacks,
  type EngineOptions,
  type StartConversation,
} from "./engine";

const session: CreateSessionResponse = {
  session_id: "sess-1",
  sk_token: "sk",
  el: {
    conversation_token: "tok-capture",
    agent_id: "agent_int",
    dynamic_variables: { expert_name: "Sabine" },
  },
  ingest_url: "wss://ingest/ws/frames/sess-1",
};

function setup(opts: Partial<EngineOptions> = {}) {
  let now = 1_000;
  const sent: Record<string, unknown>[] = [];
  const conversations: {
    token: string;
    vars: Record<string, string>;
    language: string;
    callbacks: ConversationCallbacks;
    tools: Record<string, (p: Record<string, unknown>) => Promise<string>>;
    userMessages: string[];
    contextual: { text: string; options?: { contextId?: string } }[];
    muted: boolean[];
    ended: boolean;
  }[] = [];
  let onCommand: (cmd: AgentCommand) => void = () => {};
  const unsubscribe = vi.fn();
  const socket = { send: vi.fn((d: string) => (sent.push(JSON.parse(d)), true)), close: vi.fn() };
  const gateway = {
    consent: vi.fn(async () => {}),
    setOffRecord: vi.fn(async () => {}),
    taskDone: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
  };
  const startConversation: StartConversation = async (o) => {
    const c = {
      token: o.conversationToken,
      vars: o.dynamicVariables,
      language: o.language,
      callbacks: o.callbacks,
      tools: o.clientTools,
      userMessages: [] as string[],
      contextual: [] as { text: string; options?: { contextId?: string } }[],
      muted: [] as boolean[],
      ended: false,
    };
    conversations.push(c);
    return {
      sendUserMessage: (t) => c.userMessages.push(t),
      sendContextualUpdate: (text, options) =>
        c.contextual.push(options ? { text, options } : { text }),
      setMicMuted: (m) => c.muted.push(m),
      endSession: async () => {
        c.ended = true;
        c.callbacks.onDisconnect(); // the ElevenLabs SDK reports its own hang-up too
      },
    };
  };
  const engine = new SessionEngine(
    { session, kind: "capture", language: "en", tZeroMs: 0, ...opts },
    {
      gateway,
      startConversation,
      openClientSocket: () => socket,
      subscribeCommands: (cb) => ((onCommand = cb), unsubscribe),
      now: () => now,
    },
  );
  return {
    engine,
    gateway,
    socket,
    sent,
    conversations,
    unsubscribe,
    command: (cmd: AgentCommand) => engine.handleCommand(cmd),
    current: () => conversations.at(-1)!,
    advance: (ms: number) => (now += ms),
  };
}

describe("SessionEngine", () => {
  it("starts once, however many times consent is given", async () => {
    const t = setup();
    await Promise.all([t.engine.consent(), t.engine.consent()]);
    await t.engine.consent();
    expect(t.gateway.consent).toHaveBeenCalledTimes(1);
  });

  it("records consent, then connects the gateway socket, Realtime and the agent", async () => {
    const t = setup();
    expect(t.engine.getState().stage).toBe("awaiting_consent");
    await t.engine.consent();
    expect(t.gateway.consent).toHaveBeenCalledWith("sess-1", ["audio", "screen", "storage"]);
    expect(t.conversations).toHaveLength(1);
    expect(t.current()).toMatchObject({
      token: "tok-capture",
      vars: { expert_name: "Sabine" },
      language: "en",
    });
    expect(t.engine.getState().stage).toBe("live");
  });

  it("connects without consent for /agent-host", async () => {
    const t = setup({ muteWhileSpeaking: true });
    await t.engine.connect();
    expect(t.gateway.consent).not.toHaveBeenCalled();
    expect(t.engine.getState().stage).toBe("live");
  });

  it("stops with an error when consent fails", async () => {
    const t = setup();
    t.gateway.consent.mockRejectedValueOnce(new Error("409"));
    await t.engine.consent();
    expect(t.engine.getState()).toMatchObject({ stage: "error" });
    expect(t.conversations).toHaveLength(0);
  });

  it("speaks an ask, counts it, and feeds ctx as a contextual update with its context_id", async () => {
    const t = setup();
    await t.engine.consent();
    await t.command({
      type: "ctx",
      text: "03:12 invoice 4471 | cost_center 4711→0400",
      context_id: "screen",
    });
    await t.command({
      type: "ask",
      question_id: "q1",
      text: "Why did you change the cost center?",
      qtype: "why",
    });
    expect(t.current().contextual).toEqual([
      { text: "03:12 invoice 4471 | cost_center 4711→0400", options: { contextId: "screen" } },
    ]);
    expect(t.current().userMessages).toEqual([
      "[SIDEKIK] ASK: Why did you change the cost center?",
    ]);
    expect(t.engine.getState().questionsAsked).toBe(1);
  });

  it("relays turns and speech to the gateway, skipping [SIDEKIK] echoes", async () => {
    const t = setup();
    await t.engine.consent();
    t.advance(5_000);
    t.current().callbacks.onMessage({ role: "user", message: "[SIDEKIK] ASK: Why?" });
    t.current().callbacks.onMessage({ role: "user", message: "I'm recoding it to 0400." });
    t.current().callbacks.onModeChange("speaking");
    t.current().callbacks.onModeChange("listening");
    expect(t.sent).toEqual([
      {
        type: "turn",
        role: "user",
        text: "I'm recoding it to 0400.",
        t_ms: 6_000,
        turn_id: "t6000-1",
      },
      { type: "speech", kind: "agent_speech_start", source: "sdk", t_ms: 6_000 },
      { type: "speech", kind: "agent_speech_end", source: "sdk", t_ms: 6_000 },
    ]);
    expect(t.engine.getState().transcript.map((e) => e.text)).toEqual(["I'm recoding it to 0400."]);
  });

  it("goes off the record: mutes, ignores other commands and stops relaying until it's back", async () => {
    const t = setup();
    await t.engine.consent();
    await t.command({ type: "offrecord", on: true });
    await t.command({ type: "ask", question_id: "q1", text: "Why?", qtype: "why" });
    t.current().callbacks.onMessage({ role: "user", message: "this part is private" });
    t.engine.relayDom({ kind: "field_change", field: "cost_center" });
    expect(t.current().muted).toEqual([true]);
    expect(t.current().userMessages).toEqual([]);
    expect(t.sent).toEqual([]);
    await t.command({ type: "offrecord", on: false });
    expect(t.current().muted).toEqual([true, false]);
    expect(t.engine.getState().offRecord).toBe(false);
  });

  it("applies the UI toggle at once and reverts it if the gateway refuses", async () => {
    const t = setup();
    await t.engine.consent();
    t.gateway.setOffRecord.mockRejectedValueOnce(new Error("500"));
    await t.engine.toggleOffRecord();
    expect(t.gateway.setOffRecord).toHaveBeenCalledWith("sess-1", true, "ui");
    expect(t.current().muted).toEqual([true, false]);
    expect(t.engine.getState()).toMatchObject({ offRecord: false });
    expect(t.engine.getState().error).toMatch(/off the record/);
  });

  it("switches to the debrief agent on a phase command", async () => {
    const t = setup();
    await t.engine.consent();
    await t.engine.taskDone();
    expect(t.engine.getState()).toMatchObject({ stage: "reviewing", phase: "building" });
    await t.command({
      type: "phase",
      phase: "debrief",
      conversation_token: "tok-debrief",
      agent_id: "agent_deb",
      dynamic_variables: { open_items: "1. What if the supplier is unknown?" },
    });
    expect(t.conversations).toHaveLength(2);
    expect(t.conversations[0]!.ended).toBe(true);
    expect(t.current()).toMatchObject({
      token: "tok-debrief",
      vars: { open_items: "1. What if the supplier is unknown?" },
    });
    expect(t.engine.getState()).toMatchObject({ stage: "debrief", phase: "debrief" });
    // Callbacks from the ended capture conversation are ignored.
    t.conversations[0]!.callbacks.onMessage({ role: "agent", message: "late" });
    expect(t.engine.getState().transcript).toEqual([]);
  });

  it("shows interventions and replays, and highlights the field", async () => {
    const onHighlightField = vi.fn();
    const t = setup({ onHighlightField, kind: "tutor" });
    await t.engine.consent();
    await t.command({
      type: "intervene",
      guardrail_id: "g1",
      step_id: "s4",
      text: "Equipment over €5,000 is always capex.",
      field: "cost_center",
    });
    await t.command({
      type: "replay",
      step_id: "s4",
      clip_url: "https://clip",
      quote: "Ab 5000…",
      label: "Sabine, 03:12",
    });
    expect(t.current().userMessages).toEqual([
      "[SIDEKIK] INTERVENE: Equipment over €5,000 is always capex.",
    ]);
    expect(onHighlightField).toHaveBeenCalledWith("cost_center");
    expect(t.engine.getState().intervention?.field).toBe("cost_center");
    expect(t.engine.getState().replay?.clip_url).toBe("https://clip");
  });

  it("serves the agent's client tools", async () => {
    const onHighlightField = vi.fn();
    const onReplayRequest = vi.fn();
    const t = setup({ onHighlightField, onReplayRequest });
    await t.engine.consent();
    const { tools } = t.current();
    expect(await tools["mark_off_record"]!({ on: true })).toBe("ok");
    expect(t.gateway.setOffRecord).toHaveBeenCalledWith("sess-1", true, "agent");
    await tools["show_status"]!({ text: "Listening" });
    await tools["highlight_field"]!({ field: "asset_number" });
    await tools["replay_moment"]!({});
    expect(t.engine.getState()).toMatchObject({ offRecord: true, statusText: "Listening" });
    expect(onHighlightField).toHaveBeenCalledWith("asset_number");
    expect(onReplayRequest).toHaveBeenCalledWith("current");
  });

  it("relays MiniERP DOM events with the session time", async () => {
    const t = setup();
    await t.engine.consent();
    t.advance(2_500);
    t.engine.relayDom({
      type: "dom",
      kind: "save_attempt",
      record: { kind: "invoice", id: "4471" },
    });
    expect(t.sent).toEqual([
      { type: "dom", kind: "save_attempt", record: { kind: "invoice", id: "4471" }, t_ms: 3_500 },
    ]);
  });

  it("mutes the mic while the agent speaks on /agent-host", async () => {
    const t = setup({ muteWhileSpeaking: true });
    await t.engine.consent();
    t.current().callbacks.onModeChange("speaking");
    t.current().callbacks.onModeChange("listening");
    expect(t.current().muted).toEqual([true, false]);
  });

  it("finishes a tutor session: stops the voice at once, ends at the gateway, waits for the summary", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ kind: "tutor" });
      await t.engine.consent();
      await t.engine.finish();
      expect(t.current().ended).toBe(true);
      expect(t.engine.getState().error).toBeNull();
      expect(t.gateway.end).toHaveBeenCalledTimes(1);
      expect(t.engine.getState().stage).toBe("finishing");
      const mastery = {
        session_id: "sess-1",
        workmap_id: "w1",
        learner_id: "l1",
        steps: [],
        practice_next: [],
        counts: {
          independent_correct: 1,
          prompted_correct: 0,
          corrected_after_intervention: 1,
          not_attempted: 0,
        },
      };
      await t.command({ type: "summary", mastery });
      expect(t.engine.getState().mastery).toEqual(mastery);
      expect(t.current().userMessages).toEqual([]); // nothing is read aloud any more
      await vi.advanceTimersByTimeAsync(0);
      expect(t.engine.getState().stage).toBe("ended");
      expect(t.gateway.end).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hangs up after the wait when no summary comes", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ kind: "tutor" });
      await t.engine.consent();
      await t.engine.finish(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(t.engine.getState().stage).toBe("ended");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a typed answer to the agent and the gateway, and clears the prediction", async () => {
    const t = setup({ kind: "tutor" });
    await t.engine.consent();
    await t.command({
      type: "predict",
      step_id: "s4",
      prompt: "Which cost center would Sabine use?",
    });
    expect(t.engine.getState().prediction?.step_id).toBe("s4");
    t.engine.say("0400, because it's equipment over 5,000 euros");
    expect(t.current().userMessages.at(-1)).toBe("0400, because it's equipment over 5,000 euros");
    expect(t.sent.at(-1)).toMatchObject({
      type: "turn",
      role: "user",
      text: "0400, because it's equipment over 5,000 euros",
    });
    expect(t.engine.getState().prediction).toBeNull();
  });

  it("observes a replay: commands only, no agent or socket", async () => {
    const t = setup();
    t.engine.observe();
    await t.command({ type: "ctx", text: "invoice 4471 | cost_center 0400" });
    await t.command({ type: "ask", question_id: "q1", text: "Why?", qtype: "why" });
    expect(t.conversations).toHaveLength(0);
    expect(t.engine.getState()).toMatchObject({
      stage: "live",
      questionsAsked: 1,
      screenContext: "invoice 4471 | cost_center 0400",
    });
  });

  it("ends everything once", async () => {
    const t = setup();
    await t.engine.consent();
    await t.engine.end();
    await t.engine.end();
    expect(t.current().ended).toBe(true);
    expect(t.socket.close).toHaveBeenCalledTimes(1);
    expect(t.unsubscribe).toHaveBeenCalledTimes(1);
    expect(t.gateway.end).toHaveBeenCalledTimes(1);
    expect(t.engine.getState().stage).toBe("ended");
  });

  describe("agent disconnects", () => {
    const debrief: AgentCommand = {
      type: "phase",
      phase: "debrief",
      conversation_token: "tok-debrief",
      agent_id: "agent_deb",
      dynamic_variables: {},
    };

    it("hangs up the Interviewer at Task done, quietly, so it never overlaps the debrief agent", async () => {
      const t = setup();
      await t.engine.consent();
      await t.engine.taskDone();
      expect(t.conversations[0]!.ended).toBe(true);
      expect(t.engine.getState()).toMatchObject({ stage: "reviewing", error: null });
      await t.command(debrief);
      expect(t.conversations).toHaveLength(2);
      expect(t.conversations.filter((c) => !c.ended)).toHaveLength(1); // only the debrief agent is live
      expect(t.engine.getState().error).toBeNull();
    });

    it("keeps the Interviewer when Task done fails", async () => {
      const t = setup();
      await t.engine.consent();
      t.gateway.taskDone.mockRejectedValueOnce(new Error("gateway down"));
      await t.engine.taskDone();
      expect(t.conversations[0]!.ended).toBe(false);
      expect(t.engine.getState().error).toMatch(/Couldn't finish the task/);
    });

    it("names the Interviewer during capture, and the Debrief agent after the switch", async () => {
      const t = setup();
      await t.engine.consent();
      t.current().callbacks.onDisconnect();
      expect(t.engine.getState().error).toBe("The Interviewer disconnected.");

      await t.engine.taskDone();
      await t.command(debrief);
      t.current().callbacks.onDisconnect();
      expect(t.engine.getState().error).toBe("The Debrief agent disconnected.");
    });

    it("End debrief hangs up the debrief agent at once and ends the session", async () => {
      const t = setup();
      await t.engine.consent();
      await t.engine.taskDone();
      await t.command(debrief);
      await t.engine.end();
      expect(t.conversations.every((c) => c.ended)).toBe(true);
      expect(t.engine.getState()).toMatchObject({ stage: "ended", error: null });
      expect(t.gateway.end).toHaveBeenCalledWith("sess-1");
    });

    it("names the Tutor in a tutor session", async () => {
      const t = setup({ kind: "tutor" });
      await t.engine.consent();
      t.current().callbacks.onDisconnect();
      expect(t.engine.getState().error).toBe("The Tutor disconnected.");
    });
  });
});
