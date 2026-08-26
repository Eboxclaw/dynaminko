// Attestation ledger: draft/commit chain, stale-draft rejection, and
// on-chain verification (with recoverSigner mocked to stay deterministic).

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addThesis,
  attestationMessage,
  commitAttestation,
  getDoc,
  patchThesis,
  prepareAttestation,
  verifyAttestation,
  wipe,
} from "@/lib/store";

const ALICE = "0x000000000000000000000000000000000000a11c";
const BOB = "0x000000000000000000000000000000000000b0b";

// Deterministic on-chain recovery: stand in for the precompile call.
const recovered = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("@/lib/chain/ecrecover", () => ({
  eip191Hash: (m: string) => `0xhash(${m.length})`,
  recoverSigner: vi.fn(async () => recovered.value),
}));

function thesis(id: string) {
  return getDoc().theses.find((t) => t.id === id)!;
}

beforeEach(() => {
  recovered.value = null;
  vi.clearAllMocks();
  wipe();
});

describe("prepareAttestation", () => {
  it("returns the canonical claim and the ledger link for a fresh thesis", () => {
    const t = addThesis({ title: "BTC to 150k", body: "accumulate on dips" });
    const draft = prepareAttestation(t.id, ALICE);
    expect(draft).not.toBeNull();
    expect(draft!.prevHash).toBe("");
    expect(draft!.alreadyAttested).toBe(false);
    // The claim names the signer in lowercase and includes the thesis state.
    expect(draft!.message).toContain(`signer: ${ALICE.toLowerCase()}`);
    expect(draft!.message).toContain("BTC to 150k");
    expect(draft!.message).toContain("accumulate on dips");
  });

  it("continues the chain per signer address", () => {
    const t = addThesis({ title: "first" });
    const d1 = prepareAttestation(t.id, ALICE)!;
    commitAttestation(t.id, ALICE, "0xdeadbeef", {
      message: d1.message,
      prevHash: d1.prevHash,
    });
    const t2 = addThesis({ title: "second" });
    const d2 = prepareAttestation(t2.id, ALICE);
    // The second entry links to the first entry's hash, not genesis.
    expect(d2!.prevHash).not.toBe("");
    expect(d2!.message).toContain(d2!.prevHash);
  });

  it("returns null for an unknown thesis", () => {
    expect(prepareAttestation("nope", ALICE)).toBeNull();
  });
});

describe("commitAttestation", () => {
  it("stores the signature and advances the ledger", () => {
    const t = addThesis({ title: "x" });
    const draft = prepareAttestation(t.id, ALICE)!;
    const saved = commitAttestation(t.id, ALICE, "0xdeadbeef", {
      message: draft.message,
      prevHash: draft.prevHash,
    });
    expect(saved).not.toBeNull();
    expect(saved!.attestation?.address).toBe(ALICE.toLowerCase());
    expect(saved!.attestation?.sig).toBe("0xdeadbeef");
    expect(saved!.attestation!.entryHash).toMatch(/^0x[0-9a-f]{64}$/);
    // The ledger now records the entry hash for this signer.
    expect(getDoc().attestationLedger[ALICE.toLowerCase()]).toBe(
      saved!.attestation!.entryHash,
    );
  });

  it("rejects a stale draft (thesis edited between draft and sign)", () => {
    const t = addThesis({ title: "v1" });
    const draft = prepareAttestation(t.id, ALICE)!;
    patchThesis(t.id, { body: "changed after draft" });
    const saved = commitAttestation(t.id, ALICE, "0xdeadbeef", {
      message: draft.message,
      prevHash: draft.prevHash,
    });
    expect(saved).toBeNull();
    expect(thesis(t.id).attestation).toBeUndefined();
  });

  it("rejects a second attestation on the same thesis", () => {
    const t = addThesis({ title: "once" });
    const d1 = prepareAttestation(t.id, ALICE)!;
    commitAttestation(t.id, ALICE, "0xsig1", {
      message: d1.message,
      prevHash: d1.prevHash,
    });
    const saved = commitAttestation(t.id, ALICE, "0xsig2", {
      message: d1.message,
      prevHash: d1.prevHash,
    });
    expect(saved).toBeNull();
  });

  it("refuses to commit when the ledger moved under the draft", () => {
    const t1 = addThesis({ title: "a" });
    const d1 = prepareAttestation(t1.id, ALICE)!;
    const t2 = addThesis({ title: "b" });
    const d2 = prepareAttestation(t2.id, ALICE)!;
    // Sign thesis b first, which advances alice's ledger link.
    commitAttestation(t2.id, ALICE, "0xforB", {
      message: d2.message,
      prevHash: d2.prevHash,
    });
    // The earlier draft for thesis a is now stale: its prevHash no longer
    // matches the ledger.
    const saved = commitAttestation(t1.id, ALICE, "0xforA", {
      message: d1.message,
      prevHash: d1.prevHash,
    });
    expect(saved).toBeNull();
  });
});

describe("verifyAttestation", () => {
  it("reports valid when the recovered signer matches the stored one", async () => {
    const t = addThesis({ title: "v" });
    const d = prepareAttestation(t.id, ALICE)!;
    commitAttestation(t.id, ALICE, "0xsig", {
      message: d.message,
      prevHash: d.prevHash,
    });
    recovered.value = ALICE.toLowerCase();
    const out = await verifyAttestation(t.id);
    expect(out?.valid).toBe(true);
    expect(out?.recovered).toBe(ALICE.toLowerCase());
  });

  it("reports invalid when the signature recovers a different address", async () => {
    const t = addThesis({ title: "v" });
    const d = prepareAttestation(t.id, ALICE)!;
    commitAttestation(t.id, ALICE, "0xsig", {
      message: d.message,
      prevHash: d.prevHash,
    });
    recovered.value = BOB.toLowerCase();
    const out = await verifyAttestation(t.id);
    expect(out?.valid).toBe(false);
  });

  it("reports null when nothing is stored", async () => {
    addThesis({ title: "unsigned" });
    expect(await verifyAttestation("missing")).toBeNull();
  });

  it("detects a post-signature edit by re-deriving the claim", async () => {
    const t = addThesis({ title: "stable" });
    const d = prepareAttestation(t.id, ALICE)!;
    commitAttestation(t.id, ALICE, "0xsig", {
      message: d.message,
      prevHash: d.prevHash,
    });
    patchThesis(t.id, { body: "tampered after signing" });
    // The re-derived claim no longer equals the signed claim: a real
    // on-chain recovery of the new message would not match the stored sig.
    const rederived = attestationMessage(thesis(t.id), d.prevHash, ALICE.toLowerCase());
    expect(rederived).not.toBe(d.message);
  });
});
