# rollcall

**Every AI process running on this machine, and what a stop could not reach.**

Published as `iops-rollcall`, and the command it installs is `rollcall`. The unprefixed name is
refused by npm as too similar to an existing `roll-call`, which is worth saying out loud rather than
leaving as a puzzle — and `iops-rooms` already uses the same shape.

```bash
npx iops-rollcall@0.1.2
```

Zero dependencies. Check it rather than believe it:

```bash
npm i iops-rollcall@0.1.2 && npm ls
```
```
your-project@1.0.0
`-- iops-rollcall@0.1.2
```

Nothing beneath it. That is the whole tree.

**`npm view iops-rollcall dependencies` prints nothing at all**, which looks like a failed command
and is not — npm omits the field entirely when a package has none, so blank *is* the answer. It is
a poor way to learn something, which is why the check above is the one on this page.

This tool exists partly because of dependency-level attacks through npm, so shipping on npm is only
defensible if you can verify that claim before you run anything. **The version is pinned in every
example here on purpose**: a bare `npx iops-rollcall` resolves whatever was published most recently,
at run time, which is the attack shape this is about.

## What a first run looks like

```
$ npx iops-rollcall@0.1.2

22 processes matched, of 599 running — 1 application and 5 others.

  · Claude — pid 1296, plus 16 helper processes
      an application, so a stop reports it and leaves it running
      it can start agents again
      this command runs inside it
  · Codex — pid 10451
  · Claude Code — pid 18284
  · llama-server — pid 53492

