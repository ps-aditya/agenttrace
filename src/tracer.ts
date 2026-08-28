import * as fs from "fs";
import * as path from "path";
import { TraceEvent, TraceEventType } from "./types";

// Tracer is both the "observe" layer (records what happens as it happens)
// and the "audit" layer (persists the full run to disk as evidence).
// Deliberately dumb: an in-memory array plus a flat JSON file. No database,
// no schema migrations, no retention policy -- that would be over-building
// for a 10-day CLI demo. If this project grows past the demo stage, this is
// the first thing to replace with something durable.
export class Tracer {
  private events: TraceEvent[] = [];
  private seq = 0;
  private runId: string;
  private startedAt: string;

  constructor(runId?: string) {
    this.startedAt = new Date().toISOString();
    this.runId = runId ?? this.startedAt.replace(/[:.]/g, "-");
  }

  record(type: TraceEventType, data: Record<string, unknown>): TraceEvent {
    const event: TraceEvent = {
      seq: this.seq++,
      timestamp: new Date().toISOString(),
      type,
      data,
    };
    this.events.push(event);
    return event;
  }

  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  // Writes the full run -- every event, in order -- to traces/run-<id>.json.
  // This file is the evidence artifact: it's what you point at in the README
  // and the pitch video as proof the system actually did what it claims,
  // rather than asking anyone to take the claim on faith.
  writeToFile(outcomeSummary: Record<string, unknown>): string {
    const dir = path.join(__dirname, "..", "traces");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, `run-${this.runId}.json`);
    const payload = {
      runId: this.runId,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      summary: outcomeSummary,
      events: this.events,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return filePath;
  }
}
