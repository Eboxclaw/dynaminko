import { useEffect, useState } from "react";

const STEPS = [
  "SECURE ENCLAVE CONNECTED",
  "BIOMETRIC HANDSHAKE VERIFIED",
  "KRAKEN SDK INITIALIZED",
  "NADO CLOB PROTOCOL DECRYPTED",
  "INK CHAIN L2 SYNC COMPLETE",
];

export function BootLoader() {
  const [hidden, setHidden] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length)), 550);
    const t = setTimeout(() => setHidden(true), 3600);
    return () => {
      clearInterval(iv);
      clearTimeout(t);
    };
  }, []);

  if (hidden) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-obsidian text-neon-mint font-mono p-8"
      style={{ animation: "fu-boot-fade 3.6s cubic-bezier(0.8,0,0.2,1) forwards" }}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-neon-mint/[0.06] to-transparent"
          style={{ animation: "fu-scanline 3.2s linear infinite" }}
        />
      </div>
      <div className="max-w-md w-full relative">
        <div className="mb-8 flex justify-between items-end">
          <div className="text-[10px] tracking-[0.3em] uppercase opacity-60">
            Initializing Ink_Chain L2
          </div>
          <div className="text-[10px] opacity-60">SESSION 0x884…FF2</div>
        </div>
        <div className="space-y-2 mb-10 text-sm">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-4">
              <span className={i < step ? "text-neon-mint/60" : "text-neon-mint/20"}>
                {i < step ? "[OK]" : i === step ? "[..]" : "[  ]"}
              </span>
              <span className={i <= step ? "text-neon-mint" : "text-neon-mint/25"}>{s}</span>
            </div>
          ))}
        </div>
        <div className="h-[2px] w-full bg-steel relative overflow-hidden">
          <div
            className="absolute top-0 h-full w-1/3 bg-neon-mint"
            style={{ animation: "fu-loading-bar 1.6s ease-in-out infinite" }}
          />
        </div>
        <div className="mt-12 text-[10px] text-center opacity-40 tracking-[0.5em] font-sans">
          F U S T O R E — UNSTOPPABLE GATEWAY
        </div>
      </div>
    </div>
  );
}
