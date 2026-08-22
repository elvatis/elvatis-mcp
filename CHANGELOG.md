# Changelog

Notable changes to `@elvatis_com/elvatis-mcp`.

This file starts at 1.3.0, where it was created. What earlier versions contained
is the published tarballs on
[npm](https://www.npmjs.com/package/@elvatis_com/elvatis-mcp?activeTab=versions)
and the tags in this repository.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-08-21

### Changed

- **`main` carries `1.3.1`, an unreleased number, now that `1.3.0` has shipped.**
  [SECURITY.md](SECURITY.md#release-integrity) states the convention this
  follows: a version is vacated as soon as it is published, so the default
  branch is always releasable. The version guard already refused the previous
  state and was right to; what was missing was the written rule and the step
  that satisfies it. The guard's failure message now names the convention and
  says that the fix belongs on `main`, rather than only stating the fact.
- **The changelog gate that CONTRIBUTING.md and SECURITY.md described now
  exists.** Both documents stated that "the changelog gate requires the topmost
  dated release heading to equal the version in `package.json`", and nothing
  implemented it: the phrase appeared twice in 101 tracked files, in those two
  sentences, and no script, workflow or test read a heading out of this file.
  `node scripts/check-changelog-heading.mjs` now performs that comparison in its
  own CI job on every pull request, and `publish` depends on that job. It fails
  closed, so an unparseable heading, an `[Unreleased]` section above the dated
  one, an impossible date or a duplicated version exits 2 rather than passing.
  The SECURITY.md claim was the one that mattered: it sits in a public section
  whose opening sentence invites the reader to check it against the workflow.

### Fixed

- The handoff notes under `.ai/` were partly German, in a public repository
  whose contributor documentation had never said which language it uses.
  `LOG.md` was a German session narrative, down to which machine the author
  connected from; one session entry in `STATUS.md` was German prose. Both are
  now English, and CONTRIBUTING.md states the rule so the next note does not
  have to guess it. The one German string that remains is a citation of the
  subject line of commit `c12c6e5`, which is on `main` and cannot be corrected
  without rewriting published history.
- **A test file under `tests/` could exist and never run, and the suite still
  reported a full pass.** The `test` script selected files by name and nothing
  compared that list against the directory, so an always-failing probe dropped
  into `tests/security/` left `npm test` at exit 0. `npm run test-registration`
  now compares the two, `tests/integration.test.ts` is declared excluded with
  the reason it is not run, and CI invokes the guard by path in a step of its
  own rather than through the `package.json` it audits.
- The release section of SECURITY.md claimed the tree is built on Node 18, 20
  and 22. The matrix moved to 22 and 24 on 2026-08-21 when the two end-of-life
  runtimes were dropped, and the prose stayed behind, in a section that invites
  the reader to check it against the workflow. It now points at the matrix
  instead of restating it, so it cannot drift again.
- **The em-dash ban declared in `aahp.config.json` was never evaluated by
  anything.** `aahp verify` and `aahp doctor` do not read `forbiddenPatterns`;
  `aahp check` does, and no workflow ran it. 112 occurrences of U+2014 sat
  across 35 of 101 tracked files while CONTRIBUTING.md published the rule and
  every check was green. All 112 are gone, a `governance gates (aahp check)`
  job now evaluates the rule on every pull request, and
  `tests/security/forbidden-patterns.test.ts` asserts the consequence directly
  by enumerating the tracked tree itself, so narrowing the config cannot make
  it pass.

  Wiring the gate in was not enough on its own: the AAHP default file list has
  no `*.ts` entry, so on a TypeScript project the gate would have reported
  clean over all of `src/` by construction, and 49 of the 112 occurrences were
  in files it could not open. The rule now declares an explicit `include` that
  restates the defaults and adds every text file type this repository actually
  contains. The one recorded value that legitimately holds the character, a
  captured model response under `benchmarks/results/`, stores it as a JSON
  escape, so its parsed value is byte-identical and the file carries no
  literal.
- `.ai/handoff/CONVENTIONS.md` claimed Node.js 18+ while `engines.node` has
  been `>=22` since the end-of-life runtimes were dropped.

### Security

- **A caller-supplied `model` string could run as a second command on
  Windows.** `spawnLocal` builds one command string for `cmd.exe` rather than
  passing an argv array, and its escaper rewrites an inner `"` as `\"` on the
  assumption that a backslash escapes a quote. cmd.exe has no backslash escape:
  it toggles quote state on every `"`, so `\"` closed the quoted region and the
  remainder was parsed as command text, where `&`, `&&`, `|` and `>` are
  operators. Measured on Windows 11 with Node v22.12.0 against `main` at
  94d0418: a `model` value of `x" & echo INJECTED_MARKER & "` executed
  `echo INJECTED_MARKER` as its own command. The realistic trigger is prompt
  injection, because the caller of these tools is a language model.
  `validateModel` now refuses anything outside the alphabet real model
  identifiers use, and the four sites that push `--model` into an argv
  (`claude_run`, `codex_run`, `gemini_run` and the prompt splitter) pass the
  validated value. `tests/security/model-injection.test.ts` exercises the
  validator in both directions and calls each handler, so removing the wiring
  fails the suite even though the validator would still pass its own tests.
  This does not make `src/spawn.ts` safe for arguments added later; see
  SECURITY.md and the open issue on the splitter's `-p` path.

### Security

- **Nothing looked for a credential in this public repository, at either of
  the two layers that could.** GitHub secret scanning, push protection,
  non-provider patterns and validity checks are all disabled, and
  `.github/workflows/` held no scanner: `supply-chain-guard.yml` is a
  dependency scanner and has never looked for a secret. Each layer reads as
  the other one's backstop, so zero of two looks the same from inside any
  single file. `.github/workflows/secret-scan.yml` now runs gitleaks over the
  FULL history on every pull request, every push to `main` and every release
  tag, with no `paths` or `paths-ignore` filter of any kind and no shallow
  clone. Verified in both directions against the real scanner before landing:
  140 commits of current history scan clean, and a synthetic AWS key planted
  in a markdown file under `.ai/handoff/` - the path a `paths-ignore` would
  have excluded - is caught, redacted, and fails the job. The platform layer
  is a repository setting and remains OFF; only push protection can stop a
  credential before it becomes public, so issue #71 stays open for that half.

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

[1.3.1]: https://github.com/elvatis/elvatis-mcp/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/elvatis/elvatis-mcp/releases/tag/v1.3.0
