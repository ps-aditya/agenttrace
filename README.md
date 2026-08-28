# AgentTrace

**A breakpoint debugger for autonomous commerce agents.**

AgentTrace watches an AI shopping agent's purchase decision, freezes execution
the instant that decision goes stale before payment, shows a human exactly
what changed, and logs the entire chain of custody — decision, authorization,
drift, human call, payment result — to an inspectable audit trail.

Built for Razorpay Buildathon, Track 01 ("every money action explainable,
bounded and gated").

---

## The problem, in one scenario

An agent is told: *"Buy me running shoes, budget ₹5000."* It picks a pair,
checks the price and shipping, and is ready to pay: ₹4919 total.

Between that decision and the actual payment call, the shipping quote
changes — a carrier repricing, a late-resolving surcharge, an expired promo.
Now the real total is ₹5159. Nobody re-approved that ₹240.

If the agent pays anyway: a silent, unauthorized overcharge. If it stops and
asks a human before every microscopic change: it's not really an agent
anymore. **AgentTrace is the tripwire in between** — it only interrupts when
what's about to happen no longer matches what was authorized.

## What it actually does (verified, not claimed)

1. **Observe** — a scripted agent picks a product against an intent + budget
2. **Reason** — the decision and its stated justification are logged
3. An **authorization snapshot** is taken: this is the "mandate" — item,
   price, shipping, total, at the moment of decision
4. A scripted, deterministic external change occurs (shipping cost drifts)
5. **Verify** — the system recomputes the real total and diffs it against
   the authorization
6. If they diverge: **Control** — execution freezes, the diff is printed,
   a human approves or aborts
7. On approval, a **real Razorpay test-mode order is created** — this is a
   genuine API call, not a simulation
8. **Audit** — every event above is written, in order, to a JSON trace file

### Real evidence, not a mockup

[`traces/example-run.json`](./traces/example-run.json) is an actual run,
committed as-is. It shows:

- A ₹240 shipping drift detected and printed at the breakpoint
- A human/auto approval decision logged
- A genuine Razorpay test-mode order created: **`order_TUsvF5kQw2Vh8l`**
- A ~3.2 second real round-trip to Razorpay's API (`17:58:48.024` →
  `17:58:51.260`), confirming this hit the network, not a stub

That order ID and timing are real Razorpay test-mode artifacts, not invented
numbers — you can trace the API call's shape directly in
[`src/payment.ts`](./src/payment.ts).

## Architecture

```
OBSERVE (catalog.ts)
   → candidates + intent
REASON (brain.ts)
   → agent picks a product + states its justification
VERIFY (verify.ts)
   → diffs the authorization snapshot against the actual state at payment time
CONTROL (breakpoint.ts)
   → if they diverge: pause, print the diff, wait for approve/abort
AUDIT (tracer.ts)
   → every event above, in order, written to a JSON trace file
```

Each layer is a separate module with one job. The `AgentBrain` interface
(`brain.ts`) is swappable — a rule-based implementation ships as the default
so the demo runs with zero API keys, and a Claude-backed implementation is
included as an extension point for real LLM-driven reasoning.

## Honest scope — what this is NOT

This is a 2-day buildathon proof of concept, not a claim to have invented
agent-payment authorization. To be direct about prior art:

- **[Google's Agent Payments Protocol (AP2)](https://ap2-protocol.org)**,
  announced with 60+ partners, already formalizes cryptographically signed
  Intent/Cart/Payment Mandates as an industry standard. AgentTrace does not
  compete with this — it's a small illustration of a *developer-facing
  debugging pattern* that could sit on top of a protocol like AP2, making
  mandate drift visible and interruptible rather than just logged.
- **AgentOps, LangSmith, Langfuse, Traceloop, Galileo** already do generic
  agent session tracing and replay, some with free tiers and broad framework
  support. AgentTrace does not attempt to be a general-purpose tracer — it
  targets one narrow, specific failure mode: authorization staleness at the
  payment boundary.
- **Switchbench** already offers payment-rail sandbox simulation
  (ISO 8583/HSM/EMV/3DS) for exactly the "waiting weeks for sandbox access"
  pain point. AgentTrace uses Razorpay's own test mode directly instead of
  building a simulator.

What's actually new here, narrowly: a breakpoint-style UI for the specific
moment a payment mandate goes stale mid-flow, with a committed real trace as
proof it runs end-to-end against a live payment gateway.

### Explicitly out of scope for this submission
- No browser extension, VS Code extension, or published npm package —
  roadmap only (see below), not built
- No arbitrary failure-mode detection — only the one scripted case
  (shipping cost drift)
- No persistence beyond flat JSON trace files, no database, no auth system
- No production/live-mode payments — test mode only, by design

### Roadmap (not built, stated honestly as future direction)
- Browser extension surfacing breakpoints inline on checkout pages
- VS Code extension for stepping through agent traces like a real debugger
- `npx agenttrace` distributable package
- Additional failure modes (currency mismatch, quantity drift, expired
  authorization windows)

## Setup

See [`SETUP.md`](./SETUP.md).

```
npm install
cp .env.example .env    # add your Razorpay test-mode keys, or leave blank for mock
npm run demo:auto       # or: npm run demo (interactive y/n prompt)
```

## Project structure

```
src/
  types.ts       domain types: Product, AuthorizedState, ExecutionState, TraceEvent
  catalog.ts     synthetic product catalog + scripted shipping drift
  brain.ts       AgentBrain interface; RuleBasedBrain (default) + ClaudeBrain (extension point)
  verify.ts      diffAuthorization() — the core staleness check
  breakpoint.ts  promptApproveOrAbort() — the control layer
  payment.ts     attemptPayment() — real Razorpay call, mock fallback if no keys
  tracer.ts      Tracer — records + persists the audit trail
  index.ts       orchestrator wiring all five layers together
traces/
  example-run.json   committed, real evidence (see above)
```