#!/usr/bin/env node
import "dotenv/config";
import { runScenario } from "./engine";
import { RuleBasedBrain, GeminiBrain, AgentBrain } from "./brain";

const AUTO_APPROVE = process.argv.includes("--auto-approve");
const SCENARIO = process.argv.includes("--scenario=oos") ? "oos" : "drift";
const USE_GEMINI = process.argv.includes("--brain=gemini");
const SHOW_HELP = process.argv.includes("--help") || process.argv.includes("-h");

function printHelp() {
  console.log(`AgentTrace -- bounded recovery for autonomous commerce agents

This command runs the single-scenario demo. Other real commands (require
cloning the repo, not available via npx):

  npm run demo              interactive single-scenario demo (y/n prompt)
  npm run demo:auto         same, auto-approves the breakpoint
  npm run demo:oos:auto     out-of-stock scenario instead of cost drift
  npm run demo:gemini       decision made by a real LLM (needs GEMINI_API_KEY)
  npm run batch             8 varied scenarios, real Razorpay orders, aggregated evidence
  npm run verify-payment    genuine payment + refund lifecycle (needs one manual checkout click)
  npm run refund-batch      two more real payment+refund scenarios (full + partial)

Flags for this command:
  --auto-approve      auto-resolve the breakpoint instead of prompting
  --scenario=oos       out-of-stock instead of the default cost-drift scenario
  --brain=gemini        use GeminiBrain instead of the rule-based default
  --help, -h             show this message

Full docs: https://github.com/ps-aditya/agenttrace
`);
}

if (SHOW_HELP) {
  printHelp();
  process.exit(0);
}

function selectBrain(): AgentBrain {
  if (USE_GEMINI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("⚠ --brain=gemini set but GEMINI_API_KEY is missing in .env — falling back to RuleBasedBrain.\n");
      return new RuleBasedBrain();
    }
    return new GeminiBrain(key);
  }
  return new RuleBasedBrain();
}

async function main() {
  console.log("AgentTrace demo run");
  console.log("===================");
  console.log(`Scenario: ${SCENARIO === "oos" ? "item goes out of stock" : "shipping cost drift"}`);
  console.log(`Brain: ${USE_GEMINI ? "Gemini (real LLM)" : "rule-based (deterministic)"}\n`);

  const brain = selectBrain();

  const result = await runScenario(
    {
      label: "single-demo",
      intent: "Buy me running shoes, budget ₹5000, prioritize quality over price.",
      maxBudget: 5000,
      scenarioType: SCENARIO,
      autoApprove: AUTO_APPROVE,
      onNarration: (line) => console.log(line + "\n"),
    },
    brain
  );

  console.log(`\nFull trace written to: ${result.tracePath}`);
  console.log(
    `Summary: ${String(result.outcome.status).toUpperCase()} · scenario=${SCENARIO} · recovered=${result.recovered}`
  );
}

main().catch((err) => {
  console.error("AgentTrace demo crashed:", err);
  process.exit(1);
});
