export const AGENT_RAIL_IDS = ["model", "agents", "skills", "tools", "logs"] as const;

export type AgentRailTab = (typeof AGENT_RAIL_IDS)[number];

export function agentRailSearch(search: Record<string, unknown>): { tab: AgentRailTab } {
  const tab = AGENT_RAIL_IDS.includes(search.tab as AgentRailTab)
    ? (search.tab as AgentRailTab)
    : "model";
  return { tab };
}
