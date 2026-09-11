// The second positive control, and it is the product.
//
// A kill switch that says it stopped something it did not stop is worse than no kill switch,
// because the person reads the line, believes the machine is quiet, and stops looking. Everything
// else here is a convenience; this is the claim.
//
// So verification is a post-signal existence check per pid — `process.kill(pid, 0)` throws ESRCH
// when the process is gone — and never an assumption that a delivered signal killed anything. The
// fixture is a real child process that installs a SIGTERM handler and refuses to die.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

import { isAlive, stopPids } from "../src/stop.js";

/** A child that ignores SIGTERM. Killable only with SIGKILL, which is the point. */
function spawnStubborn() {
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
    { stdio: "ignore" },
  );
  return child;
}

test("a process that ignores SIGTERM is reported as surviving it, not as stopped", async () => {
  const child = spawnStubborn();
  await sleep(300);
  assert.equal(isAlive(child.pid), true, "the fixture did not start");

  // Escalation off, so the tool has no way to win. It must say so rather than claim otherwise.
  const outcome = await stopPids([child.pid], { escalateAfterMs: 0, escalate: false });

  assert.deepEqual(outcome.stopped, [], "claimed a kill it did not achieve");
  assert.deepEqual(outcome.survived, [child.pid]);
  assert.equal(isAlive(child.pid), true, "the assertion above would be vacuous otherwise");

  child.kill("SIGKILL");
  await sleep(200);
});

test("a process that does die is verified gone rather than assumed gone", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
  await sleep(300);

  const outcome = await stopPids([child.pid], { escalateAfterMs: 500 });

  assert.deepEqual(outcome.survived, []);
  assert.deepEqual(outcome.stopped, [child.pid]);
  assert.equal(isAlive(child.pid), false);
});

test("escalation is what turns a survivor into a stop, and it is still verified", async () => {
  const child = spawnStubborn();
  await sleep(300);

  const outcome = await stopPids([child.pid], { escalateAfterMs: 300, escalate: true });

  assert.deepEqual(outcome.stopped, [child.pid]);
  assert.equal(isAlive(child.pid), false, "reported stopped while still running");
});

test("a pid that was already gone is not counted as something this run stopped", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await sleep(300);
  assert.equal(isAlive(child.pid), false, "the fixture should have exited on its own");

  const outcome = await stopPids([child.pid], { escalateAfterMs: 100 });
  assert.deepEqual(outcome.stopped, []);
  assert.deepEqual(outcome.survived, []);
  assert.deepEqual(outcome.alreadyGone, [child.pid]);
});
