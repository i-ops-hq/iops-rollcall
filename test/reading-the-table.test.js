// The process table, and the two things about it that are not obvious.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { isKernelThread, readTable, tableGaps } from "../src/ps.js";
import { ancestryOf } from "../src/attribute.js";
import { signatureFor } from "../src/registry.js";
import { coverage } from "../src/report.js";

test("comm is truncated to sixteen characters unless it is the last column", () => {
  // The finding that decided the whole reader, asserted against the real `ps` rather than quoted.
  // If this ever stops being true the two-pass reading becomes unnecessary, and that is worth
  // learning from a failing test rather than from a rewrite.
  const truncated = execFileSync("/bin/ps", ["-axo", "pid=,comm=,args="], { encoding: "utf8" });
  const whole = execFileSync("/bin/ps", ["-axo", "pid=,comm="], { encoding: "utf8" });

  const longest = (text, field) =>
    Math.max(
      ...text
        .split("\n")
        .filter(Boolean)
        .map((l) => l.trim().split(/\s+/)[field] || "")
        .map((s) => s.length),
    );

  assert.ok(longest(truncated, 1) <= 16, "comm was not truncated; the premise has changed");
  assert.ok(longest(whole, 1) > 16, "comm as the last column should keep its full path");
});

test("a path containing spaces survives the reading", async () => {
  // macOS application bundles have spaces above and below the app root, so a whitespace split
  // could not recover them at all. The first version of this asserted that such a path was already
  // running, which is a property of the MACHINE and not of this code — true on macOS, false on a
  // Linux runner, and it went red in CI within a minute. So the test creates the condition it
  // tests rather than hoping to find it.
  // The fixture differs by platform, and both halves were learned the hard way. macOS refuses to
  // execute a COPY of a signed system binary, so the copy produced a process that never started.
  // Linux resolves `/proc/<pid>/exe` through a symlink to the real target, so a symlink loses the
  // spaces it was created to carry. Symlink on macOS, copy on Linux.
  const dir = mkdtempSync(join(tmpdir(), "roll call-"));
  const spaced = join(dir, "a node");
  if (process.platform === "linux") {
    copyFileSync(process.execPath, spaced);
    chmodSync(spaced, 0o755);
  } else {
    symlinkSync(process.execPath, spaced);
  }

  const child = spawn(spaced, ["-e", "setTimeout(() => {}, 5000)"], { stdio: "ignore" });
  try {
    await sleep(400);
    const row = readTable().find((r) => r.pid === child.pid);
    assert.ok(row, "the spawned process was not in the table");
    assert.ok(row.comm.includes(" "), `comm lost its spaces: ${row.comm}`);
    assert.ok(row.comm.endsWith("a node"), row.comm);
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pid in one reading and gone from the other keeps its identity", () => {
  // A process that exits between the two readings WAS running, so dropping it understates the
  // machine. It keeps its pid and loses the field the other reading would have supplied.
  const rows = readTable();
  for (const row of rows) {
    assert.ok(Number.isInteger(row.pid) && row.pid > 0);
    assert.equal(typeof row.comm, "string");
    assert.equal(typeof row.args, "string");
  }
});

test("the gaps are counted from this machine, never asserted from elsewhere", () => {
  const rows = readTable();
  const gaps = tableGaps(rows);
  assert.ok(gaps.total > 0);

  // A handful of processes report a name and no path. The set and the count both vary between
  // machines and between readings, so the tool counts rather than claims.
  //
  // The first version of this asserted that such a name never contains a slash, which is true on
  // macOS and false on Linux: kernel threads are called things like `cpuhp/0` and `ksoftirqd/0`.
  // The meaningful property is not the shape of the string — it is that no signature can be
  // applied to it, which is why it is in this list at all.
  for (const name of gaps.noPath) {
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0);
    assert.equal(signatureFor(name), null, `${name} is listed as unmatchable but a signature took it`);
  }
});

