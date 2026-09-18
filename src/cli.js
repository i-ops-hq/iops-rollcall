#!/usr/bin/env node
// rollcall — every AI process on this machine, and what a stop could not reach.
//
// Two verbs, both first class. `list` is the default and reads nothing but the process table.
// `stop` acts, with no confirmation prompt: a switch that asks "are you sure" during an incident is
// broken. The safety is in the targeting, not in a flag — it signals only what it can attribute to
// a signature it carries, and it prints exactly what it did and what it could not do. And in the
// arguments: anything it does not understand is refused before the process table is read, because
// without a prompt a misspelled --dry-run is otherwise the real thing (src/args.js).

import { parse } from "./args.js";
import { attribute } from "./attribute.js";
import { readTable, tableGaps } from "./ps.js";
import { formatList, formatSchedules, formatStop, wrap } from "./report.js";
import { mostRecentRecord, writeRecord } from "./record.js";
import { CHECKED_ON, SIGNATURES, loadSignatures, signatureFor } from "./registry.js";
import { readSchedules } from "./schedules.js";
import { descendantsOf, plan, stopPids } from "./stop.js";

const HELP = `rollcall — every AI process on this machine, and what a stop could not reach

  rollcall              list what is running (the default; reads only)
  rollcall list         the same, said out loud
  rollcall stop         signal what it can attribute, verify each one, write a record
  rollcall schedules    what will start later: launchd, cron, systemd timers. Reads only
  rollcall stop --dry-run   what stop would signal, without signalling it
  rollcall --json       machine-readable, for either verb
  rollcall --registry <file>  use your own signatures instead of the built-in ones
  rollcall --version

It matches the executable path of a process against ${SIGNATURES.length} signatures, last checked on
a real machine ${CHECKED_ON}. It never reads the command line, because a command line contains
whatever text somebody typed.

Applications are reported and never quit: the conversation, the diff and the tool calls live inside
them. A shell you opened yourself is never listed or stopped — only one an agent started.

It reports what is running. It does not say whether any of it should be.
`;

async function main(argv) {
  const parsed = parse(argv);
  // Refused before anything is read: an argument this does not understand could be the preview
  // flag spelled wrong, and `stop` has no confirmation to catch it later.
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }
  const { verb, flags, registry } = parsed;
  if (flags.has("--help") || flags.has("-h") || verb === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.has("--version")) {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (verb !== "list" && verb !== "stop" && verb !== "schedules") {
    process.stderr.write(`rollcall: no verb called ${verb}. Try \`rollcall --help\`.\n`);
    return 2;
  }

  if (verb === "schedules") {
    let signatures = SIGNATURES;
    if (registry) {
      try {
        signatures = loadSignatures(registry);
      } catch (err) {
        process.stderr.write(`rollcall: ${err.message}\n`);
        return 2;
      }
    }
    const result = readSchedules();
    for (const source of result.sources) {
      for (const item of source.entries) {
        const sig = item.program ? signatureFor(item.program, signatures) : null;
        item.matched = Boolean(sig);
        item.label = sig ? sig.label : "";
      }
    }
    process.stdout.write(
      asJsonEarly(flags)
        ? `${JSON.stringify({ verb: "schedules", sources: result.sources }, null, 2)}\n`
        : formatSchedules(result, signatures),
    );
    // A read-only verb reports and exits 0. Returning 1 because it FOUND something fires on every
    // machine that schedules anything recognised, which is how a check becomes a line in a CI file
    // that everyone has muted — the same mistake compiled payloads caused in the dependency gate,
    // made again here and caught by running the published package against its own README.
    return 0;
  }

  let rows;
  try {
    rows = readTable();
  } catch (err) {
    process.stderr.write(`rollcall: could not read the process table: ${err.message}\n`);
    return 2;
  }
  const gaps = tableGaps(rows);
  let signatures = SIGNATURES;
  if (registry) {
    try {
      signatures = loadSignatures(registry);
    } catch (err) {
      process.stderr.write(`rollcall: ${err.message}\n`);
      return 2;
    }
  }
  const attributed = attribute(rows, { signatures });
  const asJson = flags.has("--json");

  if (verb === "list") {
    process.stdout.write(
      asJson
        ? `${JSON.stringify({ verb: "list", ...summary(attributed, gaps, signatures) }, null, 2)}\n`
        : formatList(attributed, gaps, signatures),
    );
    return 0;
  }

  const { signal, reportOnly, excluded } = plan(attributed);
  // Stopping an agent stops the work it started, which is the shells and helpers beneath it.
  const targets = new Map();
  for (const proc of signal) {
    targets.set(proc.pid, proc);
    for (const child of descendantsOf(proc.pid, attributed)) {
      if (!child.isSelf && !child.isApp) targets.set(child.pid, child);
    }
  }

  if (flags.has("--dry-run")) {
    const would = [...targets.values()];
    process.stdout.write(
      asJson
        ? `${JSON.stringify({ verb: "stop", dryRun: true, wouldSignal: would.map(brief) }, null, 2)}\n`
        : `${would.length} would be signalled:\n${would.map((p) => `  · ${p.label} — pid ${p.pid}`).join("\n")}\n\n${wrap("Nothing was signalled. This is what stop would do.", 88)}\n`,
    );
    return would.length ? 1 : 0;
  }

  // Read before this run writes its own, or the answer is always "you just stopped these".
  const previous = mostRecentRecord();
  const outcome = await stopPids([...targets.keys()]);
  const byPid = (pids) => pids.map((pid) => targets.get(pid) || { pid, label: "unknown" });
  const result = {
    stopped: byPid(outcome.stopped),
    survived: byPid(outcome.survived),
    refused: byPid(outcome.refused),
    alreadyGone: outcome.alreadyGone,
    reportOnly,
    excluded,
  };

  // Written before it is printed, because the terminal is not a record.
  const record = writeRecord({
    at: new Date().toISOString(),
    ...summary(attributed, gaps, signatures),
    stopped: result.stopped.map(brief),
    survived: result.survived.map(brief),
    refused: result.refused.map(brief),
    reportedNotSignalled: reportOnly.map(brief),
    excludedAsOwnAncestry: excluded.map(brief),
    alreadyGone: outcome.alreadyGone,
  });

  process.stdout.write(
    asJson
      ? `${JSON.stringify({ verb: "stop", record: record.path, ...summary(attributed, gaps, signatures), stopped: result.stopped.map(brief), survived: result.survived.map(brief), refused: result.refused.map(brief), reportedNotSignalled: reportOnly.map(brief) }, null, 2)}\n`
      : formatStop(result, gaps, record.path, signatures, previous),
  );
  if (record.error) process.stderr.write(`rollcall: the record could not be written: ${record.error}\n`);

  return result.survived.length || result.refused.length || reportOnly.length ? 1 : 0;
}

const asJsonEarly = (flags) => flags.has("--json");

const brief = (p) => ({ pid: p.pid, label: p.label, comm: p.comm, mayRestart: Boolean(p.mayRestart) });

function summary(attributed, gaps, signatures = SIGNATURES) {
  return {
    processesRead: gaps.total,
    signatures: signatures.length,
    signaturesCheckedOn: CHECKED_ON,
    matched: attributed.filter((p) => p.matched).map(brief),
    reportsNameWithoutPath: gaps.noPath,
    notLookedFor: [
      "anything running on another machine",
      "any request already in flight",
      "any agent these signatures do not name",
      "any work that has not started yet",
    ],
  };
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
