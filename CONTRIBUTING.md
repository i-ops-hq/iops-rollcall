# Contributing

## Two rules that are not negotiable

**It must not signal what it did not name**, and **it must not report a stop it did not achieve.**
Both have a control in `test/`, both were written before the code, and both are checked by mutation
rather than by reading. If you add a reader or a signal path, add a case to them first.

## Adding a signature

Signatures live in [`signatures.json`](signatures.json) at the root of this package. **It is data,
not code** — adding a program means adding a row, and the shipped set loads through exactly the same
function `--registry` uses, so a contributed file is held to the same rules.

```json
{
  "id": "lmstudio",
  "label": "LM Studio",
  "kind": "root",
  "path": "~/.lmstudio/",
  "example": "~/.lmstudio/bin/lms",
  "never": ["~/.lmstudio-backup/bin/lms"],
  "verified": { "on": "2026-09-15", "platform": "linux" }
}
```

| field | |
|---|---|
| `id` | short, stable, unique. Two rows sharing one are refused. |
| `label` | what a reader sees. |
| `kind` | `root` a directory prefix, `leaf` an exact basename, `app` a desktop application — reported and never signalled. |
| `path` | a **resolved executable path**, never a name fragment. A root ends in `/`; a leaf is a bare basename. `~/` is expanded at load, so write `~/` rather than your own home directory. |
| `example` | a real path this row must match. |
| `never` | at least one near miss it must **not** match. Required, not encouraged. |
| `verified` | when you confirmed it and on which platform. |
| `mayRestart` | optional; true when something still running can undo the stop. |
| `note` | optional; one clause a reader needs. |

A row validates itself the moment it is built: it refuses to exist unless it matches its own
`example` and matches none of its `never` cases. A malformed file names the row, the field and what
it wanted, so you do not need to read this table to recover from a typo.

### The evidence a pull request must show

**This is a gate, not guidance.** A row without it will be asked for it.

Paste the command output that produced the path, from your own machine:

```bash
# macOS — the full path comes straight out of ps
ps -axo pid=,comm= | grep -i <program>

# Linux — ps gives a truncated NAME, not a path. /proc is the authority.
readlink -f /proc/<pid>/exe
```

And say which platform, which OS version, and how the program was installed — a Homebrew path and
an AppImage path for the same tool are different rows.

**Do not guess, and do not take a path from documentation.** A guessed path is a signature that
matches nothing, behind a test that proves nothing, in a report silently missing a program it claims
to cover. What a vendor documents and what its binary actually resolves to are frequently different.

If you cannot confirm a path, **adding the program to the README's "not yet" table is a real
contribution** and the one we would rather have. Eight verified rows with a stated gap are worth
more than sixteen of which eight are guesses, because only one of those can be audited — and a
reader has no way to tell which half they are looking at.

### How rows are trusted, and by whom

Worth stating plainly before there are many of them, because a registry that grows by contribution
is something a reader has to trust differently from one person's list.

- **Every row carries its own provenance.** `verified` records when and on what platform, per row
  rather than per file, and the report prints the age of the **oldest** row — the weakest one speaks
  for the list.
- **The output says where the rows came from.** Running on a platform none of them was confirmed on,
  it says so, because a short list on an unfamiliar system otherwise reads as a quiet machine.
- **A maintainer merges on the evidence in the pull request**, not on the row looking plausible. If
  the evidence is not there the row waits; nobody is expected to reproduce it on hardware they do
  not have, which is the entire reason outside rows are wanted.
- **Throughput is not the goal.** A registry that accepts rows faster than it verifies them is worse
  than a small one, because it looks the same from outside and cannot be audited.

## Setup

```
node --test test/*.test.js
```

No build step, no dependencies, and it stays that way.

## Two testing rules learned the hard way

**A test that hangs is worse than a test that fails.** A hung suite reads as broken infrastructure
and gets re-run; a red one gets investigated. The ancestry walk carries a depth bound as well as a
visited set, and the bound is what turns a regression in the visited set into a fast failure.

**Keep the vocabulary ban flat, including on denials.** A checker clever enough to tell a denial from
a claim is the substring bug moved from paths to English. Write output that never needs the banned
words, not even to disown them.

## What does not belong here

- A daemon, a watcher, or anything that runs continuously. That is a different product.
- Any signal taken from anything other than this machine's process table. The claim is *audit this
  file*, and the moment it consults something you cannot see, that claim is gone.
- Advice. It reports what it found and what it could not reach.
- Egress control, firewall rules, or the words "contained", "sandboxed" or "isolated".

## Code of conduct

Be decent. Disagree about the work, not about the person.

The long form is [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1, verbatim.
Conduct reports go to **hello@i-ops.dev**. That is a different channel from a vulnerability, which
belongs in a [security advisory](https://github.com/i-ops-hq/iops-rollcall/security/advisories/new).
