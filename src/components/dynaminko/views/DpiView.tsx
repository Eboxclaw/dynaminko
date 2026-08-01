// DPI — Dynamic Performance Index.
// Measures the gap between theses made and trades taken, and between trades
// taken and the reasons attached to them. Sub-tabs slice the same dataset by
// dimension. Read-only: pure derivations of local journal + theses state.

import { useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useJournal } from "@/hooks/useJournal";
import { useChain } from "@/hooks/useChain";
import { ASSETS } from "@/lib/dynaminko-data";
import { SENTIMENT_LABELS, type JournaledTrade, type Sentiment } from "@/lib/journal";
import type { Thesis } from "./ThesesView";
import type { Wallet } from "@/lib/wallets";

type DpiTab = "pnl" | "discipline" | "ghosts" | "sentiment";

const TABS: { id: DpiTab; label: string; hint: string }[] = [
  { id: "pnl",        label: "P&L",         hint: "Realized dollars, per ticker" },
  { id: "discipline", label: "Discipline",  hint: "Trades linked to a thesis" },
  { id: "ghosts",     label: "Ghost theses", hint: "Theses with no trade" },
  { id: "sentiment",  label: "Sentiment",   hint: "How you felt vs. outcome" },
];

export function DpiView({ wallets }: { wallets: Wallet[] }) {
  const { snapshots, demo } = useChain();
  const { trades } = useJournal(wallets, snapshots, demo);
  const [theses] = useLocalStorage<Thesis[]>("dyn.theses", []);
  const [tab, setTab] = useState<DpiTab>("pnl");

  const stats = useMemo(() => deriveStats(trades, theses), [trades, theses]);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-5 max-w-6xl mx-auto w-full">
      <header className="space-y-1">
        <h1 className="font-mono text-[11px] uppercase tracking-[0.24em] text-ash">
          DPI // <span className="text-paper">DYNAMIC PERFORMANCE INDEX</span>
        </h1>
        <p className="text-ash text-sm">
          Measures what you did against what you said you'd do.
        </p>
      </header>

      {/* headline strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 border border-hairline">
        <Stat label="Realized P&L" value={fmtUsd(stats.realizedPnl)} tone={stats.realizedPnl >= 0 ? "mint" : "rose"} />
        <Stat label="Trades journaled" value={`${stats.journaled}/${stats.total}`} />
        <Stat label="Thesis-linked" value={`${(stats.discipline * 100).toFixed(0)}%`} tone={stats.discipline >= 0.6 ? "mint" : "rose"} />
        <Stat label="Ghost theses" value={String(stats.ghosts.length)} tone={stats.ghosts.length === 0 ? "mint" : "lavender"} />
      </div>

      {/* sub-tabs */}
      <div className="flex border border-hairline w-fit flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] " +
              (tab === t.id
                ? "bg-lavender/[0.08] text-lavender"
                : "text-ash hover:text-paper")
            }
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pnl" && <PnlPanel stats={stats} />}
      {tab === "discipline" && <DisciplinePanel stats={stats} />}
      {tab === "ghosts" && <GhostsPanel stats={stats} />}
      {tab === "sentiment" && <SentimentPanel stats={stats} />}
    </div>
  );
}

// ── derivations ─────────────────────────────────────────────────────────────

type DerivedStats = {
  total: number;
  journaled: number;
  discipline: number;              // 0..1 — fraction of journaled trades linked to a thesis
  realizedPnl: number;
  perTicker: { ticker: string; pnl: number; volume: number }[];
  perSentiment: { sentiment: Sentiment; count: number; avgPnl: number }[];
  ghosts: { thesis: Thesis; ageDays: number }[];
  journalledTrades: JournaledTrade[];
};

