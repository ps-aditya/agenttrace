import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Tracer } from "./tracer";
import { createPaymentLink, waitForPayment, issueRefund } from "./checkout";

// This is the refund-side counterpart to batch.ts. batch.ts proves the
// pre-payment recovery engine generalizes across failure classes; this
// proves the post-payment reversal path generalizes across refund shapes
// (full vs partial), using genuine captured payments -- not orders, not
// mocks.
//
// The honesty constraint that shapes this file: batch.ts can run 8
// scenarios unattended because nothing in it requires a human to click
// anything. A real payment fundamentally cannot be scripted the same way
// -- Razorpay's checkout page is not automatable by design. So this batch
// is deliberately just 2 scenarios, each needing exactly one manual click,
// rather than pretending a larger "batch" of real payments is achievable
// without a person in the loop. Padding this out to 8 scenarios by faking
// the payment step would produce impressive-looking but false evidence,
// which defeats the entire point of this project.
interface RefundScenario {
  label: string;
  amount: number;
  refundFraction: number; // 1.0 = full refund, 0.5 = 50% partial refund
  description: string;
}

const SCENARIOS: RefundScenario[] = [
  {
    label: "refund-01-full",
    amount: 3,
    refundFraction: 1.0,
    description: "AgentTrace refund-batch: full refund scenario",
  },
  {
    label: "refund-02-partial",
    amount: 5,
    refundFraction: 0.4,
    description: "AgentTrace refund-batch: 40% partial refund scenario",
  },
];

async function runScenario(scenario: RefundScenario) {
  const tracer = new Tracer();
  console.log(`\n  ${scenario.label} (₹${scenario.amount}, refund ${scenario.refundFraction * 100}%) ...`);

  const link = await createPaymentLink(scenario.amount, scenario.description);
  tracer.record("payment_attempt", { paymentLinkId: link.id, amount: scenario.amount, scenario: scenario.label });

  console.log(`  Pay here: ${link.shortUrl}`);
  console.log(`  (test card 4111 1111 1111 1111, any future expiry/CVV — waiting up to 5 min)`);

  const paid = await waitForPayment(link.id, { timeoutMs: 5 * 60 * 1000 });

  if (!paid) {
    console.log(`  ✗ ${scenario.label}: timed out, no payment completed.`);
    tracer.record("payment_result", { status: "timeout" });
    tracer.writeToFile({ status: "timeout", scenario: scenario.label });
    return { label: scenario.label, status: "timeout", amountPaid: null, refundAmount: null, refundId: null };
  }

  console.log(`  ✓ Captured: ${paid.paymentId} (₹${paid.amount})`);
  tracer.record("payment_result", {
    status: "captured",
    paymentId: paid.paymentId,
    amount: paid.amount,
    note: "REAL: genuine captured payment via checkout, not just an order.",
  });

  const refundAmount = Math.round(paid.amount * scenario.refundFraction);
  const refund = await issueRefund(paid.paymentId, refundAmount);
  tracer.record("refund_issued", {
    refundId: refund.refundId,
    status: refund.status,
    amount: refundAmount,
    fraction: scenario.refundFraction,
    isPartial: scenario.refundFraction < 1.0,
  });

  console.log(
    `  ✓ Refund issued: ${refund.refundId} — ₹${refundAmount} (${scenario.refundFraction === 1 ? "full" : "partial"})`
  );

  const filePath = tracer.writeToFile({
    status: "captured_and_refunded",
    paymentId: paid.paymentId,
    refundId: refund.refundId,
    refundAmount,
  });

  return {
    label: scenario.label,
    status: "refunded",
    amountPaid: paid.amount,
    refundAmount,
    refundId: refund.refundId,
    tracePath: filePath,
  };
}

async function main() {
  console.log("AgentTrace refund batch");
  console.log("=========================");
  console.log(`${SCENARIOS.length} real payment+refund scenarios queued.`);
  console.log("Each needs one manual checkout click -- pay both links as they appear.\n");

  const results = [];
  for (const scenario of SCENARIOS) {
    results.push(await runScenario(scenario));
  }

  const totalCaptured = results.reduce((sum, r) => sum + (r.amountPaid ?? 0), 0);
  const totalRefunded = results.reduce((sum, r) => sum + (r.refundAmount ?? 0), 0);
  const completed = results.filter((r) => r.status === "refunded").length;

  console.log("\n─────────────────────────────────────────────");
  console.log("REFUND BATCH SUMMARY");
  console.log("─────────────────────────────────────────────");
  console.log(`Scenarios run:            ${SCENARIOS.length}`);
  console.log(`Completed (paid+refunded): ${completed} / ${SCENARIOS.length}`);
  console.log(`Total captured:            ₹${totalCaptured}`);
  console.log(`Total refunded:            ₹${totalRefunded}`);
  console.log(`Net retained:              ₹${totalCaptured - totalRefunded}`);
  console.log("─────────────────────────────────────────────");

  const outPath = path.join(__dirname, "..", "traces", `refund-batch-${Date.now()}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), totalCaptured, totalRefunded, results }, null, 2)
  );
  console.log(`\nFull refund batch report written to: ${outPath}`);
}

main().catch((err) => {
  console.error("refund-batch crashed:", err);
  process.exit(1);
});
