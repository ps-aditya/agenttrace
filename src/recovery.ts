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
// Given n candidates with prices, an excluded item id, a fixed shipping
// cost S, and a budget B: find the candidate c (c != excluded) maximizing
// price(c) + S subject to price(c) + S <= B, or determine none exists.
// "Maximizing under the budget" is the rule, not "cheapest available" --
// the goal is the closest-value honest substitute, not the bargain-bin one.
//
// --- Why a single pass, not a sort ---
// A naive approach filters candidates, sorts them descending by total cost,
// and takes the first: O(n log n) time, O(n) extra space for the sorted
// copy. But the problem only asks for a single best element under a
// constraint -- you never need a full ordering to answer that. This is the
// same shape as a running-max-under-constraint scan (the same trick behind
// single-pass "best time to buy/sell stock" style problems): track the
// best-so-far while scanning once.
//
// You must still inspect every candidate at least once to know whether a
// better one exists -- that's an unavoidable Omega(n) lower bound for this
// problem shape, since nothing about an unsorted candidate list lets you
// skip an element without risking missing the true best fit. A single pass
// achieves O(n) time and O(1) extra space, which matches that lower bound.
// That makes it asymptotically optimal, not just faster in practice.
//
// Tie-break rule (explicit, not accidental): if two candidates produce the
// identical cart total, the first one encountered in catalog order wins.
// This is a deliberate, documented choice, not an artifact of sort stability.
export function findRecoveryOption(
  candidates: Product[],
  excludeId: string,
  maxBudget: number,
  currentShippingCost: number
): RecoveryOption | null {
  let best: { product: Product; cartTotal: number } | null = null;

  for (const candidate of candidates) {
    if (candidate.id === excludeId) continue; // O(1) skip, no separate filter pass

    const cartTotal = candidate.price + currentShippingCost;
    if (cartTotal > maxBudget) continue; // violates the constraint, not eligible

    if (best === null || cartTotal > best.cartTotal) {
      best = { product: candidate, cartTotal };
    }
  }

  if (best === null) {
    // Formal null case: either every candidate was excluded, or every
    // remaining candidate's cart total exceeds the budget even at the
    // current shipping cost. Both are legitimate "no recovery possible"
    // outcomes -- the caller falls back to abort, and that fallback is
    // itself the correct, bounded behavior, not a bug being papered over.
    return null;
  }

  return {
    product: best.product,
    shippingCost: currentShippingCost,
    cartTotal: best.cartTotal,
    fitsOriginalBudget: true,
    reasoning: `"${best.product.name}" (₹${best.product.price} + ₹${currentShippingCost} shipping = ₹${best.cartTotal}) fits within the original ₹${maxBudget} budget and is the closest-value substitute available.`,
  };
}
