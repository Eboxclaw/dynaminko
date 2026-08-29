// Local-first store. Everything the user writes lives in localStorage under a
// single versioned document, with a subscription so every hook stays in sync.
// No accounts, no server, no network.

import { keccak_256 } from "@noble/hashes/sha3.js";

export type Sentiment = "conviction" | "reactive" | "hedge" | "fomo" | "rebalance";
export type Emotion = "calm" | "anxious" | "excited" | "uncertain";
export type Alignment = "aligned" | "partial" | "deviated" | "no_thesis";
export type Sizing = "starter" | "full" | "adding" | "oversized";
export type Health = "rested" | "tired" | "stressed" | "unwell";
export type Finances = "comfortable" | "tight" | "leveraged" | "flush";

export type Thesis = {
  id: string;
  title: string;
  body: string;
  symbols: string[];
  sector: string | null;
  horizon: "days" | "weeks" | "months" | "years";
  conviction: number; // 1..5
  status: "open" | "played-out" | "invalidated";
  createdAt: number;
  updatedAt: number;
  /** EIP-191 attestation: signature, timestamp, and hash-chain prev hash.
   * null = not attested. */
  attestation?: {
    sig: string; // 0x-prefixed hex
    address: string; // signing address
    signedAt: number;
    prevHash: string; // previous chain entry hash (or null bytes hex for genesis)
    entryHash: string; // keccak(prevHash + thesisId + POT score)
  };
};

/** Where a signal came from. Plain wallet transfers carry no venue. */
export type SignalVenue = "evm" | "nado" | "hyperliquid";

/** What kind of moment it is. Plain transfers carry no action. */
export type SignalAction = "transfer" | "trade" | "deposit" | "withdraw";

/** Venue-reported detail a card can argue with. All optional, all nullable. */
export type SignalMeta = {
  price?: number | null;
  feeUsd?: number | null;
  pnl?: number | null;
  direction?: "long" | "short";
  /** order annotation: "TP/SL", "trigger ≥ 2,400", "reduce-only", … */
  trigger?: string | null;
  /** venue order reference (Nado order digest) */
  digest?: string;
  /** venue order reference (Hyperliquid order id) */
  oid?: string;
};

/** An agent-extracted on-chain moment waiting for the user to complete it. */
export type Signal = {
  id: string; // txHash:logIndex, nado:{digest} or hl:{oid}
  txHash: string;
  symbol: string;
  side: "in" | "out";
  amount: number;
  value: number | null;
  gasUsd: number | null;
  feeNative: number | null;
  counterparty: string;
  /** absent for non-EVM venues (Nado, Hyperliquid) */
  chainId?: number;
  ts: number;
  extractedAt: number;
  state: "inbox" | "linked";
  venue?: SignalVenue;
  action?: SignalAction;
  meta?: SignalMeta;
};

export type Entry = {
  id: string;
  /** chain event this reconciles, when it came from the wallet */
  tradeId: string | null;
  thesisId: string | null;
  headline: string;
  body: string;
  alignment: Alignment | null;
  sentiment: Sentiment | null;
  sizing: Sizing | null;
  emotion: Emotion | null;
  health: Health | null;
  finances: Finances | null;
  /** an intent written without a trade behind it — a ghost until executed */
  ghost: boolean;
  confidence: number; // 1..5
  createdAt: number;
};

export type Alert = {
  id: string;
  kind: "price" | "onchain" | "thesis-review";
  symbol: string | null;
  /** price alerts */
  direction: "above" | "below";
  target: number | null;
  /** thesis-review alerts */
  thesisId: string | null;
  everyDays: number | null;
  note: string;
  enabled: boolean;
  lastFiredAt: number | null;
  createdAt: number;
};

export type WalletRef = {
  address: string;
  chainId: number;
  label: string;
  kind: "watch" | "connected";
  addedAt: number;
  /** Paused wallets stay listed but are not read and cannot attest.
   * Optional so documents saved before the flag load unchanged. */
  paused?: boolean;
};

