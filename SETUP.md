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

## 5. (Optional, strongest evidence) Set up webhook-verified payment confirmation

Everything above either creates something and reads Razorpay's immediate API
response, or polls asking "did it happen yet?". Both trust an answer to a
question *we* initiated. A webhook is different: Razorpay pushes a signed
event to *us*, unprompted, and we verify the signature ourselves — proof the
event genuinely came from Razorpay, not something we're choosing to believe.

**Terminal 1 — start the local webhook receiver:**
```
npm run verify-payment
```
(if `RAZORPAY_WEBHOOK_SECRET` isn't set yet, this still runs — it'll fall
back to polling and tell you so explicitly)

**Terminal 2 — expose it publicly:**
```
npm run tunnel
```
This prints a public URL like `https://random-words.loca.lt`.

**In the Razorpay Dashboard** (Test Mode → Settings → Webhooks → Add New
Webhook):
- URL: `<your tunnel URL>/webhook`
- Active events: `payment.captured`, `refund.processed`
- Secret: pick any string, then put the *same* string in `.env` as
  `RAZORPAY_WEBHOOK_SECRET`

Restart `npm run verify-payment` after setting the secret so it picks up the
webhook path instead of falling back to polling. It'll print a real payment
link — open it, pay with test card `4111 1111 1111 1111` (any future
expiry, any CVV), and watch Terminal 1 receive and verify the signed
confirmation independently, before it issues a real refund.

## What to expect
- A scripted agent picks a product within budget (rule-based, offline, no API key needed for this part)
- Shipping cost changes or the item goes out of stock between decision and payment (simulated, deterministic)
- The system catches the mismatch and freezes before paying
- You (or `--auto-approve`) approve, accept a bounded substitute, or abort
- If keys are set: a REAL Razorpay test-mode order gets created
- If no keys: a MOCK result is returned, clearly labeled as such in the trace
- `npm run verify-payment` produces a genuine captured *payment* (not just an
  order) and a genuine refund — the one path that requires you to actually
  click "pay" once, since no API can complete checkout on your behalf

## What NOT to expect
- No real money ever moves (test mode only)
- No browser extension / VS Code extension yet — those are roadmap, not built
- Only two scripted decision-time failure classes (cost drift, unavailability)
- No database, no persistence beyond flat JSON trace files
- The webhook path needs manual one-time setup (tunnel + dashboard config);
  everything else needs zero configuration beyond API keys
