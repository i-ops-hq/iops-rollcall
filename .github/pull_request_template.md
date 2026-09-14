<!--
One change per PR. If this is a good first issue, "Closes #1" plus a sentence is fine.
-->

## What this changes, and why

## What you ran

```
$ node --test test/*.test.js
```

<!-- Paste the output if it is short. A report of a green test is not a green test. -->

## If this adds a signature

<!--
The registry is data, and a row validates itself when it is built: it throws if it does not match its
own `example`, or if it does match one of its `never` cases.
-->

- [ ] The path came off a running process on a real machine — `ps -axo pid=,comm=` on macOS, `readlink -f /proc/<pid>/exe` on Linux — and I have said which, in the PR or a comment
- [ ] There is at least one `never` case, and it is a plausible near miss rather than a token one
- [ ] A root match ends in `/`; a leaf match is a bare basename
- [ ] I said which platform I confirmed it on

<!--
If you could not confirm a path, adding it to the README's "not yet" table is the right contribution
instead. Eight verified rows with a stated gap is worth more than sixteen of which eight are guesses,
because only one of those can be audited.
-->

## The counterfactual

<!--
If this adds or changes a test: revert the fix, confirm the test fails, restore it, and say which
input you used. A test that cannot fail is documentation rather than a guard, which is fine as long
as it is not mistaken for one.
-->

- [ ] Reverted the fix and watched the test fail, then restored it
- [ ] Still no dependencies — `npm ls` shows nothing beneath the package, and it stays that way
- [ ] Added a `CHANGELOG.md` entry

## If this touches what a stop does

<!--
Two properties, both with controls in test/, both written before the code:

  1. it must not signal what it did not name
  2. it must not report a stop it did not achieve

If you touched a reader or a signal path, add a case to those first.
-->

## Anything you are unsure about
