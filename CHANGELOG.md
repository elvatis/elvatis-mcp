# Changelog

Notable changes to `@elvatis_com/elvatis-mcp`.

Versions before 1.3.0 have no entry here; this file starts where it was created.
Their contents are the published tarballs on
[npm](https://www.npmjs.com/package/@elvatis_com/elvatis-mcp?activeTab=versions)
and the tags in this repository.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## 1.3.0 - not yet released

The version in `package.json` is 1.3.0 and no `v1.3.0` tag has been pushed yet.
The date lands here when it is.

**If you are on 1.2.4, upgrade when this is released.** 1.2.4 was published on
2026-04-15 and is the newest version available; every change below has been on
the default branch since then without ever reaching the registry. See
*Release integrity* at the bottom of this entry for why.

### Security

- Input validation and shell quoting for values that are interpolated into
  commands executed on a remote host. A new `validate` module refuses values
  outside the shape each option is documented to accept - container, service,
  agent and deploy-target names, schedule expressions, cron job identifiers and
  the announcement channel - and callers quote what they pass. Remote file reads
  and appends quote their paths rather than substituting them raw.

  This is a behaviour change, and the reason this release is a minor rather than
  a patch: input that a previous version accepted and passed through is now
  rejected with an error. If a name you use is refused, it contained something
  the option was never meant to carry.

### Added

- `validate` module exporting the per-option validators and a shell-quoting
  helper, so the same rules are available to every tool rather than restated at
  each call site.

### Fixed

- The MCP server reported its version as `0.1.0` in the initialize handshake,
  regardless of which version was installed. It now reports the version from
  `package.json`, so a client can tell what it is actually talking to.

### Release integrity

The two security changes above were merged on 2026-06-28 and 2026-08-19. Neither
could be installed by anyone, because `package.json` had not moved off `1.2.4`
since 2026-03-31 and npm will not accept a version number twice. Re-tagging was
no way out either: `v1.2.4` already exists and points at the April tree. The
fixes were correct, merged, and unreachable - an April tarball cannot contain a
June fix.

Three things changed so that this cannot recur silently:

- **A version already on the registry now fails CI.** `npm run version-guard`
  asks the public registry whether the version in `package.json` has already been
  issued, and fails if it has. It runs on every pull request, in its own check,
  and the publish job depends on it. It fails closed: an unreachable or
  unreadable registry exits non-zero rather than waving the build through, since
  that is precisely when a bad publish would slip past.
- **A tag that disagrees with the version it would ship is refused**, so the
  registry, the tag and the GitHub Release cannot name three different things.
- **Only a pushed `v*` tag can publish**, out of the exact commit that tag names.

[SECURITY.md](SECURITY.md#release-integrity) sets out what the release path does
and does not guarantee, and how to verify a version you have installed.
