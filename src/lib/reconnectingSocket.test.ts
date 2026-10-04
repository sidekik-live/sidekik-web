import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReconnectingSocket } from "./reconnectingSocket";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  serverOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverDrop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("ReconnectingSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  const make = (token = { v: "tok1" }) =>
    new ReconnectingSocket({
      url: () => `ws://ingest/ws/frames/s1?t=${token.v}`,
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });

  it("drops data instead of queueing while not open", () => {
    const s = make();
    s.connect();
    expect(s.send("frame")).toBe(false);
    FakeWebSocket.instances[0]!.serverOpen();
    expect(s.send("frame")).toBe(true);
    expect(FakeWebSocket.instances[0]!.sent).toEqual(["frame"]);
  });

  it("drops data when the socket is backed up", () => {
    const s = make();
    s.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.serverOpen();
    ws.bufferedAmount = 5 * 1024 * 1024;
    expect(s.send("frame")).toBe(false);
  });

  it("reconnects with exponential backoff capped at 8 s, using a fresh URL", async () => {
    const token = { v: "tok1" };
    const s = make(token);
    s.connect();
    const delays = [500, 1000, 2000, 4000, 8000, 8000];
    for (const delay of delays) {
      FakeWebSocket.instances.at(-1)!.serverDrop();
      const before = FakeWebSocket.instances.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(FakeWebSocket.instances.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
    }
    token.v = "tok2";
    FakeWebSocket.instances.at(-1)!.serverDrop();
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeWebSocket.instances.at(-1)!.url).toContain("t=tok2");
    s.close();
  });

  it("resets the backoff after a successful open", async () => {
    const s = make();
    s.connect();
    FakeWebSocket.instances[0]!.serverDrop();
    await vi.advanceTimersByTimeAsync(500);
    FakeWebSocket.instances[1]!.serverDrop();
    await vi.advanceTimersByTimeAsync(1000);
    FakeWebSocket.instances[2]!.serverOpen();
    FakeWebSocket.instances[2]!.serverDrop();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances.length).toBe(4);
    s.close();
  });

  it("stops reconnecting after close()", async () => {
    const s = make();
    s.connect();
    FakeWebSocket.instances[0]!.serverOpen();
    s.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});
