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
import { readlinkSync } from "node:fs";

/** Bytes of `ps` output accepted before giving up. A very large table is a gap, never a hang. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** @typedef {{pid:number, ppid:number, comm:string, args:string}} Row */

/**
 * Whether `ps` is describing a kernel thread, which runs no executable at all.
 *
 * Linux brackets their arguments — `[kthreadd]`, `[rcu_gp]` — and that is how Linux itself tells
 * them apart. Exported because it is the detection, and a test that hands in a row already marked
 * as a kernel thread checks the accounting and never the thing that decides.
 */
export function isKernelThread(args) {
  const text = String(args || "").trim();
  return text.startsWith("[") && text.endsWith("]") && text.length > 2;
}

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
 * On Linux, `ps -o comm` is the command NAME, not a path — and truncated to fifteen characters at
 * that. A registry built on resolved paths would match nothing there, silently, on a whole
 * platform, which is the same failure the format string would have caused on macOS wearing a
 * different hat.
 *
 * `/proc/<pid>/exe` is the authoritative answer and better than `ps` gives on either platform: a
 * symlink to the binary actually executing. Unreadable for kernel threads and for other users'
 * processes, and that is reported as a gap rather than filled in with the short name, because a
 * short name in a field the registry treats as a path is worse than an empty one.
 */
function resolveViaProc(rows) {
  if (process.platform !== "linux") return rows;
  return rows.map((row) => {
    try {
      return { ...row, comm: readlinkSync(`/proc/${row.pid}/exe`) };
    } catch {
      // A kernel thread has no executable to point at, so its absence is not a gap in what this
      // could read — it is the whole truth about that process. On a CI runner 150 of 164 processes
      // resolve to nothing, and counting all of them as unreachable overstates the blind spot as
      // badly as hiding it would understate it. `ps` brackets a kernel thread's args, which is how
      // Linux itself distinguishes them.
      return isKernelThread(row.args)
        ? { ...row, comm: "", kernelThread: true }
        : { ...row, comm: "", shortName: row.comm };
    }
  });
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
  return resolveViaProc(rows).sort((a, b) => a.pid - b.pid);
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
  const noPath = rows
    .filter((r) => !r.kernelThread && ((r.comm && !r.comm.includes("/")) || (!r.comm && r.shortName)))
    .map((r) => r.comm || r.shortName);
  const noComm = rows.filter((r) => !r.comm && !r.shortName && !r.kernelThread).map((r) => r.pid);
  const kernelThreads = rows.filter((r) => r.kernelThread).length;
  return {
    total: rows.length,
    noPath: [...new Set(noPath)].sort(),
    noComm,
    // Counted apart: a kernel thread runs no executable, so it is not something this failed to
    // reach. Reported so the numbers add up rather than left out so they look better.
    kernelThreads,
  };
}
