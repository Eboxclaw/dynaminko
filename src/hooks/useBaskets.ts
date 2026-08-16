import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useDoc } from "@/hooks/useDoc";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useVenues } from "@/hooks/useVenues";
import {
  composeBaskets,
  composeNetWorth,
  perpExposure,
  unpricedVenueSymbols,
} from "@/lib/exposure";
import { fetchQuotes, type Quote } from "@/lib/prices";

/**
 * The composed picture: wallet holdings + venue spot in one basket model,
 * net worth = wallet + venue equity, and open perps as an exposure list.
 * Venue symbols the wallet quotes don't cover get their own small quote query.
 */
export function useBaskets() {
  const doc = useDoc();
  const overrides = doc.settings.basketOverrides;
  const { portfolio, quotes } = usePortfolio();
  const { reports } = useVenues();

  const venueSymbols = useMemo(() => unpricedVenueSymbols(reports, quotes), [reports, quotes]);

  const extra = useQuery({
    queryKey: ["quotes", `venue:${venueSymbols.join(",")}`],
    enabled: venueSymbols.length > 0,
    staleTime: 60_000,
    refetchInterval: 180_000,
    queryFn: ({ signal }) => fetchQuotes(venueSymbols, signal).catch(() => [] as Quote[]),
  });

  const allQuotes = useMemo(() => [...quotes, ...(extra.data ?? [])], [quotes, extra.data]);

  const baskets = useMemo(
    () => composeBaskets(portfolio, reports, allQuotes, overrides),
    [portfolio, reports, allQuotes, overrides],
  );
  const netWorth = useMemo(() => composeNetWorth(portfolio, reports), [portfolio, reports]);
  const trades = useMemo(() => perpExposure(reports), [reports]);

  return { baskets, netWorth, trades, quotes: allQuotes };
}
