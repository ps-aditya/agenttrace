// Core domain types for AgentTrace.
// These model the minimum vocabulary needed to describe an agentic purchase:
// what the agent wants, what it decided, what it was authorized to spend,
// and what actually happened when it tried to spend it.

export interface Product {
  id: string;
  name: string;
  price: number; // in INR (rupees, not paise) for readability
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

export type TraceEventType =
  | "intent"
  | "candidates"
  | "decision"
  | "authorization"
  | "external_change"
  | "breakpoint_triggered"
  | "breakpoint_decision"
  | "payment_attempt"
  | "payment_result";

export interface TraceEvent {
  seq: number;
  timestamp: string;
  type: TraceEventType;
  data: Record<string, unknown>;
}

export interface PaymentOutcome {
  status: "captured" | "aborted" | "failed";
  orderId?: string;
  reason?: string;
  note?: string;
}
