// The execution flow of the current turn, drawn as one compact pipeline.
//
// Only stages that actually ran appear. The active node glows, finished nodes
// go quiet, failures go red. This is a presence indicator, not a debug log.

import { Fragment } from "react";

import { STAGE_LABEL, type StageNode } from "@/lib/chat/pipeline";
import { cn } from "@/lib/utils";

export function FlowStrip({ nodes }: { nodes: StageNode[] }) {
  if (!nodes.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-stroke px-4 py-2">
      {nodes.map((n, i) => (
        <Fragment key={`${n.stage}-${i}`}>
          {i > 0 && <span className="text-ink-faint">→</span>}
          <span
            className={cn(
              "num inline-flex items-baseline gap-1 text-[10px] uppercase tracking-wide",
              n.state === "running" && "animate-pulse font-medium text-ink",
              n.state === "ok" && "text-ink-faint",
              n.state === "skipped" && "text-ink-faint opacity-60",
              n.state === "error" && "text-loss",
            )}
            title={n.detail}
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                n.state === "running" && "bg-ink",
                n.state === "ok" && "bg-gain",
                n.state === "skipped" && "bg-stroke",
                n.state === "error" && "bg-loss",
              )}
            />
            {STAGE_LABEL[n.stage]}
            {n.label && <span className="normal-case text-ink-faint">{n.label}</span>}
            {n.ms != null && n.ms > 0 && <span className="text-ink-faint">{n.ms}ms</span>}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
