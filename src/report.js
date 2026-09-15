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

import { CHECKED_ON, SIGNATURES, verifiedPlatforms } from "./registry.js";

/** How many signatures a run used. Passed in, because --registry means it is not always ours. */
const count = (signatures) => (signatures || SIGNATURES).length;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * A set and a subset of it, derived from one collection in one expression.
 *
 * This exists because the same defect has now been caught in five places across two codebases: a
 * number and the words beside it counting different things. Here it was "26 processes report a
 * name and no path ... 29 of them belong to another user" — a subset larger than its set, because
 * one number counted deduplicated names and the other counted rows.
 *
 * Passing two numbers in is what makes that possible, so this takes the collection instead. The
 * subset cannot exceed the set because both are `all`, filtered or not, and there is no argument
 * a caller can get wrong.
 */
export function share(all, isInSubset) {
  const rows = all || [];
  return { total: rows.length, part: rows.filter(isInSubset).length };
}

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
export function formatList(attributed, gaps, signatures) {
  const found = attributed.filter((p) => p.matched);
  const out = [];

  if (!found.length) {
    out.push(`No processes here match the ${plural(count(signatures), "signature", "signatures")} this carries.`);
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
  out.push(coverage(gaps, signatures));
  return `${out.join("\n")}\n`;
}

/** The stop verb. The count and its caveats travel together. */
export function formatStop(result, gaps, recordPath, signatures, previous) {
  const out = [];
  const { stopped, survived, refused, reportOnly, excluded, alreadyGone } = result;

  if (!stopped.length && !survived.length && !refused.length && !reportOnly.length) {
    // "Nothing found" is accurate and still reads as *nothing was ever here*, which is a different
    // fact from *it is already stopped*. The process table cannot tell them apart — by now those
    // processes are not in it — so the answer comes from the last record, which is the reason this
    // tool writes one.
    if (alreadyGone.length) {
      out.push(
        `Nothing here that was not already stopped. ${plural(alreadyGone.length, "process", "processes")} had exited before this ran.`,
      );
    } else if (previous && Array.isArray(previous.stopped) && previous.stopped.length) {
      out.push(
        `Nothing running that these signatures name. The last stop, ${previous.at}, took ` +
          `${plural(previous.stopped.length, "process", "processes")}.`,
      );
    } else {
      out.push(`No processes here match the ${plural(count(signatures), "signature", "signatures")} this carries.`);
    }
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
  out.push(coverage(gaps, signatures));
  return `${out.join("\n")}\n`;
}

/**
 * What was not looked for. Counted from this machine on this run, never a figure from elsewhere:
 * a tool that hardcodes another machine's ceiling is making a claim it did not check.
 */
export function coverage(gaps, signatures) {
  const bits = [
    `Read ${gaps.total} processes against ${plural(count(signatures), "signature", "signatures")}, last checked on a real machine ${CHECKED_ON}.`,
  ];
  // **Where the rows were confirmed, not just when.** Every signature carries the platform it was
  // checked on, and saying so is the difference between "8 signatures" and "8 signatures, none of
  // which was confirmed on the system you are running". A registry that is entirely macOS finds
  // little on Linux, and a reader who is not told that reads a short list as a quiet machine.
  const elsewhere = verifiedPlatforms(signatures).filter(([name]) => name !== process.platform);
  const here = verifiedPlatforms(signatures).find(([name]) => name === process.platform);
  if (elsewhere.length && !here) {
    bits.push(
      `None of them was confirmed on ${process.platform} — ` +
        `${elsewhere.map(([name, n]) => `${n} on ${name}`).join(", ")}. ` +
        "A path that is right on one system is usually wrong on another, so this list is shorter " +
        "here than the count suggests.",
    );
  } else if (elsewhere.length && here) {
    bits.push(
      `${here[1]} of them were confirmed on ${process.platform}; ` +
        `${elsewhere.map(([name, n]) => `${n} on ${name}`).join(", ")}.`,
    );
  }
  if (gaps.kernelThreads) {
    bits.push(
      `${gaps.kernelThreads} of those are kernel threads, which run no executable at all — not something this could not reach.`,
    );
  }
  if (gaps.noPath.length) {
    // Both numbers out of one call, so the sentence cannot contradict itself.
    const { total, part } = share(gaps.unresolved || [], (r) => r.notMine);
    const n = total || gaps.noPathCount || gaps.noPath.length;
    const why = part ? ` ${part} of them belong to another user, whose executable this cannot read.` : "";
    bits.push(
      `${plural(n, "process reports", "processes report")} a name and no path, so no signature ` +
        `can be applied to ${n === 1 ? "it" : "them"}, including ` +
        `${gaps.noPath.slice(0, 4).join(", ")}${gaps.noPath.length > 4 ? " and others" : ""}.${why}`,
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


/**
 * What will run later, per source.
 *
 * Deliberately not folded into `list`. A process table and a set of schedules are read from
 * different places with different reliability, and one figure across the three sources here would
 * be a denominator made of parts that do not agree — which is the thing this family of tools
 * exists to refuse.
 */
export function formatSchedules(result, signatures) {
  const out = [];
  const recognised = [];

  for (const source of result.sources) {
    if (!source.available) {
      out.push(`${source.label} — not read: ${source.why}`);
      out.push("");
      continue;
    }
    const named = source.entries.filter((e) => e.matched);
    recognised.push(...named);
    out.push(
      `${source.label} — ${plural(source.entries.length, "schedule", "schedules")} read` +
        (source.why ? `, and ${source.why}` : ""),
    );
    for (const item of named) {
      // Exists and enabled are separate facts, and unknown is a third. None is folded into another.
      const state =
        item.enabled === true ? "enabled" : item.enabled === false ? "present but disabled" : "present, enabled state unknown";
      out.push(`  · ${item.label} — ${item.id}`);
      out.push(`      ${state}; ${item.where}`);
    }
    const unattributable = source.entries.filter((e) => !e.matched && !e.program).length;
    if (unattributable) {
      out.push(
        wrap(
          `  ${plural(unattributable, "schedule states", "schedules state")} no executable path this could read, so no signature can be applied to ${unattributable === 1 ? "it" : "them"}.`,
          86,
        ),
      );
    }
    out.push("");
  }

  if (!recognised.length) {
    out.push(`No schedule read here names a program these ${plural(count(signatures), "signature", "signatures")} recognise.`);
    out.push("");
  }

  out.push(
    wrap(
      "This reads schedules and changes none of them. Not looked for: anything scheduled on another " +
        "machine, anything a running process may schedule later, and any program these signatures " +
        "do not name.",
      88,
    ),
  );
  return `${out.join("\n")}\n`;
}
