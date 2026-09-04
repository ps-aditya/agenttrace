import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { runScenario, ScenarioConfig } from "./engine";

// A deliberately varied set of synthetic scenarios, budgets chosen by
// tracing through the actual selection logic (RuleBasedBrain picks the
// highest-priced candidate with price <= maxBudget; budget is compared
// against item price alone, not the shipping-inclusive total) so each
// scenario reliably produces the outcome its label claims, not just in
// theory. Deliberately spans every reachable state:
//   - drift where a cheaper substitute exists AND approve-as-is is still
//     within budget (both options genuinely available)
//   - drift where the total breaches the buyer's budget ceiling, so
//     approve-as-is is correctly withheld and only substitute/abort remain
//   - drift where NO substitute fits either -- the one case that forces a
//     genuine abort in auto mode, proving the bound is real, not just
//     labeled as such
//   - out-of-stock at two different budget levels, both recoverable
//   - a low-budget run where the agent picks the cheapest item from the
//     start, which the out-of-stock trigger doesn't even touch -- a
//     genuine "nothing went wrong" case, included on purpose for honesty
const SCENARIOS: Omit<ScenarioConfig, "autoApprove" | "onNarration">[] = [
  { label: "run-01-drift-recovery-optional", intent: "Buy running shoes, prioritize quality.", maxBudget: 5200, scenarioType: "drift" },
  { label: "run-02-drift-recovery-required-budget-breach", intent: "Buy running shoes, mid-range budget.", maxBudget: 4350, scenarioType: "drift" },
  { label: "run-03-drift-no-recovery-forces-abort", intent: "Buy running shoes, strict budget.", maxBudget: 3900, scenarioType: "drift" },
  { label: "run-04-oos-recovery-comfortable", intent: "Buy running shoes, prioritize quality.", maxBudget: 5200, scenarioType: "oos" },
  { label: "run-05-oos-recovery-exact-budget-match", intent: "Buy running shoes, exact budget.", maxBudget: 4799, scenarioType: "oos" },
  { label: "run-06-no-failure-cheaper-item-selected", intent: "Buy running shoes, budget conscious.", maxBudget: 3800, scenarioType: "oos" },
  { label: "run-07-drift-recovery-optional-midtier", intent: "Buy running shoes for training.", maxBudget: 4700, scenarioType: "drift" },
  { label: "run-08-oos-recovery-comfortable-2", intent: "Buy running shoes, no compromises.", maxBudget: 5500, scenarioType: "oos" },
];

async function main() {
  console.log("AgentTrace batch run");
  console.log("=====================");
  console.log(`${SCENARIOS.length} synthetic transactions queued.\n`);

  const results = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.label} ... `);
    const result = await runScenario({ ...scenario, autoApprove: true });
    const statusLabel = String(result.outcome.status).toUpperCase();
    const recoveryTag = result.recovered ? " (recovered)" : "";
    console.log(`${statusLabel}${recoveryTag}`);
    results.push(result);
  }

  // ── Aggregate ────────────────────────────────────────────────────────
  const total = results.length;
  const ordersCreated = results.filter((r) => r.outcome.status === "order_created");
  const failed = results.filter((r) => r.outcome.status === "failed");
  const aborted = results.filter((r) => r.outcome.status === "aborted");
  const hadFailure = results.filter((r) => r.failureOccurred);
  const recovered = results.filter((r) => r.recovered);

  const orderValueCreated = ordersCreated.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0);
  const revenueAtRiskFromFailures = hadFailure.reduce((sum, r) => sum + r.originalAuthorizedTotal, 0);
  const revenuePreservedByRecovery = recovered.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0);

  console.log("\n─────────────────────────────────────────────");
  console.log("BATCH SUMMARY");
  console.log("─────────────────────────────────────────────");
  console.log(`Transactions run:              ${total}`);
  console.log(`  → orders created:            ${ordersCreated.length}`);
  console.log(`  → aborted:                   ${aborted.length}`);
  console.log(`  → failed (API error):        ${failed.length}`);
  console.log(`Transactions with a failure:    ${hadFailure.length} / ${total}`);
  console.log(`  → recovered via substitute:  ${recovered.length} / ${hadFailure.length || 1}`);
  console.log(`Order value created:            ₹${orderValueCreated}`);
  console.log(`Revenue that was AT RISK:       ₹${revenueAtRiskFromFailures} (across transactions that hit a failure)`);
  console.log(`Revenue preserved by recovery:  ₹${revenuePreservedByRecovery}`);
  console.log("─────────────────────────────────────────────");

  const summary = {
    generatedAt: new Date().toISOString(),
    totalTransactions: total,
    ordersCreated: ordersCreated.length,
    aborted: aborted.length,
    failedApiError: failed.length,
    transactionsWithFailure: hadFailure.length,
    recoveredViaSubstitute: recovered.length,
    totalOrderValueCreated: orderValueCreated,
    revenueAtRiskFromFailures: revenueAtRiskFromFailures,
    revenuePreservedByRecovery: revenuePreservedByRecovery,
    perTransaction: results.map((r) => ({
      label: r.label,
      status: r.outcome.status,
      failureOccurred: r.failureOccurred,
      recovered: r.recovered,
      originalAuthorizedTotal: r.originalAuthorizedTotal,
      finalTotal: r.finalTotal,
      orderId: r.outcome.orderId ?? null,
      tracePath: r.tracePath,
    })),
  };

  const dir = path.join(__dirname, "..", "traces");
  const batchId = Date.now();

  // Copy every individual per-transaction trace into a dedicated evidence
  // folder alongside the summary. An aggregate number is a claim; these are
  // the receipts backing it -- each one independently checkable against
  // Razorpay's own Dashboard via its orderId, not just trusted because a
  // summary said so.
  const evidenceDir = path.join(dir, `batch-evidence-${batchId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (const r of results) {
    if (r.tracePath && fs.existsSync(r.tracePath)) {
      const destName = `${r.label}.json`;
      fs.copyFileSync(r.tracePath, path.join(evidenceDir, destName));
    }
  }

  const summaryPath = path.join(evidenceDir, `summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nFull batch evidence (summary + all 8 individual traces) written to:`);
  console.log(`  ${evidenceDir}`);
}

main().catch((err) => {
  console.error("Batch run crashed:", err);
  process.exit(1);
});
