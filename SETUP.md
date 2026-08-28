# AgentTrace — Setup

## 1. Install dependencies
```
npm install
```

## 2. Add your Razorpay test-mode keys
Open `.env` (already created from `.env.example`) and fill in:
```
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
```
Get these from: Razorpay Dashboard → (Test Mode) → Account & Settings → API Keys → Generate Key.
No keys? The demo still runs fine — it falls back to a clearly-labeled mock payment.

## 3. Run the demo
```
npm run demo:auto     # runs fully automated, auto-approves the breakpoint
npm run demo          # runs interactively, you type y/n at the breakpoint
```

## 4. Check the evidence
Every run writes a full JSON trace to `traces/run-<timestamp>.json` — this is
the audit artifact: every decision, the authorization snapshot, the external
change, the breakpoint diff, and the payment result, in order.

## What to expect
- A scripted agent picks a product within budget (rule-based, offline, no API key needed for this part)
- Shipping cost changes between decision and payment (simulated, deterministic)
- The system catches the mismatch and freezes before paying
- You (or `--auto-approve`) approve or abort
- If keys are set: a REAL Razorpay test-mode order gets created
- If no keys: a MOCK result is returned, clearly labeled as such in the trace

## What NOT to expect
- No real money ever moves (test mode only)
- No browser extension / VS Code extension / npm package yet — those are roadmap, not built
- No arbitrary failure-mode detection — only the one scripted shipping-drift case
- No database, no persistence beyond flat JSON trace files
