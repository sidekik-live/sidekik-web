import type { FrameReason } from "./frameCodec";

export interface FrameSchedulerOptions {
  /** Called to grab, encode and send one frame. */
  capture: (reason: FrameReason) => Promise<void>;
  /** Regular tick interval. DESIGN §4: one frame per second. */
  intervalMs?: number;
  /** Minimum gap between any two frames. perception drops anything faster than 2 fps. */
  minGapMs?: number;
}

/**
 * Decides when to take a frame: a 1 s tick, plus extra frames on MiniERP blur/save/nav.
 * Extra requests that arrive too soon after the last frame are coalesced into one frame
 * sent as soon as the gap allows. Never runs two captures at once.
 */
export class FrameScheduler {
  private readonly capture: FrameSchedulerOptions["capture"];
  private readonly intervalMs: number;
  private readonly minGapMs: number;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReason: FrameReason | null = null;
  private lastFrameAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private running = false;
  private paused = false;

  constructor(opts: FrameSchedulerOptions) {
    this.capture = opts.capture;
    this.intervalMs = opts.intervalMs ?? 1000;
    this.minGapMs = opts.minGapMs ?? 500;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (!this.paused) this.startTicking();
  }

  stop() {
    this.running = false;
    this.stopTicking();
    this.clearPending();
  }

  /** Off the record: no frames at all until resume(). */
  pause() {
    this.paused = true;
    this.stopTicking();
    this.clearPending();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.running) this.startTicking();
  }

  /** Ask for an extra frame now (e.g. the MiniERP saved or switched records). */
  request(reason: FrameReason) {
    if (!this.running || this.paused) return;
    if (this.pendingReason === null || reason !== "tick") this.pendingReason = reason;
    this.flush();
  }

  private startTicking() {
    this.request("tick");
    this.tickTimer = setInterval(() => this.request("tick"), this.intervalMs);
  }

  private stopTicking() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private clearPending() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pendingReason = null;
  }

  private flush() {
    if (this.pendingReason === null || this.pendingTimer) return;
    const wait = this.inFlight ? this.minGapMs : this.lastFrameAt + this.minGapMs - Date.now();
    if (wait > 0) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null;
        this.flush();
      }, wait);
      return;
    }
    const reason = this.pendingReason;
    this.pendingReason = null;
    this.inFlight = true;
    this.lastFrameAt = Date.now();
    this.capture(reason)
      .catch(() => {})
      .finally(() => {
        this.inFlight = false;
      });
  }
}
