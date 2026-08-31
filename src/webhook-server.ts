import * as http from "http";
import * as crypto from "crypto";

// This is the actual answer to "I don't want it to be 'we think it
// worked.'" Everything else in this project asks Razorpay a question and
// trusts the answer (orders.create(), paymentLink.fetch()). Both are real
// API calls, but both are request-response: we initiate, Razorpay replies.
// A webhook is different in kind, not just in mechanism -- Razorpay pushes
// the event to us, unprompted, and signs it with HMAC-SHA256 using a secret
// only Razorpay and this server know. Verifying that signature is
// cryptographic proof the event actually originated from Razorpay, not
// something we polled for and are choosing to believe.
//
// This does NOT replace the polling/fetch calls elsewhere in the project --
// those still matter as the request-side half of the story ("we asked for
// a payment link"). This is the confirmation-side half ("Razorpay itself,
// independently, told us what happened").
export interface WebhookEvent {
  event: string; // e.g. "payment.captured", "refund.processed"
  payload: any;
  signatureValid: boolean;
  receivedAt: string;
}

type Listener = (event: WebhookEvent) => void;

export class WebhookServer {
  private server: http.Server;
  private listeners: Listener[] = [];

  constructor(private secret: string, private port: number) {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => resolve());
    });
  }

  onEvent(fn: Listener) {
    this.listeners.push(fn);
  }

  // Resolves when a matching event arrives with a VALID signature, or null
  // on timeout. A webhook with an invalid signature is deliberately never
  // resolved here -- it's logged (see verify-payment.ts) but never trusted
  // as confirmation, because an unverified POST to this endpoint could come
  // from anyone, not necessarily Razorpay.
  waitFor(eventName: string, matcher: (payload: any) => boolean, timeoutMs: number): Promise<WebhookEvent | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const listener: Listener = (evt) => {
        if (evt.signatureValid && evt.event === eventName && matcher(evt.payload)) {
          clearTimeout(timer);
          resolve(evt);
        }
      };
      this.onEvent(listener);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== "POST") {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const signatureHeader = req.headers["x-razorpay-signature"];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      const signatureValid = !!signature && this.verifySignature(body, signature);

      let payload: any = {};
      try {
        payload = JSON.parse(body);
      } catch {
        // malformed body -- payload stays {}, event type falls through to
        // "unknown" below, and signatureValid will almost certainly be
        // false anyway since Razorpay always sends valid JSON
      }

      const event: WebhookEvent = {
        event: payload.event ?? "unknown",
        payload,
        signatureValid,
        receivedAt: new Date().toISOString(),
      };

      console.log(
        `  [webhook] received "${event.event}" -- signature ${signatureValid ? "VALID" : "INVALID/MISSING"}`
      );

      this.listeners.forEach((fn) => fn(event));

      // Always 200 so Razorpay doesn't retry -- we've recorded it either way.
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
  }

  // Timing-safe HMAC comparison -- a naive === comparison would leak timing
  // information about how many leading bytes matched, which is a real
  // (if minor) side-channel; crypto.timingSafeEqual avoids that class of bug.
  private verifySignature(body: string, signature: string): boolean {
    try {
      const expected = crypto.createHmac("sha256", this.secret).update(body).digest("hex");
      const expectedBuf = Buffer.from(expected, "utf-8");
      const actualBuf = Buffer.from(signature, "utf-8");
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }
}
