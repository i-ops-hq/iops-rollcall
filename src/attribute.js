// Which processes are agent work, and which are the person's own.
//
// Scope is a hard boundary rather than a default: AI processes, and terminal sessions those
// processes started. Nothing else. A shell somebody opened themselves is never listed, never
// stopped, never counted — and the rule that decides is ancestry, not the executable, because the
// executable is identical either way. That boundary is what makes a destructive verb trustworthy
// enough to hold.

import { SHELLS, signatureFor } from "./registry.js";

/** Ancestry walks are bounded twice, and the bound is not redundant. See `ancestryOf`. */
const MAX_DEPTH = 64;

function basename(path) {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

function isShell(comm) {
  return SHELLS.has(basename(comm || ""));
}

/**
 * Every ancestor of a pid, nearest first.
 *
 * **Two guards, and they do different jobs.** The visited set stops a pid cycle looping forever.
 * The depth bound is what turns a regression in the visited set from a HANG into a fast failure —
 * and a hung suite reads as broken infrastructure and gets re-run, while a red one gets
 * investigated, so the defect survives a failing run. Removing either is a real regression.
 */
export function ancestryOf(pid, byPid) {
  const seen = new Set([pid]);
  const out = [];
  let current = byPid.get(pid);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!current || !current.ppid || current.ppid === current.pid) break;
    const parent = byPid.get(current.ppid);
    if (!parent || seen.has(parent.pid)) break;
    seen.add(parent.pid);
    out.push(parent);
    current = parent;
  }
  return out;
}

/**
 * Attribute a process table.
 *
 * `self` is this process, whose own ancestry is excluded — run from inside an agent session the
 * chain is `zsh -> claude -> app -> launchd`, so signalling "AI processes" would kill the session
 * that asked, mid-sentence, and the report would never print. An excluded process is a process
 * still running, so it is reported as such rather than omitted.
 */
export function attribute(rows, { self = process.pid } = {}) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const mine = new Set([self, ...ancestryOf(self, byPid).map((p) => p.pid)]);

  return rows.map((row) => {
    const own = signatureFor(row.comm);
    let signature = own;
    let viaAncestor = null;

    // A shell is in scope only when something named started it. Same executable, different parent,
    // different answer — which is the counterfactual the tests turn on.
    if (!signature && isShell(row.comm)) {
      for (const ancestor of ancestryOf(row.pid, byPid)) {
        if (isShell(ancestor.comm)) continue;
        const found = signatureFor(ancestor.comm);
        if (found) {
          signature = found;
          viaAncestor = ancestor.pid;
          break;
        }
      }
    }

    return {
      ...row,
      matched: Boolean(signature),
      signature,
      label: signature ? signature.label : "",
      viaAncestor,
      isApp: signature ? signature.kind === "app" : false,
      mayRestart: signature ? signature.mayRestart : false,
      isSelf: mine.has(row.pid),
    };
  });
}
