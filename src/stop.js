// Signalling, and the verification that makes the report true.
//
// `process.kill(pid, 0)` sends no signal and throws ESRCH when the pid is gone, which is the only
// honest way to know. **A delivered signal is not a death.** A kill switch that reports a stop it
// did not achieve is worse than no kill switch, because the person reads the line, believes the
// machine is quiet, and stops looking.

import { ancestryOf } from "./attribute.js";

/** Grace between SIGTERM and SIGKILL. A process gets a chance to close its files. */
export const DEFAULT_GRACE_MS = 2000;

/** Does this pid still exist? Signal 0 checks without signalling. */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to somebody else, which is still alive.
    return err && err.code === "EPERM";
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What a stop would do, without doing any of it.
 *
 * Apps are never signalled: the application is the evidence, and quitting it destroys the
 * conversation, the diff and the tool calls at the moment those are what matter. They are reported,
 * with the fact that they may restart what was stopped.
 */
export function plan(attributed, { self = process.pid } = {}) {
  const signal = [];
  const reportOnly = [];
  const excluded = [];
  for (const proc of attributed) {
    if (!proc.matched) continue;
    if (proc.isSelf) excluded.push(proc);
    else if (proc.isApp) reportOnly.push(proc);
    else signal.push(proc);
  }
  return { signal, reportOnly, excluded };
}

/**
 * SIGTERM, wait, SIGKILL what survived, then check every pid individually.
 *
 * `escalate: false` exists so the second positive control can prove the tool reports a survivor
 * rather than assuming a signal worked.
 */
export async function stopPids(pids, { escalateAfterMs = DEFAULT_GRACE_MS, escalate = true } = {}) {
  const alreadyGone = [];
  const targets = [];
  for (const pid of pids) {
    (isAlive(pid) ? targets : alreadyGone).push(pid);
  }

  const refused = [];
  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (err) {
      // Owned by another user. Reported and left alone: a switch that tells you to escalate
      // privilege in order to kill things is the omnipotent switch this tool exists not to be.
      if (err && err.code === "EPERM") refused.push(pid);
    }
  }

  if (targets.length) await sleep(Math.max(0, escalateAfterMs));

  if (escalate) {
    for (const pid of targets) {
      if (!refused.includes(pid) && isAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (err) {
          if (err && err.code === "EPERM" && !refused.includes(pid)) refused.push(pid);
        }
      }
    }
    if (targets.length) await sleep(200);
  }

  const stopped = [];
  const survived = [];
  for (const pid of targets) {
    if (refused.includes(pid)) continue;
    (isAlive(pid) ? survived : stopped).push(pid);
  }
  return { stopped, survived, refused, alreadyGone };
}

/** Descendants of a pid, so stopping an agent stops the work it started. */
export function descendantsOf(pid, rows) {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  return rows.filter((row) => row.pid !== pid && ancestryOf(row.pid, byPid).some((a) => a.pid === pid));
}