test("an ancestry walk over a pid cycle fails fast instead of hanging", () => {
  // A hung suite reads as broken infrastructure and gets re-run; a red one gets investigated. The
  // depth bound is what converts a regression in the visited set from a hang into a fast failure,
  // so it is not redundant with the visited set and both are tested here.
  const byPid = new Map([
    [10, { pid: 10, ppid: 11, comm: "/bin/a" }],
    [11, { pid: 11, ppid: 12, comm: "/bin/b" }],
    [12, { pid: 12, ppid: 10, comm: "/bin/c" }],
  ]);
  const started = Date.now();
  const chain = ancestryOf(10, byPid);
  assert.ok(Date.now() - started < 1000, "the walk did not terminate promptly");
  assert.ok(chain.length <= 64);
  assert.deepEqual(chain.map((p) => p.pid), [11, 12]);
});

test("a careless registry row cannot exist, and fails at import rather than in a test", async () => {
  // The strongest guard here is four lines in a constructor. A row that does not match its own
  // example, or that does match one of its own negative cases, refuses to be built — so a new
  // signature cannot be added without evidence, and a bad one never reaches a test that somebody
  // might not have written.
  const { Signature } = await import("../src/registry.js");
  const bad = [
    ["a root without its separator swallows its neighbours",
     { id: "a", label: "A", kind: "root", path: "/Applications/Cursor.app",
       example: "/Applications/Cursor.app/Contents/MacOS/Cursor", never: ["/Applications/Cursor.app-old/x"] }],
    ["a row that matches its own negative case",
     { id: "b", label: "B", kind: "leaf", path: "ollama", example: "/usr/bin/ollama", never: ["/usr/local/bin/ollama"] }],
    ["a row that does not match its own example",
     { id: "c", label: "C", kind: "leaf", path: "claude", example: "/usr/bin/cursor", never: ["/x/y"] }],
    ["a row shipping no negative case at all",
     { id: "d", label: "D", kind: "leaf", path: "claude", example: "/usr/bin/claude", never: [] }],
  ];
  for (const [why, spec] of bad) {
    assert.throws(() => new Signature(spec), undefined, why);
  }
});

test("a kernel thread is counted apart from something this could not reach", () => {
  // On a Linux CI runner 150 of 164 processes resolve to no executable, and almost all of them are
  // kernel threads. A kernel thread runs no executable at all, so reporting it as unreachable
  // overstates the blind spot as badly as hiding a real one would understate it. `ps` brackets
  // their arguments, which is how Linux itself tells them apart.
  const rows = [
    { pid: 2, ppid: 0, comm: "", args: "[kthreadd]", kernelThread: true },
    { pid: 3, ppid: 2, comm: "", args: "[rcu_gp]", kernelThread: true },
    { pid: 900, ppid: 1, comm: "", args: "/usr/sbin/something", shortName: "something" },
    { pid: 901, ppid: 1, comm: "/usr/bin/node", args: "node x.js" },
  ];
  // The detection itself, not just the accounting over it. The first version of this test handed
  // in rows already marked as kernel threads, so breaking the detector changed nothing and the
  // test proved nothing — caught by mutating the detector and watching it stay green.
  assert.equal(isKernelThread("[kthreadd]"), true);
  assert.equal(isKernelThread("[rcu_gp]"), true);
  assert.equal(isKernelThread("/usr/sbin/something --flag"), false);
  assert.equal(isKernelThread("node -e [1,2].map(x=>x)"), false, "a bracket inside args is not a bracketed name");
  assert.equal(isKernelThread("[]"), false);
  assert.equal(isKernelThread(""), false);

  const gaps = tableGaps(rows);

  assert.equal(gaps.kernelThreads, 2);
  assert.deepEqual(gaps.noPath, ["something"], "a kernel thread was counted as unreachable");
  assert.equal(gaps.total, 4, "the totals still add up");

  // Normalised, because the output is soft-wrapped to a terminal width and a phrase that happens
  // to straddle a line break is still the phrase a reader reads. Asserting the raw string makes
  // the test a hostage to the wrap column.
  const text = coverage(gaps).replace(/\s+/g, " ");
  assert.match(text, /kernel threads, which run no executable/);
  assert.match(text, /not something this could not reach/);
});
