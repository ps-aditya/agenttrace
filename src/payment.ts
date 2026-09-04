import { PaymentOutcome } from "./types";

// This is the actual execution boundary: the moment the agent's decision
// becomes a real (test-mode) money movement. It tries a genuine Razorpay
// test-mode order creation. If no test keys are configured, it falls back
// to a clearly-labeled mock so the demo still runs end-to-end for anyone
// without you having to hand out credentials -- but the honest path, and
// the one to actually record in the pitch video, is the real API call.
export async function attemptPayment(
  amountInRupees: number,
  receiptLabel: string
): Promise<PaymentOutcome> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return {
      status: "mock_order_created",
      orderId: `mock_${Date.now()}`,
      note: "MOCK: no RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET set in env, simulated order creation instead of calling the real API.",
    };
  }

  try {
    // Lazy require so the package is only touched when keys are present --
    // keeps the zero-config demo path free of any network dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Razorpay = require("razorpay");
    const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });

    const order = await instance.orders.create({
      amount: Math.round(amountInRupees * 100), // paise
      currency: "INR",
      receipt: receiptLabel,
      notes: { source: "agenttrace-demo" },
    });

    return {
      status: "order_created",
      orderId: order.id,
      note: "REAL: Razorpay test-mode order created successfully.",
    };
  } catch (err: any) {
    // Razorpay's SDK typically throws an object shaped like
    // { statusCode, error: { code, description } } rather than a plain
    // Error, so err.message alone is usually empty. Dig into the shape
    // we actually see so the audit trail records something a human (or a
    // judge reading the trace file) can act on, not "unknown error".
    const description =
      err?.error?.description ?? err?.message ?? JSON.stringify(err) ?? "unknown error";
    const statusCode = err?.statusCode;
    return {
      status: "failed",
      reason: statusCode ? `[HTTP ${statusCode}] ${description}` : description,
      note: "Razorpay test-mode order creation failed.",
    };
  }
}
