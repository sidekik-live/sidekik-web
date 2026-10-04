// The live session behind the Capture/Debrief Room, the Tutor Room and /agent-host (DESIGN §4,
// tickets 3, 8, 9). It holds the ElevenLabs conversation, relays what happens to the gateway
// (/ws/client), and carries out the agent commands the gateway broadcasts on Realtime.
// Everything outside the browser is injected, so the engine is tested with fakes.
import type { SocketStatus } from "@/lib/reconnectingSocket";
import type { AgentCommand, CreateSessionResponse, MasterySummary, Phase } from "./contract";
import { pageAction } from "./pageAction";
import { VoiceActivityTracker } from "./vad";

// ---------------------------------------------------------------- injected dependencies

export interface ConversationLike {
  sendUserMessage(text: string): void;
  sendContextualUpdate(text: string, options?: { contextId?: string }): void;
  setMicMuted(muted: boolean): void;
  endSession(): Promise<void>;
}

export interface ConversationCallbacks {
  onMessage(m: { role: "user" | "agent"; message: string }): void;
  onModeChange(mode: "speaking" | "listening"): void;
  onVadScore(score: number): void;
  onError(message: string): void;
  onDisconnect(): void;
}

export type ClientTool = (params: Record<string, unknown>) => Promise<string>;

export type StartConversation = (opts: {
  conversationToken: string;
  dynamicVariables: Record<string, string>;
  language: string;
  clientTools: Record<string, ClientTool>;
  callbacks: ConversationCallbacks;
}) => Promise<ConversationLike>;

export interface GatewayClient {
  consent(sessionId: string, scopes: ConsentScope[]): Promise<void>;
  setOffRecord(sessionId: string, on: boolean, source: "ui" | "agent"): Promise<void>;
  taskDone(sessionId: string): Promise<void>;
  end(sessionId: string): Promise<void>;
}

/** A reconnecting JSON socket (src/lib/reconnectingSocket.ts). send() drops instead of queueing. */
export interface ClientSocket {
  send(data: string): boolean;
  close(): void;
}

export interface EngineDeps {
  gateway: GatewayClient;
  startConversation: StartConversation;
  /** Opens WS /ws/client/:sid?t=sk_token. */
  openClientSocket: (onStatus: (s: SocketStatus) => void) => ClientSocket;
  /** Subscribes to Realtime `session:{sid}`, event `cmd`. Returns an unsubscribe function. */
  subscribeCommands: (onCommand: (cmd: AgentCommand) => void) => () => void;
  now?: () => number;
}

export interface EngineOptions {
  session: CreateSessionResponse;
  kind: "capture" | "tutor";
  language: string;
  /** Epoch ms that t_ms counts from (the session start). */
  tZeroMs?: number;
  /** /agent-host: mute the mic while the agent speaks, so it doesn't hear itself in the meeting. */
  muteWhileSpeaking?: boolean;
  /** highlight_field tool and intervene commands: tell the MiniERP which field to highlight. */
  onHighlightField?: (field: string) => void;
  /** replay_moment tool: show the expert's moment for a step. */
  onReplayRequest?: (stepId: string) => void;
}

// ---------------------------------------------------------------- state

export type Stage =
  | "awaiting_consent"
  | "connecting"
  | "live"
  | "reviewing"
  | "debrief"
  /** Tutor: ended at the gateway, still listening for the mastery `summary`. */
  | "finishing"
  | "ended"
  | "error";

export type ConsentScope = "audio" | "screen" | "storage";

export interface TranscriptEntry {
  id: string;
  role: "user" | "agent";
  text: string;
  t_ms: number;
}

export interface SessionState {
  stage: Stage;
  phase: Phase;
  agentMode: "listening" | "speaking";
  offRecord: boolean;
  transcript: TranscriptEntry[];
  questionsAsked: number;
  /** Set by the agent's show_status tool. */
  statusText: string | null;
  prediction: { step_id: string; prompt: string } | null;
  intervention: { guardrail_id: string; step_id: string; text: string; field?: string } | null;
  replay: Extract<AgentCommand, { type: "replay" }> | null;
  mastery: MasterySummary | null;
  gatewaySocket: SocketStatus;
  error: string | null;
  /** The latest `ctx` line: what Sidekik sees on screen. */
  screenContext: string | null;
}

