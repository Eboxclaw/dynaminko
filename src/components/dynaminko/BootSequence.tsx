import { useCallback, useEffect, useState } from "react";

const LINES = [
  "> establishing secure channel · ink chain L2",
  "> handshake ······ ACK",
  "> loading nado clob module ······ OK",
  "> loading tydro reserves ······ OK",
  "> decrypting thesis vault ······ OK",
  "> concierge ai online",
];

export function BootSequence({ onDone }: { onDone?: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [step, setStep] = useState(0);
  // Generated after mount only — a render-time random would break hydration.
  const [session, setSession] = useState<string | null>(null);

  const skip = useCallback(() => {
    try {
      sessionStorage.setItem("dyn.booted", "1");
    } catch {
      /* ignore */
    }
    setHidden(true);
    onDone?.();
  }, [onDone]);

  useEffect(() => {
    setSession(Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0"));

    let seen: string | null = null;
    try {
      seen = sessionStorage.getItem("dyn.booted");
    } catch {
      /* ignore */
    }
    if (seen) {
      setHidden(true);
      onDone?.();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      skip();
      return;
    }

    const iv = setInterval(() => setStep((s) => Math.min(s + 1, LINES.length)), 380);
    const t = setTimeout(skip, 3400);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [onDone, skip]);

  // Any key, or a click anywhere, dismisses the sequence.
  useEffect(() => {
    if (hidden) return;
    const onKey = () => skip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, skip]);


  if (hidden) return null;

  return (
    <div
      onClick={skip}
      role="presentation"
      className="dyn-boot-overlay fixed inset-0 z-[100] bg-onyx text-paper font-mono flex flex-col items-center justify-center overflow-hidden cursor-pointer"
      style={{ animation: "dyn-boot-fade 3.5s cubic-bezier(0.7,0,0.2,1) forwards" }}
    >

      {/* single scan line sweep */}
      <div
        className="dyn-boot-scanline pointer-events-none absolute inset-x-0 h-16"
        style={{
          animation: "dyn-scanline 3.2s cubic-bezier(0.7,0,0.3,1) 0.2s forwards",
          background:
            "linear-gradient(to bottom, transparent, rgba(182,165,240,0.16), transparent)",
        }}
      />

      {/* Centerpiece: faceted diamond form assembling */}
      <div
        className="dyn-boot-assembly relative mb-10"
        style={{
          animation: "dyn-assemble 2.2s cubic-bezier(0.6,0,0.2,1) forwards",
          transformStyle: "preserve-3d",
        }}
      >
        <div
          className="dyn-diamond-surface relative"
          style={{ width: 140, height: 176, clipPath: "polygon(50% 0, 100% 22%, 100% 78%, 50% 100%, 0 78%, 0 22%)" }}
        >
          <img
            src="/dynaminko.svg"
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-contain p-6"
            style={{ filter: "invert(1) drop-shadow(0 0 12px rgba(182,165,240,0.55))" }}
          />
        </div>
      </div>

      <div className="w-[min(420px,88vw)] space-y-1.5 text-[11px]">
        <div className="flex justify-between text-ash mb-3">
          <span className="tracking-[0.24em] uppercase">Dynaminko // boot</span>
          <span>session 0x{session ?? "····"}</span>
        </div>
        {LINES.map((l, i) => (
          <div key={i} className={i < step ? "text-paper" : "text-ash/40"}>
            {i < step ? l : i === step ? l.replace(/OK|ACK/, "…") : l}
          </div>
        ))}
      </div>

      <div className="absolute bottom-6 inset-x-0 flex justify-between px-6 text-[10px] tracking-[0.24em] uppercase text-ash">
        <span>ink chain · L2 · 57073</span>
        <button
          onClick={skip}
          className="text-ash hover:text-lavender transition-colors"
        >
          [ skip ]
        </button>
      </div>
    </div>
  );
}
