// The agent side of the app. It reads the chain feed and extracts the exact
// fields a journal entry needs, then files each one as an inbox signal.
// It never writes narrative — that is the user's half of the loop.

import type { Trade } from "@/lib/portfolio";
import type { Signal } from "@/lib/store";

export type ExtractInput = {
  trades: Trade[];
  chainId: number;
  /** native token price, used to price gas when the explorer reports it */
  nativeUsd?: number | null;
};

/** Deterministic field extraction: tx id, asset, amount, time, cost.
 * Transfers are grouped by transaction first: two legs moving different
 * tokens in one tx is a swap (one signal, the sold side carrying the pair),
 * a lone out-transfer is a send, a lone in-transfer is a receive. Airdrop
 * and incentive claims arrive as receives until the capped explorer pass
 * (labelClaimSignals) confirms the tx method. */
export function extractSignals({ trades, chainId }: ExtractInput): Signal[] {
  const now = Date.now();
  const byTx = new Map<string, Trade[]>();
  for (const t of trades) {
    const legs = byTx.get(t.txHash) ?? [];
    legs.push(t);
    byTx.set(t.txHash, legs);
  }
  const out: Signal[] = [];
  for (const legs of byTx.values()) {
    const ins = legs.filter((l) => l.side === "in");
    const outs = legs.filter((l) => l.side === "out");
    // A swap needs an actual token CHANGE: same-symbol in+out legs are wraps
    // or self-moves and stay send/receive.
    const swap = ins.some((i) => outs.some((o) => o.symbol !== i.symbol));
    for (const leg of legs) {
      // A swap is ONE journal moment (the sold side names the pair); emitting
      // both legs would put the same decision in the inbox twice.
      if (swap && leg.side === "in") continue;
      const crossLeg = swap
        ? leg.side === "out"
          ? ins.find((i) => i.symbol !== leg.symbol)
          : outs.find((o) => o.symbol !== leg.symbol)
        : undefined;
      const action: Signal["action"] = swap
        ? "swap"
        : leg.side === "in"
          ? "receive"
          : "send";
      out.push({
        id: leg.id,
        txHash: leg.txHash,
        symbol: leg.symbol,
        side: leg.side,
        amount: leg.amount,
        value: leg.value,
        gasUsd: null,
        feeNative: null,
        counterparty: leg.counterparty,
        chainId,
        ts: leg.ts,
        extractedAt: now,
        state: "inbox" as const,
        action,
        meta: crossLeg
          ? {
              pair: leg.side === "out" ? `for ${crossLeg.symbol}` : `from ${crossLeg.symbol}`,
            }
          : undefined,
      });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/**
 * Best-effort claim labeling: for the newest receive-shaped signals without
 * an action beyond receive, ask the explorer what the tx method was. Capped
 * per run so a big inbox cannot turn into a request storm. Returns patches
 * for the store to merge.
 */
export async function labelClaimSignals(
  signals: Signal[],
  explorerApi: string,
  cap = 6,
): Promise<{ id: string; action: Signal["action"] }[]> {
  const candidates = signals
    .filter((s) => s.chainId != null && s.side === "in" && (!s.action || s.action === "receive"))
    .slice(0, cap);
  const patches: { id: string; action: Signal["action"] }[] = [];
  for (const s of candidates) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${explorerApi}/transactions/${s.txHash}`, {
        headers: { accept: "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const tx = (await res.json()) as { method?: string | null };
      const method = (tx.method ?? "").toLowerCase();
      if (method.includes("claim") || method.includes("airdrop"))
        patches.push({ id: s.id, action: "claim" });
    } catch {
      /* one failed lookup must not stop the pass */
    }
  }
  return patches;
}

function venueLabel(s: Signal): string {
  if (s.venue === "hyperliquid") return "Hyperliquid";
  if (s.venue === "nado") return "Nado";
  return "Ink";
}

function priceLabel(price: number): string {
  const digits = price >= 1000 ? 2 : 6;
  return price.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** One-line summary the inbox card shows before the user opens it. */
export function describeSignal(s: Signal): string {
  const amount =
    s.amount < 0.001
      ? s.amount.toExponential(2)
      : s.amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (s.action === "deposit") return `Deposited ${amount} ${s.symbol} · ${venueLabel(s)}`;
  if (s.action === "withdraw") return `Withdrew ${amount} ${s.symbol} · ${venueLabel(s)}`;
  if (s.action === "swap") {
    const verb = s.side === "in" ? "Received" : "Swapped";
    return `${verb} ${amount} ${s.symbol}${s.meta?.pair ? ` ${s.meta.pair}` : ""} · ${venueLabel(s)}`;
  }
  if (s.action === "claim") return `Claimed ${amount} ${s.symbol} · ${venueLabel(s)}`;
  if (s.action === "send") return `Sent ${amount} ${s.symbol} · ${venueLabel(s)}`;
  if (s.action === "receive") return `Received ${amount} ${s.symbol} · ${venueLabel(s)}`;
  if (s.action === "trade") {
    const verb = s.side === "in" ? "Bought" : "Sold";
    const price = s.meta?.price != null ? ` @ ${priceLabel(s.meta.price)}` : "";
    const trigger = s.meta?.trigger ? ` · ${s.meta.trigger}` : "";
    return `${verb} ${amount} ${s.symbol}${price} · ${venueLabel(s)}${trigger}`;
  }
  const verb = s.side === "in" ? "Received" : "Sent";
  return `${verb} ${amount} ${s.symbol}`;
}

/** Naive symbol match so the agent can pre-suggest a thesis to link. */
export function suggestThesis<T extends { id: string; symbols: string[]; title: string }>(
  signal: Signal,
  theses: T[],
): T | null {
  const sym = signal.symbol.toUpperCase();
  return (
    theses.find((t) => t.symbols.some((s) => s.toUpperCase() === sym)) ??
    theses.find((t) => t.title.toUpperCase().includes(sym)) ??
    null
  );
}