/** One line in the agent activity log. Local, append-only, capped. */
export type LogLevel = "info" | "call" | "warn" | "error";
export type LogLine = {
  id: string;
  ts: number;
  agent: string;
  level: LogLevel;
  event: string;
  detail: string;
  ms: number | null;
};

/** One optional cloud endpoint, OpenAI-compatible. Keys stay on this device. */
export type CloudCredential = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

/** The single agent the user is allowed to configure. */
export type AssistantConfig = {
  provider: "local" | "cloud";
  modelId: string;
  skills: string[];
  tools: string[];
  /** which cloud provider is active when provider === "cloud" */
  cloudId?: string;
  /** provider id → credential, local to this browser */
  cloud?: Record<string, CloudCredential>;
};

export type Settings = {
  hideBalances: boolean;
  theme: "light" | "dark";
  aiEnabled: boolean;
  aiModelId: string;
  onboarded: boolean;
  /** tradeIds the user explicitly dismissed from the inbox */
  dismissedTrades: string[];
  /** the user asked for browser notifications on this device */
  notifications: boolean;
  /** automation agents that are switched on */
  automation: Record<string, boolean>;
  /** symbol -> basket, chosen by the user, wins over the registry */
  basketOverrides: Record<string, string>;
  assistant: AssistantConfig;
  /** Venue referral codes and affiliate settings. null venue = not configured. */
  referrals: {
    hyperliquid?: { referralCode: string };
    nado?: { referralCode?: string };
  };
};

export type PotDoc = {
  version: 1;
  theses: Thesis[];
  entries: Entry[];
  /** agent-extracted trade events awaiting the user */
  signals: Signal[];
  alerts: Alert[];
  wallets: WalletRef[];
  activeWallet: string | null; // `${chainId}:${address}`
  logs: LogLine[];
  settings: Settings;
  /** Hash-chained attestation ledger: latest entry hash for each signing
   * address. The thesis attestation carries prevHash linking to the previous
   * entry; an empty string means genesis (no prior attestation). */
  attestationLedger: Record<string, string>;
};

export const EMPTY_DOC: PotDoc = {
  version: 1,
  theses: [],
  entries: [],
  signals: [],
  alerts: [],
  wallets: [],
  activeWallet: null,
  logs: [],
  attestationLedger: {},
  settings: {
    hideBalances: false,
    theme: "light",
    aiEnabled: false,
    aiModelId: "lfm2-350",
    onboarded: false,
    dismissedTrades: [],
    notifications: false,
    automation: {},
    basketOverrides: {},
    referrals: {},
    assistant: {
      provider: "local",
      modelId: "lfm2-350",
      skills: ["tidy", "reason", "review"],
      tools: ["read-portfolio", "read-signals"],
    },
  },
};

/**
 * Doc persistence. Default writes straight to localStorage so the app is
 * durable even when the storage worker is unavailable. useStorage() replaces
 * this with a fire-and-forget worker bridge; setPersistFn(null) restores it.
 * `persist()` ALWAYS calls persistFn — it must not bail out when the worker
 * bridge is installed, or the in-memory doc never reaches disk and every
 * refresh silently reverts to the last-persisted state.
 */

const KEY = "pot.doc.v1";

let doc: PotDoc = EMPTY_DOC;
let loaded = false;
const listeners = new Set<() => void>();

/**
 * Settable persist function. By default it writes directly to localStorage.
 * When the storage worker is active (via useStorage at the app root), this
 * is replaced with a fire-and-forget postMessage to the worker so React
 * never waits on I/O. The worker ack is purely for diagnostics — the
 * in-memory document is the source of truth during the session.
 */
let persistFn: (data: string) => void = (data) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, data);
  } catch {
    /* quota — the UI keeps working from memory */
  }
};

/**
 * Install a custom persist function, typically the storage worker bridge.
 * Pass null to restore the default direct-localStorage path.
 */
export function setPersistFn(fn: ((data: string) => void) | null) {
  persistFn =
    fn ??
    ((data) => {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(KEY, data);
      } catch {
        /* quota — the UI keeps working from memory */
      }
    });
}