/** How long "End practice" keeps listening for tutor's mastery summary (the voice stops at once). */
const FINISH_WAIT_MS = 45_000;

/** "[SIDEKIK] …" messages are instructions to the agent, never the person's words. */
const isSidekikInstruction = (text: string) => text.trimStart().startsWith("[SIDEKIK]");

export class SessionEngine {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private conversation: ConversationLike | null = null;
  private socket: ClientSocket | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly vad: VoiceActivityTracker;
  private readonly now: () => number;
  private readonly tZero: number;
  private turnSeq = 0;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private consenting = false;

  constructor(
    private readonly opts: EngineOptions,
    private readonly deps: EngineDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.tZero = opts.tZeroMs ?? this.now();
    this.state = {
      stage: "awaiting_consent",
      phase: opts.kind === "tutor" ? "tutoring" : "capture",
      agentMode: "listening",
      offRecord: false,
      transcript: [],
      questionsAsked: 0,
      statusText: null,
      prediction: null,
      intervention: null,
      replay: null,
      mastery: null,
      gatewaySocket: "closed",
      error: null,
      screenContext: null,
    };
    this.vad = new VoiceActivityTracker((edge) => this.sendSpeech(edge));
  }

  get sessionId() {
    return this.opts.session.session_id;
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  tMs(): number {
    return Math.max(0, this.now() - this.tZero);
  }

  /** Consent first (the gateway and perception refuse sockets without it), then connect. */
  /**
   * Replay mode (ticket 11): only receive commands, with no microphone, screen or agent.
   * The gateway re-broadcasts a recorded session's commands under a new replay session id.
   */
  observe() {
    this.unsubscribe ??= this.deps.subscribeCommands((cmd) => void this.handleCommand(cmd));
    this.set({ stage: "live", error: null });
  }

  async consent(scopes: ConsentScope[] = ["audio", "screen", "storage"]) {
    // Once only: Open MiniERP and Share screen both start the session, and may both be clicked.
    if (this.consenting || this.state.stage !== "awaiting_consent") return;
    this.consenting = true;
    try {
      await this.deps.gateway.consent(this.sessionId, scopes);
    } catch (err) {
      this.fail(`Couldn't record consent: ${(err as Error).message}`);
      return;
    }
    await this.connect();
  }

  /**
   * Connects without recording consent: /agent-host, where consent was given when the expert
   * started the meeting session and the page has no user to consent as.
   */
  async connect() {
    this.set({ stage: "connecting", error: null });
    this.socket = this.deps.openClientSocket((gatewaySocket) => this.set({ gatewaySocket }));
    this.unsubscribe = this.deps.subscribeCommands((cmd) => void this.handleCommand(cmd));
    const { el } = this.opts.session;
    const ok = await this.startConversation(el.conversation_token, el.dynamic_variables);
    if (ok) this.set({ stage: "live" });
  }

  /** The ElevenLabs agent this phase talks to, for messages the person reads. */
  private agentName(): string {
    if (this.opts.kind === "tutor") return "Tutor";
    return this.state.phase === "debrief" ? "Debrief agent" : "Interviewer";
  }

  private async startConversation(token: string, dynamicVariables: Record<string, string>) {
    const generation = ++this.generation;
    // Named once, at start: a later disconnect belongs to this agent, whatever the phase is by then.
    const agent = this.agentName();
    try {
      const conversation = await this.deps.startConversation({
        conversationToken: token,
        dynamicVariables,
        language: this.opts.language,
        clientTools: this.clientTools(),
        callbacks: {
          onMessage: (m) => generation === this.generation && this.onMessage(m.role, m.message),
          onModeChange: (mode) => generation === this.generation && this.onModeChange(mode),
          onVadScore: (score) =>
            generation === this.generation && !this.state.offRecord && this.vad.score(score),
          onError: (message) => generation === this.generation && this.set({ error: message }),
          onDisconnect: () => {
            if (generation === this.generation && this.state.stage !== "ended") {
              this.set({ error: `The ${agent} disconnected.` });
            }
          },
        },
      });
      if (generation !== this.generation) {
        await conversation.endSession();
        return false;
      }
      this.conversation = conversation;
      if (this.state.offRecord) conversation.setMicMuted(true);
      return true;
    } catch (err) {
      this.fail(`Couldn't start the ${agent}: ${(err as Error).message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- commands from the gateway

  /** Carries out one agent command (ARCHITECTURE §4.5). Public so replay mode can feed commands. */
  async handleCommand(cmd: AgentCommand) {
    // While off the record the gateway drops everything except `offrecord`; ignore strays too.
    if (this.state.offRecord && cmd.type !== "offrecord") return;

    const action = pageAction(cmd);
    if (action.kind === "contextual_update") {
      this.set({ screenContext: action.text });
      this.conversation?.sendContextualUpdate(
        action.text,
        cmd.type === "ctx" && cmd.context_id ? { contextId: cmd.context_id } : undefined,
      );
    } else if (action.kind === "user_message") {
      this.conversation?.sendUserMessage(action.text);
    }

    switch (cmd.type) {
      // The Interviewer's live questions and the debrief agent's follow-ups both count.
      case "ask":
      case "followup":
        this.set({ questionsAsked: this.state.questionsAsked + 1 });
        break;
      case "predict":
        this.set({ prediction: { step_id: cmd.step_id, prompt: cmd.prompt } });
        break;
      case "intervene":
        this.set({
          intervention: {
            guardrail_id: cmd.guardrail_id,
            step_id: cmd.step_id,
            text: cmd.text,
            ...(cmd.field ? { field: cmd.field } : {}),
          },
        });
        if (cmd.field) this.opts.onHighlightField?.(cmd.field);
        break;
      case "replay":
        this.set({ replay: cmd });
        break;
      case "summary":
        this.set({ mastery: cmd.mastery });
        // After "End practice" the voice is already off: the summary only fills the mastery panel.
        if (this.state.stage === "finishing") this.scheduleTeardown(0);
        break;
      case "offrecord":
        this.applyOffRecord(cmd.on);
        break;
      case "phase":
        await this.switchPhase(cmd);
        break;
    }
  }

  /** capture → debrief: end the capture agent, start the debrief agent with the new token. */
  private async switchPhase(cmd: Extract<AgentCommand, { type: "phase" }>) {
    this.set({ phase: cmd.phase, stage: cmd.phase === "debrief" ? "debrief" : this.state.stage });
    await this.hangUp(); // normally done already at Task done
    await this.startConversation(cmd.conversation_token, cmd.dynamic_variables);
  }

  private applyOffRecord(on: boolean) {
    if (on === this.state.offRecord) return;
    if (on) this.vad.reset();
    this.conversation?.setMicMuted(on);
    this.set({ offRecord: on });
  }

  // ---------------------------------------------------------------- user actions

  /** UI toggle. Applied at once for the < 500 ms badge, then confirmed by the gateway's broadcast. */
  async toggleOffRecord() {
    await this.setOffRecord(!this.state.offRecord, "ui");
  }

  private async setOffRecord(on: boolean, source: "ui" | "agent") {
    const before = this.state.offRecord;
    this.applyOffRecord(on);
    try {
      await this.deps.gateway.setOffRecord(this.sessionId, on, source);
    } catch (err) {
      this.applyOffRecord(before);
      this.set({ error: `Couldn't change off the record: ${(err as Error).message}` });
    }
  }

  /**
   * "Task done": the Interviewer hangs up at once (it must not talk over the debrief agent); the
   * mapper builds the Work Map, then the gateway sends the `phase` command that starts the debrief.
   */
  async taskDone() {
    try {
      await this.deps.gateway.taskDone(this.sessionId);
    } catch (err) {
      this.set({ error: `Couldn't finish the task: ${(err as Error).message}` });
      return;
    }
    this.set({ stage: "reviewing", phase: "building" });
    await this.hangUp();
  }

  /** Ends the current agent call on purpose: its callbacks are retired first, so no "disconnected" error. */
  private async hangUp() {
    const conversation = this.conversation;
    this.conversation = null;
    this.generation++;
    this.set({ agentMode: "listening" });
    await conversation?.endSession().catch(() => {});
  }

  /** MiniERP DOM events (src/sandbox/domEvents.ts) relayed to the gateway as {type:"dom", ...}. */
  relayDom(event: object) {
    if (this.state.offRecord) return;
    this.send({ ...event, type: "dom", t_ms: this.tMs() });
  }

  dismissIntervention() {
    this.set({ intervention: null });
  }

  dismissReplay() {
    this.set({ replay: null });
  }

  /**
   * Tutor "End practice": the voice stops at once; the gateway ends the session, which makes tutor
   * publish the mastery `summary` for the panel. Keep listening until it arrives, then hang up.
   */
  async finish(waitMs = FINISH_WAIT_MS) {
    if (this.state.stage === "ended" || this.state.stage === "finishing") return;
    this.set({ stage: "finishing" });
    await this.hangUp();
    try {
      await this.deps.gateway.end(this.sessionId);
    } catch (err) {
      this.set({ error: `Couldn't end the session: ${(err as Error).message}` });
    }
    this.scheduleTeardown(this.state.mastery ? 0 : waitMs);
  }

  async end() {
    if (this.state.stage === "ended") return;
    await this.teardown();
    await this.deps.gateway.end(this.sessionId).catch(() => {});
  }

  /** A typed answer (the Tutor Room's Predict card): the agent hears it and tutor grades it. */
  say(text: string) {
    const clean = text.trim();
    if (!clean || this.state.offRecord) return;
    this.conversation?.sendUserMessage(clean);
    this.recordTurn("user", clean);
    this.set({ prediction: null });
  }

  private scheduleTeardown(ms: number) {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => void this.teardown(), ms);
  }

  private async teardown() {
    if (this.state.stage === "ended") return;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    this.generation++;
    this.set({ stage: "ended" });
    this.vad.reset();
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.conversation?.endSession().catch(() => {});
    this.conversation = null;
    this.socket?.close();
    this.socket = null;
  }

  // ---------------------------------------------------------------- agent → page and gateway

  private clientTools(): Record<string, ClientTool> {
    return {
      mark_off_record: async (p) => {
        await this.setOffRecord(p["on"] !== false, "agent");
        return "ok";
      },
      show_status: async (p) => {
        this.set({ statusText: typeof p["text"] === "string" ? p["text"] : null });
        return "ok";
      },
      replay_moment: async (p) => {
        const stepId = typeof p["step_id"] === "string" ? p["step_id"] : "current";
        this.opts.onReplayRequest?.(stepId);
        return "ok";
      },
      highlight_field: async (p) => {
        if (typeof p["field"] === "string") this.opts.onHighlightField?.(p["field"]);
        return "ok";
      },
    };
  }

  private onMessage(role: "user" | "agent", text: string) {
    const clean = text.trim();
    if (!clean || clean === "..." || isSidekikInstruction(clean)) return;
    if (this.state.offRecord) return;
    this.recordTurn(role, clean);
  }

  private recordTurn(role: "user" | "agent", text: string) {
    const t_ms = this.tMs();
    const id = `t${t_ms}-${++this.turnSeq}`;
    this.set({ transcript: [...this.state.transcript, { id, role, text, t_ms }] });
    this.send({ type: "turn", role, text, t_ms, turn_id: id });
  }

  private onModeChange(mode: "speaking" | "listening") {
    if (mode === this.state.agentMode) return;
    this.set({ agentMode: mode });
    if (this.opts.muteWhileSpeaking && !this.state.offRecord)
      this.conversation?.setMicMuted(mode === "speaking");
    this.sendSpeech(mode === "speaking" ? "agent_speech_start" : "agent_speech_end");
  }

  private sendSpeech(
    kind: "user_speech_start" | "user_speech_end" | "agent_speech_start" | "agent_speech_end",
  ) {
    if (this.state.offRecord) return;
    this.send({ type: "speech", kind, source: "sdk", t_ms: this.tMs() });
  }

  private send(msg: object) {
    this.socket?.send(JSON.stringify(msg));
  }

  private fail(error: string) {
    this.set({ stage: "error", error });
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