Read 599 processes against 8 signatures, last checked on a real machine 2026-09-11.
6 processes report a name and no path, so no signature can be applied to them: Core Audio
Driver (MSTeamsAudioDevice.driver), autofsd, automountd, and more.
Not looked for: anything running on another machine, any request already in flight, any agent
these signatures do not name, and any work that has not started yet. Those are outside the
numbers above rather than counted as zero.
```

Most people cannot say what AI processes are running on their machine right now. That is the
everyday reason this exists, and it needs no incident.

## Stopping

```bash
npx iops-rollcall@0.1.2 stop --dry-run   # what it would signal
npx iops-rollcall@0.1.2 stop             # signal it, verify each one, write a record
```

No confirmation prompt. A switch that asks *are you sure* during an incident is broken, and the
safety is in the targeting instead: it signals only what it can attribute to a signature it carries,
and it prints exactly what it did.

**It writes the record before it prints one.** Run this during an incident, scroll the terminal, and
the evidence is a buffer. The file holds what was stopped, what survived, what was refused and the
"not looked for" section, which is the part somebody needs three days later.

**Applications are reported and never quit.** The conversation, the diff and the tool calls live
inside the editor, and closing it destroys the record at the moment the record matters. A surviving
application that can start agents again says so, because otherwise the count above it is not a final
state.

**A process owned by another user is reported and left alone.** There is no suggestion to re-run
with `sudo`. A switch that tells you to escalate privilege in order to kill things is the thing this
is trying not to be.

## What has not started yet

A process list answers what is running. It says nothing about the launchd agent that will start an
agent at login, or the timer that will run one at three in the morning.

```bash
npx iops-rollcall@0.1.2 schedules
```

**It reads and changes nothing.** Disabling a schedule is reversible and is deliberately not here:
reporting has to be used for a while before anything acts on it.

Coverage is stated per source rather than as one number, because launchd, cron and systemd disagree
about where truth lives and who may read them, and one figure across three sources of different
reliability is a denominator made of parts that do not agree.

**A schedule that exists and a schedule that is enabled are different facts**, and a schedule whose
state could not be read is a third. It reports whichever it has and never folds one into another. A
scheduled command that names no absolute path yields nothing rather than a guess, because inventing
one is how a registry starts matching text again.

## What is in scope, and it is a boundary rather than a filter

AI processes, and terminal sessions those processes started. Nothing else.

**A shell you opened is never listed, never stopped, never counted.** The rule that decides is
ancestry, not the executable, because the executable is identical either way: the same `/bin/zsh` is
in scope under an agent and out of scope under your login window.

## How it decides what is an agent

It matches the **resolved executable path**, never the command line.

That is not a preference. On the machine this was written on, four processes matched the text
"cursor" and none of them was the Cursor editor — `CursorUIViewService` is the macOS text input
service, and stopping it breaks typing. A `grep` searching for the word "claude" carries every name
this tool looks for inside its own arguments. Both are negative test cases in the registry.

The registry is a data file you can open, audit and extend. Every row validates itself when it is
built: it refuses to exist unless it matches its own worked example and matches none of its own
negative cases, so a careless row fails at import rather than in a test somebody might not write.
A root match must end in a separator so it cannot swallow a neighbour, and a leaf match is an exact
basename so `llama-server` cannot swallow `llama-server-bench`.

**Every path in it was confirmed on a real machine.** A guessed path is a signature that matches
nothing, behind a test that proves nothing, in a report silently missing a program it claims to
cover. Programs that could not be confirmed are listed below rather than added.

| recognised | not yet |
|---|---|
| Claude, Claude Code, Claude Code CLI | LM Studio |
| Cursor, Cursor Agent | VS Code and its extensions |
| Codex | Windsurf, Continue, aider |
| Ollama, llama-server | MCP servers spawned by `npx` |

The gap is stated rather than closed with guesses. Open an issue with the output of
`ps -axo pid=,comm=` for the program you want covered and it can be added with a real path.

You can also point it at your own list without waiting for that:

```bash
npx iops-rollcall@0.1.2 --registry ./my-agents.json
```

A file is an array of rows in the same shape as the built-in ones, and it goes through the same
constructor — so it still cannot be a bare substring, still needs a worked example it matches and
at least one case it must not, and still fails loudly rather than matching nothing quietly.

## What it will not say

It reports what is running and what it could not reach. It does not tell you whether any of it
should be, does not rank anything, and does not recommend an action. That is not a verdict withheld;
it is a verdict this tool does not have.

It is also not a defence against hostile software. Anything that re-spawns itself, resists a signal
or hides from `ps` is outside what this does, and it says so rather than implying a fight it never
had. This is for work you started and want to stop.

## Verbs

| | |
|---|---|
| `rollcall` | list what is running. The default, and it reads only |
| `rollcall list` | the same, said out loud |
| `rollcall stop` | signal what it can attribute, verify each one, write a record |
| `rollcall stop --dry-run` | what `stop` would signal, without signalling it |
| `rollcall schedules` | what will start later: launchd, cron, systemd timers. Reads only |
| `--registry <file>` | use your own signatures instead of the built-in ones |
| `--json` | machine-readable, for either verb |

Exit codes differ by verb, because the verbs answer different questions.

| | |
|---|---|
| `list`, `schedules` | `0` — they read something and told you. Finding agents is the normal case, and exiting non-zero on it would make these unusable in a shell |
| `stop` | `0` when everything it recognised is stopped, `1` when something survived, was refused, or is an application it left running |
| `stop --dry-run` | `1` when there is something it would signal |
| any of them | `2` when it could not run: no such registry file, a manifest it cannot parse, a process table it cannot read |

**`stop` exiting 1 is not a failure**, it is the honest answer to "is this machine quiet now" when
part of it is not.

macOS and Linux, and they are not equally covered — which the output says on every run rather than
leaving in a footnote.

macOS gives a full executable path for every process, including other users'. Linux gives a
truncated command *name* instead, so the path comes from `/proc/<pid>/exe`, and reading that for a
process you do not own needs ptrace access. Running as yourself on Linux, processes belonging to
another user are counted and named as unreadable rather than silently skipped. Kernel threads are
counted apart from both, because they run no executable at all and calling them unreachable would
overstate the gap.

Windows is not supported, and this says so rather than half-working there.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) has the two rules and the setup, which is `node --test
test/*.test.js` and nothing else — no build step, no dependencies, and it stays that way.

The registry is eight signatures and every path in it was confirmed on a Mac. **Confirming a Linux
path is the most useful thing an outside contributor can do here**, because it needs a machine the
maintainers do not have — see the
[good first issues](https://github.com/i-ops-hq/iops-rollcall/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
Pasting `ps -axo pid=,comm=` and `readlink -f /proc/<pid>/exe` for a program you want covered is
enough on its own; someone else can add the row from that.

Please do not guess a path. A guessed signature matches nothing, behind a test that proves nothing,
in a report silently missing a program it claims to cover.

Apache-2.0. Part of [I-Ops](https://i-ops.dev).
