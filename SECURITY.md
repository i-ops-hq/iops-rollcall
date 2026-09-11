# Security

Open a [security advisory](https://github.com/i-ops-hq/rollcall/security/advisories/new). Please do
not open a public issue for a vulnerability.

## What this tool can do, stated plainly

It sends signals to processes. That is a destructive capability, and the only thing standing between
it and damage is the precision of what it will target.

- It matches the **resolved executable path** against a registry. It never reads the command line,
  because a command line contains whatever text somebody typed — a `grep` searching for "claude"
  carries every name this looks for.
- Every registry row validates itself at construction against a worked example and at least one
  negative case, so a row that matches too broadly cannot be loaded at all.
- It **never signals an application**, and never signals its own ancestry.
- It **never escalates privilege**. A process owned by another user is reported and left alone, and
  the output does not suggest `sudo`.
- It reports a stop only after checking that pid individually. A delivered signal is not a death.

## The two properties worth attacking

Both have a control in `test/`, written before the code they guard.

1. **It must not signal what it did not name.** If you can construct a process that this attributes
   to a signature it should not match, that is the report we most want. `CursorUIViewService` and a
   name-carrying `grep` are already negative cases.
2. **It must not report a stop it did not achieve.** If you can make it claim a process is gone
   while it is still running, same.

## Zero dependencies, and why that is a security property here

`npm view rollcall dependencies` returns `{}`. A tool that exists partly because of dependency-level
attacks cannot ask you to audit a dependency tree before you trust it. Everything it uses is the
Node standard library: `child_process.execFileSync` to read `/bin/ps`, and `process.kill` to signal
and to check existence.

Releases are published from CI with npm provenance, so the published tarball is verifiably linked to
the commit that produced it. That is the one part of "audit it yourself" a reader cannot check by
reading, so it is attested rather than asserted.

## What it does not defend against

Anything that re-spawns itself, resists a signal, or hides from `ps`. This is for work you started
and want to stop, not for hostile software, and it does not imply otherwise.
