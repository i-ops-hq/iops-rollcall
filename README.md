# rollcall

**Every AI process running on this machine, and what a stop could not reach.**

```bash
npx rollcall@0.1.0
```

Zero dependencies. Check that before you run it, in one command:

```bash
npm view rollcall dependencies
```

It returns `{}`. This tool exists partly because of dependency-level attacks through npm, so
shipping on npm is only defensible if you can verify that claim before running anything. **The
version is pinned in every example on this page on purpose** — a bare `npx rollcall` resolves
whatever was published most recently, at run time, which is the attack shape this is about.

## What a first run looks like

```
$ npx rollcall@0.1.0

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
npx rollcall@0.1.0 stop --dry-run   # what it would signal
npx rollcall@0.1.0 stop             # signal it, verify each one, write a record
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
npx rollcall@0.1.0 --registry ./my-agents.json
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
| `--registry <file>` | use your own signatures instead of the built-in ones |
| `--json` | machine-readable, for either verb |

Exit `0` when everything it recognised is stopped or nothing was found, `1` when something is still
running or still to look at, `2` when it could not run.

macOS and Linux, and they are not equally covered — which the output says on every run rather than
leaving in a footnote.

macOS gives a full executable path for every process, including other users'. Linux gives a
truncated command *name* instead, so the path comes from `/proc/<pid>/exe`, and reading that for a
process you do not own needs ptrace access. Running as yourself on Linux, processes belonging to
another user are counted and named as unreadable rather than silently skipped. Kernel threads are
counted apart from both, because they run no executable at all and calling them unreachable would
overstate the gap.

Windows is not supported, and this says so rather than half-working there.

Apache-2.0. Part of [I-Ops](https://i-ops.dev).
