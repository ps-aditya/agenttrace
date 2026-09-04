import {
  AttributeValue,
  MandateEvaluation,
  Product,
  RecoveryMandate,
  RecoveryOption,
  RecoveryScoreBreakdown,
} from "./types";

// Ranking is deliberately the last step. A candidate must first preserve the
// buyer's explicit mandate; a high similarity score can never compensate for
// a missing size, capability, fulfilment term, or availability fact.
const WEIGHTS = { priceCloseness: 0.5, tierMatch: 0.3, tagOverlap: 0.2 };
const TIER_ORDER: Product["tier"][] = ["budget", "mid", "premium"];

function scoreTierMatch(a: Product["tier"], b: Product["tier"]): number {
  if (a === b) return 1;
  return Math.abs(TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)) === 1 ? 0.5 : 0;
}

function scoreTagOverlap(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((tag) => setB.has(tag)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function scoreCandidate(candidate: Product, original: Product): RecoveryScoreBreakdown {
  const priceCloseness = Math.max(0, 1 - Math.abs(candidate.price - original.price) / original.price);
  const tierMatch = scoreTierMatch(candidate.tier, original.tier);
  const tagOverlap = scoreTagOverlap(candidate.tags, original.tags);
  return {
    priceCloseness,
    tierMatch,
    tagOverlap,
    weightedScore:
      priceCloseness * WEIGHTS.priceCloseness + tierMatch * WEIGHTS.tierMatch + tagOverlap * WEIGHTS.tagOverlap,
  };
}

function matchesRequirements(
  candidate: Product,
  requirements: Record<string, AttributeValue>,
  family: "functional" | "fulfilment"
): string[] {
  const reasons: string[] = [];
  for (const [key, expected] of Object.entries(requirements)) {
    const actual = candidate.attributes[key];
    if (actual === undefined) reasons.push(`${family} attribute "${key}" is unknown`);
    else if (actual !== expected) reasons.push(`${family} attribute "${key}" is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
  return reasons;
}

/** Evaluate hard contract conditions independently of similarity ranking. */
export function evaluateRecoveryMandate(
  candidate: Product,
  original: Product,
  mandate: RecoveryMandate,
  shippingCost: number
): MandateEvaluation {
  const rejectionReasons: string[] = [];
  const cartTotal = candidate.price + shippingCost;

  if (mandate.originalProductId !== original.id) rejectionReasons.push("mandate does not belong to the supplied original product");
  if (!candidate.availableForSale) rejectionReasons.push("candidate is not available for sale");
  if (candidate.id === original.id) rejectionReasons.push("candidate is the original product");
  if (candidate.category !== mandate.category) rejectionReasons.push("candidate category differs from the mandate");
  if (cartTotal > mandate.economics.maxCartTotal) rejectionReasons.push("candidate exceeds the authorized cart total");
  if (
    mandate.economics.maxItemPriceIncrease !== undefined &&
    candidate.price - original.price > mandate.economics.maxItemPriceIncrease
  ) {
    rejectionReasons.push("candidate exceeds the authorized item-price increase");
  }
  rejectionReasons.push(...matchesRequirements(candidate, mandate.functionalRequirements, "functional"));
  rejectionReasons.push(...matchesRequirements(candidate, mandate.fulfilmentRequirements, "fulfilment"));
  return { eligible: rejectionReasons.length === 0, rejectionReasons };
}

/**
 * Capture the explicit contract from facts observed when the agent chooses.
 * Callers select fields; the demo passes its own small, visible field set.
 */
export function captureRecoveryMandate(
  original: Product,
  economics: RecoveryMandate["economics"],
  options: {
    functionalKeys?: string[];
    fulfilmentKeys?: string[];
    substitutionConsent?: RecoveryMandate["substitutionConsent"];
  } = {}
): RecoveryMandate {
  const pick = (keys: string[]) => {
    const values: Record<string, AttributeValue> = {};
    for (const key of keys) {
      const value = original.attributes[key];
      if (value === undefined) throw new Error(`Cannot capture mandate: original product does not expose required attribute "${key}"`);
      values[key] = value;
    }
    return values;
  };

  return {
    originalProductId: original.id,
    category: original.category,
    functionalRequirements: pick(options.functionalKeys ?? []),
    fulfilmentRequirements: pick(options.fulfilmentKeys ?? []),
    economics,
    substitutionConsent: options.substitutionConsent ?? "direct_equivalent",
    capturedAt: new Date().toISOString(),
  };
}

export function findRecoveryOption(
  candidates: Product[],
  original: Product,
  mandate: RecoveryMandate,
  currentShippingCost: number
): RecoveryOption | null {
  let best: { product: Product; cartTotal: number; score: RecoveryScoreBreakdown; mandate: MandateEvaluation } | null = null;

  for (const candidate of candidates) {
    const evaluation = evaluateRecoveryMandate(candidate, original, mandate, currentShippingCost);
    if (!evaluation.eligible) continue;
    const score = scoreCandidate(candidate, original);
    if (best === null || score.weightedScore > best.score.weightedScore) {
      best = { product: candidate, cartTotal: candidate.price + currentShippingCost, score, mandate: evaluation };
    }
  }

  if (best === null) return null;
  const { product, cartTotal, score, mandate: evaluation } = best;
  return {
    product,
    shippingCost: currentShippingCost,
    cartTotal,
    fitsOriginalBudget: true,
    score,
    mandate: evaluation,
    requiresHumanApproval: mandate.substitutionConsent === "human_approval_required",
    reasoning: `"${product.name}" preserves every required mandate attribute, is available for sale, and totals ₹${cartTotal}. It ranked highest only after eligibility (price closeness ${score.priceCloseness.toFixed(2)}, tier match ${score.tierMatch.toFixed(2)}, tag overlap ${score.tagOverlap.toFixed(2)}).`,
  };
}
