import "dotenv/config";
import { getCandidates, INITIAL_SHIPPING_COST, simulateShippingCostAtExecutionTime } from "./catalog";
import { RuleBasedBrain } from "./brain";
import { Tracer } from "./tracer";
import { diffAuthorization } from "./verify";
import { promptApproveOrAbort } from "./breakpoint";
import { attemptPayment } from "./payment";
import { AuthorizedState, ExecutionState } from "./types";

const AUTO_APPROVE = process.argv.includes("--auto-approve");

async function main() {
  const tracer = new Tracer();
  const brain = new RuleBasedBrain();

  const intent = "Buy me running shoes, budget ₹5000, prioritize quality over price.";
  const maxBudget = 5000;

  console.log("AgentTrace demo run");
  console.log("===================");
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
  const actualShipping = simulateShippingCostAtExecutionTime();
  tracer.record("external_change", {
    field: "shippingCost",
    from: INITIAL_SHIPPING_COST,
    to: actualShipping,
  });

  // --- VERIFY ---------------------------------------------------------
  const execution: ExecutionState = {
    itemPrice: chosen.price,
    shippingCost: actualShipping,
    cartTotal: chosen.price + actualShipping,
    currency: "INR",
    observedAt: new Date().toISOString(),
  };
  const diff = diffAuthorization(authorized, execution);

  let outcome: Record<string, unknown>;

  if (diff.isStale) {
    tracer.record("breakpoint_triggered", { diff });

    // --- CONTROL ---------------------------------------------------
    const { approved, source } = await promptApproveOrAbort(diff, AUTO_APPROVE);
    tracer.record("breakpoint_decision", { approved, source });

    if (!approved) {
      outcome = { status: "aborted", reason: "human declined at breakpoint", diff };
      tracer.record("payment_result", outcome);
      console.log("Result: ABORTED. No payment attempted.\n");
    } else {
      tracer.record("payment_attempt", { amount: execution.cartTotal });
      const result = await attemptPayment(execution.cartTotal, `agenttrace-${chosen.id}`);
      tracer.record("payment_result", { ...result });
      outcome = { status: result.status, orderId: result.orderId, note: result.note, diff };
      console.log(`Result: ${result.status.toUpperCase()} (${result.note})\n`);
    }
  } else {
    tracer.record("payment_attempt", { amount: execution.cartTotal });
    const result = await attemptPayment(execution.cartTotal, `agenttrace-${chosen.id}`);
    tracer.record("payment_result", { ...result });
    outcome = { status: result.status, orderId: result.orderId, note: result.note };
    console.log(`No drift detected. Result: ${result.status.toUpperCase()} (${result.note})\n`);
  }

  const filePath = tracer.writeToFile(outcome);
  console.log(`Full trace written to: ${filePath}`);

  const statusLabel = String(outcome.status).toUpperCase();
  const driftLabel = diff.isStale ? `stale auth caught (Δ ₹${diff.totalDelta})` : "no drift";
  console.log(`\nSummary: ${statusLabel} · ${driftLabel} · ${tracer.getEvents().length} events logged`);
}

main().catch((err) => {
  console.error("AgentTrace demo crashed:", err);
  process.exit(1);
});
