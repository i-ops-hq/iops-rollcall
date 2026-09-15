// What counts as an agent process, as data a reader can open and extend.
//
// The rows live in `signatures.json` at the root of this package, not in this file, and the
// built-in set loads through exactly the same path as `--registry`. That is deliberate: a
// contributor adds a row by editing data, and there is one code path to get wrong rather than two.
//
// Two rules the format FORCES rather than documents, both of them the same defect in different
// costumes. A root match must end in a separator, so `.../engine/` cannot swallow
// `.../engine-experimental`. A leaf match is an exact basename, so `llama-server` cannot swallow
// `llama-server-bench`. There is no field a substring could live in, because the substring is the
// bug: on the machine this was written on, four processes matched the text "cursor" and none of
// them was the Cursor editor.
//
// And every row validates itself on construction. It refuses to exist unless it matches its own
// `example` and matches none of its own `never`, so a careless row fails at import rather than in
// a test somebody might not have written. That caught a real bug immediately: a `~/` example never
// reaches expansion, so every home-rooted row was silently matching nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/** `~/x` is expanded on BOTH the pattern and its example, or the self-check is theatre. */
function expand(path) {
  return path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
}

function basename(path) {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The field rules, checked before anything is built, so a hand-edited file fails with a sentence.
 *
 * This is the half that makes the registry contributable. The behavioural rules below — a row must
 * match its own example, must match none of its `never` cases — are the ones worth having, and they
 * are useless to somebody whose file will not load because `never` is a string. A JSON Schema
 * library would do this; adding one would cost this package its zero dependencies, which is a
 * promise worth more than the forty lines below.
 */
const KINDS = new Set(["root", "leaf", "app"]);

const FIELDS = {
  id: { required: true, type: "string", hint: "a short stable identifier, e.g. \"claude-code\"" },
  label: { required: true, type: "string", hint: "what a reader should see, e.g. \"Claude Code\"" },
  kind: { required: true, type: "string", hint: 'one of "root", "leaf" or "app"' },
  path: { required: true, type: "string", hint: "a resolved executable path, never a name fragment" },
  example: { required: true, type: "string", hint: "a real path this row must match" },
  never: { required: true, type: "string[]", hint: "at least one near miss this row must NOT match" },
  mayRestart: { required: false, type: "boolean", hint: "true when stopping it can be undone by something still running" },
  note: { required: false, type: "string", hint: "one clause a reader needs, or omit it" },
  verified: { required: false, type: "object", hint: '{ "on": "YYYY-MM-DD", "platform": "darwin" }' },
};

function typeOf(value) {
  if (Array.isArray(value)) return value.every((v) => typeof v === "string") ? "string[]" : "array";
  return value === null ? "null" : typeof value;
}

/** Throws with the row named and the field named, or returns. */
function checkShape(row, where) {
  const at = (id) => `${where ? `${where}: ` : ""}signature ${id ? `"${id}"` : "(no id)"}`;
  if (typeOf(row) !== "object") {
    throw new Error(`${where || "registry"}: a signature must be an object, got ${typeOf(row)}`);
  }
  const id = typeof row.id === "string" ? row.id : "";

  // Checked before the required fields, because the realistic failure is a typo rather than an
  // omission: `nver` reported only as "has no never" sends a reader to the right field and leaves
  // them staring at a line that looks correct. Refused rather than ignored, because a dropped
  // `never` removes the only check that a row cannot swallow its neighbours.
  const unknown = Object.keys(row).filter((k) => !(k in FIELDS));
  if (unknown.length) {
    throw new Error(`${at(id)}: unknown field${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}`);
  }

  for (const [name, rule] of Object.entries(FIELDS)) {
    const value = row[name];
    if (value === undefined) {
      if (rule.required) throw new Error(`${at(id)} has no "${name}" — ${rule.hint}`);
      continue;
    }
    if (typeOf(value) !== rule.type) {
      throw new Error(
        `${at(id)}: "${name}" should be ${rule.type}, got ${typeOf(value)} — ${rule.hint}`,
      );
    }
  }
  // Named separately from the type check because "kind is a string" and "kind is one we know" fail
  // for different reasons and the second is the one somebody actually hits.
  if (!KINDS.has(row.kind)) {
    throw new Error(`${at(id)}: kind "${row.kind}" is not one of ${[...KINDS].join(", ")}`);
  }
}

export class Signature {
  /**
   * One kind of process this tool recognises.
   *
   * `kind` is `root` (a directory prefix), `leaf` (an exact executable name) or `app` (a desktop
   * application, which is REPORTED and never signalled — the app is the evidence, and quitting it
   * destroys the conversation, the diff and the tool calls at the moment they matter).
   */
  constructor(row, where = "") {
    checkShape(row, where);
    const { id, label, kind, path, example, never, mayRestart = false, note = "", verified = null } = row;
    this.id = id;
    this.label = label;
    this.kind = kind;
    this.path = expand(path);
    this.example = expand(example);
    this.never = (never || []).map(expand);
    // A surviving app can respawn what was just stopped, which makes a bare count of stops a false
    // number. Carried as data so the caveat cannot drift from the figure beside it.
    this.mayRestart = mayRestart;
    this.note = note;
    // Where and when this row was confirmed. Per row rather than per file, because a registry that
    // grows by contribution has rows of different ages checked on different machines, and one
    // global date would speak for all of them on the authority of the oldest.
    this.verified = verified;

    if (kind === "leaf" && this.path.includes("/")) {
      throw new Error(`${id}: a leaf signature is a bare executable name, got ${this.path}`);
    }
    if (kind !== "leaf" && !this.path.endsWith("/")) {
      throw new Error(`${id}: a root signature must end in "/" or it swallows its own neighbours`);
    }
    if (!this.never.length) {
      throw new Error(`${id}: every signature ships at least one case it must not match`);
    }
    if (!this.matches(this.example)) {
      throw new Error(`${id}: does not match its own example ${this.example}`);
    }
    for (const decoy of this.never) {
      if (this.matches(decoy)) throw new Error(`${id}: matches its own negative case ${decoy}`);
    }
  }

  /** Executable path in, boolean out. The command line is never consulted. */
  matches(comm) {
    if (!comm) return false;
    return this.kind === "leaf" ? basename(comm) === this.path : comm.startsWith(this.path);
  }
}

/** Executables that are a shell and nothing else. In scope only via ancestry — see `attribute`. */
export const SHELLS = new Set([
  "zsh", "bash", "sh", "dash", "fish", "ksh", "tcsh", "csh", "nu", "pwsh",
]);

/**
 * The registry.
 *
 * **Every path here was confirmed on a real machine**, running or on disk, on 2026-09-11. A guessed
 * path is a signature that matches nothing, behind a test that proves nothing, in a report silently
 * missing a program it claims to cover — the same failure `assurance-deps` ships a blind-spot
 * sentence to avoid. Programs that could not be confirmed are listed in the README as candidates
 * rather than added here, and the report says how many rows it carries and when they were checked.
 */
export function loadSignatures(path, where = path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`registry at ${path} could not be read: ${err.message}`);
  }
  const rows = Array.isArray(raw) ? raw : raw && raw.signatures;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error(`registry at ${path} holds no signatures`);
  }
  const seen = new Set();
  return rows.map((row, i) => {
    const sig = new Signature(row, `${where} [${i}]`);
    // Two rows with one id makes `--registry` overrides and bug reports ambiguous, and first-match
    // ordering means the second one silently never fires.
    if (seen.has(sig.id)) throw new Error(`${where}: two signatures share the id "${sig.id}"`);
    seen.add(sig.id);
    return sig;
  });
}

