import { z } from "zod";

export const SectorBasketSchema = z.enum([
  "Privacy",
  "Store of Value",
  "Health",
  "Defense",
  "Firearms/Guns",
  "Semiconductors",
  "AI",
]);

export const ThesisStatusSchema = z.enum(["draft", "active", "paused", "closed", "archived"]);

export const TradeSideSchema = z.enum(["buy", "sell", "long", "short", "close"]);

export const TradeStatusSchema = z.enum(["planned", "open", "filled", "cancelled", "rejected"]);

export const ConciergeProposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
  "expired",
]);

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);

export const AlertStatusSchema = z.enum(["unread", "read", "acknowledged", "resolved"]);

export const PerformanceAxesSchema = z.object({
  returnPct: z.number().nullable(),
  volatilityPct: z.number().nullable(),
  drawdownPct: z.number().nullable(),
  sharpeRatio: z.number().nullable(),
  winRatePct: z.number().nullable(),
  convictionScore: z.number().min(0).max(100).nullable(),
  riskScore: z.number().min(0).max(100).nullable(),
  liquidityScore: z.number().min(0).max(100).nullable(),
  asOf: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});

export const ThesisSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  sectorBasket: SectorBasketSchema,
  status: ThesisStatusSchema,
  tickers: z.array(z.string()),
  convictionScore: z.number().min(0).max(100).nullable(),
  targetAllocationPct: z.number().min(0).max(100).nullable(),
  performance: PerformanceAxesSchema.nullable(),
  openedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).nullable(),
});

export const TradeSchema = z.object({
  id: z.string(),
  thesisId: z.string().nullable(),
  ticker: z.string(),
  sectorBasket: SectorBasketSchema.nullable(),
  side: TradeSideSchema,
  status: TradeStatusSchema,
  quantity: z.number().positive().nullable(),
  averagePrice: z.number().nonnegative().nullable(),
  notionalUsd: z.number().nonnegative().nullable(),
  feesUsd: z.number().nonnegative().nullable(),
  executedAt: z.string().datetime().nullable(),
  source: z.string().nullable(),
  rawPayloadRef: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const ConciergeProposalSchema = z.object({
  id: z.string(),
  status: ConciergeProposalStatusSchema,
  proposedAction: z.string(),
  thesisId: z.string().nullable(),
  tradeId: z.string().nullable(),
  sectorBasket: SectorBasketSchema.nullable(),
  title: z.string(),
  rationale: z.string().nullable(),
  confidenceScore: z.number().min(0).max(100).nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).nullable(),
});

export const AlertSchema = z.object({
  id: z.string(),
  severity: AlertSeveritySchema,
  status: AlertStatusSchema,
  title: z.string(),
  message: z.string().nullable(),
  sectorBasket: SectorBasketSchema.nullable(),
  thesisId: z.string().nullable(),
  tradeId: z.string().nullable(),
  proposalId: z.string().nullable(),
  trigger: z.string().nullable(),
  createdAt: z.string().datetime(),
  acknowledgedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

export type SectorBasket = z.infer<typeof SectorBasketSchema>;
export type ThesisStatus = z.infer<typeof ThesisStatusSchema>;
export type TradeSide = z.infer<typeof TradeSideSchema>;
export type TradeStatus = z.infer<typeof TradeStatusSchema>;
export type ConciergeProposalStatus = z.infer<typeof ConciergeProposalStatusSchema>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export type AlertStatus = z.infer<typeof AlertStatusSchema>;
export type PerformanceAxes = z.infer<typeof PerformanceAxesSchema>;
export type Thesis = z.infer<typeof ThesisSchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type ConciergeProposal = z.infer<typeof ConciergeProposalSchema>;
export type Alert = z.infer<typeof AlertSchema>;
