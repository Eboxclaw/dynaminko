import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type Line = { kind: "cmd" | "sys" | "ok" | "err" | "out"; text: string };

const INTRO: Line[] = [
  { kind: "sys", text: "Kraken CLI v2.1.0 · Ink Chain L2 secure bridge" },
  { kind: "sys", text: "Type 'help' for available commands." },
];

function runCommand(input: string): Line[] {
  const [cmd, ...rest] = input.trim().split(/\s+/);
  const args = rest.join(" ");
  switch (cmd) {
    case "help":
      return [
        { kind: "out", text: "kraken trade <buy|sell> <TICKER> --amount <N>" },
        { kind: "out", text: "nado clob list --sector <Privacy|Defense|Chips|AI|Health|SoV|Firearms>" },
        { kind: "out", text: "ink status" },
        { kind: "out", text: "clear" },
      ];
    case "clear":
      return [];
    case "ink":
      return [
        { kind: "ok", text: "[INK] chain: superchain-l2 · block 12,884,201 · rpc: nominal" },
      ];
    case "kraken":
      return [
        { kind: "sys", text: "[Kraken SDK] signing tx via Ink Chain…" },
        { kind: "ok", text: `[SUCCESS] ${args || "order"} filled · tx 0x9f22…b10a` },
      ];
    case "nado":
      return [
        { kind: "sys", text: "[Nado CLOB] querying builder codes…" },
        { kind: "out", text: "tLMT · tRTX · tSIG · XMR · ZEC · PAXG · tTSM · tNVDA · tPLTR · FET" },
      ];
    default:
      return [{ kind: "err", text: `unknown command: ${cmd || "(empty)"}` }];
  }
}

export function KrakenTerminal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>(INTRO);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const submit = () => {
    if (!input.trim()) return;
    const result = runCommand(input);
    if (input.trim() === "clear") {
      setLines([]);
    } else {
      setLines((prev) => [...prev, { kind: "cmd", text: input }, ...result]);
    }
    setInput("");
  };

  return (
    <div
      className={
        "fixed inset-y-0 right-0 w-full sm:w-[440px] bg-obsidian border-l border-steel z-40 flex flex-col font-mono transition-transform duration-300 " +
        (open ? "translate-x-0" : "translate-x-full")
      }
    >
      <div className="p-3 border-b border-steel flex items-center justify-between bg-onyx">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="size-2 rounded-full bg-red-500/70" />
            <div className="size-2 rounded-full bg-yellow-500/70" />
            <div className="size-2 rounded-full bg-green-500/70" />
          </div>
          <span className="text-[10px] uppercase text-slate-400 tracking-widest ml-2">
            Kraken CLI · Ink Chain
          </span>
        </div>
        <button
          onClick={onClose}
          className="size-6 grid place-items-center text-slate-500 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 text-[11px] leading-relaxed space-y-1"
      >
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.kind === "cmd"
                ? "text-neon-mint"
                : l.kind === "ok"
                  ? "text-neon-mint/80"
                  : l.kind === "err"
                    ? "text-red-400"
                    : l.kind === "sys"
                      ? "text-slate-500"
                      : "text-slate-300"
            }
          >
            {l.kind === "cmd" ? `user@ink-chain:~$ ${l.text}` : l.text}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <span className="text-neon-mint">user@ink-chain:~$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="flex-1 bg-transparent outline-none text-slate-100 text-[11px]"
            placeholder="try 'help'…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="w-2 h-4 bg-neon-mint fu-caret" />
        </div>
      </div>
    </div>
  );
}
