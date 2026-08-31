# AgentTrace

**A recovery-aware breakpoint system for autonomous commerce agents.**

AgentTrace watches an AI shopping agent's purchase decision, and when
something changes before payment executes — a price drift, an item selling
out — it doesn't just stop and ask a human. It first checks whether the sale
can be **saved within the buyer's original authorization**, proposes that
recovery, and only falls back to a plain approve/abort if no bounded
recovery exists. Every step is logged to an inspectable audit trail.

Built for Razorpay Buildathon, Track 01 ("grow the merchant's revenue, and
make them sellable to AI buyers" / "every money action explainable, bounded
and gated").

> **A precision note on the evidence below, stated plainly:** every "order
> created" claim in this README refers to a real Razorpay Orders API call
> (`orders.create()`) — verifiable order IDs, real network round-trips. It
> does **not** mean a payment was completed against that order. In
> Razorpay's model, an order starts in `created` state and only becomes a
> captured payment once a checkout is completed (a card or UPI ID entered,
> even in test mode) — there's no pure server-side shortcut around that,
> and there shouldn't be. Earlier language in this README used "captured"
> loosely; that's been corrected below. The
> [`traces/example-payment-verified.json`](./traces/example-payment-verified.json)
> evidence (further down) goes one step further and completes a genuine
> checkout, producing a real payment ID, not just an order ID.

---

## The problem, in one scenario

An agent is told: *"Buy me running shoes, budget ₹5000."* It picks a pair,
checks the price and shipping, and is ready to pay: ₹4919 total.

Between that decision and the actual payment call, something changes —
shipping cost drifts, or the item sells out entirely. A pure safety system
has exactly two moves here: let the now-wrong transaction through (unsafe),
or kill it (a lost sale, indistinguishable to the merchant from cart
abandonment). **Neither move helps the merchant.**

AgentTrace adds a third move: **check if there's a bounded way to keep the
sale alive.** If a substitute item still fits inside the buyer's original
budget, that becomes the first thing offered — not a compromise on safety,
a use of it. The buyer never pays more than they authorized. The merchant
doesn't lose a sale to a shipping quote update they had nothing to do with.

## Two failure classes, one recovery engine

- **Cost drift** — the chosen item is still purchasable, but the total
  moved (e.g. shipping cost changed). The human/policy can approve the new
  total as-is, accept a cheaper substitute, or abort.
- **Unavailable** — the chosen item cannot be bought at all (sold out at
  execution time). There is no "approve as-is" option here — only a
  substitute or an abort.

Both share the same `findRecoveryOption()` engine
([`src/recovery.ts`](./src/recovery.ts)): search the catalog for the
closest-value alternative that still fits the original authorized budget.
This is a deliberately simple, honest rule — not similarity-scored ML
matching — because the point is a bounded, explainable recovery, not a
"smart" one.

**A correctness detail that matters:** "approve as-is" is only ever offered
when the new total still fits the buyer's *stated budget ceiling* (₹5000 in
the example above), not merely the specific total the agent happened to
commit to at decision time. A budget of ₹5000 authorizes anything under
₹5000 — if a drift pushes the total *over* that ceiling, approve-as-is is
withheld entirely, even in auto-approve mode. This is enforced by
`budgetBreached` in [`src/types.ts`](./src/types.ts) and checked in
[`src/breakpoint.ts`](./src/breakpoint.ts) — the system cannot silently pay
more than the buyer ever agreed to.

### Why the recovery search is O(n), not O(n log n)

Stated formally: given `n` candidates, an excluded item, a budget `B`, and a
shipping cost `S`, find the candidate maximizing `price + S` subject to
`price + S ≤ B`, or determine none exists. A naive implementation filters,
sorts descending, and takes the first result — O(n log n) time, O(n) extra
space. But the problem only ever asks for a single best element under a
constraint; a full ordering is never needed. `findRecoveryOption()` instead
does a single linear scan tracking the best-so-far — O(n) time, O(1) extra
space. You must inspect every candidate at least once to know whether a
better one exists (an unavoidable Ω(n) lower bound for this problem shape),
so O(n) is not just faster in practice — it's asymptotically optimal.

## Evidence at scale, not one cherry-picked run

