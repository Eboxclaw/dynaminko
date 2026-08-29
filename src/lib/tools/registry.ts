// The single source of truth for what the app can do deterministically.
// The Agents tab renders this; skills execute against it.

import {
  addAlert,
  patchAlert,
  removeAlert,
  getDoc,
  readCachedSnapshot,
  readCachedVenueReports,
  activeConnectedWallet,
  prepareAttestation,
  commitAttestation,
} from "@/lib/store";
import { request as requestNotifications } from "@/lib/notify";
import { buildPortfolio } from "@/lib/portfolio";
import { readLedgerTrades } from "@/lib/ledger";
import { composeNetWorth, openPerps } from "@/lib/exposure";
import { readVelodrome } from "@/lib/venues/velodrome";
import { readNado } from "@/lib/venues/nado";
import { readTydro } from "@/lib/venues/tydro";
import { currentAccounts, personalSign } from "@/lib/chain/injected";
import { verifyAttestation } from "@/lib/store";
import { track } from "@/lib/stats/client";
import { readOffloaded } from "@/lib/agent/offload";

import * as ind from "./indicators";
import * as journal from "./journal";
import { webSearch, webRead } from "./web";
import type { ToolDef } from "./types";

function def<I, O>(t: ToolDef<I, O>): ToolDef {
  return t as unknown as ToolDef;
}

