// Core domain types for AgentTrace.
// These model the minimum vocabulary needed to describe an agentic purchase:
// what the agent wants, what it decided, what it was authorized to spend,
// and what actually happened when it tried to spend it.

export type AttributeValue = string | number | boolean;

export interface Product {
  id: string;
  name: string;
  price: number; // in INR (rupees, not paise) for readability
  category: string; // hard constraint: recovery never crosses categories
  tier: "budget" | "mid" | "premium"; // positioning, distinct from price alone
  tags: string[]; // feature signals used for similarity scoring, e.g. ["trail", "cushioned"]
  // A provider supplies only facts it can actually observe. A mandate that
  // requires a missing fact rejects the candidate; it never guesses.
  attributes: Record<string, AttributeValue>;
  availableForSale: boolean;
}

export interface AgentDecision {
  chosenId: string;
  reasoning: string;
}

// The state the agent believed was true when it decided to proceed.
// This is the "mandate" concept, simplified: a snapshot of what was
// authorized, not just what was requested.
export interface AuthorizedState {
  intent: string;
  maxBudget: number;
  itemId: string;
  itemPrice: number;
  shippingCost: number;
  cartTotal: number;
  currency: string;
  authorizationScope: "single_purchase";
  decidedAt: string; // ISO timestamp
}

// The state actually present at the moment of payment execution.
// If this diverges from AuthorizedState, the authorization is stale.
export interface ExecutionState {
  itemPrice: number;
  shippingCost: number;
  cartTotal: number;
  currency: string;
  observedAt: string;
}

export interface StaleAuthorizationDiff {
  isStale: boolean;
  fields: {
    field: string;
    authorized: number;
    actual: number;
    delta: number;
  }[];
  totalDelta: number;
}

// The class of failure determines what recovery paths are even possible.
// "cost_drift": the originally chosen item is still purchasable, but the
//   total has moved (shipping/price change). Recovery is optional here --
//   a human can still approve the original item as-is if the drift is
//   acceptable to them.
// "unavailable": the originally chosen item cannot be purchased at all
//   (out of stock at execution time). There is no "approve as-is" path --
//   the only ways forward are a substitute or an abort.
export type FailureClass = "cost_drift" | "unavailable";

// A candidate substitute the recovery engine found: something that still
// satisfies the original budget and category, and is scored against the
// original item on price closeness, tier match, and tag overlap. Every
// component of the score is exposed here, not just the final number --
// "explainable" means a human can see exactly why this candidate won, not
// just trust that it did.
export interface RecoveryScoreBreakdown {
  priceCloseness: number; // 0..1, 1 = identical price to original
  tierMatch: number; // 0, 0.5, or 1
  tagOverlap: number; // 0..1, Jaccard similarity of tags
  weightedScore: number; // the combined score actually used to rank candidates
}

// The buyer's decision is a contract, not a similarity search. Functional
// and fulfilment requirements are exact matches over provider-supplied facts.
// If a candidate does not expose a required fact, it is not eligible.
export interface RecoveryMandate {
  originalProductId: string;
  category: string;
  functionalRequirements: Record<string, AttributeValue>;
  fulfilmentRequirements: Record<string, AttributeValue>;
  economics: {
    maxCartTotal: number;
    maxItemPriceIncrease?: number;
  };
  substitutionConsent: "direct_equivalent" | "human_approval_required";
  capturedAt: string;
}

export interface MandateEvaluation {
  eligible: boolean;
  rejectionReasons: string[];
}

export interface RecoveryOption {
  product: Product;
  shippingCost: number;
  cartTotal: number;
  fitsOriginalBudget: boolean;
  score: RecoveryScoreBreakdown;
  mandate: MandateEvaluation;
  requiresHumanApproval: boolean;
  reasoning: string;
}

export interface FailureContext {
  failureClass: FailureClass;
  diff: StaleAuthorizationDiff | null;
  recovery: RecoveryOption | null;
  // True when the actual total at execution time exceeds the buyer's
  // stated maxBudget -- not just the specific total the agent happened to
  // commit to at decision time. This is the real bound: "budget ₹5000"
  // pre-authorizes anything under ₹5000, not only the exact figure the
  // agent picked. approve_as_is must never be offered (let alone
  // auto-selected) when this is true, or the system would silently pay
  // more than the buyer ever agreed to.
  budgetBreached: boolean;
}

export type BreakpointChoice = "approve_as_is" | "accept_substitute" | "abort";


export type TraceEventType =
  | "intent"
  | "candidates"
  | "decision"
  | "authorization"
  | "external_change"
  | "breakpoint_triggered"
  | "recovery_search"
  | "breakpoint_decision"
  | "payment_attempt"
  | "payment_result"
  | "refund_issued"
  | "webhook_received";

export interface TraceEvent {
  seq: number;
  timestamp: string;
  type: TraceEventType;
  data: Record<string, unknown>;
}

export interface PaymentOutcome {
  // Creating a Razorpay Order is not a captured Payment. Captured applies
  // only to the hosted-checkout payment flow in checkout.ts.
  status: "order_created" | "mock_order_created" | "failed";
  orderId?: string;
  reason?: string;
  note?: string;
}
