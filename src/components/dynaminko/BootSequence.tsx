import { useEffect, useState } from "react";
import { DiamondLogo } from "./DiamondLogo";

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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const seen = sessionStorage.getItem("dyn.booted");
      if (seen) {
        setHidden(true);
        onDone?.();
        return;
      }

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        sessionStorage.setItem("dyn.booted", "1");
        setHidden(true);
        onDone?.();
        return;
      }
    }
    const iv = setInterval(() => setStep((s) => Math.min(s + 1, LINES.length)), 380);
    const t = setTimeout(() => {
      sessionStorage.setItem("dyn.booted", "1");
      setHidden(true);
      onDone?.();
    }, 3400);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, [onDone]);

  const skip = () => {
    sessionStorage.setItem("dyn.booted", "1");
    setHidden(true);
    onDone?.();
  };

  if (hidden) return null;

  return (
    <div
      className="dyn-boot-overlay fixed inset-0 z-[100] bg-onyx text-paper font-mono flex flex-col items-center justify-center overflow-hidden"
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
        <div className="dyn-diamond-surface" style={{ width: 110, height: 176, clipPath: "polygon(50% 0, 100% 22%, 100% 78%, 50% 100%, 0 78%, 0 22%)" }}>
          <div className="absolute inset-0 flex items-center justify-center">
            <DiamondLogo size={44} glow />
          </div>
        </div>
      </div>

      <div className="w-[min(420px,88vw)] space-y-1.5 text-[11px]">
        <div className="flex justify-between text-ash mb-3">
          <span className="tracking-[0.24em] uppercase">Dynaminko // boot</span>
          <span>session 0x{Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}</span>
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
