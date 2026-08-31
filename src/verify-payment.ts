import "dotenv/config";
import { Tracer } from "./tracer";
import { createPaymentLink, waitForPayment, issueRefund } from "./checkout";
import { WebhookServer } from "./webhook-server";

// This script demonstrates the full authorize -> capture -> reverse
// lifecycle, and unlike everywhere else in this project, the capture
// confirmation here is not "we asked Razorpay and it said yes" -- it's
// "Razorpay independently pushed us a signed event, unprompted, and we
// verified the signature ourselves." That's the strongest evidence this
// repo can produce: not a request-response we're choosing to trust, but a
// cryptographically authenticated notification we can't have faked.
//
// Setup this needs that nothing else in the repo does:
//   1. A public URL pointing at this machine (a tunnel -- see SETUP.md)
//   2. That URL registered in Razorpay Dashboard -> Settings -> Webhooks,
//      subscribed to payment.captured and refund.processed
//   3. The webhook secret you set there, in .env as RAZORPAY_WEBHOOK_SECRET
//
// If any of that isn't set up, this script still works -- it falls back to
// polling paymentLink.fetch(), exactly like the previous version -- but it
// says so explicitly in the trace and on screen, rather than silently
// passing off a weaker confirmation as the strong one.
const DEMO_AMOUNT = 2; // rupees -- ₹1 exactly hit an undocumented Razorpay refund
// boundary in practice (payment captured fine, refund on the same ₹1 payment
// failed with a vague "invalid request sent"; ₹3 and ₹5 refunded correctly
// with identical code). Staying clearly above ₹1 avoids the boundary
// entirely rather than relying on an unconfirmed root cause.
const DEMO_DESCRIPTION = "AgentTrace demo: webhook-verified payment + refund";
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? 3737);
const WEBHOOK_WAIT_MS = 5 * 60 * 1000; // 5 minutes to complete checkout

async function main() {
  const tracer = new Tracer();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  console.log("AgentTrace: webhook-verified payment + refund");
  console.log("================================================\n");

  let webhookServer: WebhookServer | null = null;
  if (webhookSecret) {
    webhookServer = new WebhookServer(webhookSecret, WEBHOOK_PORT);
    await webhookServer.start();
    console.log(
      `Webhook listener running on http://localhost:${WEBHOOK_PORT} -- make sure your tunnel is pointed here and registered in the Razorpay Dashboard.\n`
    );
  } else {
    console.log(
      "⚠ RAZORPAY_WEBHOOK_SECRET not set -- running in polling-fallback mode.\n" +
        "  This still uses real Razorpay data, but confirmation comes from a\n" +
        "  request we make, not an independent event Razorpay pushes to us.\n" +
        "  See SETUP.md to enable the stronger webhook path.\n"
    );
  }

  console.log(`Creating a real Razorpay Payment Link for ₹${DEMO_AMOUNT}...`);
  const link = await createPaymentLink(DEMO_AMOUNT, DEMO_DESCRIPTION);
  tracer.record("payment_attempt", {
    paymentLinkId: link.id,
    amount: DEMO_AMOUNT,
    confirmationMode: webhookServer ? "webhook" : "polling-fallback",
  });

  console.log(`\nOpen this URL and pay with a Razorpay TEST card:`);
  console.log(`  ${link.shortUrl}`);
  console.log(`  Test card: 4111 1111 1111 1111, any future expiry, any CVV\n`);

  let paymentId: string | null = null;
  let amountPaid: number | null = null;
  let confirmedVia: "webhook" | "polling" = "polling";

  if (webhookServer) {
    console.log("Waiting for Razorpay's signed payment.captured webhook (up to 5 minutes)...\n");
    const event = await webhookServer.waitFor(
      "payment.captured",
      (payload) => payload?.payload?.payment?.entity?.description === DEMO_DESCRIPTION,
      WEBHOOK_WAIT_MS
    );

    if (event) {
      const entity = event.payload.payload.payment.entity;
      paymentId = entity.id;
      amountPaid = entity.amount / 100;
      confirmedVia = "webhook";
      tracer.record("webhook_received", {
        event: event.event,
        signatureValid: event.signatureValid,
        paymentId,
        amount: amountPaid,
        receivedAt: event.receivedAt,
      });
      console.log(`✓ Signed webhook received and verified: payment ${paymentId} captured (₹${amountPaid})\n`);
    } else {
      console.log("No webhook arrived in time -- falling back to polling for this run.\n");
    }
  }

  if (!paymentId) {
    console.log("Polling paymentLink.fetch() for payment status...\n");
    const paid = await waitForPayment(link.id, { timeoutMs: WEBHOOK_WAIT_MS });
    if (!paid) {
      console.log("Timed out waiting for payment. No payment was completed, so nothing to refund.");
      tracer.record("payment_result", { status: "timeout", paymentLinkId: link.id });
      const filePath = tracer.writeToFile({ status: "timeout" });
      console.log(`Trace written to: ${filePath}`);
      if (webhookServer) await webhookServer.close();
      return;
    }
    paymentId = paid.paymentId;
    amountPaid = paid.amount;
    confirmedVia = "polling";
  }

  console.log(`Payment confirmed via ${confirmedVia.toUpperCase()}: ${paymentId} (₹${amountPaid})`);
  tracer.record("payment_result", {
    status: "captured",
    paymentId,
    amount: amountPaid,
    confirmedVia,
    note:
      confirmedVia === "webhook"
        ? "REAL: confirmed by a signed, independently-verified Razorpay webhook -- not a request we made and chose to trust."
        : "REAL: genuine Razorpay test-mode payment, confirmed via polling fallback (webhook not configured or didn't arrive in time).",
  });

  console.log("\nIssuing a real refund against this payment...");
  const refund = await issueRefund(paymentId, amountPaid!);
  tracer.record("refund_issued", { refundId: refund.refundId, status: refund.status, amount: amountPaid });
  console.log(`Refund issued: ${refund.refundId} (status: ${refund.status})`);

  if (webhookServer) {
    console.log("\nWaiting briefly for the refund.processed webhook too (up to 30s)...");
    const refundEvent = await webhookServer.waitFor(
      "refund.processed",
      (payload) => payload?.payload?.refund?.entity?.id === refund.refundId,
      30 * 1000
    );
    if (refundEvent) {
      tracer.record("webhook_received", {
        event: refundEvent.event,
        signatureValid: refundEvent.signatureValid,
        refundId: refund.refundId,
        receivedAt: refundEvent.receivedAt,
      });
      console.log("✓ Signed refund.processed webhook also received and verified.\n");
    } else {
      console.log("(refund.processed webhook didn't arrive in the short window -- refund is still real, just not independently confirmed by webhook within this run)\n");
    }
    await webhookServer.close();
  }

  const filePath = tracer.writeToFile({
    status: "captured_and_refunded",
    paymentId,
    refundId: refund.refundId,
    confirmedVia,
  });
  console.log(`\nFull trace written to: ${filePath}`);
  console.log(
    "\nThis is the strongest evidence in the repo: a genuine captured payment,\n" +
      (confirmedVia === "webhook"
        ? "independently confirmed by a signed Razorpay webhook (not a request we trusted),\n"
        : "confirmed via polling fallback,\n") +
      "immediately followed by a genuine refund -- the full authorize-capture-reverse lifecycle,\n" +
      "all logged to the same audit trail as every other AgentTrace event."
  );
}

main().catch(async (err) => {
  console.error("verify-payment crashed:", err);
  process.exit(1);
});
