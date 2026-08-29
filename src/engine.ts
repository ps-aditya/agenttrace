import {
  getCandidates,
  INITIAL_SHIPPING_COST,
  simulateShippingCostAtExecutionTime,
  simulateStockCheckAtExecutionTime,
} from "./catalog";
import { RuleBasedBrain, AgentBrain } from "./brain";
import { Tracer } from "./tracer";
import { diffAuthorization } from "./verify";
import { findRecoveryOption } from "./recovery";
import { promptResolution } from "./breakpoint";
import { attemptPayment } from "./payment";
import { AuthorizedState, ExecutionState, FailureContext } from "./types";

export interface ScenarioConfig {
  label: string;
  intent: string;
  maxBudget: number;
  scenarioType: "drift" | "oos";
  autoApprove: boolean; // batch runs must be non-interactive
  onNarration?: (line: string) => void; // optional: CLI hooks in here for live output
}

export interface ScenarioResult {
  label: string;
  outcome: Record<string, unknown>;
  tracePath: string;
  originalAuthorizedTotal: number;
  finalTotal: number | null; // null if aborted -- nothing was actually charged
  failureOccurred: boolean;
  recovered: boolean;
  chosenItemName: string;
  decisionReasoning: string;
}

// This is the shared pipeline: everything index.ts (single interactive demo)
// and batch.ts (bulk real-API evidence runner) both go through. Extracting
// it once and reusing it means the batch runner is provably running the
// exact same observe/reason/verify/recover/control/audit logic as the
// single-run demo, not a parallel, possibly-diverging copy.
export async function runScenario(config: ScenarioConfig, brain: AgentBrain = new RuleBasedBrain()): Promise<ScenarioResult> {
  const tracer = new Tracer();
  const candidates = getCandidates();

  tracer.record("intent", { intent: config.intent, maxBudget: config.maxBudget });
  tracer.record("candidates", { candidates });

  const decision = await brain.decide(config.intent, config.maxBudget, candidates);
  tracer.record("decision", { ...decision });

  const chosen = candidates.find((c) => c.id === decision.chosenId);
  if (!chosen) {
    // Defense in depth: GeminiBrain and ClaudeBrain already validate their
    // own output before returning, but this guard means *any* AgentBrain
    // implementation -- including ones added later -- fails here with a
    // clear, specific message instead of a cryptic "Cannot read properties
    // of undefined" several lines further down where the real cause is
    // invisible.
    throw new Error(
      `runScenario: brain returned chosenId="${decision.chosenId}", which doesn't match any candidate (${candidates.map((c) => c.id).join(", ")}). Decision was: ${JSON.stringify(decision)}`
    );
  }

  const authorized: AuthorizedState = {
    intent: config.intent,
    maxBudget: config.maxBudget,
    itemId: chosen.id,
    itemPrice: chosen.price,
    shippingCost: INITIAL_SHIPPING_COST,
    cartTotal: chosen.price + INITIAL_SHIPPING_COST,
    currency: "INR",
    authorizationScope: "single_purchase",
    decidedAt: new Date().toISOString(),
  };
  tracer.record("authorization", { ...authorized });

  config.onNarration?.(`Agent decision: ${decision.reasoning}`);
  config.onNarration?.(
    `Authorized: ${chosen.name} @ ₹${chosen.price} + ₹${INITIAL_SHIPPING_COST} shipping = ₹${authorized.cartTotal}`
  );

  let failureCtx: FailureContext;
  let execution: ExecutionState | null = null;

  if (config.scenarioType === "oos") {
    const inStock = simulateStockCheckAtExecutionTime(chosen.id);
    tracer.record("external_change", { field: "stock", itemId: chosen.id, inStock });

    if (!inStock) {
      const recovery = findRecoveryOption(candidates, chosen.id, config.maxBudget, INITIAL_SHIPPING_COST);
      tracer.record("recovery_search", { found: !!recovery, recovery: recovery ?? null });
      failureCtx = { failureClass: "unavailable", diff: null, recovery, budgetBreached: false };
    } else {
      failureCtx = { failureClass: "cost_drift", diff: { isStale: false, fields: [], totalDelta: 0 }, recovery: null, budgetBreached: false };
    }
  } else {
    const actualShipping = simulateShippingCostAtExecutionTime();
    tracer.record("external_change", { field: "shippingCost", from: INITIAL_SHIPPING_COST, to: actualShipping });

    execution = {
      itemPrice: chosen.price,
      shippingCost: actualShipping,
      cartTotal: chosen.price + actualShipping,
      currency: "INR",
      observedAt: new Date().toISOString(),
    };
    const diff = diffAuthorization(authorized, execution);

    let recovery = null;
    if (diff.isStale) {
      recovery = findRecoveryOption(candidates, chosen.id, config.maxBudget, actualShipping);
      tracer.record("recovery_search", { found: !!recovery, recovery });
    }
    const budgetBreached = execution.cartTotal > config.maxBudget;
    failureCtx = { failureClass: "cost_drift", diff, recovery, budgetBreached };
  }

  const hasProblem = failureCtx.failureClass === "unavailable" || !!failureCtx.diff?.isStale;
  let outcome: Record<string, unknown>;
  let finalTotal: number | null = null;
  let recovered = false;

  if (hasProblem) {
    tracer.record("breakpoint_triggered", {
      failureClass: failureCtx.failureClass,
      diff: failureCtx.diff,
      recoveryAvailable: !!failureCtx.recovery,
      budgetBreached: failureCtx.budgetBreached,
    });

    const { choice, source } = await promptResolution(failureCtx, config.autoApprove);
    tracer.record("breakpoint_decision", { choice, source });

    if (choice === "abort") {
      outcome = { status: "aborted", reason: "policy declined at breakpoint", failureClass: failureCtx.failureClass };
      tracer.record("payment_result", outcome);
    } else if (choice === "accept_substitute" && failureCtx.recovery) {
      const rec = failureCtx.recovery;
      tracer.record("payment_attempt", { amount: rec.cartTotal, itemId: rec.product.id, substituted: true });
      const result = await attemptPayment(rec.cartTotal, `agenttrace-batch-${rec.product.id}`);
      tracer.record("payment_result", { ...result, substituted: true, itemId: rec.product.id });
      outcome = { status: result.status, orderId: result.orderId, note: result.note, substituted: true, finalItem: rec.product.name, finalTotal: rec.cartTotal };
      finalTotal = result.status === "captured" ? rec.cartTotal : null;
      recovered = result.status === "captured";
    } else {
      const total = execution ? execution.cartTotal : authorized.cartTotal;
      tracer.record("payment_attempt", { amount: total });
      const result = await attemptPayment(total, `agenttrace-batch-${chosen.id}`);
      tracer.record("payment_result", { ...result });
      outcome = { status: result.status, orderId: result.orderId, note: result.note, approvedAsIs: true };
      finalTotal = result.status === "captured" ? total : null;
    }
  } else {
    const total = execution ? execution.cartTotal : authorized.cartTotal;
    tracer.record("payment_attempt", { amount: total });
    const result = await attemptPayment(total, `agenttrace-batch-${chosen.id}`);
    tracer.record("payment_result", { ...result });
    outcome = { status: result.status, orderId: result.orderId, note: result.note };
    finalTotal = result.status === "captured" ? total : null;
  }

  const tracePath = tracer.writeToFile(outcome);

  return {
    label: config.label,
    outcome,
    tracePath,
    originalAuthorizedTotal: authorized.cartTotal,
    finalTotal,
    failureOccurred: hasProblem,
    recovered,
    chosenItemName: chosen.name,
    decisionReasoning: decision.reasoning,
  };
}
