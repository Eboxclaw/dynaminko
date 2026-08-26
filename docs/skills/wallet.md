# skill: wallet.holdings

Purpose: answer "what does my wallet hold", reading live data only.

Actions:
- wallet.holdings — holdings, basket split, net worth, and open positions

Tools:
- portfolio.read, portfolio.netWorth, portfolio.positions-perps

AI required: yes. The model interprets the structured result and must call out
any unpriced tokens.

Flow:

```text
intent → portfolio.read + portfolio.netWorth + portfolio.positions-perps
       → structured result → AI summary (top holdings, basket split, net worth,
         open positions)
```

Output: a short, concrete answer: top holdings by value, the basket split, net
worth, and open positions. Numbers come from the structured result; unpriced
tokens are flagged, not guessed.

Approval: none (read/compute only). Logging: skill invocation logged, no mutations.
Note: the agent only reads. Signing, trading, or any wallet write is user-only.
