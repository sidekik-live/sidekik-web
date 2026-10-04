// Wire format for the perception frames WebSocket (`/ws/frames/:sid`).
// One binary message per frame:
//   [uint32 big-endian: header byte length][UTF-8 JSON header][JPEG bytes]
// perception must decode exactly this; meetbot sends the same format to `/internal/frames/:sid`.

export type FrameReason = "tick" | "blur" | "save" | "nav";

export interface FrameHeader {
  t_ms: number;
  reason: FrameReason;
}

export function encodeFrame(header: FrameHeader, jpeg: ArrayBuffer): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + json.byteLength + jpeg.byteLength);
  new DataView(out.buffer).setUint32(0, json.byteLength, false);
  out.set(json, 4);
  out.set(new Uint8Array(jpeg), 4 + json.byteLength);
  return out.buffer;
}

export function decodeFrame(buf: ArrayBuffer): { header: FrameHeader; jpeg: Uint8Array } {
  const headerLen = new DataView(buf).getUint32(0, false);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 4, headerLen)),
  ) as FrameHeader;
  return { header, jpeg: new Uint8Array(buf, 4 + headerLen) };
}
