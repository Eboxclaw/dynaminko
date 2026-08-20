// The execution trace for one chat turn.
//
// This is not a debug log: it is the compact pipeline the console draws above
// the composer. One turn, one trace, only the stages that actually ran. It
// extends the existing tool-trace idea (running / ok / error + timing) with a
// `stage` so the same record can describe routing, a skill, a command or the
// answer itself.

export type Stage = "model" | "semantic" | "route" | "skill" | "command" | "tool" | "answer";

export type StageState = "running" | "ok" | "error" | "skipped";

export type StageNode = {
  stage: Stage;
  /** short name, e.g. the model label or the command id */
  label: string;
  /** one line of detail, e.g. "match: journal.review" */
  detail?: string;
  state: StageState;
  ms?: number;
  startedAt: number;
};

export const STAGE_LABEL: Record<Stage, string> = {
  model: "MODEL",
  semantic: "SEMANTIC",
  route: "ROUTE",
  skill: "SKILL",
  command: "COMMAND",
  tool: "TOOL",
  answer: "ANSWER",
};

/**
 * The lifecycle a local turn walks through. Zero output is a failure state,
 * never a quiet success.
 */
export type TurnPhase =
  | "idle"
  | "routing"
  | "selecting"
  | "loading"
  | "ready"
  | "generating"
  | "streaming"
  | "completed"
  | "failed"
  | "no_output"
  | "cancelled";

export const PHASE_LABEL: Record<TurnPhase, string> = {
  idle: "idle",
  routing: "routing",
  selecting: "selecting model",
  loading: "loading model",
  ready: "model ready",
  generating: "generating",
  streaming: "streaming",
  completed: "done",
  failed: "generation failed",
  no_output: "no output",
  cancelled: "cancelled",
};

export function isBusyPhase(p: TurnPhase): boolean {
  return (
    p === "routing" ||
    p === "selecting" ||
    p === "loading" ||
    p === "ready" ||
    p === "generating" ||
    p === "streaming"
  );
}

export function isFailurePhase(p: TurnPhase): boolean {
  return p === "failed" || p === "no_output";
}
