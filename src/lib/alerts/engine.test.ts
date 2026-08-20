import { describe, expect, it } from "vitest";

import { evaluate } from "./engine";

import type { Alert, Signal, Thesis } from "@/lib/store";
import type { Quote } from "@/lib/prices";

function priceAlert(overrides: Partial<Alert> & { symbol: string }): Alert {
  return {
    id: "p1",
    kind: "price",
    direction: "above",
    target: 100,
    thesisId: null,
    everyDays: null,
    note: "",
    enabled: true,
    lastFiredAt: null,
    createdAt: 0,
    ...overrides,
  };
}

function onchainAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "oc1",
    kind: "onchain",
    symbol: null,
    direction: "above",
    target: null,
    thesisId: null,
    everyDays: null,
    note: "",
    enabled: true,
    lastFiredAt: null,
    createdAt: 0,
    ...overrides,
  };
}

function thesisAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "tr1",
    kind: "thesis-review",
    symbol: null,
    direction: "above",
    target: null,
    thesisId: "t1",
    everyDays: 30,
    note: "",
    enabled: true,
    lastFiredAt: null,
    createdAt: 0,
    ...overrides,
  };
}

describe("evaluate - price alerts", () => {
  it("fires when price goes above target", () => {
    const alerts: Alert[] = [priceAlert({ symbol: "ETH", direction: "above", target: 2000 })];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 2100, change24h: 5 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(1);
    expect(result[0]!.alert.id).toBe("p1");
    expect(result[0]!.title).toContain("above");
  });

  it("fires when price drops below target", () => {
    const alerts: Alert[] = [priceAlert({ symbol: "ETH", direction: "below", target: 2100 })];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 2000, change24h: -5 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(1);
  });

  it("does not fire when price is below an 'above' threshold", () => {
    const alerts: Alert[] = [priceAlert({ symbol: "ETH", direction: "above", target: 3000 })];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 2800, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(0);
  });

  it("does not fire when price is above a 'below' threshold", () => {
    const alerts: Alert[] = [priceAlert({ symbol: "ETH", direction: "below", target: 1800 })];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 2000, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(0);
  });

  it("skips alerts for symbols without a matching quote", () => {
    const alerts: Alert[] = [priceAlert({ symbol: "ETH", direction: "above", target: 100 })];
    const quotes: Quote[] = [{ symbol: "BTC", usd: 60000, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(0);
  });

  it("skips disabled alerts", () => {
    const alerts: Alert[] = [
      priceAlert({ symbol: "ETH", direction: "above", target: 100, enabled: false }),
    ];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 200, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(0);
  });

  it("respects cooldown - does not re-fire within 3h", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [
      priceAlert({
        symbol: "ETH",
        direction: "above",
        target: 100,
        lastFiredAt: now - 3_600_000,
      }),
    ];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 200, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [], now });
    expect(result).toHaveLength(0);
  });

  it("fires after cooldown has elapsed", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [
      priceAlert({
        symbol: "ETH",
        direction: "above",
        target: 100,
        lastFiredAt: now - 4 * 3_600_000,
      }),
    ];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 200, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [], now });
    expect(result).toHaveLength(1);
  });

  it("skips alert with null target", () => {
    const alerts = [
      {
        ...priceAlert({ symbol: "ETH" }),
        target: null,
      },
    ];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 200, change24h: 0 }];
    const result = evaluate(alerts, { quotes, signals: [], theses: [] });
    expect(result).toHaveLength(0);
  });
});

describe("evaluate - on-chain alerts", () => {
  it("fires when an unreconciled signal is newer than lastFiredAt", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [onchainAlert({ symbol: "ETH", lastFiredAt: now - 4 * 3_600_000 })];
    const signals: Signal[] = [
      {
        id: "s1",
        txHash: "0x0",
        symbol: "ETH",
        side: "in",
        amount: 1,
        value: 2000,
        gasUsd: null,
        feeNative: null,
        counterparty: "0x0",
        ts: now - 3_600_000,
        extractedAt: now - 3_600_000,
        state: "inbox",
        venue: undefined,
        action: "trade",
        meta: {},
      },
    ];
    const result = evaluate(alerts, {
      quotes: [],
      signals,
      theses: [],
      now,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.alert.id).toBe("oc1");
  });

  it("does not fire for signals older than lastFiredAt", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [onchainAlert({ lastFiredAt: now - 4 * 3_600_000 })];
    const signals: Signal[] = [
      {
        id: "s1",
        txHash: "0x0",
        symbol: "ETH",
        side: "in",
        amount: 1,
        value: 2000,
        gasUsd: null,
        feeNative: null,
        counterparty: "0x0",
        ts: now - 5 * 3_600_000,
        extractedAt: now - 5 * 3_600_000,
        state: "inbox",
        venue: undefined,
        action: "trade",
        meta: {},
      },
    ];
    const result = evaluate(alerts, {
      quotes: [],
      signals,
      theses: [],
      now,
    });
    expect(result).toHaveLength(0);
  });
});

describe("evaluate - thesis-review alerts", () => {
  it("fires when review period has elapsed since last fire", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [
      thesisAlert({
        thesisId: "t1",
        everyDays: 30,
        lastFiredAt: now - 31 * 86_400_000,
      }),
    ];
    const theses: Thesis[] = [
      {
        id: "t1",
        title: "BTC long",
        body: "",
        symbols: ["BTC"],
        sector: null,
        horizon: "months",
        conviction: 3,
        status: "open",
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const result = evaluate(alerts, {
      quotes: [],
      signals: [],
      theses,
      now,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toContain("BTC long");
  });

  it("does not fire before the review period elapses", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [
      thesisAlert({
        thesisId: "t1",
        everyDays: 30,
        lastFiredAt: now - 15 * 86_400_000,
      }),
    ];
    const theses: Thesis[] = [
      {
        id: "t1",
        title: "BTC long",
        body: "",
        symbols: ["BTC"],
        sector: null,
        horizon: "months",
        conviction: 3,
        status: "open",
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const result = evaluate(alerts, {
      quotes: [],
      signals: [],
      theses,
      now,
    });
    expect(result).toHaveLength(0);
  });
});

describe("evaluate - mixed alerts", () => {
  it("handles price, onchain, and thesis together", () => {
    const now = 1_000_000_000_000;
    const alerts: Alert[] = [
      priceAlert({ symbol: "ETH", direction: "above", target: 100 }),
      onchainAlert({ id: "oc1", symbol: "ETH", lastFiredAt: now - 4 * 3_600_000 }),
      thesisAlert({ id: "tr1", lastFiredAt: now - 31 * 86_400_000 }),
    ];
    const quotes: Quote[] = [{ symbol: "ETH", usd: 200, change24h: 0 }];
    const signals: Signal[] = [
      {
        id: "s1",
        txHash: "0x0",
        symbol: "ETH",
        side: "in",
        amount: 1,
        value: 2000,
        gasUsd: null,
        feeNative: null,
        counterparty: "0x0",
        ts: now - 3_600_000,
        extractedAt: now - 3_600_000,
        state: "inbox",
        venue: undefined,
        action: "trade",
        meta: {},
      },
    ];
    const theses: Thesis[] = [
      {
        id: "t1",
        title: "BTC long",
        body: "",
        symbols: ["BTC"],
        sector: null,
        horizon: "months",
        conviction: 3,
        status: "open",
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const result = evaluate(alerts, { quotes, signals, theses, now });
    // Price fires, on-chain fires, thesis fires = 3
    expect(result).toHaveLength(3);
  });
});
