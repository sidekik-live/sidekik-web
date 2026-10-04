import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameReason } from "./frameCodec";
import { FrameScheduler } from "./frameScheduler";

describe("FrameScheduler", () => {
  let reasons: FrameReason[];
  let scheduler: FrameScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    reasons = [];
    scheduler = new FrameScheduler({
      capture: async (reason) => {
        reasons.push(reason);
      },
    });
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it("takes a frame immediately and then once per second", async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reasons).toEqual(["tick", "tick", "tick", "tick"]);
  });

  it("sends an extra frame right away when the gap allows", async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(600);
    scheduler.request("save");
    await vi.advanceTimersByTimeAsync(0);
    expect(reasons).toEqual(["tick", "save"]);
  });

  it("never sends two frames less than 500 ms apart, and keeps the extra reason", async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(100);
    scheduler.request("blur");
    scheduler.request("save");
    await vi.advanceTimersByTimeAsync(399);
    expect(reasons).toEqual(["tick"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(reasons).toEqual(["tick", "save"]);
  });

  it("sends nothing while paused and takes a fresh frame on resume", async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.pause();
    scheduler.request("nav");
    await vi.advanceTimersByTimeAsync(5000);
    expect(reasons).toEqual(["tick"]);
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(reasons).toEqual(["tick", "tick"]);
  });

  it("doesn't overlap captures when encoding is slow", async () => {
    let resolveCapture: () => void = () => {};
    let calls = 0;
    const slow = new FrameScheduler({
      capture: () => {
        calls += 1;
        return new Promise<void>((r) => (resolveCapture = r));
      },
    });
    slow.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(calls).toBe(1);
    resolveCapture();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toBe(2);
    slow.stop();
  });
});
