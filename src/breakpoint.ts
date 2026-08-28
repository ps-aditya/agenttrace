import * as readline from "readline";
import { StaleAuthorizationDiff } from "./types";

// This is the "control" layer. When verify() finds a stale authorization,
// this is what actually stops execution and hands control back to a human
// -- rather than silently proceeding (dangerous) or silently aborting
// (unhelpful). The demo's entire thesis lives in this one pause.
export async function promptApproveOrAbort(
  diff: StaleAuthorizationDiff,
  autoApprove: boolean
): Promise<{ approved: boolean; source: "human" | "auto" }> {
  console.log("\n──────────────────────────────────────────");
  console.log("⏸  BREAKPOINT: stale authorization detected");
  console.log("──────────────────────────────────────────");
  for (const f of diff.fields) {
    const sign = f.delta > 0 ? "+" : "";
    console.log(
      `  ${f.field.padEnd(12)} authorized ₹${f.authorized}  →  actual ₹${f.actual}  (${sign}${f.delta})`
    );
  }
  console.log(`  total delta: ${diff.totalDelta > 0 ? "+" : ""}₹${diff.totalDelta}`);
  console.log("──────────────────────────────────────────");

  if (autoApprove) {
    console.log("  [--auto-approve set] proceeding without a human prompt.\n");
    return { approved: true, source: "auto" };
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((resolve) => {
    rl.question("  Approve this payment despite the change? (y/n): ", resolve);
  });
  rl.close();

  const approved = answer.trim().toLowerCase().startsWith("y");
  console.log(approved ? "  → approved by human.\n" : "  → aborted by human.\n");
  return { approved, source: "human" };
}