function read(): PotDoc {
  if (typeof localStorage === "undefined") return EMPTY_DOC;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_DOC;
    const parsed = JSON.parse(raw) as Partial<PotDoc>;
    return {
      ...EMPTY_DOC,
      ...parsed,
      settings: { ...EMPTY_DOC.settings, ...(parsed.settings ?? {}) },
    } as PotDoc;
  } catch {
    return EMPTY_DOC;
  }
}

function persist() {
  persistFn(JSON.stringify(doc));
}

export function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  doc = read();
}

export function getDoc(): PotDoc {
  return doc;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(mutate: (draft: PotDoc) => PotDoc | void) {
  ensureLoaded();
  const before = JSON.stringify(doc);
  const draft: PotDoc = JSON.parse(before) as PotDoc;
  const next = mutate(draft) ?? draft;
  // No-op mutations must not replace the document: a new object identity would
  // re-trigger every subscriber and can loop effects that write back to the store.
  if (JSON.stringify(next) === before) return;
  doc = next;
  persist();
  listeners.forEach((fn) => fn());
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── operations ─────────────────────────────────────────────────────────────

export function addThesis(input: Partial<Thesis> & { title: string }): Thesis {
  const now = Date.now();
  const thesis: Thesis = {
    id: uid(),
    title: input.title,
    body: input.body ?? "",
    symbols: input.symbols ?? [],
    sector: input.sector ?? null,
    horizon: input.horizon ?? "months",
    conviction: input.conviction ?? 3,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  update((d) => {
    d.theses.unshift(thesis);
  });
  return thesis;
}

export function patchThesis(id: string, patch: Partial<Thesis>) {
  update((d) => {
    const t = d.theses.find((x) => x.id === id);
    if (t) Object.assign(t, patch, { updatedAt: Date.now() });
  });
}

export function removeThesis(id: string) {
  update((d) => {
    d.theses = d.theses.filter((t) => t.id !== id);
    d.entries.forEach((e) => {
      if (e.thesisId === id) e.thesisId = null;
    });
  });
}

function hexDigest(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Canonical message for a thesis attestation. Everything a signature claims
 * about is in here: the full thesis state, the chain link, and the address.
 * It is byte-stable while the thesis is untouched, so commit can re-derive it
 * and refuse a signature made against a stale draft. */
export function attestationMessage(thesis: Thesis, prevHash: string, address: string): string {
  const lines = [
    "Proof of Thesis attestation",
    `thesis: ${thesis.id}`,
    `title: ${thesis.title}`,
    `body: ${thesis.body}`,
    `symbols: ${thesis.symbols.join(",") || "none"}`,
    `status: ${thesis.status}`,
    `conviction: ${thesis.conviction}/5`,
    `prev: ${prevHash || "genesis"}`,
    `signer: ${address.toLowerCase()}`,
  ];
  return lines.join("\n");
}

/** Draft step: what would be signed. Safe for the agent to run (COMPUTE);
 * it touches nothing and cannot sign. */
export function prepareAttestation(
  thesisId: string,
  address: string,
): {
  thesisId: string;
  title: string;
  message: string;
  prevHash: string;
  alreadyAttested: boolean;
} | null {
  const doc = getDoc();
  const t = doc.theses.find((x) => x.id === thesisId);
  if (!t) return null;
  const addr = address.toLowerCase();
  const prevHash = doc.attestationLedger[addr] ?? "";
  return {
    thesisId,
    title: t.title,
    message: attestationMessage(t, prevHash, addr),
    prevHash,
    alreadyAttested: t.attestation != null,
  };
}

/** Commit step: after the user signed in their wallet. Re-derives the
 * message from the thesis as it stands and the ledger as it stands, and
 * refuses the signature if anything drifted (edited thesis, re-attested
 * ledger, wrong signer). This is the only way to set thesis.attestation. */
export function commitAttestation(
  thesisId: string,
  address: string,
  sig: string,
  drafted: { message: string; prevHash: string },
): Thesis | null {
  const doc = getDoc();
  const t = doc.theses.find((x) => x.id === thesisId);
  if (!t || t.attestation) return null;
  const addr = address.toLowerCase();
  const currentPrev = doc.attestationLedger[addr] ?? "";
  // A draft is valid only while the thesis and the ledger are exactly as
  // they were when the user read it and clicked sign.
  if (drafted.prevHash !== currentPrev) return null;
  if (attestationMessage(t, currentPrev, addr) !== drafted.message) return null;
  const entryHash = hexDigest(keccak_256(new TextEncoder().encode(drafted.message)));
  let result: Thesis | null = null;
  update((d) => {
    const now = d.theses.find((x) => x.id === thesisId);
    if (!now) return;
    now.attestation = {
      sig,
      address: addr,
      signedAt: Date.now(),
      prevHash: currentPrev,
      entryHash,
    };
    now.updatedAt = Date.now();
    d.attestationLedger[addr] = entryHash;
    result = { ...now };
  });
  return result;
}

/** Re-verify a stored attestation on-chain: re-derive the canonical message
 * from the thesis as it stands and recover the signer from the stored
 * signature. A mismatch (or a changed thesis) reports invalid — the attested
 * state never claims more than the signature covers. */
export async function verifyAttestation(
  thesisId: string,
): Promise<{ valid: boolean; recovered: string | null; stored: string; entryHash: string } | null> {
  const doc = getDoc();
  const t = doc.theses.find((x) => x.id === thesisId);
  if (!t || !t.attestation) return null;
  const at = t.attestation;
  const prevHash = at.prevHash;
  const message = attestationMessage(t, prevHash, at.address);
  const { recoverSigner } = await import("@/lib/chain/ecrecover");
  const recovered = await recoverSigner(message, at.sig);
  return {
    valid: recovered != null && recovered === at.address.toLowerCase(),
    recovered,
    stored: at.address,
    entryHash: at.entryHash,
  };
}

export function addEntry(input: Partial<Entry>): Entry {
  const entry: Entry = {
    id: uid(),
    tradeId: input.tradeId ?? null,
    thesisId: input.thesisId ?? null,
    headline: input.headline ?? "",
    body: input.body ?? "",
    alignment: input.alignment ?? null,
    sentiment: input.sentiment ?? null,
    sizing: input.sizing ?? null,
    emotion: input.emotion ?? null,
    health: input.health ?? null,
    finances: input.finances ?? null,
    ghost: input.ghost ?? input.tradeId == null,
    confidence: input.confidence ?? 3,
    createdAt: input.createdAt ?? Date.now(),
  };
  update((d) => {
    d.entries.unshift(entry);
    if (entry.tradeId) {
      const sig = d.signals.find((s) => s.id === entry.tradeId);
      if (sig) sig.state = "linked";
    }
  });
  return entry;
}

/** The agent writes here. Existing ids are never overwritten or duplicated. */
export function ingestSignals(incoming: Signal[]) {
  if (incoming.length === 0) return;
  ensureLoaded();
  const known = new Set(doc.signals.map((s) => s.id));
  const linked = new Set(doc.entries.map((e) => e.tradeId).filter(Boolean) as string[]);
  const fresh = incoming
    .filter((s) => !known.has(s.id))
    .map((s) => ({ ...s, state: linked.has(s.id) ? ("linked" as const) : s.state }));
  if (fresh.length === 0) return;
  update((d) => {
    d.signals = [...fresh, ...d.signals].sort((a, b) => b.ts - a.ts).slice(0, 300);
  });
}

export function setSignalState(id: string, state: Signal["state"]) {
  update((d) => {
    const s = d.signals.find((x) => x.id === id);
    if (s) s.state = state;
  });
}

export function removeEntry(id: string) {
  update((d) => {
    d.entries = d.entries.filter((e) => e.id !== id);
  });
}

export function dismissTrade(tradeId: string) {
  update((d) => {
    if (!d.settings.dismissedTrades.includes(tradeId)) d.settings.dismissedTrades.push(tradeId);
  });
}

export function addAlert(input: Partial<Alert>): Alert {
  const alert: Alert = {
    id: uid(),
    kind: input.kind ?? "price",
    symbol: input.symbol ?? null,
    direction: input.direction ?? "above",
    target: input.target ?? null,
    thesisId: input.thesisId ?? null,
    everyDays: input.everyDays ?? null,
    note: input.note ?? "",
    enabled: true,
    lastFiredAt: null,
    createdAt: Date.now(),
  };
  update((d) => {
    d.alerts.unshift(alert);
  });
  return alert;
}

export function patchAlert(id: string, patch: Partial<Alert>) {
  update((d) => {
    const a = d.alerts.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  });
}

export function removeAlert(id: string) {
  update((d) => {
    d.alerts = d.alerts.filter((a) => a.id !== id);
  });
}

export function walletKey(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`;
}

export function addWallet(ref: Omit<WalletRef, "addedAt">) {
  update((d) => {
    const key = walletKey(ref.chainId, ref.address);
    const existing = d.wallets.find((w) => walletKey(w.chainId, w.address) === key);
    if (existing) {
      // Re-connecting or re-watching is explicit intent to use it again.
      existing.paused = false;
    } else {
      d.wallets.unshift({ ...ref, address: ref.address.toLowerCase(), addedAt: Date.now() });
    }
    d.activeWallet = key;
  });
}

export function setActiveWallet(key: string | null) {
  update((d) => {
    d.activeWallet = key;
  });
}

/** Active/deactivate toggle. Pausing keeps the wallet listed but stops all
 * reads and attest for it; unpausing makes it the active wallet again. */
export function setWalletPaused(key: string, paused: boolean) {
  update((d) => {
    const w = d.wallets.find((x) => walletKey(x.chainId, x.address) === key);
    if (!w) return;
    w.paused = paused;
    if (paused) {
      if (d.activeWallet === key) d.activeWallet = null;
    } else {
      d.activeWallet = key;
    }
  });
}

/** The one wallet that may sign (attestations): the resolved active wallet,
 * only when it is a connected wallet and not paused. Everything that signs
 * must go through this instead of trusting the injected provider's selected
 * account. Resolution mirrors useActiveWallet: the explicit active slot,
 * else the first unpaused wallet. */
export function activeConnectedWallet(): WalletRef | null {
  const d = getDoc();
  const resolved = d.activeWallet
    ? d.wallets.find((w) => walletKey(w.chainId, w.address) === d.activeWallet)
    : d.wallets.find((w) => !w.paused);
  if (!resolved || resolved.paused || resolved.kind !== "connected") return null;
  return resolved;
}

export function removeWallet(key: string) {
  update((d) => {
    d.wallets = d.wallets.filter((w) => walletKey(w.chainId, w.address) !== key);
    if (d.activeWallet === key) {
      const next = d.wallets.find((w) => !w.paused);
      d.activeWallet = next ? walletKey(next.chainId, next.address) : null;
    }
  });
}

export function patchSettings(patch: Partial<Settings>) {
  update((d) => {
    Object.assign(d.settings, patch);
  });
}

export function exportDoc(): string {
  ensureLoaded();
  return JSON.stringify(doc, null, 2);
}

export function importDoc(json: string) {
  const parsed = JSON.parse(json) as PotDoc;
  update(() => ({
    ...EMPTY_DOC,
    ...parsed,
    settings: { ...EMPTY_DOC.settings, ...(parsed.settings ?? {}) },
  }));
}

export function wipe() {
  update(() => ({ ...EMPTY_DOC }));
  forgetAllMemory();
}

// ── agent memory ───────────────────────────────────────────────────────────
//
// Hermes-style bounded persistent memory: the agent's own curated notes about
// the user, capped hard at MEMORY_CHAR_LIMIT. A write that would exceed the
// cap fails loudly and lists the current entries — the caller consolidates in
// the same turn, nothing drops silently. Capacity is surfaced in FACTS so the
// model sees how full its memory is before it writes.

export type MemoryEntry = {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};

export const MEMORY_CHAR_LIMIT = 2200;
const MEMORY_KEY = "pot.memory.v1";

function readMemoryRaw(): MemoryEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as MemoryEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Settable memory persist function. Same pattern as `persistFn` for the main
 * document — defaults to direct localStorage, replaced by the storage worker
 * bridge when active.
 */
let memoryPersistFn: (data: string) => void = (data) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MEMORY_KEY, data);
  } catch {
    /* quota — memory stays in memory until space frees */
  }
};

export function setMemoryPersistFn(fn: ((data: string) => void) | null) {
  memoryPersistFn =
    fn ??
    ((data) => {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(MEMORY_KEY, data);
      } catch {
        /* quota — memory stays in memory until space frees */
      }
    });
}

function writeMemoryRaw(entries: MemoryEntry[]) {
  memoryPersistFn(JSON.stringify(entries));
}

export function memoryChars(entries: MemoryEntry[] = readMemoryRaw()): number {
  return entries.reduce((sum, e) => sum + e.text.length, 0);
}

export function readMemory(): MemoryEntry[] {
  return readMemoryRaw();
}

export function memoryStats(entries: MemoryEntry[] = readMemoryRaw()): {
  chars: number;
  limit: number;
  entries: number;
} {
  return { chars: memoryChars(entries), limit: MEMORY_CHAR_LIMIT, entries: entries.length };
}

export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry; stats: ReturnType<typeof memoryStats> }
  | { ok: false; chars: number; limit: number; entries: MemoryEntry[]; overBy: number };

/** The rejection message the model consolidates against: capacity plus the
 * current entries, so the next write can replace or shorten them. */
export function memoryFullMessage(r: Extract<MemoryWriteResult, { ok: false }>): string {
  const list = r.entries.map((e) => `[${e.id}] ${e.text.slice(0, 80)}`).join(" | ");
  return `memory full: ${r.chars}/${r.limit} chars across ${r.entries.length} entries, over by ${r.overBy}. Consolidate first (update or forget an entry): ${list}`;
}

export function addMemory(text: string): MemoryWriteResult {
  const clean = text.trim();
  const entries = readMemoryRaw();
  const chars = memoryChars(entries);
  if (!clean) return { ok: false, chars, limit: MEMORY_CHAR_LIMIT, entries, overBy: 0 };
  if (chars + clean.length > MEMORY_CHAR_LIMIT) {
    return {
      ok: false,
      chars,
      limit: MEMORY_CHAR_LIMIT,
      entries,
      overBy: chars + clean.length - MEMORY_CHAR_LIMIT,
    };
  }
  const entry: MemoryEntry = {
    id: `m${uid().slice(0, 6)}`,
    text: clean,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const next = [...entries, entry];
  writeMemoryRaw(next);
  return { ok: true, entry, stats: memoryStats(next) };
}

export function updateMemory(id: string, text: string): MemoryWriteResult {
  const clean = text.trim();
  const entries = readMemoryRaw();
  const others = entries.filter((e) => e.id !== id);
  const chars = memoryChars(others);
  if (!entries.some((e) => e.id === id)) {
    return { ok: false, chars, limit: MEMORY_CHAR_LIMIT, entries, overBy: 0 };
  }
  if (!clean || chars + clean.length > MEMORY_CHAR_LIMIT) {
    return {
      ok: false,
      chars,
      limit: MEMORY_CHAR_LIMIT,
      entries,
      overBy: Math.max(0, chars + clean.length - MEMORY_CHAR_LIMIT),
    };
  }
  const entry: MemoryEntry = {
    ...(entries.find((e) => e.id === id) as MemoryEntry),
    text: clean,
    updatedAt: Date.now(),
  };
  const next = [...others, entry];
  writeMemoryRaw(next);
  return { ok: true, entry, stats: memoryStats(next) };
}

export function forgetMemory(id: string): boolean {
  const entries = readMemoryRaw();
  if (!entries.some((e) => e.id === id)) return false;
  writeMemoryRaw(entries.filter((e) => e.id !== id));
  return true;
}

export function forgetAllMemory() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(MEMORY_KEY);
}

/** The MEMORY prompt section: one line per entry, ids addressable so the
 * model can update or forget by id. Bounded by the store cap by construction.
 * Auto session summaries are old chat history by another name: injecting them
 * made every new session start with the previous one's context. They stay in
 * the store (readable on demand with /run memory.read); the prompt only
 * carries deliberate, user-relevant notes. */
export function memoryPrompt(entries: MemoryEntry[] = readMemoryRaw()): string {
  const lines = entries.filter((e) => !/^session summary:/i.test(e.text));
  if (!lines.length) return "";
  return lines.map((e) => `[${e.id}] ${e.text}`).join("\n");
}

// ── agent log ──────────────────────────────────────────────────────────────

/** Append one line to the local agent log. Capped so localStorage stays small. */
export function log(
  agent: string,
  event: string,
  opts: { level?: LogLevel; detail?: string; ms?: number } = {},
): void {
  const line: LogLine = {
    id: uid(),
    ts: Date.now(),
    agent,
    level: opts.level ?? "info",
    event,
    detail: opts.detail ?? "",
    ms: opts.ms ?? null,
  };
  update((d) => {
    d.logs = [line, ...(d.logs ?? [])].slice(0, 400);
  });
}

export function clearLogs() {
  update((d) => {
    d.logs = [];
  });
}

export function patchAssistant(patch: Partial<AssistantConfig>) {
  update((d) => {
    d.settings.assistant = { ...d.settings.assistant, ...patch };
  });
}

/** Store or clear one cloud credential. Local only, never leaves the device. */
export function patchCloudCredential(id: string, patch: Partial<CloudCredential> | null) {
  update((d) => {
    const cloud = { ...(d.settings.assistant.cloud ?? {}) };
    if (patch === null) delete cloud[id];
    else cloud[id] = { ...(cloud[id] ?? { apiKey: "" }), ...patch };
    d.settings.assistant = { ...d.settings.assistant, cloud };
  });
}

export function toggleAssistantItem(field: "skills" | "tools", id: string) {
  update((d) => {
    const list = d.settings.assistant[field] ?? [];
    d.settings.assistant = {
      ...d.settings.assistant,
      [field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    };
  });
}

export function setAutomation(id: string, on: boolean) {
  update((d) => {
    d.settings.automation = { ...d.settings.automation, [id]: on };
  });
}

/**
 * Update referral settings for a specific venue. Merges shallowly so setting
 * a Hyperliquid code does not clear any other venue's config. Pass an empty
 * object to clear the venue entry.
 */
export function patchReferralSettings(
  venue: "hyperliquid" | "nado",
  patch: Record<string, string>,
) {
  update((d) => {
    const current = d.settings.referrals[venue] ?? {};
    const next = { ...current, ...patch };
    d.settings.referrals = {
      ...d.settings.referrals,
      [venue]: Object.keys(next).length > 0 ? next : undefined,
    };
  });
}

// ── cached live data accessors (for tools, not React hooks) ─────────────
//
// The wallet-reader worker caches snapshot + venue reports in IndexedDB.
// These accessors let the tool layer read the latest cached data without
// being inside a React hook or spawning a worker. Returns null when no
// cache exists yet (first load) — the tool streams null through, never
// throws. Imports are dynamic because store.ts has no static imports.

const SNAPSHOT_CACHE_PREFIX = "snapshot:";
const VENUES_CACHE_PREFIX = "venues:";

/**
 * Read the most recent wallet snapshot from the IndexedDB cache.
 * Returns null when no cached snapshot exists.
 */
export async function readCachedSnapshot(): Promise<
  import("@/lib/chain/blockscout").WalletSnapshot | null
> {
  const doc = getDoc();
  if (!doc.activeWallet) return null;
  const key = `${SNAPSHOT_CACHE_PREFIX}${doc.activeWallet}`;
  const { idbGet } = await import("@/lib/cache/idb");
  return (await idbGet<import("@/lib/chain/blockscout").WalletSnapshot>(key)) ?? null;
}

/**
 * Read the most recent venue reports from the IndexedDB cache.
 * Returns an empty array when no cached reports exist.
 */
export async function readCachedVenueReports(): Promise<
  import("@/lib/venues/types").VenueReport[]
> {
  const doc = getDoc();
  if (!doc.activeWallet) return [];
  const key = `${VENUES_CACHE_PREFIX}${doc.activeWallet}`;
  const { idbGet } = await import("@/lib/cache/idb");
  return (await idbGet<import("@/lib/venues/types").VenueReport[]>(key)) ?? [];
}
