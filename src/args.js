// What the command line says, or why it says nothing rollcall can act on.
//
// **An argument rollcall does not understand is refused, not ignored.** Every unknown flag used to be
// kept and never looked at, so `rollcall stop --dry-rn` — one letter short of the preview — skipped
// the preview and signalled everything the registry matched. On the machine this was found on that
// was Codex and three Claude Code processes. `stop` asks no "are you sure", on purpose, which makes
// this the one place a typo has to be caught: before anything is read, let alone signalled.
//
// Kept apart from cli.js because that module runs on import, and a test of this must never be able
// to reach the process table.

export const FLAGS = ["--help", "-h", "--version", "--json", "--dry-run"];

/** Edit distance, for "did you mean". Small inputs, so the plain table is fine. */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The flag this was probably meant to be, or "". Also catches a flag typed without its dashes. */
export function nearestFlag(arg) {
  const bare = arg.replace(/^-+/, "");
  let best = "";
  let bestScore = Infinity;
  for (const flag of FLAGS) {
    if (flag.length < 4) continue; // -h is too short to be anybody's near miss
    const name = flag.replace(/^-+/, "");
    const score = name.startsWith(bare) && bare.length >= 3 ? 0 : distance(bare, name);
    if (score < bestScore) {
      best = flag;
      bestScore = score;
    }
  }
  return bestScore <= 2 ? best : "";
}

const NOTHING = "Nothing was read or signalled.";

/**
 * `{ verb, flags, registry }`, or `{ error }` with a message that names the argument, says what was
 * probably meant, and says that nothing happened.
 */
export function parse(argv) {
  const flags = new Set();
  const words = [];
  let registry = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--registry" || arg.startsWith("--registry=")) {
      registry = arg === "--registry" ? argv[++i] || "" : arg.slice("--registry=".length);
      // A missing file used to fall back to the built-in signatures, so `stop --registry` with the
      // path forgotten stopped everything the defaults match instead of what the caller meant.
      if (!registry || registry.startsWith("-")) {
        return { error: `rollcall: --registry needs a file. ${NOTHING}` };
      }
    } else if (arg.startsWith("-")) {
      if (!FLAGS.includes(arg)) {
        const near = nearestFlag(arg);
        return {
          error: `rollcall: unknown flag ${arg}.${near ? ` Did you mean ${near}?` : ""} ${NOTHING} Try \`rollcall --help\`.`,
        };
      }
      flags.add(arg);
    } else {
      words.push(arg);
    }
  }
  if (words.length > 1) {
    const near = nearestFlag(words[1]);
    return {
      error: `rollcall: unexpected argument "${words[1]}" after ${words[0]}.${near ? ` Did you mean ${near}?` : ""} ${NOTHING}`,
    };
  }
  return { verb: words[0] || "list", flags, registry };
}
