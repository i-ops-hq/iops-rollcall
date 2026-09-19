// Schedules: work that has not started yet, read and never changed.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { enabledFromSystemctl, enabledState, programFromCommand, readSchedules } from "../src/schedules.js";
import { loadSignatures } from "../src/registry.js";
import { formatSchedules } from "../src/report.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("every source reports its own coverage, and an unavailable one says why", () => {
  // Three sources that disagree about where truth lives and who may read it. One figure across
  // them would be a denominator made of parts that do not agree, so each says what it read and
  // what it could not — the same split as kernel threads out of the unresolved count.
  const { sources } = readSchedules();
  assert.deepEqual(sources.map((s) => s.id).sort(), ["cron", "launchd", "systemd"]);

  for (const source of sources) {
    assert.equal(typeof source.available, "boolean");
    if (!source.available) {
      assert.ok(source.why, `${source.id} is unavailable and does not say why`);
    } else {
      assert.ok(Array.isArray(source.entries));
    }
  }
  // At least one source has to work here, or this test is asserting nothing about this machine.
  assert.ok(sources.some((s) => s.available), "no schedule source could be read at all");
});

test("existing and enabled are separate facts, and unknown is a third", () => {
  const { sources } = readSchedules();
  for (const source of sources) {
    for (const item of source.entries) {
      assert.equal(item.exists, true, "an entry that does not exist should not be an entry");
      // Never coerced to a boolean. A schedule whose enabled state could not be read is reported
      // as unknown, because folding that into "enabled" makes two facts one.
      assert.ok(
        item.enabled === true || item.enabled === false || item.enabled === null,
        `${item.id} has enabled=${JSON.stringify(item.enabled)}`,
      );
    }
  }
});

test("a schedule that states no executable path is counted rather than guessed at", () => {
  const { sources } = readSchedules();
  const available = sources.filter((s) => s.available);
  for (const source of available) {
    for (const item of source.entries) {
      if (!item.program) {
        assert.ok(item.note, `${item.id} has no program and no reason given`);
      } else {
        // A path or nothing. `cd /x && thing` names nothing this can trust, and inventing one is
        // how a registry starts matching text again.
        assert.ok(item.program.startsWith("/"), `${item.id} program is not an absolute path: ${item.program}`);
      }
    }
  }
});

test("it reads schedules and changes none of them", async () => {
  // The verb is read-only by construction: there is no disable path to accidentally reach. Asserted
  // through the CLI so the promise in the output is the promise the code keeps.
  const { stdout } = await run(process.execPath, [CLI, "schedules"]).catch((e) => e);
  assert.match(stdout, /reads schedules and changes none of them/);
  assert.match(stdout, /Not looked for:/);
  assert.match(stdout, /another machine/);
  for (const advice of ["you should", "we recommend", "disable ", "remove "]) {
    assert.ok(!stdout.toLowerCase().includes(advice), `output advises: ${advice}`);
  }
});

/**
 * The registry row the next tests build from whatever this machine has scheduled, with a near miss
 * that cannot fall inside it.
 *
 * The near miss used to be a fixed `/usr/bin/node`, which is inside the row's own root whenever the
 * first scheduled program on the machine lives in /usr/bin. The registry then refuses the row for
 * matching its own negative case, and the test fails on its fixture rather than on the code. On
 * 2026-09-19 an Ubuntu runner failed it twice with empty output, which is what that refusal looks
 * like, while every other job passed. A sibling of the root (`/usr/bin-near-miss/` for `/usr/bin/`)
 * is outside it by construction, and a nearer miss than the old one.
 */
function fixtureRow(program) {
  const root = program.slice(0, program.lastIndexOf("/") + 1);
  return {
    id: "fixture",
    label: "Fixture",
    kind: "root",
    path: root,
    example: program,
    never: [`${root.slice(0, -1)}-near-miss/${program.slice(root.length)}`],
  };
}

