# Changelog

Notable changes to `@elvatis_com/elvatis-mcp`.

This file starts at 1.3.0, where it was created. What earlier versions contained
is the published tarballs on
[npm](https://www.npmjs.com/package/@elvatis_com/elvatis-mcp?activeTab=versions)
and the tags in this repository.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **`main` carries `1.3.1`, an unreleased number, now that `1.3.0` has shipped.**
  [SECURITY.md](SECURITY.md#release-integrity) states the convention this
  follows: a version is vacated as soon as it is published, so the default
  branch is always releasable. The version guard already refused the previous
  state and was right to; what was missing was the written rule and the step
  that satisfies it. The guard's failure message now names the convention and
  says that the fix belongs on `main`, rather than only stating the fact.

### Fixed

- The release section of SECURITY.md claimed the tree is built on Node 18, 20
  and 22. The matrix moved to 22 and 24 on 2026-08-21 when the two end-of-life
  runtimes were dropped, and the prose stayed behind, in a section that invites
  the reader to check it against the workflow. It now points at the matrix
  instead of restating it, so it cannot drift again.

## [1.3.0] - 2026-08-21

The first release to contain the security fixes merged on 2026-06-28 and
2026-08-19. **If you are on 1.2.4, upgrade.**

1.2.4 was published on 2026-04-15 and remained the newest version available for
four months while both fixes sat on the default branch, unreleasable, because
the version number had not moved and npm will not accept a number twice. See
*Changed* below for what now prevents that from recurring.

The version is dated here when it is frozen; it reaches the registry when a
`v1.3.0` tag is pushed.

### Security

- Input validation and shell quoting for values interpolated into commands
  executed on a remote host. A new validation module refuses values outside the
  shape each option is documented to accept - container, service, agent and
  deploy-target names, schedule expressions, cron job identifiers and the
  announcement channel - and callers quote what they pass. Remote file reads and
  appends quote their paths rather than substituting them raw.

  This is a behaviour change, and the reason this release is a minor rather than
  a patch: input that a previous version accepted and passed through is now
  rejected with an error. If a name you use is refused, it contained something
  the option was never meant to carry.

### Added

- A validation module exporting the per-option validators and a shell-quoting
  helper, so the same rules are available to every tool rather than restated at
  each call site.

### Fixed

- The MCP server reported its version as `0.1.0` in the initialize handshake
  regardless of which version was installed. It now reports the version from
  `package.json`, so a client can tell what it is actually talking to.

### Changed

- **A version already on the registry now fails CI.** `npm run version-guard`
  asks the public registry whether the version in `package.json` has already
  been issued, and fails if it has. It runs on every pull request, in its own
  check, and the publish job depends on it. It fails closed: an unreachable or
  unreadable registry exits non-zero rather than waving the build through, since
  that is exactly when a bad publish would slip past.
- **A tag that disagrees with the version it would ship is refused**, so the
  registry, the tag and the GitHub release cannot name three different things.
- **Only a pushed `v*` tag can publish**, out of the exact commit that tag names.

[SECURITY.md](SECURITY.md#release-integrity) sets out what the release path does
and does not guarantee, and how to verify a version you have installed.

[Unreleased]: https://github.com/elvatis/elvatis-mcp/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/elvatis/elvatis-mcp/releases/tag/v1.3.0