/**
 * The registry that ships with this package, read from `signatures.json` at its root.
 *
 * **Every path in it was read off a running process on a real machine.** A guessed path is a
 * signature that matches nothing, behind a test that proves nothing, in a report silently missing
 * a program it claims to cover. Programs that could not be confirmed are listed in the README as
 * candidates rather than added here, and the report says how many rows it carries and when they
 * were checked.
 *
 * Loaded through `loadSignatures`, the same function `--registry` uses, so the shipped rows cannot
 * follow looser rules than a contributed file and there is one code path to keep correct.
 */
export const SIGNATURES_PATH = fileURLToPath(new URL("../signatures.json", import.meta.url));

export const SIGNATURES = loadSignatures(SIGNATURES_PATH, "signatures.json");

/**
 * When the shipped rows were last confirmed, derived rather than declared.
 *
 * It used to be a constant sitting beside the list, which is a second place for the truth to live:
 * add a row today against a constant that says March and the output speaks for it in March's voice.
 * The oldest date is the honest one to print — it is the age of the weakest row.
 */
export function oldestCheck(signatures = SIGNATURES) {
  return signatures.map((s) => s.verified && s.verified.on).filter(Boolean).sort()[0] || "";
}

export const CHECKED_ON = oldestCheck();

/** The platforms the shipped rows were confirmed on, so the skew is visible rather than in a README. */
export function verifiedPlatforms(signatures = SIGNATURES) {
  const counts = new Map();
  for (const sig of signatures) {
    const platform = (sig.verified && sig.verified.platform) || "unstated";
    counts.set(platform, (counts.get(platform) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The signature that claims a path, or null. First match wins; the list has no overlaps. */
export function signatureFor(comm, signatures = SIGNATURES) {
  return signatures.find((sig) => sig.matches(comm)) || null;
}