function deriveStats(trades: JournaledTrade[], theses: Thesis[]): DerivedStats {
  const journalled = trades.filter((t) => t.status === "journaled");
  // Mark-to-current-market pseudo-P&L: (current - trade price) * qty * side.
  const priceMap = new Map(ASSETS.map((a) => [a.ticker, a.price] as const));
  const pnlOf = (t: JournaledTrade) => {
    const cur = priceMap.get(t.ticker) ?? t.price;
    const dir = t.side === "BUY" ? 1 : -1;
    return (cur - t.price) * t.qty * dir;
  };
  const realizedPnl = journalled.reduce((s, t) => s + pnlOf(t), 0);

  const byTicker = new Map<string, { pnl: number; volume: number }>();
  for (const t of journalled) {
    const cur = byTicker.get(t.ticker) ?? { pnl: 0, volume: 0 };
    cur.pnl += pnlOf(t);
    cur.volume += t.qty * t.price;
    byTicker.set(t.ticker, cur);
  }
  const perTicker = Array.from(byTicker.entries())
    .map(([ticker, v]) => ({ ticker, ...v }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  const bySent = new Map<Sentiment, { count: number; totalPnl: number }>();
  for (const t of journalled) {
    if (!t.entry) continue;
    const s = bySent.get(t.entry.sentiment) ?? { count: 0, totalPnl: 0 };
    s.count += 1;
    s.totalPnl += pnlOf(t);
    bySent.set(t.entry.sentiment, s);
  }
  const perSentiment = Array.from(bySent.entries()).map(([sentiment, v]) => ({
    sentiment,
    count: v.count,
    avgPnl: v.count ? v.totalPnl / v.count : 0,
  }));

  const linked = journalled.filter((t) => t.entry?.thesisId).length;
  const discipline = journalled.length === 0 ? 0 : linked / journalled.length;

  // Ghost theses: no journalled trade for this ticker.
  const tickersWithTrades = new Set(journalled.map((t) => t.ticker));
  const ghosts = theses
    .filter((th) => !tickersWithTrades.has(th.ticker) && th.trades.length === 0)
    .map((th) => ({ thesis: th, ageDays: Math.floor((Date.now() - th.ts) / 86400_000) }));

  return {
    total: trades.length,
    journaled: journalled.length,
    discipline,
    realizedPnl,
    perTicker,
    perSentiment,
    ghosts,
    journalledTrades: journalled,
  };
}

// ── panels ──────────────────────────────────────────────────────────────────

function PnlPanel({ stats }: { stats: DerivedStats }) {
  const rows = stats.perTicker;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <div className="bg-obsidian border border-hairline p-5">
      <PanelHeader title="REALIZED P&L PER TICKER" hint="Mark-to-current-market on journaled trades." />
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((r) => (
            <div key={r.ticker} className="grid grid-cols-[70px_1fr_110px] items-center gap-3">
              <span className="font-mono text-[11px] text-paper">{r.ticker}</span>
              <div className="relative h-5 bg-onyx border border-hairline">
                <div
                  className="absolute inset-y-0 left-1/2 border-l border-hairline/60"
                  style={{ transform: "translateX(-1px)" }}
                />
                <div
                  className={"absolute inset-y-0 " + (r.pnl >= 0 ? "left-1/2 bg-mint/60" : "right-1/2 bg-rose/60")}
                  style={{ width: `${(Math.abs(r.pnl) / max) * 50}%` }}
                />
              </div>
              <span
                className={"font-mono text-[11px] text-right tabular-nums " + (r.pnl >= 0 ? "text-mint" : "text-rose")}
              >
                {fmtUsd(r.pnl)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DisciplinePanel({ stats }: { stats: DerivedStats }) {
  const pct = Math.round(stats.discipline * 100);
  const impulse = stats.journaled - stats.journalledTrades.filter((t) => t.entry?.thesisId).length;
  return (
    <div className="bg-obsidian border border-hairline p-5 space-y-4">
      <PanelHeader
        title="DISCIPLINE"
        hint="Fraction of executed trades that were tied to a prior thesis."
      />
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-3xl text-paper tabular-nums">{pct}%</span>
        <span className="font-mono text-[11px] text-ash">
          {stats.journaled - impulse} planned · {impulse} impulse
        </span>
      </div>
      <div className="h-3 bg-onyx border border-hairline overflow-hidden">
        <div className="h-full bg-lavender" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function GhostsPanel({ stats }: { stats: DerivedStats }) {
  return (
    <div className="bg-obsidian border border-hairline p-5">
      <PanelHeader
        title="GHOST THESES"
        hint="Theses you committed to but never acted on."
      />
      {stats.ghosts.length === 0 ? (
        <div className="mt-4 font-mono text-[11px] text-mint">
          — none — every thesis has a trade attached.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-hairline">
          {stats.ghosts.map(({ thesis, ageDays }) => (
            <li key={thesis.id} className="py-3 grid grid-cols-[80px_1fr_auto] gap-3 items-baseline">
              <span className="font-mono text-[11px] text-paper">{thesis.ticker}</span>
              <span className="text-[12px] text-ash line-clamp-1">{thesis.body}</span>
              <span className="font-mono text-[10px] text-ash">{ageDays}d idle</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SentimentPanel({ stats }: { stats: DerivedStats }) {
  const max = Math.max(1, ...stats.perSentiment.map((s) => Math.abs(s.avgPnl)));
  return (
    <div className="bg-obsidian border border-hairline p-5">
      <PanelHeader
        title="SENTIMENT vs OUTCOME"
        hint="Average P&L bucketed by the sentiment tag you chose at commit time."
      />
      {stats.perSentiment.length === 0 ? (
        <Empty />
      ) : (
        <div className="mt-4 space-y-2">
          {stats.perSentiment.map((s) => (
            <div key={s.sentiment} className="grid grid-cols-[110px_1fr_110px] items-center gap-3">
              <span className="font-mono text-[11px] text-paper uppercase tracking-widest">
                {SENTIMENT_LABELS[s.sentiment]}
                <span className="text-ash ml-1">×{s.count}</span>
              </span>
              <div className="relative h-5 bg-onyx border border-hairline">
                <div
                  className="absolute inset-y-0 left-1/2 border-l border-hairline/60"
                  style={{ transform: "translateX(-1px)" }}
                />
                <div
                  className={"absolute inset-y-0 " + (s.avgPnl >= 0 ? "left-1/2 bg-mint/60" : "right-1/2 bg-rose/60")}
                  style={{ width: `${(Math.abs(s.avgPnl) / max) * 50}%` }}
                />
              </div>
              <span
                className={"font-mono text-[11px] text-right tabular-nums " + (s.avgPnl >= 0 ? "text-mint" : "text-rose")}
              >
                {fmtUsd(s.avgPnl)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
        {title}
      </h3>
      <p className="text-[11px] text-ash/70 mt-1">{hint}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "mint" | "rose" | "lavender" }) {
  const toneCls =
    tone === "mint" ? "text-mint" : tone === "rose" ? "text-rose" : tone === "lavender" ? "text-lavender" : "text-paper";
  return (
    <div className="p-4 border-r last:border-r-0 border-hairline">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ash">{label}</div>
      <div className={"font-mono text-xl tabular-nums mt-1 " + toneCls}>{value}</div>
    </div>
  );
}

function Empty() {
  return (
    <div className="mt-4 font-mono text-[11px] text-ash">
      No journal data yet — reconcile some trades in the Journal tab.
    </div>
  );
}

function fmtUsd(n: number) {
  const sign = n >= 0 ? "+" : "−";
  const v = Math.abs(n);
  if (v >= 1000) return `${sign}$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `${sign}$${v.toFixed(0)}`;
}
