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
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) — nothing depends on
taking our word for it.

### How a release happens

A maintainer pushes a tag of the form `v1.2.3`. That, and only that, starts the
release path:

1. **`build`** typechecks, builds and tests the tree on Node 18, 20 and 22.
2. **`publish`** runs only after `build` succeeds. It checks out the exact commit
   the tag pointed at, refuses to continue if `package.json` disagrees with the
   tag name, and publishes with npm OIDC trusted publishing and `--provenance`.
   No long-lived registry token is involved.
3. **`release`** cuts the GitHub Release for the same commit.

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
every file in `.github/workflows/`, not one filename — this package's first 32
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
reachable from a fork or a pull request — neither can create a tag here — so it
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
  cannot remove the gate — a job that drops the environment mints a token the
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