A single successful run proves the happy path works. It doesn't prove the
*bound* is real — for that, you need to see the system refuse to overpay
and refuse to invent a recovery that doesn't exist. `src/batch.ts` runs 8
deliberately varied synthetic transactions against the real Razorpay
test-mode API in one pass — spanning both failure classes, a budget-breach
case, and critically, **one scenario with no viable substitute at all**,
which correctly forces a plain abort in full auto-approve mode. That's the
proof the bound isn't just a label: when recovery genuinely isn't possible,
the system doesn't manufacture one.

Run it: `npm run batch`. It prints a live per-transaction status, then
an aggregate summary — total order value, total at-risk from failures, total
preserved by recovery — and writes the full breakdown (every transaction,
every trace file, every real order ID) to a timestamped JSON report. (The
JSON field names still say `captured`/`revenueCaptured` for now — read
those as "order created for this amount," per the terminology note above,
not "payment completed.")

**Real committed numbers** ([`traces/example-batch-summary.json`](./traces/example-batch-summary.json)),
from an actual run against Razorpay's live test-mode API — 8 real orders
attempted, 7 real order IDs returned:

| | |
|---|---|
| Transactions run | 8 |
| Orders created | 7 |
| Aborted (no viable recovery) | 1 |
| Transactions that hit a failure | 7 / 8 |
| Recovered via substitute | 6 / 7 |
| Total order value | ₹29,553 |
| Value that was at risk | ₹32,233 |
| **Value preserved by recovery** | **₹25,834** |

That one abort (`run-03-drift-no-recovery-forces-abort`) is the important
row, not a footnote: it's the system correctly refusing to invent a
recovery when none exists, even with `--auto-approve` set. If every run
had created an order, that would be weaker evidence, not stronger — it
would mean the bound was never actually tested.

## What it actually does (verified, not claimed)

1. **Observe** — a scripted agent picks a product against an intent + budget
2. **Reason** — the decision and its justification are logged
3. An **authorization snapshot** is taken — the "mandate": item, price,
   shipping, total, at the moment of decision
4. A scripted, deterministic external change occurs (either shipping drift
   or item goes out of stock, selectable via `--scenario`)
5. **Verify** — the system checks whether the original authorization still
   holds
6. **Recover** — if it doesn't, the system searches for an in-budget
   substitute before doing anything else
7. **Control** — execution freezes, the situation and any recovery option
   are printed, a human/policy resolves it: approve as-is, accept
   substitute, or abort
8. On approval, a **real Razorpay test-mode order is created** — this is a
   genuine API call, not a simulation
9. **Audit** — every event above is written, in order, to a JSON trace file

### Real evidence, not a mockup

Two committed, genuine runs against Razorpay's live test-mode API — both
verifiable directly in the Razorpay Dashboard under Test Mode → Orders:

- [`traces/example-run-drift.json`](./traces/example-run-drift.json) —
  shipping cost drifts (₹120 → ₹360), the recovery engine finds "UrbanFlex
  Pro" fits the original ₹5000 budget, the substitute is accepted, and a
  real order is created: **`order_TVUqO5Fi8FmjZN`** (₹4659, ~3.7s real
  network round-trip: `07:04:33.473` → `07:04:37.160`).
- [`traces/example-run-oos.json`](./traces/example-run-oos.json) — the
  chosen item sells out entirely, there is no "approve as-is" option, the
  same recovery engine finds the same substitute now at original shipping
  cost, and a real order is created: **`order_TVUqU5oUAzSQO9`** (₹4419).

Both orders exist in Razorpay's own system, not just in this repo's logs —
that's the strongest evidence available that this isn't a simulation.

Reproduce either yourself:
```
npm run demo:auto          # cost-drift scenario, auto-resolves
npm run demo:oos:auto      # out-of-stock scenario, auto-resolves
npm run batch              # 8 varied transactions, one real Razorpay call each
```
Each run writes its own timestamped trace to `traces/`.

### A real LLM making the decision, not just a script

The default brain (`RuleBasedBrain`) is deterministic on purpose — it makes
the demo reproducible and free to run for anyone cloning the repo. But the
decision layer is a swappable interface
([`src/brain.ts`](./src/brain.ts)), and `GeminiBrain` wires in Google's
Gemini API for genuine LLM-driven product selection instead of a scripted
rule. Gemini's free tier requires no credit card, which is why it's the
one wired in rather than a paid API:
```
npm run demo:gemini
```
Requires a free key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
in `.env` as `GEMINI_API_KEY`.

