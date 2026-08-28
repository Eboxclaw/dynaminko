// Fail-closed numeric grounding for agent answers.
//
// GROUND_RULES tell the model to only cite numbers from FACTS and TURN
// OBSERVATIONS, but a rule is a soft prompt: the live baseline caught the
// 450M summing position sizes into an invented "1,000.60 USD" and concluding
// both venues were equal. This check runs after generation: any number in the
// answer that the turn's evidence never carried gets flagged in the message
// itself, so the user sees exactly which figures to distrust.

/**
 * Numbers in `answer` that cannot be found in `evidence`. Both sides are
 * tokenized the same way: URLs are stripped first (their ids and versions are
 * not claims), then number-like tokens are normalized (commas, spaces,
 * currency and percent signs removed, trailing decimal zeros dropped) and the
 * answer tokens are checked against the evidence token set.
 *
 * Conservative by design: single-digit integers never flag ("answer in 2 to 4
 * sentences" must not trip it), so the check only fires on numbers with a
 * decimal point or at least two digits, which is where hallucinated
 * derivations live.
 */
export function unverifiedNumbers(answer: string, evidence: string): string[] {
  const evidenceTokens = new Set(numberTokens(stripUrls(evidence)).map(normalize));
  const misses: string[] = [];
  for (const token of numberTokens(stripUrls(answer))) {
    const digits = token.replace(/\D/g, "");
    if (digits.length < 2 && !token.includes(".")) continue;
    const normalized = normalize(token);
    if (normalized && !evidenceTokens.has(normalized) && !misses.includes(token)) {
      misses.push(token);
    }
  }
  return misses;
}

/** Same regex on both sides so a match means the same shape was written. */
const NUMBER_TOKEN = /\$?\d(?:[\d,]*\d)?(?:\.\d+)?%?/g;

function numberTokens(text: string): string[] {
  return text.match(NUMBER_TOKEN) ?? [];
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, " ");
}

/**
 * Token key: lowercase, separators and unit signs dropped, trailing decimal
 * zeros trimmed ("$1,849" and "1849" collide, "1,000.60" and "1000.6" too).
 */
function normalize(token: string): string {
  const bare = token.toLowerCase().replace(/[$,%+\-\s]/g, "");
  if (!bare.includes(".")) return bare;
  return bare.replace(/0+$/, "").replace(/\.$/, "");
}
