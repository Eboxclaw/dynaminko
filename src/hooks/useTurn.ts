// The turn lifecycle, factored out of the console so extracting an
// AgentRuntime later is a move rather than a rewrite.

import { useCallback, useRef, useState } from "react";

import {
  isFailurePhase,
  type Stage,
  type StageNode,
  type TurnPhase,
} from "@/lib/chat/pipeline";

export type TurnError = { message: string; phase: TurnPhase; at: number } | null;

export function useTurn() {
  const [phase, setPhase] = useState<TurnPhase>("idle");
  const [nodes, setNodes] = useState<StageNode[]>([]);
  const [error, setError] = useState<TurnError>(null);
  const phaseRef = useRef<TurnPhase>("idle");

  const move = useCallback((next: TurnPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  /** Start a fresh pipeline. Clears the previous trace but not a pinned error. */
  const begin = useCallback(() => {
    setNodes([]);
    setError(null);
    phaseRef.current = "routing";
    setPhase("routing");
  }, []);

  const stage = useCallback((s: Stage, label: string, detail?: string) => {
    setNodes((prev) => [
      ...prev.map((n) => (n.state === "running" ? { ...n, state: "ok" as const } : n)),
      { stage: s, label, detail, state: "running", startedAt: Date.now() },
    ]);
  }, []);

  /** Close the newest node of that stage. */
  const settle = useCallback(
    (s: Stage, state: "ok" | "error" | "skipped", detail?: string) => {
      setNodes((prev) => {
        const idx = [...prev].reverse().findIndex((n) => n.stage === s);
        if (idx < 0) return prev;
        const i = prev.length - 1 - idx;
        const node = prev[i];
        const next = [...prev];
        next[i] = {
          ...node,
          state,
          detail: detail ?? node.detail,
          ms: Date.now() - node.startedAt,
        };
        return next;
      });
    },
    [],
  );

  const fail = useCallback((message: string, at: TurnPhase = "failed") => {
    phaseRef.current = at;
    setPhase(at);
    setError({ message, phase: at, at: Date.now() });
    setNodes((prev) =>
      prev.map((n) => (n.state === "running" ? { ...n, state: "error" as const } : n)),
    );
  }, []);

  const complete = useCallback(() => {
    phaseRef.current = "completed";
    setPhase("completed");
    setNodes((prev) =>
      prev.map((n) => (n.state === "running" ? { ...n, state: "ok" as const } : n)),
    );
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    phase,
    phaseRef,
    nodes,
    error,
    failed: isFailurePhase(phase),
    move,
    begin,
    stage,
    settle,
    fail,
    complete,
    clearError,
  };
}
