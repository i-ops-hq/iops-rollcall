// Work that has not started yet.
//
// A process list answers "what is running". It says nothing about the launchd agent that will
// start an agent at login, or the timer that will run one at three in the morning. Those are the
// same question asked about the future, and nothing about stopping a process touches them.
//
// **Report only.** Disabling a schedule is reversible and is deliberately not here: reporting has
// to be used for a while before anything acts on it, for the same reason the dependency gate warns
// before it blocks.
//
// Two rules this module exists to keep.
//
// **A coverage line per source, never one number.** launchd, cron and systemd disagree about where
// truth lives and about who may read it, and a single figure over three sources of different
// reliability is the shape of a made-up denominator. Each source says what it could read and why
// it could not.
//
// **A schedule that EXISTS and a schedule that is ENABLED are different facts.** Reporting one as
// the other is the label/count mismatch with a new hat on. Where the second is unknown it is
// `null` and printed as unknown, never quietly folded into the first.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where launchd looks, and who each directory belongs to. */
const LAUNCHD_DIRS = [
  { dir: () => join(homedir(), "Library", "LaunchAgents"), scope: "you, at login" },
  { dir: () => "/Library/LaunchAgents", scope: "every user, at login" },
  { dir: () => "/Library/LaunchDaemons", scope: "the system, at boot" },
];

const MAX_ENTRIES = 500;

function tryExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
  } catch {
    return null;
  }
}

/**
 * One scheduled thing.
 *
 * `program` is a resolved executable path when the schedule states one, and empty when it does not
 * — a cron line that runs `cd /x && thing` names no path this can trust, and guessing at one is
 * how a registry starts matching text again.
 */
/**
 * Enabled, disabled, or not known — three states, never two.
 *
 * The plist's `Disabled` key is the author's intent; membership of `launchctl list` is what launchd
 * is actually holding. Neither answers for the other, and a job that is in neither is genuinely
 * unknown rather than enabled. Coercing that to a boolean is how a schedule that will not run reads
 * as one that will.
 */
export function enabledState({ disabled, loaded }) {
  if (disabled === true) return false;
  if (loaded) return true;
  return null;
}

/**
 * The executable a scheduled command names, or nothing.
 *
 * Only an absolute first token counts. `cd /x && thing` and `thing --flag` name nothing this can
 * trust, and inventing a path from them is how a registry starts matching text again — which is
 * the defect the whole registry design exists to avoid.
 */
/**
 * systemctl is-enabled says more than yes and no: static, masked, indirect, generated, transient.
 * Mapping all of those onto a boolean invents a fact, so only the two unambiguous ones are answered.
 */
export function enabledFromSystemctl(word) {
  if (word === "enabled" || word === "enabled-runtime") return true;
  if (word === "disabled" || word === "masked" || word === "masked-runtime") return false;
  return null;
}

export function programFromCommand(command) {
  const first = String(command || "").trim().split(/\s+/)[0] || "";
  return first.startsWith("/") ? first : "";
}

function entry(fields) {
  return { id: "", where: "", program: "", command: "", exists: true, enabled: null, note: "", ...fields };
}

function launchd() {
  const source = { id: "launchd", label: "launchd agents and daemons", available: false, why: "", entries: [] };
  if (process.platform !== "darwin") {
    source.why = "launchd is macOS only";
    return source;
  }
  // `plutil` reads XML and binary plists alike. Hand-parsing the XML would have silently missed
  // every binary one, and this machine has them.
  const loaded = new Set();
  const listing = tryExec("/bin/launchctl", ["list"]);
  if (listing) {
    for (const line of listing.split("\n").slice(1)) {
      const label = line.trim().split(/\s+/)[2];
      if (label) loaded.add(label);
    }
  }
  source.available = true;
  let unreadable = 0;

  for (const { dir, scope } of LAUNCHD_DIRS) {
    let names;
    try {
      names = readdirSync(dir()).filter((n) => n.endsWith(".plist"));
    } catch {
      // A directory this user may not read is a gap in this source, named as one.
      unreadable += 1;
      continue;
    }
    for (const name of names.slice(0, MAX_ENTRIES)) {
      const path = join(dir(), name);
      const json = tryExec("/usr/bin/plutil", ["-convert", "json", "-o", "-", path]);
      if (!json) {
        source.entries.push(entry({ id: name, where: path, note: "could not be read", exists: true }));
        continue;
      }
      let plist;
      try {
        plist = JSON.parse(json);
      } catch {
        source.entries.push(entry({ id: name, where: path, note: "is not a readable plist" }));
        continue;
      }
      const args = Array.isArray(plist.ProgramArguments) ? plist.ProgramArguments : [];
      const program = typeof plist.Program === "string" ? plist.Program : (typeof args[0] === "string" ? args[0] : "");
      const label = typeof plist.Label === "string" ? plist.Label : name.replace(/\.plist$/, "");
      source.entries.push(
        entry({
          id: label,
          where: `${path} — ${scope}`,
          program,
          command: args.join(" ") || program,
          // Loaded and disabled are separate facts and neither is the other. `Disabled` in the
          // plist is the author's intent; membership of `launchctl list` is what launchd is
          // actually holding.
          enabled: enabledState({ disabled: plist.Disabled, loaded: loaded.has(label) }),
          note: plist.Disabled === true ? "the plist marks it disabled" : loaded.has(label) ? "" : "not currently loaded",
        }),
      );
    }
  }
  if (unreadable) source.why = `${unreadable} of ${LAUNCHD_DIRS.length} directories could not be read`;
  return source;
}

