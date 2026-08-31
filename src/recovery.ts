import { Product, RecoveryOption } from "./types";

// This is the piece that turns AgentTrace from a pure safety gate into a
// revenue-preserving one. A naive gated system, when it detects a problem,
// only ever has two moves: let the (now-wrong) transaction through, or kill
// it. Killing it is safe but it's also a lost sale -- for the merchant,
// indistinguishable from cart abandonment. This module's job is to check,
// before giving up, whether there's a bounded, honest way to keep the sale
// alive: a substitute that still respects what the buyer actually
// authorized (the budget), even if it's not the exact original item.
//
// --- Problem, stated formally ---
// Given n candidates with prices and categories, an excluded item id, a
// fixed shipping cost S, and a budget B: find the candidate c (c !=
// excluded, category(c) == category(excluded)) maximizing price(c) + S
// subject to price(c) + S <= B, or determine none exists.
//
// The category match is a HARD constraint, not a preference -- and it's
// here because of a real failure mode a budget-only version of this
// function has: fitting the budget is necessary but nowhere near
// sufficient for something to be a legitimate substitute. A ₹399 coffee
// mug fits almost any budget in this catalog; it is not a substitute for
// running shoes. A recovery engine that only checks price is a bad
// salesman -- it'll sell anyone anything that fits their wallet, whether
// or not it fits what they actually wanted. Constraining to the same
// category is a deliberately simple, honest way to keep "recovery" meaning
// "a genuinely comparable alternative," not "whatever's cheap enough."
//
// --- Why a single pass, not a sort ---
// A naive approach filters candidates, sorts them descending by total cost,
// and takes the first: O(n log n) time, O(n) extra space for the sorted
// copy. But the problem only asks for a single best element under a
// constraint -- you never need a full ordering to answer that. Track the
// best-so-far while scanning once instead: O(n) time, O(1) extra space,
// which matches the unavoidable Omega(n) lower bound of having to inspect
// every candidate at least once.
//
// Tie-break rule (explicit, not accidental): if two candidates produce the
// identical cart total, the first one encountered in catalog order wins.
export function findRecoveryOption(
  candidates: Product[],
  excludeId: string,
  excludeCategory: string,
  maxBudget: number,
  currentShippingCost: number
): RecoveryOption | null {
  let best: { product: Product; cartTotal: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.id === excludeId) continue; // O(1) skip, no separate filter pass
    if (candidate.category !== excludeCategory) continue; // hard constraint: must be genuinely comparable

    const cartTotal = candidate.price + currentShippingCost;
    if (cartTotal > maxBudget) continue; // violates the budget constraint, not eligible

    if (best === null || cartTotal > best.cartTotal) {
      best = { product: candidate, cartTotal };
    }
  }

  if (best === null) {
    // Formal null case: either no same-category candidate exists, every
    // same-category candidate was excluded, or every remaining one's cart
    // total exceeds the budget. All are legitimate "no recovery possible"
    // outcomes -- the caller falls back to abort, and that fallback is
    // itself correct, bounded behavior, not a bug being papered over.
    return null;
  }

  return {
    product: best.product,
    shippingCost: currentShippingCost,
    cartTotal: best.cartTotal,
    fitsOriginalBudget: true,
    reasoning: `"${best.product.name}" (₹${best.product.price} + ₹${currentShippingCost} shipping = ₹${best.cartTotal}) is the same category as the original item, fits within the original ₹${maxBudget} budget, and is the closest-value substitute available.`,
  };
}
