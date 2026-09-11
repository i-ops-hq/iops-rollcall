// The durable record, written before anything is printed.
//
// A stop prints. Run it during an incident, scroll the terminal, and the evidence is a buffer —
// and an incident is the definition of read-back-later. What somebody needs three days later is
// not the number that was stopped; it is what survived, what was refused, and what was never
// looked for at all.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where records go when the caller does not say. */
export function defaultRecordDir() {
  return join(homedir(), ".rollcall", "records");
}

function stamp(when = new Date()) {
  return when.toISOString().replace(/[:.]/g, "-");
}

/**
 * Write the record, and return its path so the output can name it.
 *
 * Failure to write is reported rather than thrown: losing the record is bad, and failing to stop
 * anything because the record could not be written is worse.
 */
export function writeRecord(payload, { dir = defaultRecordDir(), now = new Date() } = {}) {
  const path = join(dir, `stop-${stamp(now)}.json`);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { path, error: "" };
  } catch (err) {
    return { path: "", error: String(err && err.message ? err.message : err) };
  }
}