function cron() {
  const source = { id: "cron", label: "your crontab", available: false, why: "", entries: [] };
  const out = tryExec("/usr/bin/crontab", ["-l"]);
  if (out === null) {
    // No crontab and no crontab command look the same from here, and saying which would be a guess.
    source.why = "no crontab for this user, or crontab could not be run";
    return source;
  }
  source.available = true;
  for (const raw of out.split("\n").slice(0, MAX_ENTRIES)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^[A-Z_]+=/.test(line)) continue;
    const parts = line.split(/\s+/);
    const command = line.startsWith("@") ? parts.slice(1).join(" ") : parts.slice(5).join(" ");
    if (!command) continue;
    const program = programFromCommand(command);
    source.entries.push(
      entry({
        id: line.slice(0, 60),
        where: "crontab",
        // Only an absolute first token is a path. `cd /x && thing` names nothing this can trust,
        // and inventing one is how a registry starts matching text again.
        program,
        command,
        // A crontab line is present or absent. There is no separate enabled state to report, and
        // inventing `true` here would make the two facts one.
        enabled: true,
        note: program ? "" : "no absolute path in the command, so nothing to match",
      }),
    );
  }
  return source;
}

function systemdTimers() {
  const source = { id: "systemd", label: "systemd timers", available: false, why: "", entries: [] };
  if (process.platform !== "linux") {
    source.why = "systemd is Linux only";
    return source;
  }
  const read = (scope) => tryExec("/usr/bin/systemctl", [...scope, "list-timers", "--all", "--no-pager", "--no-legend"]);
  const blocks = [
    { scope: [], label: "system" },
    { scope: ["--user"], label: "yours" },
  ];
  let any = false;
  for (const { scope, label } of blocks) {
    const out = read(scope);
    if (out === null) continue;
    any = true;
    for (const raw of out.split("\n").slice(0, MAX_ENTRIES)) {
      const line = raw.trim();
      if (!line) continue;
      const unit = line.split(/\s+/).find((t) => t.endsWith(".timer"));
      if (!unit) continue;
      const service = unit.replace(/\.timer$/, ".service");
      const exec = tryExec("/usr/bin/systemctl", [...scope, "show", service, "--property=ExecStart", "--value"]);
      // Through the same gate as a cron command, and it was not: `ExecStart` on a real runner
      // yielded `systemd-tmpfiles` from a `path=` capture, and the systemd branch accepted it
      // because only the cron branch checked. One rule, applied in one place, or it is not a rule.
      const captured = (exec || "").match(/path=(\S+)/);
      const program = programFromCommand(captured ? captured[1] : "");
      const enabled = tryExec("/usr/bin/systemctl", [...scope, "is-enabled", unit]);
      source.entries.push(
        entry({
          id: unit,
          where: `systemd, ${label}`,
          program,
          command: (exec || "").trim(),
          // is-enabled prints static, masked, indirect and others. Only "enabled" is enabled, and
          // only "disabled" or "masked" is off; everything else is a state this does not model, so
          // it is unknown rather than guessed.
          enabled: enabled === null ? null : enabledFromSystemctl(enabled.trim()),
          note: program ? "" : "the unit states no executable path this could read",
        }),
      );
    }
  }
  source.available = any;
  if (!any) source.why = "systemctl could not be run";
  return source;
}

/** Every source, each with its own coverage. Reads only; disables nothing. */
export function readSchedules() {
  return { sources: [launchd(), cron(), systemdTimers()] };
}
