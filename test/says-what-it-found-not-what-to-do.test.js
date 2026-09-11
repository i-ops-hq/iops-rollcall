// Show, do not advise — and the ban is flat on purpose.
//
// A test banning a word fired once on a sentence that DENIED the word, which is exactly the right
// thing for output to say and exactly what a substring check cannot tell apart. That is the
// CursorUIViewService bug moved from paths to English. The fix is the sentence, not the checker: the
// output is written so it never needs these words, not even to disown them. A clever checker is
// defeated by the first copy edit from somebody who never read the design note.

import test from "node:test";
import assert from "node:assert/strict";

import { attribute } from "../src/attribute.js";
import { coverage, formatList, formatStop } from "../src/report.js";
import { readTable, tableGaps } from "../src/ps.js";

/** Verdicts this tool does not have, and advice it has no standing to give. */
const BANNED = [
  "safe", "unsafe", "malicious", "suspicious", "threat", "secure", "sandbox",
  "you should", "we recommend", "recommended", "consider ", "make sure",
  "clean", "danger", "risk",
];

function assertNoVerdicts(text, where) {
  const lower = text.toLowerCase();
  for (const word of BANNED) {
    assert.ok(!lower.includes(word), `${where} contains "${word}" — flat ban, denials included`);
  }
}

const gaps = { total: 3, noPath: ["autofsd"], noComm: [] };

test("the list says what is running and nothing about whether it should be", () => {
  const rows = [
    { pid: 10, ppid: 1, comm: "/bin/zsh", args: "zsh" },
    { pid: 11, ppid: 1, comm: "/opt/homebrew/bin/ollama", args: "ollama serve" },
  ];
  assertNoVerdicts(formatList(attribute(rows, { self: 999 }), gaps), "formatList");
});

test("a stop report says what happened and nothing about what to do next", () => {
  const proc = (pid, label) => ({ pid, label, comm: "/x", mayRestart: false, isApp: false });
  const text = formatStop(
    {
      stopped: [proc(1, "A")],
      survived: [proc(2, "B")],
      refused: [proc(3, "C")],
      reportOnly: [{ ...proc(4, "D"), isApp: true, mayRestart: true }],
      excluded: [proc(5, "E")],
      alreadyGone: [],
    },
    gaps,
    "/tmp/record.json",
  );
  assertNoVerdicts(text, "formatStop");
  // It must not tell anyone to escalate privilege in order to kill things.
  assert.ok(!text.toLowerCase().includes("sudo"), "suggested sudo");
});

test("the coverage line is an observation about this run, on this machine", () => {
  const text = coverage(tableGaps(readTable()));
  assertNoVerdicts(text, "coverage");
  assert.match(text, /Not looked for:/);
  assert.match(text, /another machine/);
  assert.match(text, /already in flight/);
});

test("a second stop distinguishes 'nothing left' from 'nothing was ever here'", () => {
  const empty = { stopped: [], survived: [], refused: [], reportOnly: [], excluded: [], alreadyGone: [] };
  const nothingEver = formatStop(empty, gaps, "");
  const alreadyDone = formatStop({ ...empty, alreadyGone: [7, 8] }, gaps, "");

  assert.match(nothingEver, /No processes here match/);
  assert.match(alreadyDone, /not already stopped/);
  assert.notEqual(nothingEver, alreadyDone, "0 found reads as nothing was ever here");
});

test("an application is reported as surviving, and as able to start agents again", () => {
  const app = { pid: 4, label: "Cursor", comm: "/Applications/Cursor.app/x", isApp: true, mayRestart: true };
  const text = formatStop(
    { stopped: [], survived: [], refused: [], reportOnly: [app], excluded: [], alreadyGone: [] },
    gaps,
    "",
  );
  assert.match(text, /not signalled/);
  assert.match(text, /start agents again/, "a survivor that can respawn makes the count provisional");
});
