# 0.1.4

**A misspelled `--dry-run` no longer performs the stop.** Every unknown flag was kept and never
looked at, so `rollcall stop --dry-rn`, one letter short of the preview, skipped the preview and
signalled everything the registry matched. On the machine it was found on, that was Codex and three
Claude Code processes. It was found by running the published package against a registry that
matched nothing, which is the only safe way to find it.

**Now anything rollcall does not understand is refused before the process table is read**, with
the flag it probably meant and a line saying nothing was read or signalled:

```
$ rollcall stop --dry-rn
rollcall: unknown flag --dry-rn. Did you mean --dry-run? Nothing was read or signalled. Try `rollcall --help`.
```

The same goes for a flag typed without its dashes, `rollcall stop dry-run`, which used to read
"stop" and drop the rest. The same goes for `--registry` with its file forgotten, which fell back
to the built-in signatures, so a stop meant for a custom list signalled everything the defaults
match instead.

`stop` still has no "are you sure", on purpose. That is why the argument check is where a typo has
to be caught.

# 0.1.3

**The registry is data now, and contributing a row no longer means editing JavaScript.**

Eight signatures, every path confirmed by hand on one person's Mac, is a ceiling that does not move
while anybody sleeps. The mechanism to load an outside list already existed — `--registry` — so what
was missing was social rather than technical: somewhere for a row to live that is not source code,
errors a hand-edited file can recover from, and a written standard for what evidence a new row must
show.

**`signatures.json` at the root of the package**, and the shipped rows load through exactly the same
function `--registry` uses. One code path, so nothing built in can follow looser rules than
something you write.

**A malformed file names the row, the field, and what it wanted.** Unknown fields are refused rather
than ignored, and checked *before* required ones — a typo'd `nver` reported only as "has no never"
sends a reader to the right field and leaves them staring at a line that looks correct. Duplicate
ids are refused too: first match wins, so the second would never fire.

**Each row carries its own provenance** — `verified: { on, platform }` — instead of one constant
beside the list. A registry that grows by contribution has rows of different ages checked on
different machines, and a single date would speak for all of them on the authority of the oldest.
The printed date is derived from the oldest row, because the weakest one speaks for the list.

**The output says where the rows were confirmed, not only when.** Run it on a platform none of them
was checked on and it says so:

```
Read 725 processes against 8 signatures, last checked on a real machine 2026-09-11.
None of them was confirmed on linux — 8 on darwin. A path that is right on one
system is usually wrong on another, so this list is shorter here than the count
suggests.
```

That is the honest version of the macOS skew, which until now lived only in the README. A short
result on an unfamiliar system otherwise reads as a quiet machine.

**`CONTRIBUTING.md` states the evidence a pull request must show, as a gate** — the command output
that produced the path, the platform, the OS version, how the program was installed — and how rows
are trusted once there are more of them than one person checked.

### A defect found while building it

`signatures.json` was not in `package.json`'s `files`. The registry loads at import, so the
published tarball would have thrown on `require` — every test passed locally because the file was
sitting in the working tree. There is now a test asserting it ships.

# 0.1.2

**The first release published from CI, with a provenance attestation you can check** on the npm page
instead of taking a paragraph's word for it. 0.1.0 and 0.1.1 went out by hand because npm can only
accept a trusted publisher for a package that already exists.

**`schedules` exited 1 whenever it recognised a scheduled program.** That fires on any machine that
schedules anything at all, which is how a check becomes a line in a CI file everybody has muted — the
same mistake compiled payloads caused in `assurance-deps`, made again here. A read-only verb reports
and exits 0; only `stop` exits 1, and only when something survived it.

**The README described one exit rule for every verb**, and `list` had never followed it. Exit codes
are now stated per verb, because the verbs answer different questions.

Both found by running the published 0.1.1 against its own README rather than by re-reading either.

**The npm page linked at the old repository name.** `package.json` still pointed at
`i-ops-hq/rollcall` after the rename, so the sidebar on npmjs.com sent readers to a redirect. The
README references were updated at the time and this one was missed, because nothing renders
`package.json` until the package is published — which is the same reason the dependency check went
out claiming an output nobody had seen.

