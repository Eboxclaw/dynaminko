// The model harness: what a llama.cpp front end is expected to expose and
// nothing more — role, state, context window, a RAM-aware recommendation, and
// the generation basics.

import { useAi } from "@/hooks/useAi";
import { useDoc } from "@/hooks/useDoc";
import {
  CTX_CHOICES,
  MODEL_BY_ID,
  STATE_LABEL,
  memoryEstimateGb,
  recommendModel,
} from "@/lib/ai";
import { patchAssistant, patchSettings } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ModelPanel({ ai }: { ai: ReturnType<typeof useAi> }) {
  const doc = useDoc();
  const profile = ai.profile;
  const rec = recommendModel(profile);
  const selected = doc.settings.assistant.modelId;
  const spec = MODEL_BY_ID[selected];

  const budget = profile.ramGb ?? (profile.mobile ? 2 : 4);
  const estimate = memoryEstimateGb(selected, ai.ctx);

  return (
    <div>
      <p className="border-b border-stroke px-4 py-2.5 text-[12px] text-ink-soft">
        {rec.reason}
        {rec.id !== selected && (
          <button
            type="button"
            onClick={() => {
              patchAssistant({ modelId: rec.id });
              patchSettings({ aiModelId: rec.id });
            }}
            className="doodle-pill ml-2 px-2.5 py-0.5 text-[11px] hover:border-ink"
          >
            Use {MODEL_BY_ID[rec.id]?.label}
          </button>
        )}
      </p>

      <ul>
        {ai.models.map((m) => {
          const active = selected === m.id;
          const state = ai.states[m.id];
          return (
            <li key={m.id} className="border-b border-stroke px-4 py-3 last:border-0">
              <label className="flex items-start gap-3">
                <input
                  type="radio"
                  name="model"
                  className="mt-1"
                  disabled={!m.generative || state === "unavailable"}
                  checked={active}
                  onChange={() => {
                    patchAssistant({ modelId: m.id });
                    patchSettings({ aiModelId: m.id });
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-medium">{m.label}</span>
                    <span className="num text-[11px] text-ink-faint">{m.quant}</span>
                    <span
                      className={cn(
                        "eyebrow",
                        state === "ready" && "text-gain",
                        (state === "error" || state === "unavailable") && "text-loss",
                        state === "required" && "text-ink-faint",
                      )}
                    >
                      {STATE_LABEL[state]}
                    </span>
                    {m.id === rec.id && <span className="eyebrow">recommended</span>}
                  </span>
                  <span className="mt-1 block text-[12px] text-ink-soft">{m.role}</span>
                  <span className="eyebrow mt-1 block">
                    ~{m.weightsGb} GB · {m.capabilities.join(" · ")} · ctx ≤ {m.maxCtx}
                  </span>
                  <span className="num mt-1 block text-[10px] break-all text-ink-faint">
                    {m.serve}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="border-b border-stroke px-4 py-3">
        <p className="eyebrow">Context window</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CTX_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              disabled={spec ? c > spec.maxCtx : false}
              onClick={() => ai.setCtx(c)}
              className={cn(
                "doodle-pill num px-3 py-1 text-[11px]",
                ai.ctx === c ? "bg-ink text-paper" : "text-ink-faint hover:border-ink",
                spec && c > spec.maxCtx && "opacity-40",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <p className={cn("eyebrow mt-2", estimate > budget && "text-loss")}>
          ~{estimate} GB working set
          {estimate > budget ? " · above what this device reports" : " · fits"}
          {ai.status.phase === "ready" && ai.loadedCtx !== ai.ctx
            ? " · reload to apply"
            : ""}
        </p>
      </div>

      <div className="grid gap-3 border-b border-stroke px-4 py-3 sm:grid-cols-2">
        <label className="text-[12px]">
          <span className="eyebrow block">Temperature {ai.temperature.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={ai.temperature}
            onChange={(e) => ai.setTemperature(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
        <label className="text-[12px]">
          <span className="eyebrow block">Max tokens {ai.maxTokens}</span>
          <input
            type="range"
            min={64}
            max={1024}
            step={32}
            value={ai.maxTokens}
            onChange={(e) => ai.setMaxTokens(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => void ai.load(selected)}
          className="doodle-pill bg-ink px-4 py-1.5 text-[12px] font-medium text-paper"
        >
          {ai.states[selected] === "ready" && ai.loadedCtx === ai.ctx
            ? "Loaded"
            : ai.downloaded.has(selected)
              ? "Start"
              : "Download & start"}
        </button>
        {ai.status.phase === "ready" && (
          <button
            type="button"
            onClick={() => void ai.stop()}
            className="doodle-pill px-4 py-1.5 text-[12px]"
          >
            Unload
          </button>
        )}
        {ai.status.phase === "downloading" && (
          <span className="num text-[12px] text-ink-faint">
            {Math.round(ai.status.progress * 100)}%
          </span>
        )}
        {ai.speed && (
          <span className="num text-[11px] text-ink-faint">
            {ai.speed.tps.toFixed(1)} tok/s
          </span>
        )}
        {ai.status.phase === "error" && (
          <span className="text-[12px] text-loss">{ai.status.message}</span>
        )}
      </div>
    </div>
  );
}
