// What counts as an agent process, as data a reader can open and extend.
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

import { homedir } from "node:os";

/** `~/x` is expanded on BOTH the pattern and its example, or the self-check is theatre. */
function expand(path) {
  return path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
}

function basename(path) {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

export class Signature {
  /**
   * One kind of process this tool recognises.
   *
   * `kind` is `root` (a directory prefix), `leaf` (an exact executable name) or `app` (a desktop
   * application, which is REPORTED and never signalled — the app is the evidence, and quitting it
   * destroys the conversation, the diff and the tool calls at the moment they matter).
   */
  constructor({ id, label, kind, path, example, never, mayRestart = false, note = "" }) {
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
export const CHECKED_ON = "2026-09-11";

export const SIGNATURES = [
  new Signature({
    id: "claude-desktop",
    label: "Claude",
    kind: "app",
    path: "/Applications/Claude.app/",
    example: "/Applications/Claude.app/Contents/MacOS/Claude",
    never: ["/Applications/Claude.app-backup/Contents/MacOS/Claude", "/Applications/ClaudeX.app/x"],
    mayRestart: true,
    note: "the desktop app; agent sessions run underneath it",
  }),
  new Signature({
    id: "claude-code",
    label: "Claude Code",
    kind: "root",
    path: "~/Library/Application Support/Claude/claude-code/",
    example: "~/Library/Application Support/Claude/claude-code/2.1.260/claude.app/Contents/MacOS/claude",
    never: ["~/Library/Application Support/Claude/claude-code-old/x"],
  }),
  new Signature({
    id: "claude-cli",
    label: "Claude Code (CLI)",
    kind: "root",
    path: "~/.local/share/claude/",
    example: "~/.local/share/claude/versions/2.1.86",
    never: ["~/.local/share/claude-experiments/x"],
  }),
  new Signature({
    id: "cursor-app",
    label: "Cursor",
    kind: "app",
    path: "/Applications/Cursor.app/",
    example: "/Applications/Cursor.app/Contents/MacOS/Cursor",
    never: [
      // The reason this file matches paths and not names.
      "/System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService",
      "/Applications/Cursor.app-old/Contents/MacOS/Cursor",
    ],
    mayRestart: true,
    note: "the editor; the agent runs inside it",
  }),
  new Signature({
    id: "cursor-agent",
    label: "Cursor Agent",
    kind: "root",
    path: "~/.local/share/cursor-agent/",
    example: "~/.local/share/cursor-agent/versions/2026.04.17-787b533/cursor-agent",
    never: ["~/.local/share/cursor-agentx/y"],
  }),
  new Signature({
    id: "codex",
    label: "Codex",
    kind: "root",
    path: "~/.codex/",
    example: "~/.codex/plugins/cache/openai-bundled/chrome/latest/extension-host/macos/arm64/ChatGPT for Chrome",
    never: ["~/.codex-backup/x"],
  }),
  new Signature({
    id: "ollama",
    label: "Ollama",
    kind: "leaf",
    path: "ollama",
    example: "/Applications/Ollama.app/Contents/Resources/ollama",
    never: ["/usr/local/bin/ollama-helper", "/opt/homebrew/bin/ollamad"],
  }),
  new Signature({
    id: "llama-server",
    label: "llama-server",
    kind: "leaf",
    path: "llama-server",
    example: "~/Library/Application Support/I-Ops/engine/v0.30.7/llama-server",
    never: ["/opt/homebrew/bin/llama-server-bench"],
    note: "a local inference server",
  }),
];

/** The signature that claims a path, or null. First match wins; the list has no overlaps. */
export function signatureFor(comm) {
  return SIGNATURES.find((sig) => sig.matches(comm)) || null;
}
