// The first positive control, written before the code it guards.
//
// A tool that signals processes has one way to be catastrophically wrong that no amount of correct
// behaviour makes up for: killing something nobody asked it to kill. The registry is what stands
// between it and that, and a registry that matches too broadly is the same defect shipped as data,
// past every test the code has.
//
// The decoys here are real. `CursorUIViewService` is the macOS text input service and lives at
// `TextInputUIMacHelper.framework`; on the machine this was written on, four processes matched the
// substring "cursor" and none of them was the Cursor editor. The grep is the one that proves the
// match is on the executable path rather than on text: its arguments contain every name the
// registry looks for, and its own path is `/usr/bin/grep`.

import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";

import { attribute } from "../src/attribute.js";
import { SIGNATURES } from "../src/registry.js";
import { plan } from "../src/stop.js";

/** A process row in the shape `readTable` produces, so the decoys go through the real path. */
const proc = (pid, ppid, comm, args = comm) => ({ pid, ppid, comm, args });

const DECOYS = [
  proc(
    801,
    1,
    "/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService",
  ),
  // Every registry name, inside the arguments of something that is not an agent.
  proc(802, 900, "/usr/bin/grep", "grep -Ei claude|cursor|llama|ollama|codex|aider ."),
  // A near-miss on a leaf: the registry names `llama-server`, and this is not it.
  proc(803, 1, "/opt/homebrew/bin/llama-server-bench"),
  // A near-miss on a root: a directory whose name merely starts the same way.
  proc(804, 1, `${homedir()}/.local/share/cursor-agentx/v1/thing`),
  // A shell the person opened themselves. Never in scope, whatever else is true of it.
  proc(805, 1, "/bin/zsh"),
];

test("nothing that merely resembles a signature is ever attributed", () => {
  const found = attribute(DECOYS, { self: 999 });
  assert.deepEqual(
    found.filter((p) => p.matched).map((p) => p.comm),
    [],
    "a decoy was attributed to an agent",
  );
});

test("a stop plan over nothing but decoys signals nothing at all", () => {
  const { signal, excluded } = plan(attribute(DECOYS, { self: 999 }), { self: 999 });
  assert.deepEqual(signal, [], "the plan would have signalled a process nobody named");
  assert.deepEqual(excluded, []);
});

test("every signature carries a case it must not match, and honours it", () => {
  // Each row's own negative case, checked through the same matcher the tool uses. A signature
  // without one cannot be added: the field is required and validated at construction.
  for (const sig of SIGNATURES) {
    assert.ok(sig.never.length > 0, `${sig.id} ships no negative case`);
    for (const path of sig.never) {
      assert.equal(sig.matches(path), false, `${sig.id} matches its own negative case ${path}`);
    }
  }
});

test("a person's own shell is out of scope, and its ancestry is what decides", () => {
  // Same executable, different parent. The counterfactual is the test that matters.
  // Built from the real home directory, because the registry expands `~/` and a fixture that
  // hardcodes someone else's home tests the expansion rather than the rule.
  const agent = proc(700, 1, `${homedir()}/Library/Application Support/Claude/claude-code/2.1.0/claude.app/Contents/MacOS/claude`);
  const shellUnderAgent = proc(701, 700, "/bin/zsh");
  const shellUnderLoginWindow = proc(702, 1, "/bin/zsh");

  const found = attribute([agent, shellUnderAgent, shellUnderLoginWindow], { self: 999 });
  const inScope = found.filter((p) => p.matched).map((p) => p.pid);

  assert.ok(inScope.includes(701), "a shell an agent started is work the agent started");
  assert.ok(!inScope.includes(702), "a shell the person opened is never in scope");
});

test("an application is never in the set to be signalled", () => {
  // The app is the evidence. After an incident you need the conversation, the diff and the tool
  // calls, and quitting the editor destroys the record at the moment the record is what matters.
  // This is a rule rather than a default, so it is asserted rather than configured.
  const app = proc(600, 1, "/Applications/Cursor.app/Contents/MacOS/Cursor");
  const agent = proc(601, 1, `${homedir()}/.local/share/cursor-agent/versions/1/cursor-agent`);

  const attributed = attribute([app, agent], { self: 999 });
  const { signal, reportOnly } = plan(attributed, { self: 999 });

  assert.deepEqual(signal.map((p) => p.pid), [601], "an application reached the signal list");
  assert.deepEqual(reportOnly.map((p) => p.pid), [600]);
  assert.equal(reportOnly[0].mayRestart, true, "a survivor that can respawn makes the count provisional");
});

test("this command's own ancestry is excluded, and reported rather than dropped", () => {
  // Run from inside an agent session the chain is zsh -> claude -> app -> launchd. Signalling
  // "AI processes" would kill the session that asked, mid-sentence, and the report would never
  // print. An excluded process is still running, so it is named.
  const agent = proc(710, 1, `${homedir()}/.local/share/claude/versions/2.1.86`);
  const shell = proc(711, 710, "/bin/zsh");
  const other = proc(712, 1, `${homedir()}/.local/share/cursor-agent/versions/1/cursor-agent`);

  const attributed = attribute([agent, shell, other], { self: 711 });
  const { signal, excluded } = plan(attributed, { self: 711 });

  assert.deepEqual(excluded.map((p) => p.pid).sort(), [710, 711]);
  assert.deepEqual(signal.map((p) => p.pid), [712], "it would have killed the session that asked");
});
