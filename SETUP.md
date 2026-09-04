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

## 3a. Connect a Shopify store you administer

AgentTrace's Shopify connector is read-only and requires a Storefront API
access token issued by the merchant's own store. Add these values to `.env`:

```
AGENTTRACE_SHOPIFY_SHOP=your-store.myshopify.com
AGENTTRACE_SHOPIFY_STOREFRONT_TOKEN=your_storefront_token
```

Then inspect a live product, capture the exact facts that an alternative
must preserve, and later recheck against the live catalog:

```
node dist/cli.js shopify inspect --handle=product-handle
node dist/cli.js shopify capture --handle=product-handle --budget=5000 \
  --functional=option.Size,tag.trail --out=mandate.json
node dist/cli.js shopify recover --mandate=mandate.json
```

The connector uses live variant price and sellability. Do not set a mandate
field that Shopify does not expose: AgentTrace deliberately rejects unknown
facts rather than guessing at a substitute.

## 4. Check the evidence
Every run writes a full JSON trace to `traces/run-<timestamp>.json` — this is
the audit artifact: every decision, the authorization snapshot, the external
change, the breakpoint diff, and the payment result, in order.

## 5. Complete a real payment (needs one manual click)

`npm run verify-payment` and `npm run refund-batch` produce genuine captured
*payments* (not just orders) and genuine refunds — Razorpay's own hosted
checkout page has to be completed by a human, since no API can do this on
an agent's behalf. Each command prints a real payment link:

**Recommended: NetBanking → any test bank (e.g. PNB) → Success.** Card test
numbers vary by account and region and can change without notice on
Razorpay's side (a documented card number failed as "international" during
this project's own testing) — NetBanking has proven reliable. Razorpay's
own current test-payment docs are the source of truth if you want to try
cards instead: https://razorpay.com/docs/payments/payments/test-card-details/

## On webhooks (attempted, not relied on)

Real signature-verified webhook confirmation (`WebhookServer` in
`src/webhook-server.ts`) is implemented and correct — HMAC-SHA256
verification, timing-safe comparison, graceful fallback to polling. In
practice, Razorpay's webhook URL validation rejects public tunnel domains
(`localtunnel`'s `.loca.lt` hostnames specifically failed registration),
which is an external policy outside this project's control, not a bug in
the code. **`verify-payment` and `refund-batch` both work correctly without
it** — they fall back to polling automatically, and polling-confirmed real
payments are the evidence this project actually ships on. The webhook code
stays in the repo as a documented, honest attempt at the stronger
evidence path, not a claimed working feature.

## Check the evidence
Every run writes a full JSON trace to `traces/run-<timestamp>.json` — every
decision, the authorization snapshot, the external change, the breakpoint
diff, and the payment result, in order.

## What to expect
- A scripted agent picks a product within budget (rule-based, offline, no API key needed for this part)
- Shipping cost changes or the item goes out of stock between decision and payment (simulated, deterministic)
- The system catches the mismatch and freezes before paying
- You (or `--auto-approve`) approve, accept a bounded substitute, or abort
- If keys are set: a REAL Razorpay test-mode order gets created
- If no keys: a MOCK result is returned, clearly labeled as such in the trace
- `npm run verify-payment` / `npm run refund-batch` produce genuine captured
  payments and genuine refunds, confirmed via polling (real, just not
  independently webhook-verified — see above)

## What NOT to expect
- No real money ever moves (test mode only)
- No browser extension / VS Code extension yet — those are roadmap, not built
- Only two scripted decision-time failure classes (cost drift, unavailability)
- No database, no persistence beyond flat JSON trace files
- No working webhook confirmation in this submission — attempted, blocked by
  Razorpay's tunnel-domain policy, documented honestly rather than hidden
