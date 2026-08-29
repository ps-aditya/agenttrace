import "dotenv/config";
import { runScenario } from "./engine";
import { RuleBasedBrain, GeminiBrain, AgentBrain } from "./brain";

const AUTO_APPROVE = process.argv.includes("--auto-approve");
const SCENARIO = process.argv.includes("--scenario=oos") ? "oos" : "drift";
const USE_GEMINI = process.argv.includes("--brain=gemini");

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