# 0.1.1

**The command this README told you to run to check the zero-dependency claim printed nothing.**
`npm view iops-rollcall dependencies` returns zero bytes rather than `{}`, because npm omits the
field entirely when a package has none — so a reader following the instruction saw a blank line and
could not tell a working command from a broken one. Silence read as success, in the README, about
the one property the page leads with.

Replaced with `npm i iops-rollcall@0.1.1 && npm ls`, which prints the package with nothing beneath
it, and the old behaviour is explained rather than left as a puzzle.

Found by running the published package the way a stranger would rather than by re-reading the file.

# 0.1.0

Published by hand as `iops-rollcall`, because npm refuses the bare `rollcall` as too similar to an
existing `roll-call`. The command it installs is still `rollcall`, the same shape as `iops-rooms`.
Worth recording: the registry returning 404 for a name says it is unregistered, which is a different
question from whether npm will accept it, and only publishing asks the second one. **No provenance attestation on this version**: npm provenance
can only be generated by a CI run, and npm can only accept a trusted publisher for a package that
already exists, so the first release of anything has to come from somewhere else. From 0.1.1 it
comes from CI and you can check the attestation instead of reading a claim about it. There is no
long-lived publish token in this repository and there will not be one.

**`rollcall schedules` reads work that has not started yet** — launchd agents and daemons, your
crontab, systemd timers. Reads only; disabling is reversible and stays out until reporting has been
used for a while.

Coverage per source rather than one number, because the three disagree about where truth lives and
who may read them. **Existing and enabled are separate facts and unknown is a third**, so a job
present but not loaded reports as unknown rather than as enabled. A scheduled command that names no
absolute path yields nothing rather than a guess.

Both of those decisions are tested directly rather than through the machine, because a mutation
that coerced unknown to a boolean passed every test that read the real launchd directory, and the
crontab parser was never executed at all on a machine with no crontab.

**`stop` is tested by actually stopping things.** It runs in CI, where the machine is disposable by
definition, against a registry the test supplies rather than the shipped one — a job that stops
processes named by the real registry is a job that will one day stop something on a runner nobody
expected. It spawns real processes, one of them a child of another, plus a decoy no signature names.
The decoy surviving is the assertion that matters: the same control as `CursorUIViewService`, moved
from matching to killing, and killing is where being wrong costs somebody their work.

**A second `stop` says what actually happened.** "Nothing found" is accurate after a stop and still
reads as *nothing was ever here*. The process table cannot tell the two apart, because by then those
processes are not in it, so the answer comes from the record this tool already writes — which is
the reason for writing one. Writing that test is what showed the promised sentence had never fired.

**`--registry <file>`** points it at your own signatures. The same constructor, so a file cannot
loosen the rules the built-in list follows.

**One helper against a defect caught five times now**, across two codebases: a number and the words
beside it counting different things. `share` takes a collection and returns both the set and the
subset from one expression, because passing two numbers in is what makes them able to disagree.


First release. macOS and Linux, zero dependencies, two verbs.

**`list` is the everyday half.** Most people cannot say what AI processes are running on their
machine, and this answers that in one command with no incident and nothing to configure.

**`stop` signals what it can attribute and verifies each pid individually**, because a delivered
signal is not a death and a switch that reports a stop it did not achieve is worse than no switch.
It writes a durable record before it prints one.

**It matches resolved executable paths, never command lines.** On the machine this was written on,
four processes matched the text "cursor" and none of them was the Cursor editor. Both that case and
a `grep` carrying every registry name in its own arguments are negative tests.

**The registry is data that validates itself at construction** — a row refuses to exist unless it
matches its own example and matches none of its own negative cases, so a careless row fails at
import. Every path in it was confirmed on a real machine; programs that could not be confirmed are
named in the README rather than guessed at.

**Applications are reported and never quit**, because the conversation, the diff and the tool calls
are inside them. A surviving application that can start agents again says so. This command's own
ancestry is excluded and reported rather than dropped.

**A shell you opened is never in scope.** Only one an agent started, decided by ancestry rather than
by the executable.