export const TOOLS: ToolDef[] = [
  // ── web ──────────────────────────────────────────────────────────────
  def({
    id: "web.search",
    group: "web",
    action: "search",
    label: "Search the web",
    purpose:
      "Live web search for news and external facts: DuckDuckGo first, Jina, Tavily (keyed) and Wikipedia as fallbacks, rows reranked locally.",
    access: "READ",
    inputs: "{ query: string, limit?: number }",
    output: "{ query, source, results[{title,url,snippet}] }",
    live: true,
    // Server-proxied lite results with a CORS-enabled Instant Answer
    // fallback; bounded to a handful of rows so it enters observations like
    // any other tool result.
    run: (i: { query: string; limit?: number }) => webSearch(i.query, i.limit),
  }),
  def({
    id: "web.read",
    group: "web",
    action: "read",
    label: "Read a web page",
    purpose:
      "Fetch one web page and extract a bounded digest: title, description, heading outline, lead paragraphs, outbound link domains and image inventory. Use after web.search to learn what a page says and how the site is structured.",
    access: "READ",
    inputs: "{ url: string }",
    output:
      "{ url, title, description, outline[], paragraphs[], linkDomains[], images[{alt,url}], source }",
    live: true,
    // Proxy extraction first, r.jina.ai reader fallback. The digest is what
    // enters observations; the page itself never does.
    run: (i: { url: string }) => webRead(i.url),
  }),
  // ── journal ───────────────────────────────────────────────────────────
  def({
    id: "journal.index",
    group: "journal",
    action: "index",
    label: "Index journal",
    purpose: "Journal overview counts; use journal.search to fetch actual cards.",
    access: "COMPUTE",
    inputs: "none",
    output: "{ cards, tickers, motives, theses, topTickers, preview[], builtAt }",
    live: true,
    // Bounded digest, never the full card set: an unbounded index is the one
    // result guaranteed to blow the context window. Counts and a short preview
    // answer "how much of what"; journal.search fetches the rows themselves.
    run: () => {
      const index = journal.buildIndex();
      const byTicker = new Map<string, number>();
      for (const c of index.cards) {
        if (c.ticker) byTicker.set(c.ticker, (byTicker.get(c.ticker) ?? 0) + 1);
      }
      return {
        cards: index.cards.length,
        tickers: index.tickers.length,
        motives: index.motives.length,
        theses: index.theses.length,
        topTickers: [...byTicker.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t, n]) => `${t} x${n}`),
        preview: index.cards.slice(0, 8).map((c) => c.record),
        builtAt: index.builtAt,
      };
    },
  }),
  def({
    id: "journal.search",
    group: "journal",
    action: "search",
    label: "Search journal",
    purpose: "Free-text match over records and tickers, including venue and pnl filtering.",
    access: "READ",
    inputs: "{ query: string, limit?: number }",
    output: "JournalCard[]",
    live: true,
    run: (i: { query: string; limit?: number }) => journal.searchCards(i.query, i.limit),
  }),
  def({
    id: "journal.filter",
    group: "journal",
    action: "filter",
    label: "Filter journal",
    purpose:
      "Narrow cards by motive, ticker, alignment, state, thesis, venue, PnL side (winners/losers) or date range.",
    access: "READ",
    inputs: "JournalFilter",
    output: "JournalCard[]",
    live: true,
    run: (i: journal.JournalFilter) => journal.filterCards(i),
  }),
  def({
    id: "journal.read",
    group: "journal",
    action: "read",
    label: "Read card",
    purpose: "Full record for one card id.",
    access: "READ",
    inputs: "{ id: string }",
    output: "JournalCard | null",
    live: true,
    run: (i: { id: string }) => journal.readCard(i.id),
  }),
  def({
    id: "journal.compare",
    group: "journal",
    action: "compare",
    label: "Compare sets",
    purpose: "Two filtered card sets side by side.",
    access: "COMPUTE",
    inputs: "{ a: JournalFilter, b: JournalFilter }",
    output: "{ a: JournalCard[], b: JournalCard[] }",
    live: true,
    run: (i: { a: journal.JournalFilter; b: journal.JournalFilter }) =>
      journal.compareSets(i.a, i.b),
  }),
  def({
    id: "journal.write",
    group: "journal",
    action: "write",
    label: "Write entry",
    purpose: "Append a journal entry. Never runs without approval.",
    access: "WRITE",
    inputs: "Partial<Entry>",
    output: "Entry",
    live: true,
    run: journal.writeEntry,
  }),
  def({
    id: "journal.delete",
    group: "journal",
    action: "delete",
    label: "Delete entry",
    purpose: "Remove a journal entry. Explicit approval only.",
    access: "DELETE",
    inputs: "{ id: string }",
    output: "void",
    live: true,
    run: (i: { id: string }) => journal.deleteEntry(i.id),
  }),

  // ── thesis ────────────────────────────────────────────────────────────
  def({
    id: "thesis.read",
    group: "thesis",
    action: "read",
    label: "Read theses",
    purpose: "All theses with status and symbols.",
    access: "READ",
    inputs: "none",
    output: "Thesis[]",
    live: true,
    run: () => getDoc().theses,
  }),
  def({
    id: "thesis.stats",
    group: "thesis",
    action: "stats",
    label: "Thesis stats",
    purpose: "Entries, trades, alignment rate and staleness for one thesis.",
    access: "COMPUTE",
    inputs: "{ thesisId: string }",
    output: "{ entries, trades, aligned, alignmentRate, staleDays }",
    live: true,
    run: (i: { thesisId: string }) => ind.thesisStats(i.thesisId),
  }),
  def({
    id: "thesis.edit",
    group: "thesis",
    action: "edit",
    label: "Edit thesis",
    purpose: "Patch a thesis. Approval required.",
    access: "EDIT",
    inputs: "{ id: string, patch: Partial<Thesis> }",
    output: "void",
    live: true,
    run: (i: { id: string; patch: Parameters<typeof journal.editThesis>[1] }) =>
      journal.editThesis(i.id, i.patch),
  }),
  def({
    id: "thesis.attest",
    group: "thesis",
    action: "attest",
    label: "Attest thesis",
    purpose:
      "Prepare the exact claim an EIP-191 signature will cover: the thesis as it stands, the ledger link, the signer. READ/COMPUTE only, no signature is made. Present the claim to the user; the user then signs it in their wallet.",
    access: "COMPUTE",
    inputs: "{ thesisId: string }",
    output: "{ thesisId, title, message, prevHash, alreadyAttested, signer } | { error }",
    live: true,
    run: async (i: { thesisId: string }) => {
      // The signer is the app's active connected wallet, never just the
      // account the injected provider happens to have selected.
      const signer = activeConnectedWallet();
      if (!signer)
        return {
          error:
            "No active connected wallet. The user must connect a wallet (wallet chip) and keep it unpaused before an attestation can be drafted.",
        };
      const accounts = await currentAccounts();
      if (!accounts.includes(signer.address))
        return {
          error: `The wallet has ${accounts[0] ?? "no account"} selected, but the active wallet is ${signer.address}. Ask the user to select the active account in their wallet.`,
        };
      const draft = prepareAttestation(i.thesisId, signer.address);
      if (!draft) return { error: `No thesis with id ${i.thesisId}.` };
      return { ...draft, signer: signer.address };
    },
  }),
  def({
    id: "thesis.attest-sign",
    group: "thesis",
    action: "attest-sign",
    label: "Sign thesis attestation",
    purpose:
      "Ask the connected wallet to sign the prepared claim (EIP-191, no gas, no transaction). Explicit user approval required; the user must click Sign in their wallet. The agent may only prepare the claim, never sign it.",
    access: "EXTERNAL",
    inputs: "{ thesisId: string, draft: { message: string, prevHash: string } }",
    output: "{ thesisId, address, entryHash, signedAt } | { error }",
    live: true,
    run: async (i: { thesisId: string; draft: { message: string; prevHash: string } }) => {
      const signer = activeConnectedWallet();
      if (!signer) return { error: "No active connected wallet. Ask the user to connect one." };
      const accounts = await currentAccounts();
      if (!accounts.includes(signer.address))
        return {
          error: `The wallet has ${accounts[0] ?? "no account"} selected, but the active wallet is ${signer.address}. The user must select the active account before signing.`,
        };
      const address = signer.address;
      const sig = await personalSign(i.draft.message, address);
      const saved = commitAttestation(i.thesisId, address, sig, {
        message: i.draft.message,
        prevHash: i.draft.prevHash,
      });
      if (!saved)
        return {
          error:
            "Commit refused: the thesis or the ledger changed between the approval and the signature, or the thesis is already attested.",
        };
      track("attestation_signed");
      const check = await verifyAttestation(saved.id);
      return {
        thesisId: saved.id,
        address: saved.attestation!.address,
        entryHash: saved.attestation!.entryHash,
        signedAt: saved.attestation!.signedAt,
        verified: check?.valid ?? null,
      };
    },
  }),
  def({
    id: "thesis.verify",
    group: "thesis",
    action: "verify",
    label: "Verify thesis attestation",
    purpose:
      "Re-check a stored attestation on-chain: re-derive the claim from the thesis as it stands and recover the signer from the stored signature. No approval: it only reads and recovers, it changes nothing.",
    access: "COMPUTE",
    inputs: "{ thesisId: string }",
    output: "{ valid, recovered, stored, entryHash } | { error }",
    live: true,
    run: async (i: { thesisId: string }) => {
      const out = await verifyAttestation(i.thesisId);
      if (!out) return { error: "No attestation stored for that thesis." };
      return out;
    },
  }),

  // ── signals ───────────────────────────────────────────────────────────
  def({
    id: "signal.read",
    group: "signal",
    action: "read",
    label: "Read signals",
    purpose: "Extracted on-chain moments, inbox and linked.",
    access: "READ",
    inputs: "none",
    output: "Signal[]",
    live: true,
    run: () => getDoc().signals,
  }),
  def({
    id: "signal.coverage",
    group: "signal",
    action: "coverage",
    label: "Inbox coverage",
    purpose: "How many extracted trades have been answered, with per-venue extraction counts.",
    access: "COMPUTE",
    inputs: "none",
    output: "{ signals, linked, inbox, ratio }",
    live: true,
    run: () => ind.coverageStats(),
  }),

  // ── indicators ────────────────────────────────────────────────────────
  def({
    id: "indicators.motiveStats",
    group: "indicators",
    action: "motiveStats",
    label: "Motive statistics",
    purpose: "Counts, alignment mix, discipline score, tickers and venue-measured PnL per motive.",
    access: "COMPUTE",
    inputs: "{ motive: Sentiment }",
    output: "MotiveStats",
    live: true,
    run: (i: { motive: Parameters<typeof ind.motiveStats>[0] }) => ind.motiveStats(i.motive),
  }),
  def({
    id: "indicators.alignmentStats",
    group: "indicators",
    action: "alignmentStats",
    label: "Alignment mix",
    purpose: "Alignment buckets across the whole journal.",
    access: "COMPUTE",
    inputs: "none",
    output: "{ total, buckets }",
    live: true,
    run: () => ind.alignmentStats(),
  }),
  def({
    id: "indicators.potIndex",
    group: "indicators",
    action: "potIndex",
    label: "POT index",
    purpose: "The six-axis, execution-weighted score with trends.",
    access: "COMPUTE",
    inputs: "none",
    output: "PotIndex",
    live: true,
    run: () => ind.potIndex(),
  }),

  // ── alerts & notifications ────────────────────────────────────────────
  def({
    id: "alerts.read",
    group: "alerts",
    action: "read",
    label: "Read alerts",
    purpose: "All configured triggers.",
    access: "READ",
    inputs: "none",
    output: "Alert[]",
    live: true,
    run: () => getDoc().alerts,
  }),
  def({
    id: "alerts.create",
    group: "alerts",
    action: "create",
    label: "Create alert",
    purpose: "Add a price, on-chain or thesis-review trigger. Approval required.",
    access: "WRITE",
    inputs: "Partial<Alert>",
    output: "Alert",
    live: true,
    run: (i: Parameters<typeof addAlert>[0]) => addAlert(i),
  }),
  def({
    id: "alerts.edit",
    group: "alerts",
    action: "edit",
    label: "Edit alert",
    purpose: "Patch an existing trigger. Approval required.",
    access: "EDIT",
    inputs: "{ id: string, patch: Partial<Alert> }",
    output: "void",
    live: true,
    run: (i: { id: string; patch: Parameters<typeof patchAlert>[1] }) => patchAlert(i.id, i.patch),
  }),
  def({
    id: "alerts.delete",
    group: "alerts",
    action: "delete",
    label: "Delete alert",
    purpose: "Remove a trigger. Explicit approval only.",
    access: "DELETE",
    inputs: "{ id: string }",
    output: "void",
    live: true,
    run: (i: { id: string }) => removeAlert(i.id),
  }),
  def({
    id: "notify.permission",
    group: "notify",
    action: "permission",
    label: "Ask for notifications",
    purpose: "Request browser notification permission on this device.",
    access: "EXTERNAL",
    inputs: "none",
    output: "PermissionState",
    live: true,
    run: () => requestNotifications(),
  }),

  // ── portfolio & chain (read paths wired from cached snapshot/venue data) ─
  def({
    id: "portfolio.read",
    group: "portfolio",
    action: "read",
    label: "Read portfolio",
    purpose: "Live wallet holdings, basket slices and total value for the active wallet.",
    access: "READ",
    inputs: "none",
    output: "Portfolio",
    live: true,
    run: async () => {
      const snapshot = await readCachedSnapshot();
      if (!snapshot)
        return {
          holdings: [],
          total: 0,
          priced: false,
          slices: [],
          message: "no wallet snapshot cached yet; sync your wallet first",
        };
      // Quotes are best-effort from the IDB cache; the price pipeline caches
      // in IndexedDB under the same key prefix.
      const { idbGet } = await import("@/lib/cache/idb");
      const quotes = (await idbGet<import("@/lib/prices").Quote[]>("quotes:latest")) ?? [];
      const overrides = getDoc().settings.basketOverrides;
      return buildPortfolio(snapshot, quotes, overrides);
    },
  }),
  def({
    id: "portfolio.netWorth",
    group: "portfolio",
    action: "netWorth",
    label: "Net worth",
    purpose: "Wallet balance plus venue account equity combined.",
    access: "READ",
    inputs: "none",
    output: "{ wallet, venueEquity, net }",
    live: true,
    run: async () => {
      const snapshot = await readCachedSnapshot();
      const reports = await readCachedVenueReports();
      if (!snapshot)
        return { wallet: 0, venueEquity: 0, net: 0, message: "no wallet snapshot cached yet" };
      const { idbGet } = await import("@/lib/cache/idb");
      const quotes = (await idbGet<import("@/lib/prices").Quote[]>("quotes:latest")) ?? [];
      const overrides = getDoc().settings.basketOverrides;
      return composeNetWorth(buildPortfolio(snapshot, quotes, overrides), reports);
    },
  }),
  def({
    id: "portfolio.positions-perps",
    group: "portfolio",
    action: "positions-perps",
    label: "Open perp positions",
    purpose:
      "Open perpetuals across venues: side, size, entry, uPnL, leverage/margin where the venue reports them, plus account-level margin and the fields a venue does not report.",
    access: "READ",
    inputs: "none",
    output: "{ trades: ActiveTrade[], accounts: venue margin, gaps: string[] }",
    live: true,
    run: async () => {
      const reports = await readCachedVenueReports();
      return openPerps(reports);
    },
  }),
  def({
    id: "chain.transfers",
    group: "chain",
    action: "transfers",
    label: "Read transfers",
    purpose:
      "Persistent local transfer history for the active wallet: every filed transfer, not just the recent window.",
    access: "READ",
    inputs: "{ limit?: number }",
    output: "LedgerTrade[]",
    live: true,
    run: async (input?: { limit?: number }) => {
      const wallet = getDoc().activeWallet;
      if (!wallet) return [];
      return readLedgerTrades(wallet, typeof input?.limit === "number" ? input.limit : 100);
    },
  }),
  def({
    id: "market.quote",
    group: "market",
    action: "quote",
    label: "Quote",
    purpose: "Spot price and 24h change for a symbol.",
    access: "EXTERNAL",
    inputs: "{ symbols: string[] }",
    output: "Quote[]",
    live: false,
  }),
  def({
    id: "log.read",
    group: "log",
    action: "read",
    label: "Read log",
    purpose: "The local agent activity log.",
    access: "READ",
    inputs: "none",
    output: "LogLine[]",
    live: true,
    run: () => getDoc().logs ?? [],
  }),

  // ── context ────────────────────────────────────────────────────────────
  // Reads back a payload that was too big to keep in an observation. The key
  // rides on the tool card's offloadKey; there is no autonomous hop loop yet,
  // so this is reached via /tool, not the model-chosen hop.
  def({
    id: "context.readOffload",
    group: "context",
    action: "readOffload",
    label: "Read full result",
    purpose: "Fetch the full data behind a truncated observation by its offload key.",
    access: "READ",
    inputs: "{ key: string }",
    output: "unknown",
    live: true,
    run: (i: { key: string }) => readOffloaded(i.key),
  }),
];

