// Tydro reader: pure-logic tests for the hand-rolled ABI decode and the
// pinned RPC selectors. The live RPC path is exercised separately (mainnet
// probe); these tests keep the decode and selectors from silently drifting.

import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { decodeReserves, readTydro } from "@/lib/venues/tydro";

const word = (v: string | number) => (typeof v === "number" ? v.toString(16) : v).padStart(64, "0");
const addrWord = (a: string) =>
  "000000000000000000000000" + a.toLowerCase().replace(/^0x/, "").padStart(40, "0");
/** String bytes are left-aligned within their padded word (ABI), unlike an
 * address which is right-aligned. */
const dataWord = (hexBytes: string) => hexBytes.padEnd(64, "0");

/** Build a getAllReservesTokens() payload: (string, address)[] with two rows. */
function twoReserves(): string {
  const words = [
    word(0x20), // offset to array
    word(2), // count
    word(0x40), // element 0 offset
    word(0xc0), // element 1 offset
    word(0x40), // (string offset, not read by the decoder)
    addrWord("0x0000000000000000000000000000000000000001"), // address 0
    word(4), // "WETH" length
    dataWord("57455448"), // "WETH"
    word(0x40),
    addrWord("0x0000000000000000000000000000000000000002"), // address 1
    word(4), // "USDC" length
    dataWord("55534443"), // "USDC"
  ];
  return "0x" + words.join("");
}

describe("decodeReserves", () => {
  it("decodes a two-reserve (string, address) array", () => {
    const out = decodeReserves(twoReserves());
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ asset: "0x0000000000000000000000000000000000000001", symbol: "WETH" });
    expect(out[1]).toEqual({ asset: "0x0000000000000000000000000000000000000002", symbol: "USDC" });
  });

  it("returns an empty array for a malformed payload", () => {
    expect(decodeReserves("0x")).toEqual([]);
    expect(decodeReserves("0x1234")).toEqual([]);
  });
});

describe("Tydro selectors are pinned to their signatures", () => {
  const sel = (sig: string) =>
    "0x" +
    Buffer.from(keccak_256(Buffer.from(sig)))
      .subarray(0, 4)
      .toString("hex");
  it("matches the constants the reader uses", () => {
    expect(sel("getAllReservesTokens()")).toBe("0xb316ff89");
    expect(sel("getReserveTokensAddresses(address)")).toBe("0xd2493b6c");
    expect(sel("balanceOf(address)")).toBe("0x70a08231");
    expect(sel("POOL()")).toBe("0x7535d246");
    expect(sel("getUserAccountData(address)")).toBe("0xbf92857c");
  });
});

describe("readTydro chain guard", () => {
  it("returns pending on a non-Ink chain without touching RPC", async () => {
    const report = await readTydro("0x0000000000000000000000000000000000000001", 1);
    expect(report.status).toBe("pending");
    expect(report.positions).toEqual([]);
  });
});
