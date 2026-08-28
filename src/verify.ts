import { AuthorizedState, ExecutionState, StaleAuthorizationDiff } from "./types";

// This is the "verify" layer. It answers exactly one question:
// does what the agent is about to pay match what it was authorized to pay?
//
// Deliberately narrow: it only compares itemPrice, shippingCost, and
// cartTotal. It does not try to detect every possible way a transaction
// could drift (currency swaps, quantity changes, tax changes, fraud
// signals). Widening this is explicit future scope, not something to
// half-implement now.
export function diffAuthorization(
  authorized: AuthorizedState,
  actual: ExecutionState
): StaleAuthorizationDiff {
  const fields: StaleAuthorizationDiff["fields"] = [];

  const checks: [string, number, number][] = [
    ["itemPrice", authorized.itemPrice, actual.itemPrice],
    ["shippingCost", authorized.shippingCost, actual.shippingCost],
    ["cartTotal", authorized.cartTotal, actual.cartTotal],
  ];

  for (const [field, auth, real] of checks) {
    if (auth !== real) {
      fields.push({ field, authorized: auth, actual: real, delta: real - auth });
    }
  }

  const totalDelta = actual.cartTotal - authorized.cartTotal;

  return {
    isStale: fields.length > 0,
    fields,
    totalDelta,
  };
}
