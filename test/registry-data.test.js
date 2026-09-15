// The registry as data: what a contributed row must satisfy, and what a broken one is told.
//
// Signatures used to be JavaScript, so adding one meant editing code and the failure mode for a
// typo was a stack trace. They are `signatures.json` now, the shipped set loads through the same
// function `--registry` uses, and the rules below are what makes that file safe to hand-edit.
//
// The behavioural rules — a row matches its own example, matches none of its `never` cases — were
// already here and are unchanged. What is new is that a file which cannot load says which row and
// which field, because a rule nobody can get past the parser to reach is not a rule.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECKED_ON,
  SIGNATURES,
  SIGNATURES_PATH,
  Signature,
  loadSignatures,
  oldestCheck,
  verifiedPlatforms,
} from "../src/registry.js";

const root = fileURLToPath(new URL("..", import.meta.url));

/** A registry file holding `rows`, loaded, so the error a contributor would see is the one tested. */
async function loadRows(rows) {
  const dir = await mkdtemp(join(tmpdir(), "rollcall-reg-"));
  const path = join(dir, "registry.json");
  await writeFile(path, JSON.stringify({ signatures: rows }), "utf8");
  try {
    return loadSignatures(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const GOOD = {
  id: "example",
  label: "Example",
  kind: "root",
  path: "/opt/example/",
  example: "/opt/example/bin/example",
  never: ["/opt/example-old/bin/example"],
};

/** The message from loading `rows`, or "" when it loaded. */
async function errorFrom(rows) {
  try {
    await loadRows(rows);
    return "";
  } catch (err) {
    return err.message;
  }
}

// ── the shipped set is data, and goes through the same door ─────────────────────────────────────

test("the shipped registry is the JSON file, loaded the way --registry loads one", async () => {
  const onDisk = JSON.parse(readFileSync(SIGNATURES_PATH, "utf8")).signatures;
  assert.equal(SIGNATURES.length, onDisk.length);
  assert.deepEqual(SIGNATURES.map((s) => s.id), onDisk.map((r) => r.id));
  // Not a separate code path: a contributed file cannot be held to looser rules than the shipped
  // one, and there is one function to keep correct rather than two.
  assert.equal(typeof loadSignatures, "function");
});

test("signatures.json is in the published package", async () => {
  // The registry is loaded at import time, so a tarball without it is a package that throws on
  // `require`. Found while building this: `files` listed src/ and the markdown and nothing else.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(
    pkg.files.includes("signatures.json"),
    'package.json "files" must ship signatures.json or the published package cannot start',
  );
});

test("home-rooted paths stay unexpanded in the file and expand on load", async () => {
  // `~/` in the file is what makes a row portable between machines; expansion at construction is
  // what makes the self-check real. A row that shipped an expanded path would name one person.
  const raw = readFileSync(SIGNATURES_PATH, "utf8");
  assert.ok(raw.includes('"~/'), "the file should carry ~/ rather than somebody's home directory");
  assert.ok(!raw.includes("/Users/"), "no absolute home path belongs in the shipped file");
  for (const sig of SIGNATURES) assert.ok(!sig.path.startsWith("~/"), `${sig.id} did not expand`);
});

// ── what a broken row is told ───────────────────────────────────────────────────────────────────

test("a missing field names the row and the field, and says what it wanted", async () => {
  const { id, ...withoutId } = GOOD;
  assert.match(await errorFrom([withoutId]), /has no "id"/);

  const { never, ...withoutNever } = GOOD;
  const message = await errorFrom([withoutNever]);
  assert.match(message, /"example"/, "the row is named by its id");
  assert.match(message, /has no "never"/);
  assert.match(message, /near miss/, "and what the field is for");
});

test("a field of the wrong type says which type it wanted", async () => {
  const message = await errorFrom([{ ...GOOD, never: "/opt/example-old/bin/example" }]);
  assert.match(message, /"never" should be string\[\], got string/);
});

test("an unknown kind is refused by name rather than by type", async () => {
  // "kind is a string" and "kind is one we know" fail for different reasons, and the second is the
  // one somebody actually hits after a typo.
  assert.match(await errorFrom([{ ...GOOD, kind: "rooot" }]), /kind "rooot" is not one of/);
});

test("an unknown field is refused rather than ignored", async () => {
  // A typo'd `nver` that was quietly dropped would remove the negative cases — the only check that
  // a row cannot swallow its neighbours — and the row would still load.
  const { never, ...rest } = GOOD;
  const message = await errorFrom([{ ...rest, nver: ["/opt/example-old/x"] }]);
  assert.match(message, /unknown field nver/);
});

test("two rows with one id are refused", async () => {
  // First match wins, so the second would never fire, and a bug report naming the id is ambiguous.
  const message = await errorFrom([GOOD, { ...GOOD, path: "/opt/other/", example: "/opt/other/x" }]);
  assert.match(message, /two signatures share the id "example"/);
});

test("the position in the file is named, so a long registry can be navigated", async () => {
  assert.match(await errorFrom([GOOD, { ...GOOD, id: "second", kind: 7 }]), /\[1\]/);
});

// ── the behavioural rules still hold, through the data path ─────────────────────────────────────

test("a row that does not match its own example is refused", async () => {
  assert.match(
    await errorFrom([{ ...GOOD, example: "/somewhere/else/example" }]),
    /does not match its own example/,
  );
});

test("a row that matches its own never case is refused", async () => {
  assert.match(
    await errorFrom([{ ...GOOD, never: ["/opt/example/bin/other"] }]),
    /matches its own negative case/,
  );
});

test("a root row that does not end in a separator is refused", async () => {
  // `.../engine` would swallow `.../engine-experimental`. The format forces this rather than
  // documenting it.
  assert.match(
    await errorFrom([{ ...GOOD, path: "/opt/example", example: "/opt/example/bin/example" }]),
    /must end in "\/"/,
  );
});

// ── provenance, per row ─────────────────────────────────────────────────────────────────────────

test("every shipped row records where and when it was confirmed", async () => {
  for (const sig of SIGNATURES) {
    assert.ok(sig.verified, `${sig.id} has no verified block`);
    assert.match(sig.verified.on, /^\d{4}-\d{2}-\d{2}$/, `${sig.id} has no confirmation date`);
    assert.ok(sig.verified.platform, `${sig.id} does not say which platform`);
  }
});

test("the date printed is the oldest row's, not a constant beside the list", async () => {
  // It used to be a hand-written constant, which is a second place for the truth to live: add a row
  // today against a constant that says March and the output speaks for it in March's voice.
  const oldest = SIGNATURES.map((s) => s.verified.on).sort()[0];
  assert.equal(CHECKED_ON, oldest);

  // Every shipped row currently shares one date, so the assertion above holds whichever end of the
  // sort is taken — it proves nothing on its own. This exercises the derivation on rows that differ.
  const rows = await loadRows([
    { ...GOOD, verified: { on: "2030-01-01", platform: "linux" } },
    { ...GOOD, id: "older", path: "/opt/older/", example: "/opt/older/x", verified: { on: "2020-01-01", platform: "linux" } },
  ]);
  assert.equal(oldestCheck(rows), "2020-01-01", "the age of the weakest row is the honest one");
});

test("verifiedPlatforms counts the rows per platform, commonest first", async () => {
  const rows = await loadRows([
    { ...GOOD, verified: { on: "2026-01-01", platform: "darwin" } },
    { ...GOOD, id: "b", path: "/opt/b/", example: "/opt/b/x", verified: { on: "2026-01-01", platform: "linux" } },
    { ...GOOD, id: "c", path: "/opt/c/", example: "/opt/c/x", verified: { on: "2026-01-01", platform: "linux" } },
  ]);
  assert.deepEqual(verifiedPlatforms(rows), [["linux", 2], ["darwin", 1]]);
});

test("a row with no verified block is counted as unstated rather than assumed", async () => {
  const rows = await loadRows([GOOD]);
  assert.deepEqual(verifiedPlatforms(rows), [["unstated", 1]]);
});

// ── the rules the constructor already had are unchanged ─────────────────────────────────────────

test("a leaf is still an exact basename and a root is still a prefix", () => {
  const leaf = new Signature({
    id: "l", label: "L", kind: "leaf", path: "server",
    example: "/opt/x/server", never: ["/opt/x/server-bench"],
  });
  assert.equal(leaf.matches("/anywhere/server"), true);
  assert.equal(leaf.matches("/anywhere/server-bench"), false);
});
