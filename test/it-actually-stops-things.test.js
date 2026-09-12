// `stop` has never stopped anything, and that is the wrong path to leave untested.
//
// The destructive half of a tool whose whole promise is precision. It cannot be exercised by hand
// on a developer's machine — doing so takes their agent session, their editor and their local
// inference server with it — so it runs where the machine is disposable by definition.
//
// **The registry here is a fixture this file supplies, never the shipped one.** A job that stops
// processes named by the real registry is a job that will one day stop something on a runner
// nobody expected.
//
// The assertion that matters is the decoy surviving. It is the same control as
// `CursorUIViewService`, moved from matching to killing, and killing is where being wrong costs
// somebody their work.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import { isAlive } from "../src/stop.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

// Disposable machines only. Running this anywhere else would signal real processes, and the point
// of the whole tool is not doing that by accident.
const DISPOSABLE = process.env.CI === "true" || process.env.ROLLCALL_ALLOW_REAL_STOP === "1";
const why = "runs where the machine is disposable: CI, or ROLLCALL_ALLOW_REAL_STOP=1";

/** An executable at a path we choose, so a fixture registry can name it and nothing else. */
function plant(dir, name) {
  const path = join(dir, name);
  if (process.platform === "linux") {
    copyFileSync(process.execPath, path);
    chmodSync(path, 0o755);
  } else {
    symlinkSync(process.execPath, path);
  }
  return path;
}

function idle(path, extra = []) {
  return spawn(path, ["-e", "setInterval(() => {}, 1000)", ...extra], { stdio: "ignore" });
}

test("it stops what the registry names, leaves what it does not, and says so", { skip: !DISPOSABLE && why }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "rollcall-real-"));
  const named = join(root, "named");
  const other = join(root, "other");
  mkdirSync(named);
  mkdirSync(other);

  // A registry that can only ever match inside this temp directory.
  const registry = join(root, "registry.json");
  writeFileSync(
    registry,
    JSON.stringify([
      {
        id: "fixture",
        label: "Fixture agent",
        kind: "root",
        path: `${named}/`,
        example: `${named}/an-agent`,
        never: [`${other}/a-decoy`, "/usr/bin/node"],
      },
    ]),
    "utf8",
  );

  const agentPath = plant(named, "an-agent");
  const helperPath = plant(named, "a-helper");
  const decoyPath = plant(other, "a-decoy");

  const agent = idle(agentPath);
  const helper = idle(helperPath);
  const decoy = idle(decoyPath);
  // A child of the agent, spawned by it, so the tree walk is exercised rather than assumed.
  const child = spawn(agentPath, ["-e", "require('child_process').spawn(process.argv[1], ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'}); setInterval(()=>{},1000)", agentPath], { stdio: "ignore" });

  t.after(() => {
    for (const p of [agent, helper, decoy, child]) {
      try { p.kill("SIGKILL"); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  });

  await sleep(700);
  for (const [label, proc] of [["agent", agent], ["helper", helper], ["decoy", decoy], ["child", child]]) {
    assert.equal(isAlive(proc.pid), true, `${label} did not start; the test would prove nothing`);
  }

  // The real thing. Not --dry-run.
  const { stdout } = await run(process.execPath, [CLI, "stop", "--registry", registry, "--json"]).catch((e) => e);
  const report = JSON.parse(stdout);

  const stoppedPids = report.stopped.map((p) => p.pid);
  assert.ok(stoppedPids.includes(agent.pid), "the agent was named and is not in the stopped list");
  assert.ok(stoppedPids.includes(helper.pid), "the helper was named and is not in the stopped list");

  // Verified against the operating system, not against the tool's own account of itself.
  assert.equal(isAlive(agent.pid), false, "reported stopped while still running");
  assert.equal(isAlive(helper.pid), false, "reported stopped while still running");

  // The one that matters.
  assert.equal(isAlive(decoy.pid), true, "it killed a process no signature named");
  assert.ok(!stoppedPids.includes(decoy.pid), "the decoy is in the stopped list");

  // The durable record exists, and lists what the report listed.
  assert.ok(report.record, "no record path was reported");
  const written = JSON.parse(readFileSync(report.record, "utf8"));
  assert.deepEqual(
    written.stopped.map((p) => p.pid).sort(),
    stoppedPids.sort(),
    "the record and the printed report disagree about what was stopped",
  );
  assert.ok(Array.isArray(written.notLookedFor) && written.notLookedFor.length, "the record omits what was not looked for");
  assert.ok(written.at, "the record is not dated");
});

test("a second stop says nothing was left, not that nothing was ever there", { skip: !DISPOSABLE && why }, async (t) => {
  // A sentence this project decided on and had therefore never observed. "0 found" reads as
  // nothing was ever here, which is a different fact from everything already being stopped.
  const root = mkdtempSync(join(tmpdir(), "rollcall-twice-"));
  const named = join(root, "named");
  mkdirSync(named);
  const registry = join(root, "registry.json");
  writeFileSync(
    registry,
    JSON.stringify([
      { id: "fixture", label: "Fixture agent", kind: "root", path: `${named}/`,
        example: `${named}/an-agent`, never: ["/usr/bin/node"] },
    ]),
    "utf8",
  );
  const agent = idle(plant(named, "an-agent"));
  t.after(() => {
    try { agent.kill("SIGKILL"); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  await sleep(700);

  await run(process.execPath, [CLI, "stop", "--registry", registry]).catch((e) => e);
  assert.equal(isAlive(agent.pid), false);

  const second = await run(process.execPath, [CLI, "stop", "--registry", registry]).catch((e) => e);
  const text = String(second.stdout || "");

  // The distinction cannot come from the process table — by now the stopped process is not in it —
  // so it comes from the record the first run wrote. Without that, this says "no processes match",
  // which is accurate and still reads as though nothing was ever running.
  assert.match(text, /The last stop, .*, took \d+ process/, "a second run cannot tell the two cases apart");
  assert.doesNotMatch(text, /No processes here match/, "that sentence is for a machine that never had any");
});
