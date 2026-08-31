// This module exists specifically to close the gap the terminology note in
// the README describes: everything in payment.ts creates a real Razorpay
// ORDER, but never completes a real PAYMENT, because that requires an
// actual checkout step (a card or UPI id entered) which cannot happen
// purely server-side. This module drives that checkout via a Payment
// Link -- a real, hosted Razorpay checkout page -- so a genuine payment_id
// can be produced, and a genuine refund issued against it.
//
// The one deliberately manual step: you open the printed URL in a browser
// and pay with a Razorpay test card (4111 1111 1111 1111, any future
// expiry, any CVV). That's not a limitation of this code -- there is no
// documented way to skip checkout entirely, even in test mode, and
// pretending otherwise would be exactly the kind of fabricated evidence
// this project has been careful to avoid elsewhere.
export interface PaymentLinkResult {
  id: string;
  shortUrl: string;
}

export interface PaidResult {
  paymentId: string;
  amount: number; // rupees
}

export interface RefundResult {
  refundId: string;
  status: string;
}

function getClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error(
      "RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET must be set for the checkout/refund flow -- this path has no mock fallback, because the entire point is a genuine payment."
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Razorpay = require("razorpay");
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function createPaymentLink(
  amountInRupees: number,
  description: string
): Promise<PaymentLinkResult> {
  const client = getClient();
  const link = await client.paymentLink.create({
    amount: Math.round(amountInRupees * 100),
    currency: "INR",
    description,
    customer: {
      name: "AgentTrace Demo Buyer",
      email: "demo@agenttrace.local",
      contact: "9876543210", // Razorpay rejects contacts with too many repeated digits (e.g. 9999999999) -- this one passes their own validation
    },
    notify: { sms: false, email: false },
    reminder_enable: false,
  });
  return { id: link.id, shortUrl: link.short_url };
}

// Polls the payment link until it's paid or the timeout elapses. Returns
// null on timeout rather than throwing -- a timeout here just means "you
// haven't paid it yet," which is a normal, expected outcome, not an error.
export async function waitForPayment(
  paymentLinkId: string,
  { timeoutMs = 5 * 60 * 1000, pollIntervalMs = 5000 } = {}
): Promise<PaidResult | null> {
  const client = getClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const link = await client.paymentLink.fetch(paymentLinkId);
    if (link.status === "paid" && link.payments?.length) {
      const paid = link.payments.find((p: any) => p.status === "captured") ?? link.payments[0];
      return { paymentId: paid.payment_id, amount: link.amount_paid / 100 };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return null;
}

export async function issueRefund(paymentId: string, amountInRupees: number): Promise<RefundResult> {
  const client = getClient();
  const refund = await client.payments.refund(paymentId, {
    amount: Math.round(amountInRupees * 100),
  });
  return { refundId: refund.id, status: refund.status };
}
