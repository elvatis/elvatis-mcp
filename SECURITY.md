# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this project, please report it responsibly:

1. **Do not open a public issue.** Instead, send an email to **security@elvatis.com** with:
   - A clear description of the vulnerability
   - Steps to reproduce
   - Expected and actual behavior
   - Any PoC code or attachments (zip) if safe to share

2. We will acknowledge receipt within **48 hours** and provide a timeline for fixes.

3. Do not publicly disclose the issue until we have had a reasonable time to address it.

## Scope

This project connects to remote systems via SSH and to Home Assistant via HTTP.
Security-relevant areas include:

- SSH key handling and connection parameters
- Environment variable management (tokens, credentials)
- Input validation on tool arguments (shell injection in SSH commands)
- MCP protocol transport (stdio and HTTP modes)
- The release path: how a commit in this repository becomes the tarball you
  install from npm (see below)

We appreciate responsible disclosure.

## Release integrity

`@elvatis_com/elvatis-mcp` is built and published by GitHub Actions from this
repository. This section states what that path does and does not guarantee, so
you can decide how much to rely on it. Everything here is checkable against
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) - nothing depends on
taking our word for it.

### How a release happens

A maintainer pushes a tag of the form `v1.2.3`. That, and only that, starts the
release path:

1. **`build`** typechecks, builds and tests the tree on every Node major in
   the `build` matrix of [`ci.yml`](.github/workflows/ci.yml). This document
   deliberately does not repeat those numbers. It used to, and when the matrix
   dropped two end-of-life runtimes on 2026-08-21 the copy here stayed behind,
   in a section whose whole claim is that you need not take our word for it.
   [`tests/security/runtime-support.test.ts`](tests/security/runtime-support.test.ts)
   holds the matrix itself to `engines.node` and refuses an end-of-life floor.
2. **`publish`** runs only after `build` succeeds. It checks out the exact commit
   the tag pointed at, refuses to continue if `package.json` disagrees with the
   tag name, and publishes with npm OIDC trusted publishing and `--provenance`.
   No long-lived registry token is involved.
3. **`release`** cuts the GitHub Release for the same commit.
4. **The number that just shipped is vacated on `main`**, so the default branch
   never carries a version the registry has already issued. This is a step of
   the release, not preparation for the next one. See below.

### `main` always carries an unreleased version

A version number that has shipped is spent. npm never accepts a number twice,
not even one that was unpublished, and the tag for it already points at the
commit that shipped. So the moment `v1.3.0` reaches the registry, `1.3.0` in
`package.json` stops describing something that can be released and starts
describing something that cannot.

The convention is therefore:

> As soon as a version ships, raise `version` in `package.json` past it.
> `main` carries an unreleased number at all times.

Raise it to the next patch by default. If a change that lands later warrants a
minor or a major, raise it again then. The placeholder exists so that `main` is
always releasable; it is not a prediction of the next release's size.

Opening that number's section in [CHANGELOG.md](CHANGELOG.md) is part of the
same step rather than a follow-up. The changelog gate requires the topmost
dated release heading to equal the version in `package.json`, so the number and
its entry move together or the gate fails; what the release contains then
accumulates under that heading until the tag is pushed. The date is the day the
section was opened, and it is corrected at freeze time if the release slips.

**Why this is a rule and not a preference.** Between 2026-04-15 and 2026-08-21
this package sat on a published `1.2.4` while two security fixes were merged to
`main`. Both were correct, both were reviewed, and for four months neither could
be installed by anyone, because the only number the tree offered was one the
registry had already issued. Nothing went red in that window: the build, the
tests and the publish guards all passed, because each of them gates a release
path that was never reached.

`npm run version-guard` now fails a pull request whose `package.json` version is
already on the registry, and it runs on every pull request rather than only at
release time. Note where it points when it fires. The version it objects to is
almost never something the branch under review introduced; it is whatever `main`
carries. A pull request that is red on this check while touching nothing
version-related is reporting that a release finished without step 4.

### What that path guarantees

Four properties, each enforced by the workflow and each asserted by
[`tests/security/publish-guard.test.ts`](tests/security/publish-guard.test.ts),
which runs on every pull request:

| Property | Why it matters |
|---|---|
| No trigger other than a **pushed** `v*` tag reaches a publishing job | The Run-workflow button offers every branch and every tag. Asserting the *event* is what a dialog cannot forge. |
| Every checkout on the release path pins `ref: ${{ github.sha }}` | The tarball is built from the commit the tag pointed at when the run started, not from a ref that can move mid-run. |
| Publishing waits on the job that typechecks and tests | A tag cannot ship a tree that was never built. |
| The tag name must equal the `version` in `package.json` | The registry, the git tag and the GitHub Release cannot drift apart and name three different things. |

The guard evaluates the workflow rather than pattern-matching it, and it scans
every file in `.github/workflows/`, not one filename - this package's first 32
versions were published from a second workflow file that no longer exists.

### What that path does NOT guarantee, today

**It does not prove that the commit under the tag was reviewed.**

As of 2026-08-21 this repository has no ruleset or protection restricting who may
create `refs/tags/v*`, no environment able to hold a release for a reviewer, and
no required status check on the default branch. So the binding the workflow
provides is:

> the published tarball is built from the commit that the tag named

and *not*:

> that commit passed review

Anyone with push access to this repository can point a `v*` tag at any commit and
that is an ordinary pushed tag, indistinguishable from a real release to every
check described above.

**Scope of that exposure.** It requires push access to this repository. It is not
reachable from a fork or a pull request - neither can create a tag here - so it
is not an avenue for an outside contributor. It is a statement about how much a
compromised or mistaken maintainer account can do without a second pair of eyes,
which is exactly the question a supply-chain consumer is entitled to ask.

**Two controls would close it**, and they are not exclusive:

- **A tag ruleset** restricting creation of `refs/tags/v*` to named actors. One
  repository setting, no workflow change, and it directly removes today's gap.
  Its limit is that it guards the *trigger*: a future workflow that publishes on
  something other than a v-tag is outside its scope.
- **An `npm-publish` environment with a required reviewer**, named in the
  package's trusted-publisher configuration on the registry. The publish job
  declares the environment, the run pauses for a human, and the OIDC token it
  mints carries that environment claim. Because the reviewer requirement is a
  repository setting rather than a line in the workflow, and because the registry
  is configured to accept only tokens carrying the claim, editing the workflow
  cannot remove the gate - a job that drops the environment mints a token the
  registry refuses. It fails closed. The cost is that every release waits for a
  human.

Neither is in place yet. This section will say so until one is.

### Verifying what you installed

Registry signatures are present on every published version:

```bash
npm audit signatures
```

**Provenance is configured but not yet demonstrated.** The workflow publishes
with `--provenance`, but no version on the registry carries a provenance
attestation today: all 32 published versions predate the move to OIDC trusted
publishing on 2026-06-27 and came from the older token-based workflow. The next
release will be the first to produce one. Until then, `npm audit signatures`
reports signatures but no provenance, and that is expected rather than a sign of
tampering.

If you find a published version whose contents do not match the tagged commit it
claims to come from, please report it by email as described above.
