// AI Terminal — slash commands + natural language, responses render as JSON or
// table, and any create/modify request renders a dossier proposal card with
// Approve / Edit / Discard. Proposals do not persist in this pass.

import { useEffect, useMemo, useRef, useState } from "react";
import { ASSETS } from "@/lib/dynaminko-data";
import { DossierCard } from "../DossierCard";

type Format = "json" | "table";

type Msg =
  | { kind: "user"; text: string; id: string }
  | { kind: "reply"; format: Format; data: unknown; label: string; id: string }
  | { kind: "proposal"; id: string; proposal: Proposal }
  | { kind: "sys"; text: string; id: string };

type Proposal = {
  kind: "thesis" | "trade" | "alert";
  title: string;
  fields: { label: string; value: string }[];
  body?: string;
};

const COMMANDS = ["/market", "/account", "/trade", "/funds", "/thesis", "/alert"];

export function TerminalView() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      kind: "sys",
      id: "s0",
      text: "Dynaminko concierge online. Try /market XMR, /account, /trade buy tTSM 10, or ask in plain english.",
    },
  ]);
  const [input, setInput] = useState("");
  const [globalFormat, setGlobalFormat] = useState<Format>("table");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  const suggestions = useMemo(() => {
    if (!input.startsWith("/")) return [];
    return COMMANDS.filter((c) => c.startsWith(input.split(" ")[0]));
  }, [input]);

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    setMsgs((m) => [...m, { kind: "user", text, id }]);
    setInput("");
    setShowAutocomplete(false);
    setTimeout(() => setMsgs((m) => [...m, ...handle(text, globalFormat)]), 240);
  };

  const resolveProposal = (id: string, action: "approve" | "discard") => {
    setMsgs((m) =>
      m
        .filter((x) => x.id !== id)
        .concat({
          kind: "sys",
          id: crypto.randomUUID(),
          text:
            action === "approve"
              ? "> proposal APPROVED · entry committed to journal (mock)"
              : "> proposal DISCARDED",
        }),
    );
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto w-full">
      <div className="bg-obsidian border border-hairline flex flex-col h-[calc(100vh-10rem)] min-h-[540px]">
        <div className="px-4 h-11 border-b border-hairline flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-mint" style={{ animation: "dyn-pulse-dot 1.8s infinite" }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper">
              AI TERMINAL // <span className="text-ash">CONCIERGE v0</span>
            </span>
          </div>
          <div className="flex border border-hairline">
            {(["table", "json"] as Format[]).map((f) => (
              <button
                key={f}
                onClick={() => setGlobalFormat(f)}
                className={
                  "px-2 py-1 font-mono text-[10px] uppercase " +
                  (globalFormat === f ? "bg-lavender/[0.08] text-lavender" : "text-ash hover:text-paper")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-[12px]">
          {msgs.map((m) => {
            if (m.kind === "user")
              return (
                <div key={m.id} className="text-lavender">
                  <span className="text-ash">$ </span>
                  {m.text}
                </div>
              );
            if (m.kind === "sys")
              return (
                <div key={m.id} className="text-ash whitespace-pre-wrap">
                  {m.text}
                </div>
              );
            if (m.kind === "reply") return <ReplyBlock key={m.id} format={m.format} data={m.data} label={m.label} />;
            return (
              <ProposalCard
                key={m.id}
                proposal={m.proposal}
                onApprove={() => resolveProposal(m.id, "approve")}
                onDiscard={() => resolveProposal(m.id, "discard")}
              />
            );
          })}
        </div>

        <div className="border-t border-hairline p-3 relative">
          {showAutocomplete && suggestions.length > 0 && (
            <div className="absolute bottom-full left-3 mb-1 bg-onyx border border-hairline">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s + " ");
                    setShowAutocomplete(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 font-mono text-[11px] text-paper hover:bg-lavender/[0.08]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <span className="text-lavender">$</span>
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setShowAutocomplete(e.target.value.startsWith("/"));
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="type / for commands or ask a question…"
              className="flex-1 bg-transparent outline-none text-paper placeholder:text-ash/60"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="w-1.5 h-4 bg-lavender dyn-caret" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReplyBlock({ format, data, label }: { format: Format; data: unknown; label: string }) {
  return (
    <div className="border border-hairline">
      <div className="px-3 py-1.5 border-b border-hairline text-[10px] uppercase tracking-widest text-ash">
        {label}
      </div>
      <div className="p-3 text-paper">
        {format === "json" ? (
          <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(data, null, 2)}</pre>
        ) : Array.isArray(data) && data.length > 0 && typeof data[0] === "object" ? (
          <TableView rows={data as Record<string, unknown>[]} />
        ) : (
          <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(data, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

function TableView({ rows }: { rows: Record<string, unknown>[] }) {
  const keys = Object.keys(rows[0]);
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-ash">
          {keys.map((k) => (
            <th key={k} className="text-left font-normal pr-4 pb-1 uppercase tracking-widest text-[9px]">{k}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-hairline">
            {keys.map((k) => (
              <td key={k} className="pr-4 py-1 tabular-nums text-paper">
                {String(r[k])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProposalCard({
  proposal,
  onApprove,
  onDiscard,
}: {
  proposal: Proposal;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <DossierCard
      label={proposal.kind === "thesis" ? "PROPOSAL // THESIS" : proposal.kind === "trade" ? "PROPOSAL // TRADE" : "PROPOSAL // ALERT"}
      index="DRAFT"
      status={{ tone: "lavender", text: "AWAITING APPROVAL" }}
    >
      <div className="p-4">
        <div className="text-paper font-sans mb-3">{proposal.title}</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {proposal.fields.map((f) => (
            <div key={f.label} className="border border-hairline p-2">
              <div className="text-[9px] uppercase tracking-widest text-ash">{f.label}</div>
              <div className="font-mono text-paper text-[11px] mt-0.5">{f.value}</div>
            </div>
          ))}
        </div>
        {proposal.body && <p className="text-[12px] text-paper mb-3 font-sans">{proposal.body}</p>}
        <div className="flex gap-2 pt-3 border-t border-hairline">
          <button
            onClick={onApprove}
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest bg-lavender text-onyx hover:brightness-110"
          >
            Approve
          </button>
          <button
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-paper hover:border-lavender"
          >
            Edit
          </button>
          <button
            onClick={onDiscard}
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest border border-hairline text-ash hover:text-rose hover:border-rose/40"
          >
            Discard
          </button>
        </div>
      </div>
    </DossierCard>
  );
}

// ---- Command handler ----
function handle(text: string, format: Format): Msg[] {
  const id = () => crypto.randomUUID();
  const lower = text.toLowerCase();
  const parts = text.split(/\s+/);

  // Slash commands
  if (parts[0] === "/market") {
    const t = parts[1]?.toUpperCase();
    const rows = t ? ASSETS.filter((a) => a.ticker === t) : ASSETS.slice(0, 8);
    if (!rows.length) return [{ kind: "sys", id: id(), text: `> no asset ${t}` }];
    return [
      {
        kind: "reply",
        id: id(),
        format,
        label: `/market${t ? ` ${t}` : ""}`,
        data: rows.map((a) => ({ ticker: a.ticker, sector: a.sector, price: a.price, "24h%": a.change24h })),
      },
    ];
  }
  if (parts[0] === "/account") {
    return [
      {
        kind: "reply",
        id: id(),
        format,
        label: "/account",
        data: {
          wallet: "0xkraken.eth",
          chain: "ink",
          chainId: 57073,
          equity: 1425840,
          positions: ASSETS.length,
        },
      },
    ];
  }
  if (parts[0] === "/funds") {
    return [
      {
        kind: "reply",
        id: id(),
        format,
        label: "/funds",
        data: [
          { asset: "USDC", available: 84210.5, deployed: 342100.0 },
          { asset: "ETH", available: 3.4, deployed: 0 },
        ],
      },
    ];
  }
  if (parts[0] === "/trade") {
    const side = parts[1]?.toUpperCase();
    const ticker = parts[2]?.toUpperCase();
    const qty = parts[3];
    const a = ASSETS.find((x) => x.ticker === ticker);
    if (!a || !side || !qty) {
      return [{ kind: "sys", id: id(), text: "> usage: /trade <buy|sell> <TICKER> <qty>" }];
    }
    return [
      {
        kind: "proposal",
        id: id(),
        proposal: {
          kind: "trade",
          title: `${side} ${qty} ${a.ticker} @ mark ($${a.price.toFixed(2)})`,
          fields: [
            { label: "Venue", value: "Nado CLOB" },
            { label: "Chain", value: "Ink · 57073" },
            { label: "Est. cost", value: `$${(Number(qty) * a.price).toFixed(2)}` },
            { label: "Slippage", value: "0.10%" },
          ],
        },
      },
    ];
  }
  if (parts[0] === "/thesis") {
    const ticker = parts[1]?.toUpperCase();
    if (!ticker) return [{ kind: "sys", id: id(), text: "> usage: /thesis <TICKER>" }];
    return [
      {
        kind: "proposal",
        id: id(),
        proposal: {
          kind: "thesis",
          title: `New thesis for ${ticker}`,
          fields: [
            { label: "Ticker", value: ticker },
            { label: "Horizon", value: "mid" },
          ],
          body: "Draft body — approve to commit, edit to refine.",
        },
      },
    ];
  }
  if (parts[0] === "/alert") {
    return [
      {
        kind: "proposal",
        id: id(),
        proposal: {
          kind: "alert",
          title: "New price alert",
          fields: [
            { label: "Type", value: "price" },
            { label: "Condition", value: parts.slice(1).join(" ") || "define trigger" },
          ],
        },
      },
    ];
  }

  // Natural language — if it sounds like a write, propose. Otherwise, reply.
  if (/^(buy|sell|long|short|swap)/i.test(text)) {
    return [
      {
        kind: "proposal",
        id: id(),
        proposal: {
          kind: "trade",
          title: `Interpreted: ${text}`,
          fields: [
            { label: "Venue", value: "Nado CLOB" },
            { label: "Chain", value: "Ink · 57073" },
          ],
          body: "AI-parsed intent — confirm to route.",
        },
      },
    ];
  }
  if (/thesis|conviction|because/i.test(lower)) {
    return [
      {
        kind: "proposal",
        id: id(),
        proposal: {
          kind: "thesis",
          title: "Draft thesis from your note",
          fields: [{ label: "Detected ticker", value: parts.find((p) => /^[A-Z]{2,5}$/.test(p)) ?? "—" }],
          body: text,
        },
      },
    ];
  }
  return [
    {
      kind: "reply",
      id: id(),
      format,
      label: "reply",
      data: {
        answer:
          "I can pull data (/market, /account, /funds) or draft a thesis / trade / alert for your approval. Ask me to buy something, or say 'thesis: XMR ...'.",
      },
    },
  ];
}
