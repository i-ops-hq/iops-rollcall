// What a person reads. Observations only.
//
// **Show, do not advise.** This says what is running and what it could not reach. It does not say a
// process looks malicious, does not rank anything by severity, and does not recommend stopping
// anything. That is not a verdict withheld; it is a verdict this tool does not have, and inventing
// one would be claiming a threat model it does not possess. `Coverage` has always said "not in this
// folder" rather than "missing", and the same sentence fits here unchanged.
//
// The vocabulary ban in the tests is flat, including on denials. A checker clever enough to tell a
// denial from a claim is the substring bug moved from paths to English, so the output is written to
// never need the words at all — not even to disown them.

import { CHECKED_ON, SIGNATURES } from "./registry.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function line(proc) {
  const via = proc.viaAncestor ? ` (started by pid ${proc.viaAncestor})` : "";
    return `  · ${proc.label} — pid ${proc.pid}${via}`;
}

/**
 * Applications collapse to one entry each, with their helper count beside them.
 *
 * On the machine this was written on, 22 processes matched and 15 were Electron helpers of a single
 * desktop app: renderers, a GPU process, a crashpad handler. Listing those as fifteen findings is
 * the inflated number this whole family of tools exists to refuse, and it also buries the two lines
 * that matter. The helpers are counted, not hidden.
 */
function groupApps(found) {
  const apps = new Map();
  const rest = [];
  for (const proc of found) {
    if (!proc.isApp) {
      rest.push(proc);
      continue;
    }
    const key = proc.signature.id;
    const seen = apps.get(key);
    if (!seen || proc.pid < seen.root.pid) {
      apps.set(key, { root: proc, helpers: (seen ? seen.helpers : -1) + 1, self: (seen && seen.self) || proc.isSelf });
    } else {
      seen.helpers += 1;
      seen.self = seen.self || proc.isSelf;
    }
  }
  return { apps: [...apps.values()], rest };
}

/** The read-only verb. Names everyone present. */
export function formatList(attributed, gaps) {
  const found = attributed.filter((p) => p.matched);
  const out = [];

  if (!found.length) {
    out.push(`No processes here match the ${SIGNATURES.length} signatures this carries.`);
  } else {
    const { apps, rest } = groupApps(found);
    out.push(
      `${plural(found.length, "process", "processes")} matched, of ${gaps.total} running — ` +
        `${plural(apps.length, "application", "applications")} and ${plural(rest.length, "other", "others")}.`,
    );
    out.push("");
    for (const app of apps) {
      const helpers = app.helpers ? `, plus ${plural(app.helpers, "helper process", "helper processes")}` : "";
      out.push(`  · ${app.root.label} — pid ${app.root.pid}${helpers}`);
      out.push("      an application, so a stop reports it and leaves it running");
      if (app.root.mayRestart) out.push("      it can start agents again");
      if (app.self) out.push("      this command runs inside it");
    }
    for (const proc of rest) {
      const marks = [];
      if (proc.mayRestart) marks.push("can start agents again");
      if (proc.isSelf) marks.push("this command's own ancestry");
      out.push(line(proc) + (marks.length ? `\n      ${marks.join(", ")}` : ""));
    }
  }

  out.push("");
  out.push(coverage(gaps));
  return `${out.join("\n")}\n`;
}

/** The stop verb. The count and its caveats travel together. */
export function formatStop(result, gaps, recordPath) {
  const out = [];
  const { stopped, survived, refused, reportOnly, excluded, alreadyGone } = result;

  if (!stopped.length && !survived.length && !refused.length && !reportOnly.length) {
    // "0 found" reads as nothing was ever here. That is a different sentence from this one.
    out.push(
      alreadyGone.length
        ? `Nothing here that was not already stopped. ${plural(alreadyGone.length, "process", "processes")} had exited before this ran.`
        : `No processes here match the ${SIGNATURES.length} signatures this carries.`,
    );
  } else {
    out.push(`${plural(stopped.length, "process", "processes")} stopped and verified gone.`);
  }
  out.push("");

  const stillHere = [...survived, ...refused, ...reportOnly];
  if (stillHere.length) {
    out.push(`Still running (${stillHere.length}):`);
    for (const proc of reportOnly) {
      out.push(line(proc));
      out.push("      an application, so it was not signalled — the conversation, the diff and the");
      out.push("      tool calls are inside it, and closing it takes them with it.");
      if (proc.mayRestart) out.push("      It can start agents again, so the count above is not a final state.");
    }
    for (const proc of survived) {
      out.push(`${line(proc)}\n      it was signalled and it is still here`);
    }
    for (const proc of refused) {
      out.push(`${line(proc)}\n      owned by another user, so this could not signal it`);
    }
    out.push("");
  }

  if (excluded.length) {
    out.push(`Not signalled, because this command runs inside it (${excluded.length}):`);
    for (const proc of excluded) out.push(line(proc));
    out.push("");
  }

  if (recordPath) {
    out.push(`Written to ${recordPath}`);
    out.push("");
  }
  out.push(coverage(gaps));
  return `${out.join("\n")}\n`;
}

/**
 * What was not looked for. Counted from this machine on this run, never a figure from elsewhere:
 * a tool that hardcodes another machine's ceiling is making a claim it did not check.
 */
export function coverage(gaps) {
  const bits = [
    `Read ${gaps.total} processes against ${SIGNATURES.length} signatures, last checked on a real machine ${CHECKED_ON}.`,
  ];
  if (gaps.kernelThreads) {
    bits.push(
      `${gaps.kernelThreads} of those are kernel threads, which run no executable at all — not something this could not reach.`,
    );
  }
  if (gaps.noPath.length) {
    const why = gaps.notMine
      ? ` ${gaps.notMine} of them belong to another user, whose executable this cannot read.`
      : "";
    bits.push(
      `${plural(gaps.noPath.length, "process reports", "processes report")} a name and no path, so no signature can be applied to ${gaps.noPath.length === 1 ? "it" : "them"}: ${gaps.noPath.slice(0, 4).join(", ")}${gaps.noPath.length > 4 ? ", and more" : ""}.${why}`,
    );
  }
  bits.push(
    "Not looked for: anything running on another machine, any request already in flight, any agent " +
      "these signatures do not name, and any work that has not started yet. Those are outside the " +
      "numbers above rather than counted as zero.",
  );
  return bits.map((b) => wrap(b, 88)).join("\n");
}

export function wrap(text, width = 88, indent = "") {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}
