# 0.1.0

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
