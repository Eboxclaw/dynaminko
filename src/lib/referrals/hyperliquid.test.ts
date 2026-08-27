// Hyperliquid referral adapter: the phantom-agent signing path must match the
// official Python SDK byte-for-byte. The msgpack encoder is asserted against
// hand-derived msgpack-spec bytes; the action hash is asserted against an
// independently assembled preimage, so an encoder regression cannot silently
// produce a signature Hyperliquid would reject.

import { describe, expect, it, vi } from "vitest";

import { keccak_256 } from "@noble/hashes/sha3.js";

import { l1ActionHash, msgpackPack } from "./hyperliquid";
import { getNadoReferralBinding } from "./nado";

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("msgpackPack", () => {
  it("packs the setReferrer action exactly per the msgpack spec", () => {
    // fixmap(2) | fixstr "type" | fixstr(11) "setReferrer"
    //          | fixstr "code" | fixstr(12) "OFFICIALINKO"
    const expected =
      "82" +
      "a4" +
      "74797065" +
      "ab" +
      "7365745265666572726572" +
      "a4" +
      "636f6465" +
      "ac" +
      "4f4646494349414c494e4b4f";
    expect(hex(msgpackPack({ type: "setReferrer", code: "OFFICIALINKO" }))).toBe(expected);
  });

  it("packs map keys in insertion order, so key order changes the bytes", () => {
    const a = msgpackPack({ type: "setReferrer", code: "X" });
    const b = msgpackPack({ code: "X", type: "setReferrer" });
    expect(hex(a)).not.toBe(hex(b));
  });

  it("encodes integers across the msgpack positive-int widths", () => {
    expect(hex(msgpackPack(0))).toBe("00");
    expect(hex(msgpackPack(127))).toBe("7f");
    expect(hex(msgpackPack(128))).toBe("cc80");
    expect(hex(msgpackPack(255))).toBe("ccff");
    expect(hex(msgpackPack(256))).toBe("cd0100");
    expect(hex(msgpackPack(65535))).toBe("cdffff");
    expect(hex(msgpackPack(65536))).toBe("ce00010000");
  });

  it("encodes booleans, null, and long strings with the str8 marker", () => {
    expect(hex(msgpackPack(true))).toBe("c3");
    expect(hex(msgpackPack(false))).toBe("c2");
    expect(hex(msgpackPack(null))).toBe("c0");
    const s40 = "A".repeat(40);
    expect(hex(msgpackPack(s40))).toBe("d928" + "41".repeat(40));
  });

  it("encodes nested maps and arrays", () => {
    // fixmap(1){ fixstr "a" -> fixarray(2)[ 1, fixstr "b" ] }
    expect(hex(msgpackPack({ a: [1, "b"] }))).toBe("81a1619201a162");
  });
});

describe("l1ActionHash", () => {
  const action = { type: "setReferrer", code: "OFFICIALINKO" };

  it("keccak256(msgpack(action) + nonce_be8 + 0x00), matching an independent assembly", () => {
    const nonce = 1_756_086_400_000;
    const viaHelper = l1ActionHash(action, nonce, null);

    const packed = msgpackPack(action);
    const preimage = new Uint8Array(packed.length + 9);
    preimage.set(packed, 0);
    const dv = new DataView(preimage.buffer);
    dv.setBigUint64(packed.length, BigInt(nonce), false);
    preimage[packed.length + 8] = 0x00;
    const independent = keccak_256(preimage);

    expect(hex(viaHelper)).toBe(hex(independent));
    expect(viaHelper).toHaveLength(32);
  });

  it("produces a different hash per nonce and per vault flag", () => {
    const h1 = hex(l1ActionHash(action, 1000, null));
    const h2 = hex(l1ActionHash(action, 1001, null));
    const hVault = hex(l1ActionHash(action, 1000, "0x1111111111111111111111111111111111111111"));
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(hVault);
  });

  it("is deterministic for the same action and nonce", () => {
    expect(hex(l1ActionHash(action, 42, null))).toBe(hex(l1ActionHash(action, 42, null)));
  });
});

describe("getNadoReferralBinding", () => {
  it("queries the Archive indexer with the SDK envelope and packed subaccount", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return { ok: true, json: async () => ({ referral_code: "SOMECODE" }) } as Response;
    });

    const binding = await getNadoReferralBinding("0xabc123");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://archive.prod.nado.xyz/v1");
    expect(calls[0]!.body).toEqual({ referral_code: { subaccount: "0xabc123" } });
    expect(binding).toEqual({ bound: true, code: "SOMECODE" });
  });

  it("treats a null referral_code as unbound", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ referral_code: null }),
    } as Response);
    expect(await getNadoReferralBinding("0xabc123")).toEqual({ bound: false, code: null });
  });
});
