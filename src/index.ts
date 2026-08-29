import "dotenv/config";
import {
  getCandidates,
  INITIAL_SHIPPING_COST,
  simulateShippingCostAtExecutionTime,
  simulateStockCheckAtExecutionTime,
} from "./catalog";
import { RuleBasedBrain } from "./brain";
import { Tracer } from "./tracer";
import { diffAuthorization } from "./verify";
import { findRecoveryOption } from "./recovery";
import { promptResolution } from "./breakpoint";
import { attemptPayment } from "./payment";
import { AuthorizedState, ExecutionState, FailureContext } from "./types";

const AUTO_APPROVE = process.argv.includes("--auto-approve");
const SCENARIO = process.argv.includes("--scenario=oos") ? "oos" : "drift";

async function main() {
  const tracer = new Tracer();
  const brain = new RuleBasedBrain();

  const intent = "Buy me running shoes, budget ₹5000, prioritize quality over price.";
  const maxBudget = 5000;

  console.log("AgentTrace demo run");
  console.log("===================");
  console.log(`Scenario: ${SCENARIO === "oos" ? "item goes out of stock" : "shipping cost drift"}`);
  console.log(`Intent: ${intent}\n`);

  // --- OBSERVE + REASON ---------------------------------------------
  const candidates = getCandidates();
  tracer.record("intent", { intent, maxBudget });
  tracer.record("candidates", { candidates });

  const decision = await brain.decide(intent, maxBudget, candidates);
  tracer.record("decision", { ...decision });
  console.log(`Agent decision: ${decision.reasoning}\n`);

  const chosen = candidates.find((c) => c.id === decision.chosenId)!;

  // --- AUTHORIZATION SNAPSHOT (the "mandate") ------------------------
  const authorized: AuthorizedState = {
    intent,
    maxBudget,
    itemId: chosen.id,
    itemPrice: chosen.price,
    shippingCost: INITIAL_SHIPPING_COST,
    cartTotal: chosen.price + INITIAL_SHIPPING_COST,
    currency: "INR",
    authorizationScope: "single_purchase",
    decidedAt: new Date().toISOString(),
  };
  tracer.record("authorization", { ...authorized });
  console.log(
    `Authorized: ${chosen.name} @ ₹${chosen.price} + ₹${INITIAL_SHIPPING_COST} shipping = ₹${authorized.cartTotal}\n`
  );

  // --- EXTERNAL CHANGE (scripted, deterministic) ----------------------
  let failureCtx: FailureContext;
  let execution: ExecutionState | null = null;

  if (SCENARIO === "oos") {
    const inStock = simulateStockCheckAtExecutionTime(chosen.id);
    tracer.record("external_change", { field: "stock", itemId: chosen.id, inStock });

    if (!inStock) {
      const recovery = findRecoveryOption(candidates, chosen.id, maxBudget, INITIAL_SHIPPING_COST);
      tracer.record("recovery_search", {
        found: !!recovery,
        recovery: recovery ?? null,
      });
      failureCtx = { failureClass: "unavailable", diff: null, recovery };
    } else {
      failureCtx = { failureClass: "cost_drift", diff: { isStale: false, fields: [], totalDelta: 0 }, recovery: null };
    }
  } else {
    const actualShipping = simulateShippingCostAtExecutionTime();
    tracer.record("external_change", {
      field: "shippingCost",
      from: INITIAL_SHIPPING_COST,
      to: actualShipping,
    });

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
      recovery = findRecoveryOption(candidates, chosen.id, maxBudget, actualShipping);
      tracer.record("recovery_search", { found: !!recovery, recovery });
    }
    failureCtx = { failureClass: "cost_drift", diff, recovery };
  }

  // --- VERIFY + CONTROL -------------------------------------------------
  const hasProblem = failureCtx.failureClass === "unavailable" || !!failureCtx.diff?.isStale;
  let outcome: Record<string, unknown>;

  if (hasProblem) {
    tracer.record("breakpoint_triggered", {
      failureClass: failureCtx.failureClass,
      diff: failureCtx.diff,
      recoveryAvailable: !!failureCtx.recovery,
    });

    const { choice, source } = await promptResolution(failureCtx, AUTO_APPROVE);
    tracer.record("breakpoint_decision", { choice, source });

    if (choice === "abort") {
      outcome = { status: "aborted", reason: "human/policy declined at breakpoint", failureClass: failureCtx.failureClass };
      tracer.record("payment_result", outcome);
      console.log("Result: ABORTED. No payment attempted.\n");
    } else if (choice === "accept_substitute" && failureCtx.recovery) {
      const rec = failureCtx.recovery;
      tracer.record("payment_attempt", { amount: rec.cartTotal, itemId: rec.product.id, substituted: true });
      const result = await attemptPayment(rec.cartTotal, `agenttrace-substitute-${rec.product.id}`);
      tracer.record("payment_result", { ...result, substituted: true, itemId: rec.product.id });
      outcome = {
        status: result.status,
        orderId: result.orderId,
        note: result.note,
        substituted: true,
        finalItem: rec.product.name,
        finalTotal: rec.cartTotal,
      };
      console.log(
        `Result: ${result.status.toUpperCase()} via substitute "${rec.product.name}" @ ₹${rec.cartTotal} (${result.note})\n`
      );
    } else {
      // approve_as_is
      const total = execution ? execution.cartTotal : authorized.cartTotal;
      tracer.record("payment_attempt", { amount: total });
      const result = await attemptPayment(total, `agenttrace-${chosen.id}`);
      tracer.record("payment_result", { ...result });
      outcome = { status: result.status, orderId: result.orderId, note: result.note, approvedAsIs: true };
      console.log(`Result: ${result.status.toUpperCase()} as-is (${result.note})\n`);
    }
  } else {
    const total = execution ? execution.cartTotal : authorized.cartTotal;
    tracer.record("payment_attempt", { amount: total });
    const result = await attemptPayment(total, `agenttrace-${chosen.id}`);
    tracer.record("payment_result", { ...result });
    outcome = { status: result.status, orderId: result.orderId, note: result.note };
    console.log(`No problem detected. Result: ${result.status.toUpperCase()} (${result.note})\n`);
  }

  const filePath = tracer.writeToFile(outcome);
  console.log(`Full trace written to: ${filePath}`);

  const statusLabel = String(outcome.status).toUpperCase();
  const events = tracer.getEvents().length;
  console.log(`\nSummary: ${statusLabel} · scenario=${SCENARIO} · ${events} events logged`);
}

main().catch((err) => {
  console.error("AgentTrace demo crashed:", err);
  process.exit(1);
});
