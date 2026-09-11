# 0.1.0

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
