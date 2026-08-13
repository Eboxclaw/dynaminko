// Velodrome reader — Slipstream concentrated liquidity on Ink (57073).
//
//   NonFungiblePositionManager.balanceOf(wallet)
//     → tokenOfOwnerByIndex → positions(tokenId)
//     → factory.getPool(token0, token1, tickSpacing) → slot0
//     → token amounts from liquidity and the live tick
//
// The Sugar helper at 0x116b… reverts for the read shapes Slipstream Sugar
// documents, so enumeration is the path today. It is cheap here: reads are
// batched into one JSON-RPC request per stage.
//
// No USD value is claimed: there is no price oracle we trust for these pairs,
// so notionalValue stays null and the UI shows the token amounts instead.

import {
  ethCallMany,
  padHex,
  padInt,
  padUint,
  readTokenMeta,
  SELECTOR,
  toAddress,
  toBigInt,
  toSigned,
  words,
} from "./evm";
import { emptyReport, type Position, type VenueReport } from "./types";

const POSITION_MANAGER = "0xefD0f78F93f578036AE34D52A813a4BE7D8D2D52";
const FACTORY = "0x718E46d0962A66942E233760a8bd6038Ce54EdCD";
const CHAIN = 57073;

const Q96 = 2 ** 96;

function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

/** Uniswap-V3-style amounts for a position at the current price. */
function amountsFor(liquidity: number, tickLower: number, tickUpper: number, tick: number) {
  const sa = tickToSqrtPrice(tickLower);
  const sb = tickToSqrtPrice(tickUpper);
  const sp = Math.min(Math.max(tickToSqrtPrice(tick), sa), sb);
  const amount0 = liquidity * (1 / sp - 1 / sb);
  const amount1 = liquidity * (sp - sa);
  return { amount0: Math.max(amount0, 0), amount1: Math.max(amount1, 0) };
}

export async function readVelodrome(
  address: string,
  chainId: number,
  signal?: AbortSignal,
): Promise<VenueReport> {
  if (chainId !== CHAIN) {
    return { ...emptyReport("velodrome", "Velodrome reads Ink mainnet."), status: "pending" };
  }
  const report = emptyReport("velodrome");

  const [balanceRaw] = await ethCallMany(
    chainId,
    [{ to: POSITION_MANAGER, data: SELECTOR.balanceOf + padHex(address) }],
    signal,
  );
  const count = Number(toBigInt(words(balanceRaw ?? "0x")[0]));
  if (!count) return report;

  const idxCalls = Array.from({ length: Math.min(count, 50) }, (_, i) => ({
    to: POSITION_MANAGER,
    data: SELECTOR.tokenOfOwnerByIndex + padHex(address) + padUint(i),
  }));
  const idResults = await ethCallMany(chainId, idxCalls, signal);
  const tokenIds = idResults
    .filter((r): r is string => Boolean(r))
    .map((r) => toBigInt(words(r)[0]));

  const posResults = await ethCallMany(
    chainId,
    tokenIds.map((id) => ({ to: POSITION_MANAGER, data: SELECTOR.positions + padUint(id) })),
    signal,
  );

  type Raw = {
    tokenId: bigint;
    token0: string;
    token1: string;
    tickSpacing: number;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    owed0: bigint;
    owed1: bigint;
  };
  const raws: Raw[] = [];
  posResults.forEach((res, i) => {
    if (!res) return;
    const w = words(res);
    if (w.length < 12) return;
    const liquidity = toBigInt(w[7]);
    if (liquidity === 0n) return;
    raws.push({
      tokenId: tokenIds[i]!,
      token0: toAddress(w[2]),
      token1: toAddress(w[3]),
      tickSpacing: Number(toSigned(w[4])),
      tickLower: Number(toSigned(w[5])),
      tickUpper: Number(toSigned(w[6])),
      liquidity,
      owed0: toBigInt(w[10]),
      owed1: toBigInt(w[11]),
    });
  });
  if (raws.length === 0) return report;

  const poolResults = await ethCallMany(
    chainId,
    raws.map((p) => ({
      to: FACTORY,
      data: SELECTOR.getPool + padHex(p.token0) + padHex(p.token1) + padInt(p.tickSpacing),
    })),
    signal,
  );
  const pools = poolResults.map((r) => (r ? toAddress(words(r)[0]) : null));

  const slotResults = await ethCallMany(
    chainId,
    pools.filter((p): p is string => Boolean(p)).map((p) => ({ to: p, data: SELECTOR.slot0 })),
    signal,
  );
  const slotByPool = new Map<string, { tick: number; sqrtPriceX96: bigint }>();
  pools
    .filter((p): p is string => Boolean(p))
    .forEach((pool, i) => {
      const res = slotResults[i];
      if (!res) return;
      const w = words(res);
      slotByPool.set(pool, { sqrtPriceX96: toBigInt(w[0]), tick: Number(toSigned(w[1])) });
    });

  const meta = await readTokenMeta(chainId, raws.flatMap((p) => [p.token0, p.token1]), signal);
  const now = Date.now();

  report.positions = raws.map((p, i): Position => {
    const pool = pools[i];
    const slot = pool ? slotByPool.get(pool) : undefined;
    const m0 = meta.get(p.token0.toLowerCase())!;
    const m1 = meta.get(p.token1.toLowerCase())!;
    const inRange = slot ? slot.tick >= p.tickLower && slot.tick < p.tickUpper : null;
    const amounts = slot
      ? amountsFor(Number(p.liquidity), p.tickLower, p.tickUpper, slot.tick)
      : null;
    const a0 = amounts ? amounts.amount0 / 10 ** m0.decimals : null;
    const a1 = amounts ? amounts.amount1 / 10 ** m1.decimals : null;
    const label = `${m0.symbol} / ${m1.symbol}`;
    const fmt = (n: number | null) => (n == null ? "—" : n < 1 ? n.toPrecision(3) : n.toFixed(4));
    return {
      id: `velo-${p.tokenId}`,
      venue: "velodrome",
      kind: "lp-concentrated",
      symbol: label,
      symbols: [m0.symbol, m1.symbol],
      label: `${label} · ts ${p.tickSpacing}`,
      // amounts are known, USD is not: never invent a price
      notionalValue: null,
      accountId: `#${p.tokenId}`,
      parentAddress: address,
      detail: `${fmt(a0)} ${m0.symbol} + ${fmt(a1)} ${m1.symbol} · ${
        inRange == null ? "range unknown" : inRange ? "in range" : "out of range"
      }`,
      metadata: {
        tokenId: String(p.tokenId),
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        currentTick: slot?.tick ?? null,
        pool: pool ?? null,
        amount0: a0,
        amount1: a1,
        inRange,
        feesOwed0: Number(p.owed0) / 10 ** m0.decimals,
        feesOwed1: Number(p.owed1) / 10 ** m1.decimals,

      },
      fetchedAt: now,
      value: null,
    };
  });
  report.status = report.positions.length > 0 ? "ok" : "empty";
  if (report.positions.length > 0) report.note = "Amounts are on-chain; USD value not priced.";
  return report;
}
