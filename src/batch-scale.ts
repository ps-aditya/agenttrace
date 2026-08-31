import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { runScenario, ScenarioConfig } from "./engine";

// batch.ts (8 scenarios) is deliberately hand-designed: every scenario
// exists to prove one specific, named point (budget-breach gating, a
// forced abort, an exact-budget-match). This file exists for a different,
// complementary reason: 8 real transactions invite a fair question --
// "is that just cherry-picked?" A larger, randomized sample answers that
// without needing to hand-write 100 scenario objects.
//
// Budgets are drawn from a range deliberately kept above the cheapest
// footwear item's price (₹3599) -- see the README's Scope section for why:
// RuleBasedBrain has no category-awareness of its own, so a budget below
// that floor could let it select the deliberately-mismatched catalog item
// (the mug) as the *initial* decision, which is a different, known,
// unfixed limitation this batch isn't testing and shouldn't accidentally
// trigger.
const COUNT = Number(process.argv.find((a) => a.startsWith("--count="))?.split("=")[1]) || 100;
const MIN_BUDGET = 3900; // stays above the footwear floor
const MAX_BUDGET = 5600;

function randomScenario(index: number): Omit<ScenarioConfig, "autoApprove" | "onNarration"> {
  const budget = Math.round(MIN_BUDGET + Math.random() * (MAX_BUDGET - MIN_BUDGET));
  const scenarioType: "drift" | "oos" = Math.random() < 0.5 ? "drift" : "oos";
  return {
    label: `scale-${String(index + 1).padStart(3, "0")}-${scenarioType}-budget${budget}`,
    intent: "Buy running shoes for daily training.",
    maxBudget: budget,
    scenarioType,
  };
}

async function main() {
  console.log("AgentTrace scale batch");
  console.log("=========================");
  console.log(`${COUNT} randomized transactions queued against the real Razorpay Orders API.`);
  console.log(`Budgets drawn uniformly from ₹${MIN_BUDGET}–₹${MAX_BUDGET}, scenario type 50/50 drift/oos.`);
  console.log(`This is real randomness (Math.random()), not seeded -- re-running produces different`);
  console.log(`exact numbers each time. That's an honest property, not a flaw: it's evidence this`);
  console.log(`isn't a hardcoded, memorized sequence.\n`);

  const results = [];
  const startedAt = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const scenario = randomScenario(i);
    process.stdout.write(`  [${i + 1}/${COUNT}] ${scenario.label} ... `);
    try {
      const result = await runScenario({ ...scenario, autoApprove: true });
      const statusLabel = String(result.outcome.status).toUpperCase();
      const recoveryTag = result.recovered ? " (recovered)" : "";
      console.log(`${statusLabel}${recoveryTag}`);
      results.push(result);
    } catch (err: any) {
      console.log(`CRASHED: ${err.message}`);
      results.push({
        label: scenario.label,
        outcome: { status: "failed" as const, reason: err.message },
        failureOccurred: true,
        recovered: false,
        originalAuthorizedTotal: 0,
        finalTotal: null,
        tracePath: null,
      });
    }
  }

  const durationMs = Date.now() - startedAt;

  // ── Aggregate ────────────────────────────────────────────────────────
  const total = results.length;
  const captured = results.filter((r) => r.outcome.status === "captured");
  const failed = results.filter((r) => r.outcome.status === "failed");
  const aborted = results.filter((r) => r.outcome.status === "aborted");
  const hadFailure = results.filter((r) => r.failureOccurred);
  const recovered = results.filter((r) => r.recovered);

  const revenueCaptured = captured.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0);
  const revenueAtRiskFromFailures = hadFailure.reduce((sum, r) => sum + r.originalAuthorizedTotal, 0);
  const revenuePreservedByRecovery = recovered.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0);

  console.log("\n─────────────────────────────────────────────");
  console.log("SCALE BATCH SUMMARY");
  console.log("─────────────────────────────────────────────");
  console.log(`Transactions run:              ${total}`);
  console.log(`  → orders created:            ${captured.length}`);
  console.log(`  → aborted:                   ${aborted.length}`);
  console.log(`  → crashed (real error):      ${failed.length}`);
  console.log(`Transactions with a failure:    ${hadFailure.length} / ${total}`);
  console.log(`  → recovered via substitute:  ${recovered.length} / ${hadFailure.length || 1}`);
  console.log(`Total order value:              ₹${revenueCaptured}`);
  console.log(`Value that was AT RISK:         ₹${revenueAtRiskFromFailures}`);
  console.log(`Value preserved by recovery:    ₹${revenuePreservedByRecovery}`);
  console.log(`Wall-clock time:                ${(durationMs / 1000).toFixed(1)}s (${(durationMs / total).toFixed(0)}ms/txn avg)`);
  console.log("─────────────────────────────────────────────");

  const summary = {
    generatedAt: new Date().toISOString(),
    kind: "scale-batch-randomized",
    totalTransactions: total,
    ordersCreated: captured.length,
    aborted: aborted.length,
    crashed: failed.length,
    transactionsWithFailure: hadFailure.length,
    recoveredViaSubstitute: recovered.length,
    totalOrderValue: revenueCaptured,
    valueAtRisk: revenueAtRiskFromFailures,
    valuePreservedByRecovery: revenuePreservedByRecovery,
    durationMs,
    perTransaction: results.map((r) => ({
      label: r.label,
      status: r.outcome.status,
      failureOccurred: r.failureOccurred,
      recovered: r.recovered,
      originalAuthorizedTotal: r.originalAuthorizedTotal,
      finalTotal: r.finalTotal,
      orderId: (r.outcome as any).orderId ?? null,
    })),
  };

  const dir = path.join(__dirname, "..", "traces");
  const batchId = Date.now();
  const evidenceDir = path.join(dir, `scale-batch-evidence-${batchId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  for (const r of results) {
    if (r.tracePath && fs.existsSync(r.tracePath)) {
      fs.copyFileSync(r.tracePath, path.join(evidenceDir, `${r.label}.json`));
    }
  }

  const summaryPath = path.join(evidenceDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nFull scale-batch evidence written to: ${evidenceDir}`);
  console.log(`(${results.filter((r) => r.tracePath).length} individual traces + summary.json)`);
}

main().catch((err) => {
  console.error("Scale batch crashed:", err);
  process.exit(1);
});