**Real committed evidence** ([`traces/example-run-gemini.json`](./traces/example-run-gemini.json)):
Gemini, given the same candidates and budget as every other example in this
README, produced its own reasoning in its own words — *"Trailrunner X2 at
₹4799 is within the ₹5000 budget and, as the highest-priced candidate,
aligns best with the instruction to prioritize quality over price"* — then
hit the same recovery/breakpoint/audit pipeline as any other decision
source, and completed a real Razorpay order (`order_TVafwjSDaVZIwv`). The
brain is swappable; the safety and recovery guarantees around it are not.

## Architecture

```
OBSERVE (catalog.ts)
   → candidates + intent
REASON (brain.ts)
   → agent picks a product + states its justification
VERIFY (verify.ts)
   → checks whether the original authorization still holds
RECOVER (recovery.ts)
   → if not: searches for an in-budget substitute before giving up
CONTROL (breakpoint.ts)
   → pauses, presents approve-as-is / accept-substitute / abort, waits for a decision
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

What's actually new here: none of the above turn a detected payment problem
into a *bounded recovery attempt*. AP2 formalizes what was authorized;
AgentOps/LangSmith trace what happened; neither asks "is there a way to
still complete this sale within what the buyer already agreed to?" before
giving up. That's the specific, narrow thing AgentTrace adds — a recovery
engine that tries to save a sale within its original bounds before falling
back to a plain approve/abort, with a committed real trace as proof it runs
end-to-end against a live payment gateway.

### Explicitly out of scope for this submission
- No browser extension, VS Code extension, or published npm package —
  roadmap only (see below), not built
- Only two scripted failure classes (cost drift, unavailability) — not an
  open-ended fraud/anomaly detector; the batch harness varies budgets and
  scenario types, not arbitrary new failure categories
- No persistence beyond flat JSON trace files, no database, no auth system
- No production/live-mode payments — test mode only, by design

### Roadmap (not built, stated honestly as future direction)
- Browser extension surfacing breakpoints inline on checkout pages
- VS Code extension for stepping through agent traces like a real debugger
- `npx agenttrace` distributable package
- Additional failure classes (currency mismatch, quantity drift, expired
  authorization windows) — the recovery engine's interface doesn't change
  to add these, only `catalog.ts`'s scripted triggers would

## Setup

**Try it in 10 seconds, no clone, no setup:**
```
npx @REPLACE_WITH_YOUR_NPM_USERNAME/agenttrace
```
(swap in the real scope once published — see the npm publish steps below)
Runs the full pipeline immediately using the mock payment fallback (no
Razorpay keys needed to see the recovery logic work). For real Razorpay
test-mode orders, the batch harness, Gemini, or the live-payment-and-refund
flow, clone the repo instead:

See [`SETUP.md`](./SETUP.md).

```
npm install
cp .env.example .env    # add your Razorpay test-mode keys, or leave blank for mock
npm run demo:auto       # or: npm run demo (interactive y/n prompt)
```

## Project structure

```
src/
  types.ts       domain types: Product, AuthorizedState, ExecutionState, TraceEvent, RecoveryOption
  catalog.ts     synthetic product catalog + scripted shipping drift + scripted stock failure
  brain.ts       AgentBrain interface; RuleBasedBrain (default), ClaudeBrain + GeminiBrain (real LLM options)
  verify.ts      diffAuthorization() — the core staleness check
  recovery.ts    findRecoveryOption() — O(n) single-pass search for an in-budget substitute
  breakpoint.ts  promptResolution() — the control layer, budget-breach-aware 3-way choice
  payment.ts     attemptPayment() — real Razorpay call, mock fallback if no keys
  tracer.ts      Tracer — records + persists the audit trail
  engine.ts      runScenario() — the shared pipeline used by both index.ts and batch.ts
  index.ts       single-run interactive/auto demo, --scenario=drift|oos, --brain=gemini
  batch.ts       runs 8 varied scenarios against the real API, aggregates evidence
  index.ts       orchestrator wiring all layers together, --scenario=drift|oos
traces/
  example-run.json   committed, real evidence (see above)
```
