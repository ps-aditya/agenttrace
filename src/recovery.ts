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
// Deliberately simple substitution rule: cheapest excluded-item candidate
// that still fits under the original max budget once the current shipping
// cost is included. No similarity scoring, no ML matching -- if this needs
// to get smarter later, that's an explicit extension point, not something
// to fake now.
export function findRecoveryOption(
  candidates: Product[],
  excludeId: string,
  maxBudget: number,
  currentShippingCost: number
): RecoveryOption | null {
  const alternatives = candidates
    .filter((c) => c.id !== excludeId)
    .map((c) => ({
      product: c,
      shippingCost: currentShippingCost,
      cartTotal: c.price + currentShippingCost,
    }))
    .filter((option) => option.cartTotal <= maxBudget)
    .sort((a, b) => b.cartTotal - a.cartTotal); // prefer the closest-to-budget fit, not the cheapest possible

  if (alternatives.length === 0) return null;

  const best = alternatives[0];
  return {
    product: best.product,
    shippingCost: best.shippingCost,
    cartTotal: best.cartTotal,
    fitsOriginalBudget: true,
    reasoning: `"${best.product.name}" (₹${best.product.price} + ₹${best.shippingCost} shipping = ₹${best.cartTotal}) fits within the original ₹${maxBudget} budget and is the closest-value substitute available.`,
  };
}
