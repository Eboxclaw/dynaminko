// Tydro reader — Aave v3 lending on Ink (57073).
//
//   AaveProtocolDataProvider (verified on the explorer) → POOL()
//   getAllReservesTokens() → the reserve list (13 today: WETH, kBTC, USDC…)
//   getReserveTokensAddresses(asset) → aToken + debt tokens (session-cached)
//   balanceOf(wallet) on each token → exact supply, stable and variable debt
//   Pool.getUserAccountData(wallet) → health factor + USD totals
//
// Balances are read straight from balanceOf in underlying units. The
// DataProvider's getUserReserveData returns ray-scaled values that need
// liquidity-index math; we don't do that math here. Per-token USD stays null
// (no oracle of our own — same rule as the Velodrome reader), while
// account-level collateral and debt come from Aave's own accounting in
// 8-decimal USD: the same numbers liquidations use.

import { ethCallMany, padHex, readTokenMeta, toAddress, toBigInt, words } from "./evm";
import { emptyReport, type AccountSummary, type Position, type VenueReport } from "./types";

const DATA_PROVIDER = "0x96086C25d13943C80Ff9a19791a40Df6aFC08328";
const CHAIN = 57073;
const UINT256_MAX = 2n ** 256n - 1n;
const USD8 = 1e8;

const SEL = {
  getAllReservesTokens: "0xb316ff89",
  getReserveTokensAddresses: "0xd2493b6c",
  balanceOf: "0x70a08231",
  POOL: "0x7535d246",
  getUserAccountData: "0xbf92857c",
} as const;

export type Reserve = { asset: string; symbol: string };

/** Reserve list and token addresses only change on deployment days: session cache. */
const reserveCache = new Map<number, Reserve[]>();
const tokensCache = new Map<string, { aToken: string; stableDebt: string; variableDebt: string }>();

/** ABI-decodes getAllReservesTokens(): (string symbol, address tokenAddress)[]. */
export function decodeReserves(result: string): Reserve[] {
  const w = words(result);
  if (w.length < 2) return [];
  const base = Number(toBigInt(w[0]) / 32n);
  if (!Number.isInteger(base) || base <= 0 || base + 1 >= w.length) return [];
  const count = Number(toBigInt(w[base]));
  const out: Reserve[] = [];
  for (let i = 0; i < count && i < 64; i += 1) {
    const off = w[base + 1 + i];
    if (!off) continue;
    // entries are (string offset, tokenAddress); the string starts two words in
    const entry = base + 1 + Number(toBigInt(off) / 32n);
    if (entry + 2 >= w.length) continue;
    const asset = toAddress(w[entry + 1]);
    if (asset === "0x") continue;
    const len = Number(toBigInt(w[entry + 2]));
    let symbol = asset.slice(0, 6);
    if (len > 0 && len <= 32) {
      const hex = w
        .slice(entry + 3)
        .join("")
        .slice(0, len * 2);
      const bytes = new Uint8Array(len);
      for (let b = 0; b < len; b += 1) bytes[b] = parseInt(hex.slice(b * 2, b * 2 + 2), 16);
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\0+$/, "");
      if (decoded) symbol = decoded;
    }
    out.push({ asset, symbol });
  }
  return out;
}

function fmt(n: number): string {
  return n !== 0 ? (n < 1 ? n.toPrecision(3) : n.toFixed(4)) : "0";
}

