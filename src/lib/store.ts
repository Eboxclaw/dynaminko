// Local-first store. Everything the user writes lives in localStorage under a
// single versioned document, with a subscription so every hook stays in sync.
// No accounts, no server, no network.

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
};

/** An agent-extracted on-chain moment waiting for the user to complete it. */
export type Signal = {
  id: string; // txHash:logIndex
  txHash: string;
  symbol: string;
  side: "in" | "out";
  amount: number;
  value: number | null;
  gasUsd: number | null;
  feeNative: number | null;
  counterparty: string;
  chainId: number;
  ts: number;
  extractedAt: number;
  state: "inbox" | "linked";
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
  settings: {
    hideBalances: false,
    theme: "light",
    aiEnabled: false,
    aiModelId: "lfm2-450-vl",
    onboarded: false,
    dismissedTrades: [],
    notifications: false,
    automation: {},
    basketOverrides: {},
    assistant: {
      provider: "local",
      modelId: "lfm2-450-vl",
      skills: ["tidy", "reason", "review"],
      tools: ["read-portfolio", "read-signals"],
    },
  },
};


const KEY = "pot.doc.v1";

let doc: PotDoc = EMPTY_DOC;
let loaded = false;
const listeners = new Set<() => void>();

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
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch {
    /* quota — the UI keeps working from memory */
  }
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
    if (!d.settings.dismissedTrades.includes(tradeId))
      d.settings.dismissedTrades.push(tradeId);
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
    if (!d.wallets.some((w) => walletKey(w.chainId, w.address) === key)) {
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

export function removeWallet(key: string) {
  update((d) => {
    d.wallets = d.wallets.filter((w) => walletKey(w.chainId, w.address) !== key);
    if (d.activeWallet === key)
      d.activeWallet = d.wallets[0]
        ? walletKey(d.wallets[0].chainId, d.wallets[0].address)
        : null;
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
