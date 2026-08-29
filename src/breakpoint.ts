import * as readline from "readline";
import { BreakpointChoice, FailureContext } from "./types";

// This is the "control" layer. When verify() finds a problem, this is what
// actually stops execution and hands control back to a human -- rather
// than silently proceeding (dangerous) or silently aborting (a lost sale).
//
// The choice set depends on the failure class:
//   cost_drift  -> approve as-is is still possible (the item exists, it's
//                  just more expensive), so the human can accept the drift,
//                  accept a cheaper substitute if one was found, or abort.
//   unavailable -> approve as-is is impossible (nothing to buy), so the
//                  only real choices are accept the substitute or abort.
export async function promptResolution(
  ctx: FailureContext,
  autoApprove: boolean
): Promise<{ choice: BreakpointChoice; source: "human" | "auto" }> {
  console.log("\n──────────────────────────────────────────");
  console.log(
    ctx.failureClass === "unavailable"
      ? "⏸  BREAKPOINT: chosen item unavailable at execution time"
      : "⏸  BREAKPOINT: stale authorization detected"
  );
  console.log("──────────────────────────────────────────");

  if (ctx.diff) {
    for (const f of ctx.diff.fields) {
      const sign = f.delta > 0 ? "+" : "";
      console.log(
        `  ${f.field.padEnd(12)} authorized ₹${f.authorized}  →  actual ₹${f.actual}  (${sign}${f.delta})`
      );
    }
    console.log(`  total delta: ${ctx.diff.totalDelta > 0 ? "+" : ""}₹${ctx.diff.totalDelta}`);
  }
  if (ctx.budgetBreached) {
    console.log(`  ⚠ this exceeds the buyer's authorized budget ceiling — approve-as-is is not offered`);
  }

  const canApproveAsIs = ctx.failureClass === "cost_drift" && !ctx.budgetBreached;
  const options: { key: string; choice: BreakpointChoice; label: string }[] = [];

  if (canApproveAsIs) {
    options.push({ key: "a", choice: "approve_as_is", label: "approve as-is (pay the new total)" });
  }
  if (ctx.recovery) {
    options.push({
      key: "s",
      choice: "accept_substitute",
      label: `accept substitute — ${ctx.recovery.reasoning}`,
    });
  }
  options.push({ key: "x", choice: "abort", label: "abort (no payment)" });

  console.log("──────────────────────────────────────────");
  for (const opt of options) {
    console.log(`  [${opt.key}] ${opt.label}`);
  }
  console.log("──────────────────────────────────────────");

  if (autoApprove) {
    // Auto mode picks the best available non-abort option: prefer accepting
    // the substitute (keeps the sale, still bounded) over approving a
    // drifted total as-is, and only aborts if neither is available.
    const picked =
      options.find((o) => o.choice === "accept_substitute") ??
      options.find((o) => o.choice === "approve_as_is") ??
      options[options.length - 1];
    console.log(`  [--auto-approve set] auto-selecting: ${picked.label}\n`);
    return { choice: picked.choice, source: "auto" };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const validKeys = options.map((o) => o.key).join("/");
  const answer: string = await new Promise((resolve) => {
    rl.question(`  Your choice (${validKeys}): `, resolve);
  });
  rl.close();

  const matched = options.find((o) => o.key === answer.trim().toLowerCase());
  const resolved = matched ?? options[options.length - 1]; // default to abort on unrecognized input
  console.log(`  → ${resolved.label}\n`);
  return { choice: resolved.choice, source: "human" };
}