export async function readTydro(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<VenueReport> {
  if (chainId !== CHAIN) {
    return { ...emptyReport("tydro", "Tydro reads Ink mainnet."), status: "pending" };
  }
  const report = emptyReport("tydro");

  // Stage 1: pool address + reserve list in one batch.
  const [poolRaw, reservesRaw] = await ethCallMany(
    chainId,
    [
      { to: DATA_PROVIDER, data: SEL.POOL },
      { to: DATA_PROVIDER, data: SEL.getAllReservesTokens },
    ],
    signal,
  );
  const pool = poolRaw ? toAddress(words(poolRaw)[0]) : null;
  const reserves = reserveCache.get(chainId) ?? (reservesRaw ? decodeReserves(reservesRaw) : []);
  if (reserves.length > 0) reserveCache.set(chainId, reserves);
  if (!pool || reserves.length === 0) {
    throw new Error("Tydro reserves or pool unreadable");
  }

  // Stage 2: account state + per-reserve token addresses in one batch.
  const accountCall = { to: pool, data: SEL.getUserAccountData + padHex(address) };
  const tokenCalls = reserves.map((r) => ({
    to: DATA_PROVIDER,
    data: SEL.getReserveTokensAddresses + padHex(r.asset),
  }));
  const stage2 = await ethCallMany(chainId, [accountCall, ...tokenCalls], signal);
  const accountWords = words(stage2[0] ?? "0x");
  const tokens = reserves.map(
    (r, i): { aToken: string; stableDebt: string; variableDebt: string } => {
      const cached = tokensCache.get(r.asset.toLowerCase());
      if (cached) return cached;
      const w = words(stage2[i + 1] ?? "0x");
      const fresh = {
        aToken: toAddress(w[0]),
        stableDebt: toAddress(w[1]),
        variableDebt: toAddress(w[2]),
      };
      if (fresh.aToken !== "0x") tokensCache.set(r.asset.toLowerCase(), fresh);
      return fresh;
    },
  );

  // Stage 3: exact underlying balances off the tokens themselves.
  const balanceCalls = tokens.flatMap((t) => [
    { to: t.aToken, data: SEL.balanceOf + padHex(address) },
    { to: t.stableDebt, data: SEL.balanceOf + padHex(address) },
    { to: t.variableDebt, data: SEL.balanceOf + padHex(address) },
  ]);
  const balances = await ethCallMany(chainId, balanceCalls, signal);

  const active: { reserve: Reserve; supply: bigint; stable: bigint; variable: bigint }[] = [];
  reserves.forEach((r, i) => {
    const supply = toBigInt(words(balances[i * 3] ?? "0x")[0]);
    const stable = toBigInt(words(balances[i * 3 + 1] ?? "0x")[0]);
    const variable = toBigInt(words(balances[i * 3 + 2] ?? "0x")[0]);
    if (supply > 0n || stable > 0n || variable > 0n) {
      active.push({ reserve: r, supply, stable, variable });
    }
  });
  if (active.length === 0) return report;

  const meta = await readTokenMeta(
    chainId,
    active.map((a) => a.reserve.asset),
    signal,
  );
  const now = Date.now();

  report.positions = active.map((a): Position => {
    const m = meta.get(a.reserve.asset.toLowerCase()) ?? {
      symbol: a.reserve.symbol,
      decimals: 18,
    };
    const supply = Number(a.supply) / 10 ** m.decimals;
    const stable = Number(a.stable) / 10 ** m.decimals;
    const variable = Number(a.variable) / 10 ** m.decimals;
    const debt = stable + variable;
    return {
      id: `tydro:${a.reserve.asset.toLowerCase()}`,
      venue: "tydro",
      kind: "lending",
      symbol: m.symbol,
      symbols: [m.symbol],
      label: m.symbol,
      size: supply,
      // token amounts are on-chain; USD is not priced per token
      notionalValue: null,
      accountId: null,
      parentAddress: address,
      detail:
        `supply ${fmt(supply)} ${m.symbol}` +
        (debt > 0 ? ` · borrow ${fmt(debt)} ${m.symbol}` : ""),
      metadata: {
        asset: a.reserve.asset,
        supply,
        stableDebt: stable,
        variableDebt: variable,
      },
      fetchedAt: now,
      value: null,
    };
  });

  // Account state in Aave's own 8-dec USD, the numbers liquidations use.
  if (accountWords.length >= 6) {
    const collateral = Number(toBigInt(accountWords[0])) / USD8;
    const debt = Number(toBigInt(accountWords[1])) / USD8;
    const available = Number(toBigInt(accountWords[2])) / USD8;
    const hfRaw = toBigInt(accountWords[5]);
    const health = hfRaw === 0n ? null : hfRaw >= UINT256_MAX ? null : Number(hfRaw) / 1e27;
    if (collateral > 0 || debt > 0 || (health != null && health > 0)) {
      const account: AccountSummary = {
        id: "tydro:account",
        venue: "tydro",
        accountId: address,
        label: "Lending account",
        parentAddress: address,
        equity: collateral > 0 || debt > 0 ? collateral - debt : null,
        available: available > 0 ? available : null,
        marginUsed: debt > 0 ? debt : null,
        health,
        detail:
          `collateral $${collateral.toFixed(0)} · debt $${debt.toFixed(0)}` +
          (health != null ? ` · HF ${health.toFixed(2)}` : " · no debt"),
      };
      report.accounts = [account];
    }
  }

  report.status = "ok";
  report.note = "Amounts on-chain; collateral/debt/HF from Aave's oracle accounting.";
  return report;
}
