import { describe, expect, it } from "vitest";
import { decodeFrame, encodeFrame } from "./frameCodec";

describe("frameCodec", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]).buffer;

  it("round-trips header and JPEG bytes", () => {
    const { header, jpeg: out } = decodeFrame(encodeFrame({ t_ms: 192_345, reason: "save" }, jpeg));
    expect(header).toEqual({ t_ms: 192_345, reason: "save" });
    expect(Array.from(out)).toEqual(Array.from(new Uint8Array(jpeg)));
  });

  it("prefixes a big-endian uint32 header length followed by UTF-8 JSON", () => {
    const buf = new Uint8Array(encodeFrame({ t_ms: 0, reason: "tick" }, jpeg));
    const json = '{"t_ms":0,"reason":"tick"}';
    expect(Array.from(buf.slice(0, 4))).toEqual([0, 0, 0, json.length]);
    expect(new TextDecoder().decode(buf.slice(4, 4 + json.length))).toBe(json);
    expect(Array.from(buf.slice(4 + json.length, 4 + json.length + 2))).toEqual([0xff, 0xd8]);
  });
});
