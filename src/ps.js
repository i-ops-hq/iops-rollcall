// The process table, read twice, because it cannot be read once.
//
// The obvious format string does not work, and it fails silently, which is the dangerous half.
// `ps` truncates `comm` to sixteen characters whenever `comm` is not the last column. Measured on
// the machine this was written on: 568 of 580 executable paths are longer than sixteen characters.
// A registry matching on a truncated `comm` therefore matches almost nothing, and a signature that
// matches nothing is indistinguishable from a machine with nothing running — silence read as
// success, arriving through a format string.
//
// Three fields also contain spaces, so whitespace splitting could not recover them anyway:
// `lstart` is five tokens, `comm` contains spaces on macOS (`.../Claude Helper.app/.../Claude
// Helper`), and `args` obviously does. `ps` emits no delimiter, and only the last column may
// contain spaces.
//
// So: two readings, each with exactly one variable-width field and that field last, joined on pid.

import { execFileSync } from "node:child_process";

/** Bytes of `ps` output accepted before giving up. A very large table is a gap, never a hang. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** @typedef {{pid:number, ppid:number, comm:string, args:string}} Row */

function run(args) {
  return execFileSync("/bin/ps", args, {
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** `pid ppid comm` — comm last, so it keeps its full path and may contain spaces. */
function readComm() {
  const out = new Map();
  for (const line of run(["-axo", "pid=,ppid=,comm="]).split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const parts = text.split(/\s+/, 2);
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    // Everything after the second field, spaces and all.
    const rest = text.slice(text.indexOf(parts[1], parts[0].length) + parts[1].length).trim();
    out.set(pid, { pid, ppid, comm: rest });
  }
  return out;
}

/** `pid args` — args last for the same reason. */
function readArgs() {
  const out = new Map();
  for (const line of run(["-axo", "pid=,args="]).split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const cut = text.indexOf(" ");
    const pid = Number(cut === -1 ? text : text.slice(0, cut));
    if (!Number.isInteger(pid)) continue;
    out.set(pid, cut === -1 ? "" : text.slice(cut + 1));
  }
  return out;
}

/**
 * Every process, joined on pid.
 *
 * A pid present in one reading and absent from the other is a process that exited between them. It
 * keeps its identity and loses the field the second reading would have supplied, because it WAS
 * running and dropping it would understate the machine. That happened during testing, which is how
 * the case came to be written down.
 */
export function readTable() {
  const byComm = readComm();
  const byArgs = readArgs();
  /** @type {Row[]} */
  const rows = [];
  for (const [pid, row] of byComm) {
    rows.push({ ...row, args: byArgs.get(pid) ?? "" });
  }
  for (const [pid, args] of byArgs) {
    if (!byComm.has(pid)) rows.push({ pid, ppid: 0, comm: "", args });
  }
  return rows.sort((a, b) => a.pid - b.pid);
}

/**
 * What this reading could not tell us about itself, reported from THIS machine rather than from a
 * number written down somewhere else.
 *
 * A handful of processes report a name with no path — `autofsd`, `automountd`, `cloudphotod` and
 * two Core Audio plugins on the machine this was written on. None is a permission refusal, and the
 * count is not stable between readings, so it is counted each time rather than asserted.
 */
export function tableGaps(rows) {
  const noPath = rows.filter((r) => r.comm && !r.comm.includes("/")).map((r) => r.comm);
  const noComm = rows.filter((r) => !r.comm).map((r) => r.pid);
  return { total: rows.length, noPath: [...new Set(noPath)].sort(), noComm };
}
