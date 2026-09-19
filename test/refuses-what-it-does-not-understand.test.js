// An argument rollcall does not understand is refused before anything is read.
//
// Found by running the published package: `rollcall stop --dry-rn` — one letter short of the
// preview flag — was accepted, the unknown flag was ignored, and it took the real stop path. On the
// machine it was found on, the built-in registry would have signalled Codex and three Claude Code
// processes. `stop` has no "are you sure" on purpose, so the argument check is where a typo has to
// be caught.
//
// The end-to-end test below runs the real CLI, and is safe by construction: its registry matches
// nothing, and HOME is a temp directory, so even the old behaviour could only write a record there.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { nearestFlag, parse } from "../src/args.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

// ── the parser ──────────────────────────────────────────────────────────────────────────────────

test("a misspelled --dry-run is refused, and the likely flag is named", () => {
  for (const typo of ["--dry-rn", "--dryrun", "--dry-runn", "--dry"]) {
    const { error } = parse(["stop", typo]);
    assert.ok(error, `${typo} was accepted`);
    assert.match(error, /Did you mean --dry-run\?/, `${typo} gets no suggestion`);
    assert.match(error, /Nothing was read or signalled\./);
  }
});

test("the preview flag spelled right still works", () => {
  const parsed = parse(["stop", "--dry-run"]);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.verb, "stop");
  assert.ok(parsed.flags.has("--dry-run"));
});

test("a flag that is nothing like one it knows is refused without a guess", () => {
  const { error } = parse(["stop", "--force"]);
  assert.match(error, /unknown flag --force\./);
  assert.doesNotMatch(error, /Did you mean/);
});

test("a flag typed without its dashes is an unexpected argument, and says so", () => {
  // `rollcall stop dry-run` read "stop" and dropped the rest, which is the same typo without a dash.
  const { error } = parse(["stop", "dry-run"]);
  assert.match(error, /unexpected argument "dry-run" after stop\. Did you mean --dry-run\?/);
});

test("--registry with its file forgotten is refused rather than falling back to the defaults", () => {
  // It used to fall back to the built-in signatures, so a stop meant for a custom list signalled
  // everything the defaults match instead.
  assert.match(parse(["stop", "--registry"]).error, /--registry needs a file/);
  assert.match(parse(["stop", "--registry", "--dry-run"]).error, /--registry needs a file/);
  assert.match(parse(["stop", "--registry="]).error, /--registry needs a file/);
  const ok = parse(["stop", "--registry", "mine.json", "--dry-run"]);
  assert.equal(ok.registry, "mine.json");
  assert.ok(ok.flags.has("--dry-run"));
});

test("every flag the help text documents is one the parser accepts", () => {
  for (const argv of [["--help"], ["-h"], ["--version"], ["--json"], ["schedules", "--json"], ["list"]]) {
    assert.equal(parse(argv).error, undefined, `${argv.join(" ")} was refused`);
  }
});

test("no suggestion for something short, which would be a guess", () => {
  assert.equal(nearestFlag("-n"), "");
  assert.equal(nearestFlag("--x"), "");
});

// ── the real CLI, against a registry that cannot match anything ─────────────────────────────────

test("the CLI exits 2 on the typo and writes no stop record", async () => {
  const home = await mkdtemp(join(tmpdir(), "rollcall-args-"));
  const registry = join(home, "nothing.json");
  await writeFile(
    registry,
    JSON.stringify({
      signatures: [
        {
          id: "nothing",
          label: "Nothing installed",
          kind: "root",
          path: "/opt/definitely-not-installed-agent/",
          example: "/opt/definitely-not-installed-agent/bin/x",
          never: ["/opt/definitely-not-installed-agent-2/bin/x"],
        },
      ],
    }),
    "utf8",
  );
  try {
    const failed = await run(process.execPath, [CLI, "stop", "--dry-rn", "--registry", registry], {
      env: { ...process.env, HOME: home },
    }).then(
      () => null,
      (err) => err,
    );
    assert.ok(failed, "the typo exited 0");
    assert.equal(failed.code, 2);
    assert.match(failed.stderr, /Did you mean --dry-run\?/);
    assert.equal(existsSync(join(home, ".rollcall", "records")), false, "a stop record was written, so the stop path ran");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
