// Trade proposals: the agent may READ venues, SEE state, and PROPOSE an
// order. It can never execute one: proposals carry executable:false and no
// code path in this module signs, sends, or touches a wallet. Execution
// testing arrives with a dedicated user-provided wallet and its own
// explicitly-wired path (S9).

export type TradeVenue = "hyperliquid" | "nado";
export type TradeSide = "long" | "short";

export type TradeProposal = {
  venue: TradeVenue;
  symbol: string;
  side: TradeSide;
  size: number;
  /** null = market order; otherwise the proposed limit price */
  price: number | null;
  /** latest known mark from the venue cache, when available */
  currentMark: number | null;
  rationale: string;
  /** Always false by construction: a proposal is paper until a human
   *  explicitly wires and approves an execution path (S9). */
  executable: false;
  proposedAt: string;
};

export type ProposalProblem = string | null;

const VENUES: TradeVenue[] = ["hyperliquid", "nado"];

export function normalizeSide(raw: unknown): TradeSide | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "buy" || s === "long") return "long";
  if (s === "sell" || s === "short") return "short";
  return null;
}

/**
 * Validate and normalize a model-composed order proposal. Unknown venue,
 * junk size, or an unusable side returns a human-readable problem instead
 * of a proposal, so the model can retry with a better pick.
 */
export function normalizeTradeProposal(input: {
  venue?: unknown;
  symbol?: unknown;
  side?: unknown;
  size?: unknown;
  price?: unknown;
  rationale?: unknown;
}): { proposal: TradeProposal } | { problem: ProposalProblem } {
  if (typeof input.venue !== "string" || !VENUES.includes(input.venue as TradeVenue))
    return { problem: `venue must be one of ${VENUES.join(" or ")}` };
  const symbol = typeof input.symbol === "string" ? input.symbol.trim().toUpperCase() : "";
  if (!symbol) return { problem: "symbol is required" };
  const side = normalizeSide(input.side);
  if (!side) return { problem: `side must be long or short (got ${JSON.stringify(input.side) ?? "nothing"})` };
  const size = typeof input.size === "number" ? input.size : Number(input.size);
  if (!Number.isFinite(size) || size <= 0)
    return { problem: `size must be a positive number (got ${JSON.stringify(input.size) ?? "nothing"})` };
  let price: number | null = null;
  if (input.price != null) {
    const p = typeof input.price === "number" ? input.price : Number(input.price);
    if (!Number.isFinite(p) || p <= 0)
      return { problem: `price must be a positive number or omitted for market (got ${JSON.stringify(input.price)})` };
    price = p;
  }
  const rationale = typeof input.rationale === "string" ? input.rationale.trim().slice(0, 400) : "";
  return {
    proposal: {
      venue: input.venue as TradeVenue,
      symbol,
      side,
      size,
      price,
      currentMark: null,
      rationale,
      executable: false,
      proposedAt: new Date().toISOString(),
    },
  };
}
