#!/usr/bin/env node
// rollcall — every AI process on this machine, and what a stop could not reach.
//
// Two verbs, both first class. `list` is the default and reads nothing but the process table.
// `stop` acts, with no confirmation prompt: a switch that asks "are you sure" during an incident is
// broken. The safety is in the targeting, not in a flag — it signals only what it can attribute to
// a signature it carries, and it prints exactly what it did and what it could not do.

import { attribute } from "./attribute.js";
import { readTable, tableGaps } from "./ps.js";
import { formatList, formatStop, wrap } from "./report.js";
import { writeRecord } from "./record.js";
import { CHECKED_ON, SIGNATURES } from "./registry.js";
import { descendantsOf, plan, stopPids } from "./stop.js";

const HELP = `rollcall — every AI process on this machine, and what a stop could not reach

  rollcall              list what is running (the default; reads only)
  rollcall list         the same, said out loud
  rollcall stop         signal what it can attribute, verify each one, write a record
  rollcall stop --dry-run   what stop would signal, without signalling it
  rollcall --json       machine-readable, for either verb
  rollcall --version

It matches the executable path of a process against ${SIGNATURES.length} signatures, last checked on
a real machine ${CHECKED_ON}. It never reads the command line, because a command line contains
whatever text somebody typed.

Applications are reported and never quit: the conversation, the diff and the tool calls live inside
them. A shell you opened yourself is never listed or stopped — only one an agent started.

It reports what is running. It does not say whether any of it should be.
`;

function parse(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith("-")));
  const words = argv.filter((a) => !a.startsWith("-"));
  return { verb: words[0] || "list", flags };
}

async function main(argv) {
  const { verb, flags } = parse(argv);
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
  if (verb !== "list" && verb !== "stop") {
    process.stderr.write(`rollcall: no verb called ${verb}. Try \`rollcall --help\`.\n`);
    return 2;
  }

  let rows;
  try {
    rows = readTable();
  } catch (err) {
    process.stderr.write(`rollcall: could not read the process table: ${err.message}\n`);
    return 2;
  }
  const gaps = tableGaps(rows);
  const attributed = attribute(rows);
  const asJson = flags.has("--json");

  if (verb === "list") {
    process.stdout.write(
      asJson
        ? `${JSON.stringify({ verb: "list", ...summary(attributed, gaps) }, null, 2)}\n`
        : formatList(attributed, gaps),
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
    ...summary(attributed, gaps),
    stopped: result.stopped.map(brief),
    survived: result.survived.map(brief),
    refused: result.refused.map(brief),
    reportedNotSignalled: reportOnly.map(brief),
    excludedAsOwnAncestry: excluded.map(brief),
    alreadyGone: outcome.alreadyGone,
  });

  process.stdout.write(
    asJson
      ? `${JSON.stringify({ verb: "stop", record: record.path, ...summary(attributed, gaps), stopped: result.stopped.map(brief), survived: result.survived.map(brief), refused: result.refused.map(brief), reportedNotSignalled: reportOnly.map(brief) }, null, 2)}\n`
      : formatStop(result, gaps, record.path),
  );
  if (record.error) process.stderr.write(`rollcall: the record could not be written: ${record.error}\n`);

  return result.survived.length || result.refused.length || reportOnly.length ? 1 : 0;
}

const brief = (p) => ({ pid: p.pid, label: p.label, comm: p.comm, mayRestart: Boolean(p.mayRestart) });

function summary(attributed, gaps) {
  return {
    processesRead: gaps.total,
    signatures: SIGNATURES.length,
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
