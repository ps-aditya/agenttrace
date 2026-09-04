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
const DELAY_MS = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1]) || 300;
const TRIALS = Number(process.argv.find((a) => a.startsWith("--trials="))?.split("=")[1]) || 1;
const MIN_BUDGET = 3900; // stays above the footwear floor
const MAX_BUDGET = 5600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomScenario(index: number, trialIndex: number): Omit<ScenarioConfig, "autoApprove" | "onNarration"> {
  const budget = Math.round(MIN_BUDGET + Math.random() * (MAX_BUDGET - MIN_BUDGET));
  const scenarioType: "drift" | "oos" = Math.random() < 0.5 ? "drift" : "oos";
  return {
    label: `trial${trialIndex + 1}-scale-${String(index + 1).padStart(3, "0")}-${scenarioType}-budget${budget}`,
    intent: "Buy running shoes for daily training.",
    maxBudget: budget,
    scenarioType,
  };
}

interface TrialSummary {
  trial: number;
  totalTransactions: number;
  ordersCreated: number;
  aborted: number;
  crashed: number;
  transactionsWithFailure: number;
  recoveredViaSubstitute: number;
  recoveryRatePct: number;
  totalOrderValue: number;
  valueAtRisk: number;
  valuePreservedByRecovery: number;
  durationMs: number;
  evidenceDir: string;
}

async function runOneTrial(trialIndex: number): Promise<TrialSummary> {
  console.log(`\n── Trial ${trialIndex + 1}/${TRIALS} ${"─".repeat(30)}`);

  const results = [];
  const startedAt = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const scenario = randomScenario(i, trialIndex);
    process.stdout.write(`  [${i + 1}/${COUNT}] ${scenario.label} ... `);
    try {
      const result = await runScenario({ ...scenario, autoApprove: true });
      const statusLabel = String(result.outcome.status).toUpperCase();
      const recoveryTag = result.recovered ? " (recovered)" : "";
      const reasonTag = statusLabel === "FAILED" ? ` [${(result.outcome as any).reason ?? "no reason captured"}]` : "";
      console.log(`${statusLabel}${recoveryTag}${reasonTag}`);
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
    if (i < COUNT - 1) await sleep(DELAY_MS);
  }

  const durationMs = Date.now() - startedAt;

  const total = results.length;
  const ordersCreated = results.filter((r) => r.outcome.status === "order_created");
  const failed = results.filter((r) => r.outcome.status === "failed");
  const aborted = results.filter((r) => r.outcome.status === "aborted");
  const hadFailure = results.filter((r) => r.failureOccurred);
  const recovered = results.filter((r) => r.recovered);

  const orderValueCreated = ordersCreated.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0);
  const revenueAtRiskFromFailures = hadFailure.reduce((sum, r) => sum + r.originalAuthorizedTotal, 0);
  const revenuePreservedByRecovery = recovered.reduce((sum, r) => sum + (r.finalTotal ?? 0), 0);
  const recoveryRatePct = hadFailure.length > 0 ? (recovered.length / hadFailure.length) * 100 : 0;

  console.log(`  Trial ${trialIndex + 1}: ${ordersCreated.length} orders created, ${aborted.length} aborted, ${failed.length} failed`);
  console.log(
    `  Recovery rate: ${recoveryRatePct.toFixed(1)}% (${recovered.length}/${hadFailure.length}) · Preserved ₹${revenuePreservedByRecovery}`
  );

  const dir = path.join(__dirname, "..", "traces");
  const evidenceDir = path.join(dir, `scale-batch-evidence-trial${trialIndex + 1}-${Date.now()}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  for (const r of results) {
    if (r.tracePath && fs.existsSync(r.tracePath)) {
      fs.copyFileSync(r.tracePath, path.join(evidenceDir, `${r.label}.json`));
    }
  }

  const trialSummary: TrialSummary = {
    trial: trialIndex + 1,
    totalTransactions: total,
    ordersCreated: ordersCreated.length,
    aborted: aborted.length,
    crashed: failed.length,
    transactionsWithFailure: hadFailure.length,
    recoveredViaSubstitute: recovered.length,
    recoveryRatePct,
    totalOrderValue: orderValueCreated,
    valueAtRisk: revenueAtRiskFromFailures,
    valuePreservedByRecovery: revenuePreservedByRecovery,
    durationMs,
    evidenceDir,
  };

  fs.writeFileSync(
    path.join(evidenceDir, "summary.json"),
    JSON.stringify(
      {
        ...trialSummary,
        perTransaction: results.map((r) => ({
          label: r.label,
          status: r.outcome.status,
          failureOccurred: r.failureOccurred,
          recovered: r.recovered,
          originalAuthorizedTotal: r.originalAuthorizedTotal,
          finalTotal: r.finalTotal,
          orderId: (r.outcome as any).orderId ?? null,
          apiFailureReason: (r.outcome as any).reason ?? null,
        })),
      },
      null,
      2
    ),
    "utf-8"
  );

  return trialSummary;
}

async function main() {
  console.log("AgentTrace scale batch");
  console.log("=========================");
  console.log(`${TRIALS} trial(s) of ${COUNT} randomized transactions each, against the real Razorpay Orders API.`);
  console.log(`Budgets drawn uniformly from ₹${MIN_BUDGET}–₹${MAX_BUDGET}, scenario type 50/50 drift/oos.`);
  console.log(`Real randomness (Math.random()), not seeded -- every trial produces different exact numbers.`);
  console.log(`That's deliberate: a single run only proves the mechanism works once. Multiple independent`);
  console.log(`trials show whether the recovery rate is a stable property of the system, or one lucky draw.`);
  console.log(`Pacing each real API call ${DELAY_MS}ms apart to avoid tripping Razorpay's rate limiting.`);

  const trials: TrialSummary[] = [];
  for (let t = 0; t < TRIALS; t++) {
    trials.push(await runOneTrial(t));
  }

  if (TRIALS > 1) {
    const rates = trials.map((t) => t.recoveryRatePct);
    const preserved = trials.map((t) => t.valuePreservedByRecovery);
    console.log("\n═════════════════════════════════════════════");
    console.log(`CROSS-TRIAL SUMMARY (${TRIALS} independent trials, ${COUNT} txns each)`);
    console.log("═════════════════════════════════════════════");
    console.log(
      `Recovery rate range:      ${Math.min(...rates).toFixed(1)}% – ${Math.max(...rates).toFixed(1)}% (mean ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)}%)`
    );
    console.log(
      `Value preserved range:    ₹${Math.min(...preserved)} – ₹${Math.max(...preserved)} (mean ₹${Math.round(preserved.reduce((a, b) => a + b, 0) / preserved.length)})`
    );
    console.log("═════════════════════════════════════════════");

    const dir = path.join(__dirname, "..", "traces");
    const crossTrialPath = path.join(dir, `cross-trial-summary-${Date.now()}.json`);
    fs.writeFileSync(
      crossTrialPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          trials: TRIALS,
          transactionsPerTrial: COUNT,
          recoveryRateRange: { min: Math.min(...rates), max: Math.max(...rates), mean: rates.reduce((a, b) => a + b, 0) / rates.length },
          valuePreservedRange: {
            min: Math.min(...preserved),
            max: Math.max(...preserved),
            mean: preserved.reduce((a, b) => a + b, 0) / preserved.length,
          },
          perTrial: trials,
        },
        null,
        2
      ),
      "utf-8"
    );
    console.log(`\nCross-trial summary written to: ${crossTrialPath}`);
  }
}

main().catch((err) => {
  console.error("Scale batch crashed:", err);
  process.exit(1);
});
