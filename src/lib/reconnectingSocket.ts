export type SocketStatus = "connecting" | "open" | "closed";

export interface ReconnectingSocketOptions {
  /** Built on every (re)connect so a refreshed token is picked up. */
  url: () => string;
  binaryType?: BinaryType;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** send() drops data instead of queueing once this much is still buffered. */
  maxBufferedBytes?: number;
  onStatus?: (status: SocketStatus) => void;
  onMessage?: (ev: MessageEvent) => void;
  /** Injected in tests. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * WebSocket that reconnects with exponential backoff (0.5 s → 8 s, DESIGN §4).
 * send() never queues: if the socket isn't open or is backed up, the data is dropped
 * and send() returns false. Callers send fresh data next time instead of stale data.
 */
export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private closedByUs = false;
  private readonly opts: Required<Omit<ReconnectingSocketOptions, "onStatus" | "onMessage">> &
    Pick<ReconnectingSocketOptions, "onStatus" | "onMessage">;

  constructor(opts: ReconnectingSocketOptions) {
    this.opts = {
      binaryType: "arraybuffer",
      minDelayMs: 500,
      maxDelayMs: 8000,
      maxBufferedBytes: 4 * 1024 * 1024,
      WebSocketImpl: WebSocket,
      ...opts,
    };
  }

  get status(): SocketStatus {
    if (this.ws?.readyState === 1) return "open";
    return this.closedByUs ? "closed" : "connecting";
  }

  connect() {
    this.closedByUs = false;
    this.open();
  }

  send(data: ArrayBuffer | string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1 || ws.bufferedAmount > this.opts.maxBufferedBytes) return false;
    ws.send(data);
    return true;
  }

  close() {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.opts.onStatus?.("closed");
  }

  private open() {
    this.opts.onStatus?.("connecting");
    const ws = new this.opts.WebSocketImpl(this.opts.url());
    ws.binaryType = this.opts.binaryType;
    ws.onopen = () => {
      this.attempt = 0;
      this.opts.onStatus?.("open");
    };
    ws.onmessage = (ev) => this.opts.onMessage?.(ev);
    ws.onclose = () => {
      if (this.ws !== ws || this.closedByUs) return;
      this.ws = null;
      this.scheduleReconnect();
    };
    this.ws = ws;
  }

  private scheduleReconnect() {
    this.opts.onStatus?.("connecting");
    const delay = Math.min(this.opts.maxDelayMs, this.opts.minDelayMs * 2 ** this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closedByUs) this.open();
    }, delay);
  }
}
