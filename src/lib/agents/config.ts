// Local-first agent configuration. Everything here lives in the browser:
// agent profiles and skills in localStorage, model weights in the Cache API.
// Nothing is sent to a server.

export type SkillId =
  | "read-portfolio"
  | "propose-thesis"
  | "propose-journal"
  | "propose-alert"
  | "read-markets";

export type Skill = {
  id: SkillId;
  label: string;
  description: string;
  /** every write-capable skill is propose-then-approve, never silent */
  writes: boolean;
};

export const SKILLS: Skill[] = [
  {
    id: "read-portfolio",
    label: "Read portfolio",
    description: "Balances, positions and transfers for visible wallets.",
    writes: false,
  },
  {
    id: "read-markets",
    label: "Read markets",
    description: "Prices, sector baskets and venue TVL.",
    writes: false,
  },
  {
    id: "propose-thesis",
    label: "Propose thesis",
    description: "Drafts a thesis dossier for approval. Never saves directly.",
    writes: true,
  },
  {
    id: "propose-journal",
    label: "Propose journal entry",
    description: "Reconciles a detected trade against a thesis, pending approval.",
    writes: true,
  },
  {
    id: "propose-alert",
    label: "Propose alert",
    description: "Drafts price, on-chain or thesis-validation alerts.",
    writes: true,
  },
];

export type ModelRuntime = "webgpu" | "wasm";

export type ModelSpec = {
  id: string;
  label: string;
  params: string;
  quant: string;
  sizeMb: number;
  runtime: ModelRuntime;
  url: string;
  note: string;
};

/** Small GGUF builds that are realistic to run in a browser tab. */
export const MODELS: ModelSpec[] = [
  {
    id: "qwen2.5-0.5b-q4",
    label: "Qwen2.5 0.5B Instruct",
    params: "0.5B",
    quant: "Q4_K_M",
    sizeMb: 398,
    runtime: "wasm",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    note: "Fastest to load. Good for command parsing, weak at analysis.",
  },
  {
    id: "qwen2.5-1.5b-q4",
    label: "Qwen2.5 1.5B Instruct",
    params: "1.5B",
    quant: "Q4_K_M",
    sizeMb: 1120,
    runtime: "wasm",
    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    note: "Balanced. Recommended default once WebGPU is available.",
  },
  {
    id: "llama-3.2-3b-q4",
    label: "Llama 3.2 3B Instruct",
    params: "3B",
    quant: "Q4_K_M",
    sizeMb: 2020,
    runtime: "webgpu",
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    note: "Best reasoning of the three. Needs WebGPU and ~3GB of memory.",
  },
];

export type RemoteProvider = {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  /** stored in this browser only */
  apiKey: string;
};

export type Agent = {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  /** local model id, or `remote:<providerId>` */
  model: string;
  temperature: number;
  skills: SkillId[];
  mcpServers: string[];
};

export type McpServer = {
  id: string;
  label: string;
  url: string;
  transport: "http" | "sse";
  enabled: boolean;
  state: "unknown" | "connecting" | "ready" | "failed";
  tools: string[];
  lastError: string | null;
};

export const DEFAULT_AGENTS: Agent[] = [
  {
    id: "concierge",
    name: "Concierge",
    role: "Reconciles fetched trades against theses",
    systemPrompt:
      "You are Dynaminko's reconciliation concierge. Given a detected on-chain trade, match it to an existing thesis or propose a new one. Always output a proposal for approval; never assert that an entry was saved.",
    model: "qwen2.5-1.5b-q4",
    temperature: 0.2,
    skills: ["read-portfolio", "propose-journal", "propose-thesis"],
    mcpServers: [],
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Sector and exposure commentary",
    systemPrompt:
      "You are a terse sector analyst for the Dynaminko basket universe. Answer with numbers first, prose second. Flag when data is indicative rather than live.",
    model: "qwen2.5-1.5b-q4",
    temperature: 0.4,
    skills: ["read-portfolio", "read-markets", "propose-alert"],
    mcpServers: [],
  },
];

export const AGENT_KEYS = {
  agents: "dyn.agents",
  activeAgent: "dyn.activeAgent",
  providers: "dyn.aiProviders",
  mcp: "dyn.mcpServers",
  installedModels: "dyn.installedModels",
} as const;

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Math.random()).slice(2);
}
