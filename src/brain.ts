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
  constructor(private apiKey: string, private model: string = "claude-sonnet-5") {}

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
        model: this.model,
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

    if (!response.ok || !data.content?.[0]) {
      const apiError = data?.error?.message ?? JSON.stringify(data);
      throw new Error(`ClaudeBrain: API call failed (HTTP ${response.status}, model="${this.model}"): ${apiError}`);
    }

    const text = data.content[0].text;
    if (!text) {
      throw new Error(`ClaudeBrain: response had no text content: ${JSON.stringify(data.content[0])}`);
    }

    let parsed: AgentDecision;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      throw new Error(`ClaudeBrain: could not parse JSON from model output: ${text}`);
    }

    if (!candidates.some((c) => c.id === parsed.chosenId)) {
      throw new Error(
        `ClaudeBrain: model returned chosenId="${parsed.chosenId}", which doesn't match any real candidate id (${candidates.map((c) => c.id).join(", ")})`
      );
    }

    return parsed;
  }
}

// A second real-LLM option, using Google's Gemini API instead of Anthropic's.
// This exists specifically because Gemini's free tier (via Google AI Studio)
// requires no credit card and no paid plan -- genuinely free, not a trial
// that expires. That makes it the practical choice for demoing real
// LLM-driven reasoning without a budget. Same interface, same contract as
// ClaudeBrain and RuleBasedBrain: the orchestrator doesn't need to know or
// care which brain is plugged in.
//
// Model name note: Gemini model identifiers get retired on a rolling basis.
// gemini-2.0-flash was deprecated in early-to-mid 2026, and gemini-2.5-flash
// was retired for new users shortly after -- Google's own API error message
// pointed directly at gemini-3.6-flash as the replacement, which is what's
// wired in below. If this one is retired too, the fix is a one-line change
// here, not a rewrite -- and the error-handling below means a future
// retirement fails with a clear message pointing at the fix, not a crash.
export class GeminiBrain implements AgentBrain {
  constructor(private apiKey: string, private model: string = "gemini-3.6-flash") {}

  async decide(
    intent: string,
    maxBudget: number,
    candidates: Product[]
  ): Promise<AgentDecision> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are a shopping agent. Intent: "${intent}". Budget: ₹${maxBudget}. Candidates: ${JSON.stringify(
                  candidates
                )}. Respond ONLY with raw JSON, no markdown fences: {"chosenId": "...", "reasoning": "..."}`,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    // Fail loudly and specifically instead of silently returning {} and
    // letting the crash surface somewhere unrelated later. A wrong model
    // name, an expired key, or a safety block all show up here as a
    // missing candidates[0], and each has a distinct, useful error field.
    if (!response.ok || !data.candidates?.[0]) {
      const apiError = data?.error?.message ?? JSON.stringify(data);
      throw new Error(
        `GeminiBrain: API call failed (HTTP ${response.status}, model="${this.model}"): ${apiError}`
      );
    }

    const text = data.candidates[0].content?.parts?.[0]?.text;
    if (!text) {
      throw new Error(
        `GeminiBrain: response had no text content (possibly blocked by safety filters): ${JSON.stringify(data.candidates[0])}`
      );
    }

    let parsed: AgentDecision;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      throw new Error(`GeminiBrain: could not parse JSON from model output: ${text}`);
    }

    if (!candidates.some((c) => c.id === parsed.chosenId)) {
      throw new Error(
        `GeminiBrain: model returned chosenId="${parsed.chosenId}", which doesn't match any real candidate id (${candidates.map((c) => c.id).join(", ")})`
      );
    }

    return parsed;
  }
}
