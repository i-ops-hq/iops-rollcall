# Contributing

## Two rules that are not negotiable

**It must not signal what it did not name**, and **it must not report a stop it did not achieve.**
Both have a control in `test/`, both were written before the code, and both are checked by mutation
rather than by reading. If you add a reader or a signal path, add a case to them first.

## Adding a signature

The registry is data, and a row validates itself when it is built. It needs:

- a **resolved executable path**, never a name fragment. A root match ends in `/`; a leaf match is a
  bare basename.
- a worked `example` the row must match.
- at least one `never` case the row must not match. This is required, not encouraged.

**Confirm the path on a real machine before adding it.** A guessed path is a signature that matches
nothing, behind a test that proves nothing, in a report silently missing a program it claims to
cover. If you cannot confirm it, add it to the README's "not yet" table instead — a registry with
eight verified rows and a stated gap is worth more than one with sixteen of which eight are guesses,
and only one of those can be audited.

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
