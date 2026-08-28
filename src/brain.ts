import { AgentDecision, Product } from "./types";

// AgentBrain is the "reason" layer: given an intent, a budget, and a set of
// candidates, it decides what to buy. It is intentionally an interface, not
// a concrete class, so the reasoning strategy is swappable without touching
// anything else in the system (trace recording, breakpoints, payment).
export interface AgentBrain {
  decide(
    intent: string,
    maxBudget: number,
    candidates: Product[]
  ): Promise<AgentDecision>;
}

// Deterministic, offline, zero-dependency implementation. This is the
// default so the demo runs identically for anyone, with no API key and no
// network call required. It picks the most expensive candidate that still
// fits under budget, which is a defensible, explainable "best value within
// constraint" heuristic.
export class RuleBasedBrain implements AgentBrain {
  async decide(
    intent: string,
    maxBudget: number,
    candidates: Product[]
  ): Promise<AgentDecision> {
    const affordable = candidates
      .filter((c) => c.price <= maxBudget)
      .sort((a, b) => b.price - a.price);

    if (affordable.length === 0) {
      throw new Error(
        `No candidate fits within budget ₹${maxBudget} for intent: "${intent}"`
      );
    }

    const chosen = affordable[0];
    return {
      chosenId: chosen.id,
      reasoning: `Selected "${chosen.name}" (₹${chosen.price}) as the highest-value option within the ₹${maxBudget} budget, given intent: "${intent}".`,
    };
  }
}

// Extension point: a real LLM-backed brain using the Anthropic API.
// Wire this up with your own ANTHROPIC_API_KEY when you're ready to demo
// genuine model-driven reasoning instead of the rule-based heuristic above.
// The interface contract stays identical either way, which is the point:
// the rest of the system doesn't care which brain is plugged in.
export class ClaudeBrain implements AgentBrain {
  constructor(private apiKey: string) {}

  async decide(
    intent: string,
    maxBudget: number,
    candidates: Product[]
  ): Promise<AgentDecision> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: `You are a shopping agent. Intent: "${intent}". Budget: ₹${maxBudget}. Candidates: ${JSON.stringify(
              candidates
            )}. Respond ONLY with JSON: {"chosenId": "...", "reasoning": "..."}`,
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return parsed as AgentDecision;
  }
}