test("the fixture is a row the registry accepts, whatever directory the schedule names", () => {
  // Checked here, against paths chosen on purpose, because the test below only ever sees whichever
  // program this machine happens to schedule first.
  const dir = mkdtempSync(join(tmpdir(), "rollcall-fixture-"));
  try {
    for (const program of ["/usr/bin/mandb", "/usr/sbin/logrotate", "/usr/lib/apt/apt.systemd.daily", "/opt/homebrew/bin/brew"]) {
      const file = join(dir, "r.json");
      writeFileSync(file, JSON.stringify([fixtureRow(program)]), "utf8");
      assert.doesNotThrow(() => loadSignatures(file), `a schedule naming ${program} builds a row the registry refuses`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a schedule naming a recognised program is reported, and reporting is not a failure", async () => {
  const { sources } = readSchedules();
  const withProgram = sources.flatMap((s) => s.entries).find((e) => e.program);
  if (!withProgram) return; // nothing scheduled here states a path; nothing to prove

  const dir = mkdtempSync(join(tmpdir(), "rollcall-sched-"));
  const registry = join(dir, "r.json");
  writeFileSync(registry, JSON.stringify([fixtureRow(withProgram.program)]), "utf8");
  try {
    const result = await run(process.execPath, [CLI, "schedules", "--registry", registry]).catch((e) => e);
    assert.match(
      String(result.stdout),
      /Fixture/,
      `the recognised schedule (${withProgram.program}) is named; stderr said: ${String(result.stderr).trim() || "nothing"}`,
    );
    assert.equal(result.code ?? 0, 0, "a read-only verb reports; it does not fail on what it read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the summary never says a source was read when it was not", () => {
  const text = formatSchedules(
    {
      sources: [
        { id: "a", label: "source A", available: false, why: "not on this platform", entries: [] },
        { id: "b", label: "source B", available: true, why: "", entries: [] },
      ],
    },
    [],
  );
  assert.match(text, /source A — not read: not on this platform/);
  assert.match(text, /source B — 0 schedules read/);
});

test("three enabled states, and unknown is not folded into either of the others", () => {
  // Tested directly rather than through this machine, because a machine only covers the cases it
  // happens to have — and a mutation that coerced unknown to a boolean passed every test that read
  // the real launchd directory.
  assert.equal(enabledState({ disabled: true, loaded: false }), false, "the plist says disabled");
  assert.equal(enabledState({ disabled: true, loaded: true }), false, "disabled wins over loaded");
  assert.equal(enabledState({ disabled: false, loaded: true }), true);
  assert.equal(enabledState({ disabled: undefined, loaded: true }), true);
  // The case that matters: present, not marked disabled, not currently loaded. Not enabled, and
  // saying so is different from saying it is off.
  assert.equal(enabledState({ disabled: undefined, loaded: false }), null);
  assert.equal(enabledState({}), null);
});

test("a scheduled command yields a path or nothing, never a guess", () => {
  // Also tested directly: there is no crontab on the machine this was written on, so every test
  // that went through the real reader skipped this code entirely.
  assert.equal(programFromCommand("/usr/local/bin/ollama serve"), "/usr/local/bin/ollama");
  assert.equal(programFromCommand("  /opt/x/y --flag  "), "/opt/x/y");
  assert.equal(programFromCommand("cd /x && ollama serve"), "", "cd is not the program");
  assert.equal(programFromCommand("ollama serve"), "", "a bare name is not a path");
  assert.equal(programFromCommand("~/bin/thing"), "", "an unexpanded home is not a path");
  assert.equal(programFromCommand(""), "");
  assert.equal(programFromCommand(undefined), "");
});

test("systemctl says more than enabled and disabled, and the rest is unknown", () => {
  // A real Linux runner returned `systemd-tmpfiles` from an ExecStart capture and the systemd
  // branch accepted it, because only the cron branch checked for an absolute path. One rule
  // applied in one place is not a rule, and the general test caught it.
  assert.equal(enabledFromSystemctl("enabled"), true);
  assert.equal(enabledFromSystemctl("enabled-runtime"), true);
  assert.equal(enabledFromSystemctl("disabled"), false);
  assert.equal(enabledFromSystemctl("masked"), false);
  // States this does not model. Mapping them onto a boolean would invent a fact.
  for (const word of ["static", "indirect", "generated", "transient", "alias", ""]) {
    assert.equal(enabledFromSystemctl(word), null, word || "(empty)");
  }
});

test("a read-only verb reports and exits zero, however much it finds", async () => {
  // `schedules` returned 1 when it recognised a scheduled program, which fires on every machine
  // that schedules anything at all — how a check becomes a line in a CI file everybody has muted.
  // The same mistake compiled payloads caused in the sibling dependency gate, made again here, and
  // caught by running the published package against its own README.
  const plain = await run(process.execPath, [CLI, "schedules"]).catch((e) => e);
  assert.equal(plain.code ?? 0, 0, "reading and reporting is not a failure");

  const listed = await run(process.execPath, [CLI, "list"]).catch((e) => e);
  assert.equal(listed.code ?? 0, 0);

  // It still exits 2 when it genuinely could not run, which is the distinction that matters.
  const broken = await run(process.execPath, [CLI, "schedules", "--registry", "/nope/x.json"]).catch((e) => e);
  assert.equal(broken.code, 2);
});