/** Venue groups: read/parse only for now, execution deliberately out of scope. Velodrome, Nado, Tydro and Hyperliquid have live readers; Inkyswap still pending. */
const VENUES = ["velodrome", "inkyswap", "hyperliquid", "nado", "tydro"] as const;

/** Which venues have a real reader wired up right now. */
const LIVE_VENUE_READERS = new Set(["velodrome", "hyperliquid", "nado", "tydro"]);

/** The wallet address to use for venue reads. Falls back to active wallet. */
function activeAddress(getDoc: () => import("@/lib/store").PotDoc): string | null {
  const doc = getDoc();
  if (!doc.activeWallet) return null;
  const sep = doc.activeWallet.indexOf(":");
  return sep >= 0 ? doc.activeWallet.slice(sep + 1) : doc.activeWallet;
}

const INK_CHAIN_ID = 57073;

for (const venue of VENUES) {
  TOOLS.push(
    def({
      id: `${venue}.read`,
      group: venue,
      action: "read",
      label: `Read ${venue}`,
      purpose: `Positions and pool state on ${venue}.`,
      access: "EXTERNAL",
      inputs: "{ address: string }",
      output: "VenuePosition[]",
      live: LIVE_VENUE_READERS.has(venue),
      run: LIVE_VENUE_READERS.has(venue)
        ? async (i: { address?: string }) => {
            const address = i?.address || activeAddress(getDoc);
            if (!address) return [];
            const reader =
              venue === "velodrome"
                ? readVelodrome
                : venue === "nado"
                  ? readNado
                  : venue === "tydro"
                    ? readTydro
                    : venue === "hyperliquid"
                      ? (await import("@/lib/venues/hyperliquid")).readHyperliquid
                      : null;
            if (!reader) return [];
            const report = await reader(address, INK_CHAIN_ID);
            return report.positions ?? [];
          }
        : undefined,
    }),
    def({
      id: `${venue}.execute`,
      group: venue,
      action: "execute",
      label: `Execute on ${venue}`,
      purpose: "Out of scope. Journaling first, execution later.",
      access: "EXECUTE",
      inputs: "—",
      output: "—",
      live: false,
    }),
  );
}

export const TOOL_BY_ID: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

export const TOOL_GROUPS = [...new Set(TOOLS.map((t) => t.group))];
