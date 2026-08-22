## 2026-08-22 - A model name could become a second command, and the rule that forbade it was already written

ISSUE #69, CLOSED AT THE BOUNDARY RATHER THAN AT THE SINK, BECAUSE THE SINK
CANNOT CURRENTLY BE BOTH SAFE AND FAITHFUL. On Windows `spawnLocal` does not
pass an argv array: it joins the arguments into one command string for cmd.exe.
The escaper rewrites an inner `"` as `\"`, assuming backslash escapes a quote.
cmd.exe has no backslash escape - it toggles quote state on every `"` it meets -
so `\"` CLOSES the quoted region and the rest is command text, where `&`, `&&`,
`|` and `>` are operators.

REPRODUCED, NOT INFERRED. Windows 11 (10.0.26200), Node v22.12.0, against `main`
at 94d0418. `model` = `x" & echo INJECTED_MARKER & "` produced

  echo "exec" "--json" "--model" "x\" & echo INJECTED_MARKER & \""

and `echo INJECTED_MARKER` ran as its own command. The marker appeared in the
output.

THE RULE WAS ALREADY THERE. `src/validate.ts` opens with "All values that reach
a shell command (even via SSH) must be validated here before use", and its own
header names `--model` as an example of the option-value position that `--`
cannot protect. There was no model validator. Nothing compared the set of
validators against the set of values that reach a command string, so the file
read as evidence while the value it names travelled unchecked. Same shape as
#67 and #70: a rule that is stated and not executed.

THREE ROUTES WERE MEASURED BEFORE CHOOSING, and the issue's own recommendation
is not implementable:

  A  spawn(shim, argv, {shell:false})     EINVAL against a .cmd shim
  C  cmd.exe /d /s /c + verbatim + ^esc   no injection, but the payload arrived
                                          split across six argv entries
  D  today's escaper                      injected

A is Node's CVE-2024-27980 mitigation, and all three agent CLIs here are `.cmd`
shims, so it cannot be written as the issue describes. C is safe and wrong. So
the value was constrained at the boundary instead, which is the route #73
already took for `--channel` in this repository.

`validateModel` refuses everything outside the alphabet real model identifiers
use, and the four `--model` push sites pass the validated local.
`tests/security/model-injection.test.ts` runs the validator in both directions,
CALLS each of the three handlers so the wiring is load-bearing, and refuses a
raw `args.model` push reappearing next to a validated local - with a control
asserting that last scan can actually fire.

MUTATION PROOF, RUN AFTER COMMITTING THE FIX, every substitution asserted to
have changed the file before the suite ran:

  validateModel body replaced with `return value;`      13 rejection tests red
  claude.ts push reverted to `args.model`               scan + handler test red
  gemini.ts validateModel( call removed                 handler test red
  import of validateModel removed from splitter.ts      import test red

Each was restored and the suite returned to 40 passing.

WHAT IS NOT FIXED, AND IS NOW FILED SEPARATELY. `src/spawn.ts` is still wrong
for any argument added later, and `splitViaGemini` puts the analysis prompt into
`-p` as a command-line argument instead of over stdin the way `gemini_run` does.

That one was measured before it was written down, and the first answer was
wrong. It is NOT a live injection: `buildAnalysisPrompt` places the caller's
text after several newlines, and cmd.exe ends the command at the first newline,
so the payload never reaches a position where it could run. What it IS, today,
is a functional break - the command is cut at that newline, so `--output-format`,
`--model` and all but the first line of the prompt are silently dropped, and the
Gemini split strategy cannot be doing what it claims on Windows. With the same
argv position and no leading newline the marker executes, so the sink is
injectable and only the template's shape is holding it shut.

Issue #69 states "prompt is not affected: it travels over stdin". That is true
of the three run tools and false of the splitter, in a way that happens not to
be exploitable rather than by design.

## 2026-08-22 - The changelog gate that two documents described now exists, and one of those documents is public

ISSUE #76 IS THE THIRD INSTANCE OF ONE CLASS IN THIS REPOSITORY AND THE ONLY ONE
FACING OUTWARDS. `CONTRIBUTING.md` and `SECURITY.md` both stated that "the
changelog gate requires the topmost dated release heading to equal the version
in `package.json`". Re-measured on `main` at `df66e15` before writing anything:
the phrase "changelog gate" appears exactly twice across 101 tracked files, in
those two sentences, and nothing under `scripts/`, `.github/workflows/`,
`tests/` or `aahp.config.json` reads a heading out of `CHANGELOG.md`. Two
claims, zero implementations.

The claim was never false about the tree. `## [1.3.1] - 2026-08-21` and
`"version": "1.3.1"` agreed, and still agree. It was unenforced, not violated,
which is the whole reason it survived: an unenforced rule that happens to hold
is indistinguishable from an enforced one until the day it stops holding, and on
that day nothing reports it. The same shape as #67 (`forbiddenPatterns`
declared, `aahp check` invoked by nothing) and #70 (`npm test` naming its files,
so an unregistered test never runs). The difference is the audience: the
`SECURITY.md` instance sits in a public section whose opening sentence invites
the reader to check every claim in it against `ci.yml`.

IMPLEMENTED RATHER THAN DELETED. `scripts/check-changelog-heading.mjs` parses
the file, takes the topmost second-level heading, and compares the version it
names to `package.json`. Three decisions are worth recording because each is a
way the gate could have been green and meaningless:

- **"Topmost" is structural, not a search.** The first `##` heading has to BE
  the dated release heading. A script that scanned downward for the first
  heading that happens to parse would step over `## [Unreleased]` and report
  agreement about a section nobody is editing. `[Unreleased]` was this file's
  topmost heading until 2026-08-21, so this is not hypothetical.
- **Fenced code blocks are excluded.** An example heading in a ``` block above
  the real one would otherwise take the topmost position from a document that is
  perfectly correct.
- **Invoked by literal path in CI, never through `npm run`.** The acceptance
  criterion is that the gate cannot be switched off by editing `package.json`,
  and an npm script is a line in `package.json`. The version guard is allowed
  npm indirection; this one is not, and the test enforces the difference.

It exits 2 for a missing file, an unparseable heading, an impossible date
(`2026-02-30` matches the digit shape and is not a day), a version that is not a
version, and the same version heading twice. `publish` now lists the new job in
`needs:`, which on a repository whose `required_status_checks` is `null` is the
only place a check can hold anything up from inside this tree.

MUTATION PROOF, 13 ROWS, ALL AS EXPECTED. Run after committing the fix, so no
restore could delete it, and every substitution asserted that it had actually
changed the file before the gate ran:

  version raised to 1.3.2, heading left at 1.3.1     exit 1   (was 0)
  heading raised to 1.4.0, version left at 1.3.1     exit 1   (the other direction)
  [Unreleased] placed above the dated section        exit 2   (not a step-over)
  CI step replaced with `echo skipped`               suite red
  `needs:` edge on publish dropped                   suite red

Each was restored and re-run to 0. The two workflow mutations matter most: they
are the difference between this gate and `aahp check`, which passes its own
scenarios perfectly and has been wired to nothing for the life of this
repository.

Full suite locally: 260 tests, 0 failures, 11.6 seconds. `npm test` here is
node:test through tsx, not bats; the estate rule about never running a full
suite on this machine was measured against bats and does not apply.

NOT EXERCISED, AND SAID PLAINLY: the new job has never run on a GitHub runner
from this session. Everything above is a local verdict. CI decides.

Open, and Emre's:

- **`required_status_checks` on `main` is still `null`.** Unchanged from the
  previous session's note. Every gate in this repository reports rather than
  blocks on a pull request. The `needs:` edge added here is a partial answer for
  the release path only.
- **#75 is open and CONFLICTING**, and its check marks are the last run against
  a base that no longer exists. It edits the same `test` script line this change
  appends to, so the two will conflict textually; keeping both filenames on that
  line is the whole resolution. Not this session's pull request to touch.
## 2026-08-22 - The supply-chain scan never ran on the one ref that publishes

ISSUE #68. `supply-chain-guard.yml` triggered on `push: branches: [main]`. A
`push:` block carrying a `branches:` filter does not match a tag push AT ALL,
and `ci.yml` publishes from exactly a `v[0-9]+.[0-9]+.[0-9]+` tag push. So the
ref that becomes a public npm tarball was the one ref no supply-chain gate was
configured to see, and `npm publish --provenance` attested a tree that no scan
had inspected. Re-measured on `c12c6e5`, which is also tag `v1.3.0`: of the
three workflows in `.github/workflows/`, ONE ran on the tag ref and two did not.

WHY IT READ AS COVERED, WHICH IS THE PART TO REMEMBER. A tag normally points at
a commit that also landed on `main`, and `main` is scanned. So the published
tree usually HAD been scanned: by a different run, on a different ref, at a
different time. That is a convention, not a control. Nothing in this repository
requires a `v*` tag to name a commit `main` ever carried, and
`gh api repos/elvatis/elvatis-mcp/rulesets` returns `[]`, so no tag ruleset
supplies it either. Every gate added here later inherits the same gap unless its
trigger list is written against the release path rather than against `main`.

THE FIX IS ONE LINE, SO THE ASSERTION IS THE SUBSTANCE.
`tests/security/publish-guard.test.ts` now compares the two trigger lists as a
COVERAGE RELATION: for every ref pattern a publishing job can fire on, some scan
workflow must trigger on a pattern that covers it. `covers()` is deliberately
conservative (equality, `*`, or a trailing-wildcard prefix) and reports anything
it cannot prove as uncovered rather than guessing, because a wrong answer here
would announce coverage that does not exist. The scanner is located by the
ACTION it runs, not by the file it lives in, for the same reason the rest of
that file locates the publisher by capability.

MUTATION PROOF, 11 ROWS, ALL AS EXPECTED, run after committing the fix. Two are
worth naming:

  publish gains a `release-*` tag trigger, scan not extended   red, names `release-*`
  scan broadened to `v*`, which COVERS the publish pattern     green

The first is the forward case: the defect recurring rather than the original
being restored. The second is what separates a coverage relation from a
hardcoded expectation, and a hardcoded one would have forced the next
maintainer to edit the test to widen the scan.

WHAT IS NOT FIXED, AND IS EMRE'S. The scan reports; it does not block. `publish`
does not name it in `needs:` and no status check here is required, so a Critical
finding on the tagged tree ships anyway. That is written into SECURITY.md under
`What that path does NOT guarantee, today`, with the cost on both sides stated,
rather than left implied: a blocking scan makes every release depend on a
third-party action and an indicator feed, and a non-blocking one means the
provenance attestation covers a tree nothing was empowered to refuse. Issue #68
asks for that decision to be recorded somewhere a stranger can find it; the
state is now recorded there, the decision itself is not mine to make.

Full suite locally: 237 tests, 0 failures. `npm run typecheck` clean.

NOT EXERCISED: nothing here can be proved without pushing a tag, which this
session did not and must not do. The workflow change is asserted by the test and
by CI parsing the file; the run on a real tag ref happens at the next release,
and the check for it is the `gh api` one-liner in issue #68.
## 2026-08-22 - The em-dash gate was declared, never run, and could not have seen the code

ISSUE #67, AND THE SECOND DEFECT THAT ONLY APPEARS ONCE THE FIRST IS FIXED.
`aahp.config.json` has declared a `forbiddenPatterns` rule banning U+2014 since
this repository was created, and nothing ever evaluated it: the two AAHP steps
in `aahp-verify.yml` are `verify --level ci` and `doctor --json`, and neither
reads `forbiddenPatterns`. The command that does is `aahp check`, which no
workflow called and no npm script wrapped. Re-measured on `main` at `df66e15`
before touching anything: **112 occurrences across 35 of 101 tracked files**,
while `CONTRIBUTING.md` published the rule in prose and every check was green.

THE PART WORTH REMEMBERING IS NOT THE EM DASHES. Wiring `aahp check` in would
NOT have been enough. Read from the CLI's own source rather than inferred, the
default file list is:

  *.md *.mjs *.js *.json *.sh *.bash *.bats *.yml *.yaml *.txt

There is no `*.ts` entry, and this is a TypeScript project. The gate, once
wired, would have reported CLEAN over the whole of `src/` by construction: 49 of
the 112 occurrences sat in files it could not open. A gate that runs, passes and
is structurally incapable of seeing its subject is worse than one that never
runs, because now the passing tick is evidence. That is the same failure this
repository keeps producing in new forms, one layer further in each time.

`aahp.config.json` now declares an explicit `include` that restates the defaults
and adds `*.ts`. A new test then found FIVE MORE unscanned text types nobody had
thought about (`*.py`, `*.example`, `*.gitignore`, `*.aiignore`, `LICENSE`), so
those are in the list too. The list is a widening throughout; nothing was
relaxed and nothing is excluded.

THREE FILES NEEDED JUDGEMENT RATHER THAN A SWEEP:

- `CLAUDE.md` and `.ai/handoff/CONVENTIONS.md` both stated the ban and quoted
  the banned character while doing it. Deleting the quotation would weaken the
  rule, so both sentences now name the codepoint instead of showing it.
- `benchmarks/results/subagents-1774986597513.json` contains it inside a
  captured model response. That is a recorded measurement, and editing it would
  falsify a record. The literal became a JSON escape: the parsed document is
  asserted identical, the file carries no literal, and no exclusion was needed.
  Doctoring a benchmark result to satisfy a lint rule would have been the wrong
  trade in the other direction.

THE TEST ASSERTS THE CONSEQUENCE, NOT THE CONFIGURATION.
`tests/security/forbidden-patterns.test.ts` enumerates the tracked tree itself
and counts, so a narrowed `include`, a replaced CLI or a deleted CI job cannot
make it pass. It separately asserts that the include list, expanded through
`git ls-files`, covers every tracked text file, which is the row that catches a
narrowing the count alone cannot.

MUTATION PROOF, 17 ROWS, ALL AS EXPECTED, run after committing the fix. The pair
that carries the argument:

  em dash in src/index.ts                        aahp check exit 1, suite red
  ...and then the include widening reverted      aahp check exit 0, suite STILL RED

That is the state #67 would have left behind had only the wiring been fixed: the
gate running, reporting success, blind to the file. Also covered: a markdown
match, `aahp check` removed from the workflow, and the pattern relaxed to an
unmatchable codepoint (which `aahp check` passes and the suite refuses).

MEASURED WHILE THERE, WORTH KNOWING: `aahp check`'s aggregated output names the
rule and the match COUNT but not the offending file or line. Reproduced twice.
The repository-local test lists every file with its count, so that is the one to
read when this goes red.

Full suite locally: 244 tests, 0 failures, 11.4 seconds. `npm run typecheck`
clean. `npx --no-install aahp check .` exits 0.

NOT EXERCISED: the new `governance gates (aahp check)` job has never run on a
GitHub runner from this session. CI decides.

Open, and Emre's:

- **`required_status_checks` on `main` is still `null`**, so this gate reports
  rather than blocks, like every other one here.
- **An explicit `include` list stops inheriting future AAHP defaults.** If a
  later release adds a file type to `DEFAULT_INCLUDE`, this repository will not
  pick it up. The "scans every tracked text file" row is the compensation: a new
  type appearing in the tree goes red until it is added deliberately.

## 2026-08-22 - The three stranded pull requests carry nothing main lacks, and the handoff notes were German

RE-MEASURED #63, #64 AND #66 AGAINST `main`, LINE BY LINE, AND ALL THREE ARE
EMPTY. The session below reached this by tree comparison; this one repeated it at
the granularity that answers the follow-up question, which is not "does the
branch differ from main" but "does the branch carry anything main lacks". Those
are different questions, and only the second one decides whether a branch is
worth re-proposing. For each branch, every line it ADDS relative to the common
base `c12c6e5` was looked up in main's copy of the same file:

  #66   96 added lines, 0 absent from main
  #64  190 added lines, 0 absent from main
  #63  193 added lines, 0 absent from main

Bookkeeping files (`MANIFEST.json`, `STATUS.md`, `package-lock.json`) excluded,
since those three are regenerated or appended by every session and never carry a
branch's argument.

The reason this needed re-measuring rather than trusting the earlier note is that
the assignment arrived with a per-branch list of things main was said to still
lack: #63's `LOG.md` line, #66's release-convention section in `CONTRIBUTING.md`,
#64's `SECURITY.md` wording. All three are on `main` already, and the
`CONTRIBUTING.md` section is there verbatim. A two-dot diff makes the branches
look enormous (each would delete 1,300 to 1,600 lines) and a three-dot diff makes
them look small; neither says whether their content survives. Counting added
lines against main does.

WHAT MAIN DID STILL LACK IS A DIFFERENT DEFECT THAN THE ONE #63 FIXED. #63
removed a CPU and GPU model from `LOG.md`, and that removal is on main. What it
left behind is the rest of the line and the rest of the file: a German session
narrative, in a public repository, recording which machine the author connected
from. The hardware string was the smaller half.

Measured before and after with a word-list scan over every tracked file, so the
fix has a denominator rather than an impression: 12 German lines in 2 files
before, 1 line in 1 file after. The one that remains is `STATUS.md` line 484,
which quotes the German subject line of commit `c12c6e5` inside an English
paragraph that exists to explain why that subject cannot be corrected. It is a
citation of something immutable, not prose, and it stays.

NO LANGUAGE GATE WAS ADDED, DELIBERATELY. A detector strong enough to catch
German prose also catches that citation, so it would have to ship with an
exception for it, and an exception carved into a matcher is the thing that
swallows the next real instance. This repository already has one control that
reads as active and cannot fire (issue #67, `forbiddenPatterns` declared in
`aahp.config.json` with nothing invoking `aahp check`), and a second gate of that
shape is worth less than no gate plus an accurate sentence in CONTRIBUTING.md.
Recorded here so the choice is visible rather than looking like an omission.

Open, and Emre's:

- **`CONTRIBUTING.md` and `SECURITY.md` both describe a changelog gate that does
  not exist.** Both state that "the changelog gate requires the topmost dated
  release heading to equal the version in `package.json`". Nothing in `tests/`,
  `scripts/`, `.github/workflows/` or `aahp.config.json` compares those two
  values; `grep -rni changelog` over all four returns only prose and the npm
  `files` entry. This is the same class as #67, and worse placed: it is asserted
  in a public `SECURITY.md` section whose opening claim is that nothing depends
  on taking our word for it. Filed as its own issue.
- #63, #64 and #66 are still open and still show stale green check marks. They
  are not this session's to close.
## 2026-08-22 - A test file could exist under tests/ and never run, and the suite still said 234 passed

ISSUE #70, CLOSED BY MEASUREMENT RATHER THAN BY ASSERTION. The `test` script
named its files, nothing compared that list against the directory, and the drift
ran in the dangerous direction: a file missing from the list was never reported
as missing, it was simply never executed, and the run still reported a full
pass. Reproduced here at 87c6cd4 before touching anything: an always-failing
probe in `tests/security/` exits 1 on its own and leaves `npm test` at exit 0,
with its filename absent from the output.

THE GATE IS A SCRIPT WITH ITS OWN CI STEP, AND THE FIRST DRAFT GOT THAT WRONG.
The obvious shape is a test file that reads `package.json` and walks `tests/`.
It is also the one shape that cannot work here: a guard reached only through the
enumerated list is removed by the same edit it exists to catch. So the deciding
invocation is `node scripts/check-test-registration.mjs` as a step of its own in
`ci.yml`, and `tests/security/test-registration.test.ts` executes that script as
a child process instead of restating its logic.

The first draft ran the step as `npm run test-registration`, and the test in
this pull request went red on it. That is the correct verdict and worth
recording, because the reasoning is not obvious: an npm script lives in
`package.json`, which is the file the guard audits, so routing the invocation
through it puts the gate inside its own subject. Rewriting `test-registration`
to `echo ok` would then disable the check with the same edit that breaks the
list. The step now names the script by path.

The workflow assertion strips `#` comments before matching, for the same reason
the last three matchers in this estate were defeated: a `run:` body whose only
mention of the script sits in a comment names the gate without running it, and a
substring match reads that as compliance.

CONTRACT, ASSERTED EXACTLY AND NEVER AS "NON-ZERO". 0 registered, 1 drift, 2
cannot determine. 1 is a real verdict here, so accepting any non-zero would let
a deleted or renamed script - which exits 1 from node itself - impersonate a
working gate on every drift row. Exit 2 covers a missing or unparseable
`package.json`, no `test` script, a script passing no `--test`, an absent
`tests/`, an unrecognised argument, an exclusion with no reason, and an
exclusion map that is an array.

A COMPLETE FILE LIST IS NOT A COMPLETE RUN, which is the second half and the
half a list-versus-directory check misses entirely. `--test-name-pattern`,
`--test-skip-pattern`, `--test-only` and `--test-shard` each leave the list
correct while the run skips most of what it names, and `||`, `;` and `|` after
the runner discard its exit status. All seven exit 2. `&&` is accepted, and
there is a row asserting that, because it propagates failure.

`tests/integration.test.ts` IS NOW DECLARED RATHER THAN FORGOTTEN. It is not a
`node:test` file at all: it carries its own `assert`/`test` helpers, runs as a
plain program, and calls live SSH, Home Assistant and a local LLM. It is
excluded in `package.json` under `testRegistration.excluded` with that reason,
and the guard requires an exclusion to name a file that exists and to carry a
non-empty reason. A stale exclusion is a standing permission for a future file
to arrive under that name and never run, so it exits 1.

Mutation proofs recorded in the pull request body: five, each red, each restored
green, each guarded by an assertion that the substitution actually changed the
file.

Suite: 234 tests before, 263 after, 0 failed.

Open, and Emre's:

- **The changelog gate described in `CONTRIBUTING.md` and `SECURITY.md` does not
  exist.** Filed as its own issue. Same class as #67 and as this one, and worst
  placed of the three: it is asserted in a public `SECURITY.md` section whose
  opening claim is that nothing depends on taking our word for it.
- `required_status_checks` on `main` is still `null`, so this gate reports
  rather than blocks, exactly like CI, Scan and AAHP Verify. Unreachable from
  any file in this tree.

## 2026-08-22 - The three blocked pull requests were already shipped, and the sweep #64 asked for

#63, #64 AND #66 ARE ALREADY ON `main`, CARRIED BY #65. The instruction for this
session was to rebase them onto current `main` and get them green. They do not
need a rebase; they need closing. #65 was the top of the linear stack recorded
in the section below (`main` <- #66 <- #64 <- #63 <- #65), and each branch
contained the ones under it, so squash-merging #65 merged all four at once.

Checked by TREE comparison, not by `git log`. After a squash-merge the original
commits keep their SHAs and patch-ids, so `git rev-list`, `git cherry` and
`git branch --merged` all report these branches as unmerged; they are not. For
each branch, every file it touched relative to the common base `c12c6e5` was
diffed against `origin/main`:

  #66  CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, check-version-unpublished.mjs
       -> all byte-identical on main
  #64  the above, plus src/validate.ts, src/tools/cron-manage.ts,
       tests/unit.test.ts -> all byte-identical on main
  #63  the above, plus .ai/handoff/LOG.md, .claude/commands/build.md
       -> all byte-identical on main

What still differs is `main` being AHEAD: the branches carry
`@elvatis_com/aahp` 3.8.1 where main now carries 3.10.0, and they lack main's
later STATUS.md and MANIFEST.json entries. Rebasing any of them would produce an
empty pull request; merging one would DOWNGRADE the pinned AAHP CLI and drop
`scripts/require-layer2-base.mjs` and `tests/security/aahp-gate.test.ts`. They
were left untouched, not being this session's to close, and the three green
check-marks each still shows are stale: all three read CONFLICTING/DIRTY, and a
conflicting pull request runs no CI at all, so "no checks reported" is showing
as the last green run rather than as a fresh one.

THE SWEEP #64 ASKED FOR. #64 fixed `validateScheduleValue`, the one validator
accepting a leading hyphen, on the one sink reaching the remote command line
unquoted. The class it belongs to was swept across all 42 process sinks in
`src/`, counted by script rather than by eye: 42 sink call sites in 19 files, 43
`args.*` interpolations into command templates, 22 argv tokens built from a
caller value.

The class in one line: single-quoting decides whether the SHELL acts on a value
and says nothing about whether the PROGRAM the shell starts acts on it, because
the quotes are gone before that program runs. `--cron '--announce'` and `--cron
--announce` are identical argv. Such a value contains no shell metacharacter, so
every metacharacter test in the suite passes over it.

Still reachable in two positions, needing two different fixes:

  OPERAND positions, fixed at the sink with the POSIX `--` marker (and grep's
  `-e`), because a path and a search term are legitimately free-form and a
  validator would reject real input: `openclaw_memory_search` (the term is
  grep's PATTERN, and GNU grep permutes), `openclaw_logs` (`filter` likewise,
  in both fallbacks of the gateway and agent branches; `path` is tail's FILE,
  where `-f` turned a log read into a follow that holds the SSH connection open
  until the timeout), and `file_transfer` (`remote_path` is an operand of ls,
  stat, base64 and mkdir).

  OPTION-VALUE positions, where `--` cannot help and the leading character has
  to be refused: `openclaw cron add --cron`, the FALL-THROUGH BRANCH OF THE
  FUNCTION #64 FIXED, three lines below it - every schedule that is not
  "every ..." or "at ..." lands there and was forwarded verbatim; the same flag
  on `cron edit`; and `openclaw_notify --channel`, the last caller value in the
  tree that reached a command string with neither quoting nor validation, held
  only by a zod enum three files away.

TESTED BY CONSEQUENCE. The tests tokenise the command the way a POSIX shell
does, find the token the caller controls, and assert the receiving program
cannot read it as an option: `--` earlier in the SAME pipeline segment, or `-e`
immediately before it. Presence is asserted before safety, so a builder that
stopped emitting the value cannot leave the assertion passing while checking
nothing. The assertion and the tokeniser have their own both-directions tests,
including one that the assertion FAILS on an unprotected command.

The assertion caught two of its own tests being wrong: `$files` is a shell
variable rather than a caller value, and `-r` collides with the literal
`sort -r` in the same command.

MUTATION PROOF, run after committing rather than before, so restoring could not
delete the fix. Three independent mutations, each asserting the substitution had
actually changed the file before the suite was re-run: dropping `--` from the ls
operand (2 red), dropping `-e` and `--` from the memory grep (3 red), and
neutering the leading-hyphen refusal in `validateCronExpression` (3 red).
Baseline and restore both 184 pass / 0 fail, and `git status` clean afterwards.

FOUND AND NOT FIXED, deliberately:

  - `--model` in claude_run, codex_run and gemini_run has no validator and
    reaches argv as its own token. Issue #69 already covers the Windows half of
    that sink (cmd.exe quoting in `spawnLocal`); the flag-injection facet is not
    the same bug and is not covered by it.
  - `src/tools/llama-server.ts` calls `spawn()` directly with `shell: true` on
    Windows AND an args array - the exact pattern `src/spawn.ts` exists to avoid
    (DEP0190) and documents as unsafe. `model_path`, `cache_type_k/v` and
    `extra_args` all reach that line; `extra_args` is spread into argv verbatim
    by design. This is a second instance of #69's root cause in a file #69 does
    not name, and it is local execution on the MCP host rather than remote.
  - `openclaw-deploy.ts` shell-quotes the default script dir `~/deploy`, which
    stops the tilde expanding: `bash '~/deploy'/deploy-api.sh` looks for a
    literal `~` directory. Functional, not security, and pre-existing.
  - The em-dash forbidden pattern in `aahp.config.json` does not run. Measured,
    not inferred: `tests/unit.test.ts` on `main` contains 10 U+2014 characters
    and every gate is green. That is issue #67, now with a count behind it.

## 2026-08-21 - The four open pull requests are one linear stack, and all four are green

WHAT WAS RED AND WHY. All three of #63, #64 and #65 failed `version is not
already published` without having touched a version. `main` carries 1.3.0,
1.3.0 reached the registry at 17:34 UTC today, and the guard runs on every pull
request, so every open branch inherited a statement about `main`. Nothing was
wrong with any of the three branches.

THE BUMP WAS NOT WHERE IT WAS REPORTED TO BE. The 1.3.0 to 1.3.1 bump was
described as having been pushed onto `chore/aahp-3.10.0`. It was not on that
branch, and it was not on any of the three. It exists only on
`docs/release-version-convention` (#66), which was opened later and is the only
branch that was green. Checked by reading `package.json` out of each of the four
remote refs rather than by trusting the report: three read 1.3.0, one reads
1.3.1.

THE STACK. `main` <- #66 <- #64 <- #63 <- #65, each branch merging the one
below it. All four are now green on all five checks and all four report
CLEAN/MERGEABLE. Ancestry was asserted with `git merge-base --is-ancestor` in
all three links rather than inferred from the diffs.

It is a stack rather than four independent branches because all four rewrite
`.ai/handoff/MANIFEST.json`, whose checksums and line counts regenerate every
session. Any two of them collide there by construction, so without sequencing
the second, third and fourth merges each hit the same conflict on `main`.
Sequencing pays that cost once, on the branches, where it can be verified.

HOW, AND WHAT THAT COSTS THE REVIEWER. Assembled with `git merge`, not `git
rebase`: no branch history was rewritten and every push was a fast-forward.
The price is that each branch now CONTAINS the ones below it, so merging one
merges those too. That is the shape that put an unfixed defect on a main branch
elsewhere in the estate on 2026-08-01, carried by a small pull request whose
body did not say what it carried. Every one of the four bodies now opens with
the merge order and names, explicitly, which pull requests it carries. The
carry is not the hazard; an unannounced carry is.

CONFLICT RESOLUTION, both files, both append-logs. STATUS.md: BOTH sides kept
every time, since each side is a whole dated section prepended by a different
branch and neither supersedes the other. Line endings were asserted equal in
and out on each resolution (422, 464 and 582 CRLF respectively), because this
tree is CRLF locally and LF on CI and a checksum taken over the wrong one
passes here and fails there. MANIFEST.json: regenerated with `aahp manifest .`
rather than hand-edited, then diffed field by field against the pre-merge file
and asserted that `project` still reads `elvatis-mcp`. 3.8.1 rewrites that
field to the directory name it runs in, which is the defect #65 exists to fix;
it did not fire only because the worktree happened to be named correctly.

VERIFIED ON EACH MERGE RESULT, not on either parent: typecheck clean, the suite
green (189, 189, then 199 with #65's ten new gate assertions), the version guard
OK, and `aahp verify --level ci` passing all four layers, under 3.10.0 with an
explicit `--base` on the top of the stack.

The guard's new failure message was ticked by EXECUTING it in both directions,
not by reading the diff: `version` set back to 1.3.0 exits 1 and prints the
paragraph naming the convention and pointing the fix at `main`; restored, exit
0. The mutation asserted its substitution had actually applied first.
`scripts/require-layer2-base.mjs` was executed the same way, with its real exit
code read rather than a pipeline's: valid base 0, and absent, empty, all-zero
and non-SHA all 2, distinct from the 1 `aahp verify` uses for a real failure.

### One correction to yesterday's backlog triage

The triage recorded above is right that all ten tool requests are genuinely
unimplemented. One of its reasons does not survive checking against the source.

**T-023 / #17 (`mcp_stats`) needs no live infrastructure and no product
decision.** It was swept up in the reason "shells out to a remote host". It does
not. `src/rate-limiter.ts:223` already writes `usage.json` into the configured
data directory, and `src/config.ts:65` and `:104` already resolve that directory
from `ELVATIS_DATA_DIR`. The tool reads a local file this package itself writes,
and the issue specifies its parameters and return shape, so the product decision
is made. It is ordinary local technical work and it is the only one of the
fifteen that is.

It was NOT implemented in this session, deliberately. Every new branch cut today
is either red on the version guard, because `main` still carries 1.3.0, or has
to become a fifth link on a stack that exists precisely to unblock a broken
release path. Neither is a good home for a new public tool surface. It is ready
the moment #66 reaches `main`.

### Open, and Emre's rather than an agent's

- **Merge order.** #66 first. It is the only one that vacates 1.3.0, and until
  it lands every pull request in this repository is red on a condition none of
  them caused.
- **No status check is required on this repository.** `required_status_checks`
  is null, so all five green checks are advisory and a red pull request can
  still be merged by anyone with push access. Green here is a fact about the
  checks, not a gate.
- **Six issues still carry the `v1.2` target label** while 1.2.4 shipped in
  April and 1.3.0 shipped today. Retargeting or untargeting them is a roadmap
  decision.
- **Priorities were not invented.** Every open issue now carries `product:
  fleet`, which is a fact about this repository. None was given a `priority:`
  label, because ordering someone else's backlog is not an agent's call.
- **The benchmark tables still publish the workstation CPU and GPU** on purpose,
  and #63 says so rather than implying it fixed that. Note that `BENCHMARKS.md`
  also carries what reads as a machine name in a section heading, which is a
  different class of detail from a part number and worth a separate look.

## 2026-08-21 - AAHP 3.8.1 to 3.10.0: the one consumer the fleet rollout skipped

This repository was the last `@elvatis_com/aahp` 3.8.1 consumer in the estate,
and that single fact explains the stray `project` values seen across the fleet.

**3.8.1 rewrites `MANIFEST.json`'s `project` to the name of the DIRECTORY the CLI
ran in.** Reproduced here rather than inferred: in a worktree named
`elvatis-mcp-aahp`, a plain `aahp manifest .` turned `"project": "elvatis-mcp"`
into `"project": "elvatis-mcp-aahp"`. Reinstalling 3.10.0 and running the same
command in the same directory left the field untouched. Both bad values observed
in the estate, `elvatis-mcp-scg-pin` and `mcp-node-eol`, are agent worktree
directory names, and both originated here, because here was the only place still
running 3.8.1. Nothing ever went red: a rewritten `project` is a well-formed
string in a well-formed file, and the checksum layer re-blesses whatever the tool
just wrote.

**Layer 2 is fail-closed from 3.10.0, and that is the part that changed this
repository's workflow.** The content-drift gate now refuses to run without an
explicit `--base SHA` / `AAHP_BASE_SHA` instead of diffing against an implicit
base, and it separately refuses a base that resolves to HEAD, "which would make
Layer 2 vacuous". Measured here: `verify --level ci` with no base exits 1 naming
the missing argument; with `--base $(git rev-parse origin/main)` on an unchanged
tree it exits 1 naming the vacuous base. So `aahp-verify.yml` now supplies a base
per trigger: `pull_request` from `github.event.pull_request.base.sha`, `push` from
`github.event.before`, and `workflow_dispatch` from a new REQUIRED `base` input.
That input is not decoration. A manual run has neither event field, so without it
every dispatch fails closed and reads as a broken workflow rather than as a
missing argument.

**The base is validated before `aahp verify` is reached.**
`scripts/require-layer2-base.mjs` refuses an absent, empty, all-zero or non-SHA
base with exit 2, deliberately distinct from the 1 that `aahp verify` exits on a
real gate failure, so "no base" and "gate failed" stay tellable apart. It is a
script rather than an inline `run:` block for one reason: a test can EXECUTE it in
both directions, the way `version-guard.test.ts` already executes its own script.
A guard asserted only by grepping the workflow that contains it has never been run.

**`tests/security/aahp-gate.test.ts` (10 assertions, new, wired into `npm test`)
asserts the consequence rather than the configuration.** The load-bearing one is
that `MANIFEST.json`'s `project` still equals this package's unscoped name: that
goes red for a stale pin, for a regression, or for a hand-edit, without needing to
know which, and it is the assertion that would have caught the fleet-wide defect
at its first occurrence. Around it: the pin is exact and at or after 3.10.0; the
verify command carries `--base`; every trigger declared under `on:` appears in the
base expression, so adding a trigger without adding its arm goes red; the
`workflow_dispatch` input exists and is `required: true`; the guard is actually
invoked, and before `aahp verify` rather than after; and the gate carries no
`continue-on-error`, no job-level `if:`, no `|| true`, no unconditional `exit 0`
and no `paths`/`paths-ignore` on the workflow the gate itself lives in.

Ten mutations, proved one at a time, fix committed first so `git checkout --`
could not eat it, tree restored and re-verified between each, with the driver
asserting that each substitution actually changed the file on disk before running
anything. Every one turned its own named assertion red and no other. Restored
tree: `npm test` 185 pass 0 fail in 5.9s, `npm run typecheck` clean.

One measurement worth keeping, because it cost time and will cost it again:
`core.autocrlf` is `true` here and the repository has no `.gitattributes`, so
`git checkout --` restores an LF blob as CRLF and a byte comparison then reports a
restore that did not fail. The MANIFEST checksums are over the LF blob, not over
the working-tree bytes (`STATUS.md` hashes `636ed482...` as stored and
`32d63b6f...` on disk, and the MANIFEST holds the former), so AAHP normalises line
endings when checksumming. Compare in LF space and let `git status` be the proof.

### Open, and Emre's

**The AAHP pin has no bump lane, so this staleness will recur.**
`.github/dependabot.yml` deliberately omits the `npm` ecosystem, pending a
runner-budget decision that is still open. That is exactly the "a pin with nothing
to bump it freezes a VERSION" argument this repository already wrote down for
`homeofe/supply-chain-guard`, and it now applies to the repository's own handoff
protocol: 3.8.1 shipped, the fleet moved to 3.10.x, and nothing here could notice.
The new `project` assertion turns the next occurrence red instead of silent, but it
is a detector, not a lane. A single-package `npm` entry grouped to
`@elvatis_com/aahp` alone would cost roughly one pull request per AAHP release.

**`required_status_checks` is still `null` on `main`** (unchanged from the previous
three sessions), so AAHP Verify, CI, Scan and version-guard remain advisory. Every
gate added this month is a gate nobody is required to read.

**The dependabot exemption can be reached by commit-author spoofing.** The gate
no-ops to success when `github.event.head_commit.author.username` is
`dependabot[bot]`, and on a push that field is resolved from the commit author's
email. A commit authored as dependabot therefore skips the handoff gate on the
push to `main`. Left as measured rather than changed: the exemption is load-bearing
for scanner bumps, `action-pin.test.ts` asserts it still exists, and with no
required checks the practical exposure today is nil. Worth revisiting together with
the branch-protection question rather than separately.

### Backlog triage, the 15 open issues

Measured against the source rather than against the titles: all ten issues asking
for a new MCP tool are genuinely unimplemented. `src/index.ts` registers 37 tools,
and `home_presence`, `git_status`, `mcp_stats`, `openclaw_memory_update`,
`openclaw_session_spawn`, `image_generate`, `http_request`, `calendar_event`,
`db_query` and `home_camera_snapshot` are none of them. So nothing in this backlog
is stale in the already-done sense, and none of it can simply be closed.

None was a safe drive-by in this session, and the reason is worth stating rather
than left to be assumed. Each one either needs live infrastructure a session cannot
reach (Home Assistant for T-028, T-026 and T-016; an SSH tunnel for T-015; Google
OAuth for T-014; Cursor and Windsurf clients for T-007), or a product decision
nobody has made yet (which provider T-019 generates images through, which API T-005
trades against), or - and this covers the ones that look cheapest - shells out to a
remote host, which is the exact surface that produced this repository's last two
security fixes. T-020 is documentation only, but it is a per-CLI model support
matrix on a public repository, and model strings expire silently; publishing one
that is wrong is worse than publishing none, because it reads as authoritative.

TWO METADATA FACTS, both the owner's call rather than an agent's:

- Six issues still carry the `v1.2` target label. 1.2.0 through 1.2.4 all shipped
  and 1.3.0 is now published, so that label names a release train that closed two
  trains ago while still reading as "next up" in any filtered view. Whether those
  should be retargeted or untargeted is a roadmap decision, so they are left alone.
- No open issue carries a `product:` or a `priority:` label, against the estate
  convention. Applying them would mean inventing a priority order for someone
  else's backlog, so they are left alone too.
## 2026-08-21 - `main` must always carry an unreleased version, and the guard now says so

`1.3.0` shipped today from the commit that is still `main`, and the number was
never vacated. Within hours all three open pull requests were red on `version is
not already published`, none of them having touched a version. The guard is right
and stays: `main` carrying a published number means anything merged there is
unpublishable, which is the state that left two security fixes uninstallable
between 2026-04-15 and 2026-08-21 while every check stayed green.

What was missing was the convention, not the gate. It is now written where a
public reader meets it:

- SECURITY.md gains step 4 of the release path and a section, `main` always
  carries an unreleased version, stating the rule and the four-month incident
  that motivates it.
- CONTRIBUTING.md repeats it for contributors, including how to read a red
  version-guard: it is a statement about `main`, not about your branch.
- The guard's failure message now names the convention and says the fix belongs
  on `main`. Mutation proof: reverting package.json to 1.3.0 returns exit 1 with
  the new text present; restored, exit 0. Full suite 175/175 in 5.8s.
- `package.json` moves to 1.3.1, which is the rule applied to today's state.

Also corrected: SECURITY.md claimed the tree is built on Node 18, 20 and 22. The
matrix moved to 22 and 24 in #62 and the prose stayed behind, inside a section
whose own claim is that everything in it is checkable against the workflow. It
now points at the matrix rather than restating it, so it cannot drift again. The
five em dashes the file carried are gone; `aahp.config.json` forbids them and
nothing was catching them in that file.

**Measured, for whoever sequences the merges.** The 1.3.0 -> 1.3.1 bump reported
as pushed to `chore/aahp-3.10.0` is NOT on that branch; all three PR heads still
read 1.3.0, and #65's only `package.json` change is the AAHP devDependency and
the test script. The three also do not rebase cleanly onto one another: every one
of them rewrites `.ai/handoff/MANIFEST.json`, whose session id, timestamps,
checksums and line counts are regenerated per session, so the second and third to
merge conflict there by construction. #64 collides on STATUS.md as well. Resolve
MANIFEST.json by rerunning `npx aahp manifest .` after each merge rather than
hand-editing it; resolve STATUS.md by keeping both sides.

**The convention collides with the AAHP changelog grammar, and the collision is
the part worth knowing.** `aahp doctor` runs `changelog-format`, whose R6 requires
the topmost dated release heading in CHANGELOG.md to equal `package.json`. So
vacating the version turns that gate red until the new number also has its own
`## [X.Y.Z] - YYYY-MM-DD` section. `## [Unreleased]` does not satisfy R6, and
`## [1.3.1] - Unreleased` violates R1, which demands a real calendar date.
Measured rather than guessed: main's own CHANGELOG passes with `package.json` at
1.3.0 and fails with it at 1.3.1, nothing else changed. Both documents now say the
version and its changelog section move together, because a gate enforces exactly
that, and the next person to apply the convention would otherwise meet a red check
with no idea why.

Open and Emre's: no status check is required on this repository
(`required_status_checks` is null, recorded in aahp-verify.yml), so the
version-guard, CI and Scan are all advisory and a red pull request can still be
merged by anyone with push access.
## 2026-08-21 - The 1.3.0 tarball was checked against main, and the schedule value was still a flag

THE PUBLISHED ARTIFACT WAS VERIFIED RATHER THAN ASSUMED, because assuming is
what cost four months. `npm pack @elvatis_com/elvatis-mcp@1.3.0` fetched the
tarball from the registry; `dist/validate.js` carries `validateChannel` and
`validateScheduleValue`, `dist/tools/cron-manage.js` carries `escapeShell` and
calls all three, and the raw `parts.push('--channel', args.channel)` is gone.
The negative grep was itself guarded: the same pattern was run against a
synthetic vulnerable line first and matched it, so its zero hits on the shipped
file mean absence rather than a typo in the pattern.

Stronger than the greps: `origin/main` at c12c6e5 was built into a clean
worktree and the whole `dist/` tree compared file by file against the tarball.
128 files on each side, none missing from either, and after normalising line
endings the SHA-256 over the entire tree is identical
(a64126de6ca9ab30c4c3c1e24fee08849dfbebcdac669f34a1c96e077919f5d8). The only
three byte-level differences are CRLF inside template literals in
dashboard.js, routing-rules.js and splitter.js, produced by the Windows
checkout and not by the publish. **1.3.0 is exactly what main says it is.**

The published validators were then EXECUTED, not just read: nine injection
payloads against `validateChannel` are all refused and five legitimate channel
names still pass.

WHAT THAT EXERCISE FOUND. `validateScheduleValue` accepted `../../etc` and
`-rf`. It was the only validator in the module that accepted a leading hyphen -
`validateContainerName`, `validateServiceName`, `validateAgentName`,
`validateDeployService` and `validateChannel` all refuse one, and the module
header names leading hyphens and traversal as part of the contract it enforces.
Its own docstring already claimed to reject traversal sequences.

It matters at this call site because `--every` and `--at` are the only two
values on the `openclaw cron add` line pushed as a bare token; every other one
goes in as `'${escapeShell(x)}'`. A schedule of `every --announce` therefore put
`--announce` on the remote command line as a flag. Impact is bounded - the
allow-list still admits no space, quote or metacharacter, so this is argument
injection into `openclaw cron add`, not arbitrary execution - but it is the
class the module exists to prevent, and it is the same shape as the `--channel`
defect fixed on 2026-08-19.

Fixed by constraining the FIRST character to alphanumeric or `+` separately
from the body allow-list, so `+20m` and the internal hyphens of an ISO
timestamp keep working while `-6h` does not, plus a `..` check. The two call
sites are now quoted like every other value.

THREE MUTATIONS, AND THE THIRD ONE IS REPORTED AS IT CAME OUT. Reverting the
leading-character rule turns 8 tests red including both handler-level cases;
deleting the `..` check turns 2 red. **Reverting the call-site quoting turns
NOTHING red.** That is the honest result and it is not a hole in the tests: the
validator's allow-list already excludes every character quoting would defend
against, so the quoting is only load-bearing if the allow-list is later widened,
and this suite states in its own header that it runs no SSH and asserts no
command string. Recorded here so nobody later reads "two layers" as "two
proven layers". Each mutation asserted that its substitution actually applied,
because a mutation that fails to apply looks exactly like a passing gate.

The 15 new tests assert both directions - every documented schedule form is
asserted to still be ACCEPTED - so a validator that simply rejected everything
would fail the block rather than pass it.

HARDWARE IN THE HANDOFF DOCS, AND WHY REMOVING IT DOES NOT CLOSE ANYTHING.
`.ai/handoff/LOG.md` and `.claude/commands/build.md` named the workstation CPU
and GPU; both are internal documents where the part number serves no reader, so
it is removed in a separate PR. But `README.md` and `BENCHMARKS.md` publish the
same CPU and GPU deliberately, as the reference hardware the benchmark numbers
were measured on, and stripping them there would turn a reproducible benchmark
into an anonymous one. So the hardware remains publicly readable in this
repository on purpose. Treating the handoff edit as "the hardware is no longer
public" would be wrong, and the recommendation is to keep the benchmark tables
as they are.

VERSION-GUARD IS NOW RED ON EVERY PULL REQUEST, INCLUDING ONES THAT SHIP
NOTHING. This is the steady state rather than a one-off, and it is the item most
worth a decision.

The job has no `if:`, no `paths:` filter and no `continue-on-error` - all
deliberate, and `tests/security/version-guard.test.ts` asserts each of them - so
it runs on every pull request and asks one question: is the version in
`package.json` already on the registry? After any release the answer is yes, and
stays yes until someone bumps. So from the moment 1.3.0 was published, every
pull request against this repository fails that check until the version moves.

The docs-only PR opened today demonstrates it: it changes no shippable file at
all and is still red, because the guard reads the version string rather than
whether the branch changes anything shippable. Both of today's PRs are red on
it, and so would be a README typo fix.

The intent behind it is sound and should be kept - `publish` carries
`needs: [build, version-guard]`, which is the one place a check can hold
something up while `required_status_checks` is null. The misfire is the separate
PR-visible job, not the gate on the release path. A permanently red check is one
people stop reading, and this repository has no required checks, so the only
thing that check currently does is train a reader to ignore red.

Options, none taken here because they are release policy:

  1. Bump `version` in whichever PR lands a shippable change. Matches the
     original intent most closely; awkward with two PRs open at once, since both
     would claim the same number and collide.
  2. Fail on the pull request only when the branch touches shippable source
     (`src/`, `package.json`), so docs and CI PRs stay green while a code change
     still has to move the number.
  3. Keep the guard only where it is already load-bearing - `needs:` on
     `publish` - and drop the separate PR job, accepting that the version moves
     at release time rather than at merge time.

Open and Emre's:

- **c12c6e5 has a German subject line on a public repository** ("Node 18 und 20
  sind end of life, und der publish-Job lief auf einem davon"). The PR title and
  body were corrected to English after the merge; the commit was not, and it is
  the first thing a stranger sees in `git log` and on the commits page. It is
  already on `main`, so correcting it means rewriting published history - a
  force-push that changes that SHA and every SHA after it, breaking anyone's
  clone and any link that names the old hash. Not done here, and the
  recommendation is to leave it and keep future subjects in English rather than
  to rewrite. Several older entries in this file and in LOG.md are German too;
  that is the same question at a larger scale and is worth one deliberate
  decision rather than a per-commit one.
- Whether the reference-hardware tables in `README.md` and `BENCHMARKS.md` stay.
  Recommendation above: keep them.
- `required_status_checks` on `main` is still `null`, unchanged from the earlier
  measurement today, so CI, Scan and AAHP Verify remain advisory on both of
  today's PRs. Tag protection is likewise still absent.
## 2026-08-21 - The handoff docs named the workstation, and the benchmark tables still do

`.ai/handoff/LOG.md` and `.claude/commands/build.md` carried the exact CPU and
GPU model of the machine this is worked from. Both are internal documents that
happen to sit on a public repository, and in neither does the part number serve
a reader: "use the dev PC" is the same instruction as "use the <model> dev PC".
Removed. The maintainer's name and email stay, which was already decided.

REMOVING IT DOES NOT MAKE THE HARDWARE PRIVATE, and this entry exists mostly to
say so. `README.md` carries a Reference Hardware table with the same CPU and
GPU, and `BENCHMARKS.md` carries the same table plus the model in roughly ten
result headings. That is deliberate: they are the specs the published benchmark
numbers were measured on, and a benchmark that does not say what it ran on is
not a benchmark. So the hardware remains publicly readable here on purpose, and
anyone reading the handoff edit as "that detail is no longer public" would be
wrong. Recommendation is to keep the benchmark tables as they are; it is a
maintainer decision, not a cleanup, and it stays open.

THE LOCAL DRIFT GATE COMPARES A PUSHED BRANCH AGAINST ITSELF, so it passed
locally and then failed on the pull request. This is worth knowing before it
wastes someone's afternoon.

`verify-handoff.sh` picks its base for Layer 2 as the branch's UPSTREAM
tracking ref (`@{u}`), falling back to `origin/main` only when there is none.
Once a branch has been pushed with `-u`, `@{u}` is that branch's own remote
head, so `@{u}...HEAD` shows only the commits made since the last push - not
the change set the pull request actually proposes. Measured on this branch:

    git diff --name-only @{u}...HEAD        -> .ai/handoff/ only
    git diff --name-only origin/main...HEAD -> also .claude/commands/build.md

CI has no such upstream and diffs against the base branch, so it saw
`.claude/commands/build.md` and correctly demanded a STATUS.md update. Both of
the local runs here were vacuous, for two different reasons: the first ran
before the edits were staged or committed (nothing in the diff at all), the
second ran after the push (base had moved to the branch itself).

So a green local `aahp verify` on a pushed branch is close to no evidence about
Layer 2. To reproduce what CI will decide, compare against the base explicitly
rather than trusting the default. Layers 1, 3 and 4 are unaffected - they do not
depend on a diff range - and Layer 2 counts everything outside `.ai/handoff/` as
source, `.claude/` included.

## 2026-08-21 - Node 18 and 20 are end of life, and the publish job ran on one of them

The v1.3.0 release failed today. Not on the package, and not on the new
version-guard, which correctly reported 1.3.0 as still free, but on the runtime:

    npm error code EBADENGINE
    npm error notsup Required: {"node":"^22.22.2 || ^24.15.0 || >=26.0.0"}
    npm error notsup Actual:   {"npm":"10.8.2","node":"v20.20.2"}

The publish job fetches `npm@latest` for OIDC trusted publishing, and npm 12
dropped Node 20. The step whose whole purpose is to make publishing possible is
therefore the step refusing it, on EVERY release attempt since npm 12. Nobody
saw it, because nothing had been published since April.

At the same time the matrix ran on [18, 20, 22] while `engines.node` publicly
promised `>=18`, a runtime without security patches for 16 months.

Changed: matrix -> [22, 24], three individual pins '20' -> '24', engines '>=22'.

**The mutation proof found a defect in its own assertion.** The first version of
the empty-matrix guard read the GLOBAL pin list, so emptying the matrix left it
green: the individual pins of the other jobs kept that list from ever being
empty, and multi-runtime coverage would have disappeared silently. `matrixPins()`
now reads `strategy.matrix` and nothing else. Four mutations, all proved red.

Open, and Emre's: tag protection is still absent (`tags/protection` -> 404,
rulesets empty), so a v-tag can still point at any commit.

> Note (2026-08-21, claude-opus-5): THE RELEASE PATH WAS GUARDED AND UNWALKABLE. `package.json` last moved its version on 2026-03-31 (b6d4c17, the initial skeleton). `1.2.4` was published on 2026-04-15. `main` then took 35 commits without the number changing, two of them security fixes: the command-injection remediation of 2026-06-28 (fb7b76a, 9 findings) and the `--channel` escaping fix of 2026-08-19 (ef82cb5, PR 56). Both are correct, both are merged, and neither could ever be installed by anyone. npm refuses a duplicate version, and `v1.2.4` already exists and points at the April tree, so re-tagging is not a way out either. An April tarball cannot contain a June fix, so for four months every `npm install` of the estate's only public package served the vulnerable code while the tree said it was fixed. Bumped to 1.3.0, in `package.json` and in both root entries of `package-lock.json`.
>
> MINOR, NOT PATCH, AND THE REASON IS IN THE DIFF RATHER THAN IN THE SEVERITY. Reading what the 35 commits actually contain: `src/validate.ts` is a new 165-line module exporting eight validators plus `shellQuote`, which is additive public surface that ships in `dist`; `src/index.ts` stops reporting `0.1.0` in the MCP initialize handshake and reports the real version, so a client sees a different string; and every hardened call site now REFUSES input that 1.2.4 accepted and passed to a remote shell. That last one is the load-bearing part. A patch release says "nothing you can observe has changed", and that is false here - a caller passing a channel or a cron id containing shell metacharacters gets an error where they previously got execution. It is not a major either: nothing documented was withdrawn, and the only inputs that stop working are the ones the option was never meant to carry. Minor is the honest signal, and it is the one that tells a consumer to read before upgrading.
>
> THE CHECK IS ON THE CONSEQUENCE, NOT THE CONFIGURATION. `scripts/check-version-unpublished.mjs` asks the public registry whether the version in `package.json` has already been issued, and exits 1 if it has. The registry is the only authority on that question: a git tag can be missing, moved, or created for a version that was never published; a CHANGELOG heading is prose; `dist-tags.latest` moves under `npm dist-tag` with no publish at all. None of them is what npm consults when it accepts or rejects a tarball. Presence is decided by an exact key lookup in the returned `versions` map, and a key whose value is null still counts as spent, because npm never re-issues a number even after an unpublish.
>
> IT FAILS CLOSED, WHICH IS THE HALF THAT DOES THE WORK. Exit 2, "cannot determine", covers a refused connection, a request timeout, a 5xx, a body that is not JSON, a package.json that is missing or says nothing, an argument the script does not understand, and - the subtle one - a 200 carrying no `versions` map. That last shape is what a proxy error page, a captive portal and a truncated response all arrive as, and `const versions = doc.versions ?? {}` is one line, reads as defensive, and turns every one of them into "nothing is published, ship it". An unreachable registry is not a neutral moment; it is precisely the moment a bad publish slips past a check that shrugged.
>
> WIRED SO IT CAN ACTUALLY HOLD SOMETHING UP. A new `version-guard` job in ci.yml, separate from `build` and outside the release path it protects - a gate living inside the publish job is only consulted once someone has pushed a v-tag, which is months after the moment the version should have moved. It has to fire on the pull request that lands the change. `publish` now carries `needs: [build, version-guard]`, because with `required_status_checks` still absent on this repository (measured 2026-08-21, unchanged) `needs:` is the only place a check can be made consequential rather than advisory.
>
> `tests/security/version-guard.test.ts` (20 assertions, new; wired into `npm test`) EXECUTES the script as a real child process against a real local HTTP server, one per scenario, and asserts EXACT exit statuses rather than "non-zero" - a script that has been deleted or renamed exits 1 from node itself, and 1 is this script's already-published verdict, so accepting any non-zero would let a missing gate impersonate a working one on eight rows. Both directions everywhere: it refuses a published version AND accepts an unpublished one, so neither a gate that always fires nor one that cannot fire survives. The row that distinguishes an exact key lookup from `body.includes(v)` is 1.2.4 against a registry serving 1.2.40, in both orderings, with the exact match still firing - a substring comparison passes every other assertion in the file and then blocks a legitimate release, and a false positive is what gets a working check deleted rather than fixed. The workflow side enumerates `continue-on-error` and `if:` over the guard job AND every one of its steps, `paths`/`paths-ignore` over every trigger of the workflow the guard lives in, `|| true`-shaped exit-status swallowing in the step's own script, and `--registry` on the command line, which is the quiet way to point the gate at something that decides nothing. Anything it cannot classify throws rather than passing.
>
> Mutation-proved one at a time, fix committed first so `git checkout --` could not eat it, tree restored and re-verified between each. Recorded as measured, because two of these landed narrower than expected and the narrowness is the point. (1) Defaulting the `versions` map to `{}` when the registry answers 200 without one - `document?.versions ?? {}`, the one-line "defensive" edit - turned exactly ONE row red, `gives no verdict on a 200 that carries no versions map`, with the script cheerfully reporting `exit 0 ... 0 version(s) published; this tree is releasable` off a body containing no versions at all. Every other row stayed green, including the four other fail-closed rows, which is why that scenario has to be its own assertion rather than being assumed to ride along with the network-failure ones. (2) Softening the exact key lookup to a substring test turned exactly ONE row red, `tells 1.2.4 from 1.2.40, in both directions`; rows 1 and 3 stayed green because a substring test still fires on a true match, so no assertion about firing can catch this and only the 1.2.40 row can. (3) Returning `EXIT_OK` instead of `EXIT_ALREADY_PUBLISHED` turned THREE rows red at once - 1, 3 and 5, every row that needs the guard to actually fire - which is the gate-that-cannot-fire signature and is what tells this mutation apart from the two above. (4) `continue-on-error: true` on the version-guard job turned `carries no continue-on-error and no if:` red, naming `ci.yml:version-guard`. (5) `paths: ['package.json']` on the workflow's `pull_request` trigger turned `runs on pull requests, unfiltered by path` red - and that filter is the one that would have made this very gate silent for all 35 commits at issue, since not one of them touched package.json. Restored tree: `npm test` 171 pass 0 fail in 5.9s (151 existing + 20 new), `npm run typecheck` clean, `aahp verify --level ci` passes with Layer 3 the tolerated WARN. And the gate was proved live before any mutation: run unchanged against the real registry with `main`'s package.json it exits 1, reporting 1.2.4 already published with 32 versions; after the bump to 1.3.0 it exits 0.
>
> ALSO CORRECTED. `CHANGELOG.md` did not exist, and the GitHub Release step announced every release with "See the README changelog" while the README had no changelog section either - so the register a public reader was pointed at had never existed. Created, starting at 1.3.0, with the upgrade advice a 1.2.4 user needs and the release-integrity story stated plainly; the release note and the README install section now point at it, and it is added to `files` so it ships in the tarball. The security entry describes the hardening at the level of what changed and why to upgrade, deliberately without restating the parameter and payload shape.
>
> AND CREATING IT WOKE A THIRD GATE THAT HAD NEVER BEEN ABLE TO FIRE HERE. `aahp doctor` carries a `changelog-format` gate, and `check-changelog-format.mjs` opens with "a repo with no CHANGELOG.md is a clean skip (exit 0)". So for this repository's whole life that gate reported clean about an artifact that did not exist. The moment the file appeared it went FAIL on CI, and its rule R6 is: the topmost release heading must equal `package.json`'s version. That is a second, independent lever on precisely today's defect - it forces the changelog and the version to move together - and it had been dormant for the entire four months in which the version did not move. It is the same shape as the finding this whole change is about, one level up: not a check that was wrong, a check whose subject was absent, reporting the absence as health. Worth carrying to the other repositories in the fleet, since a skip-when-missing gate reads as PASS in any dashboard that counts failures. Conformance is now 6 gates, no failures, with `version-sync` still SKIP for want of `versionSites` in `aahp.config.json` - which is the next lever of the same kind and is left for the owner to aim.
>
> RAISED, NOT CHANGED, AND IT NEEDS A DECISION BEFORE THE RELEASE. `.ai/handoff/STATUS.md` on this public default branch describes the vulnerable function, the exact parameter and the payload shape, in the 2026-08-19 note. The fix for it is unpublished, so the exploit is public and the remedy is not, and has been for two days. Trimming it is a judgement call about a handoff record and is not made unilaterally here; the cheapest resolution is to publish 1.3.0, after which the note is history rather than a live recipe. Note also that the same detail is in the merged commit subject of ef82cb5 and in the body of PR 56, so redacting this file alone would not close it.
>
> WHAT THIS DOES NOT FIX. The check nags rather than blocks: once 1.3.0 is released, `main` carries a published number again and `version-guard` goes red on the next pull request until someone bumps. That is the intended reading - at that moment `main` genuinely cannot ship anything - but it means the version bump has to travel with the change rather than being remembered at release time, which is a workflow the maintainer should agree to rather than discover. And nothing here makes anyone look: `required_status_checks` is still absent on `main`, so CI, Scan, AAHP Verify and now version-guard are all advisory, which is the same repository setting already open from the last three changes.

> Note (2026-08-21, claude-opus-5): Documented the residual release-path exposure that #59 could not close from a file, and closed two gaps in the guard itself that were found while measuring it. SECURITY.md gains a `## Release integrity` section: how a release happens, the four properties the workflow now enforces, and - stated plainly, because this is the estate's only public repository and its only public publisher - that none of them prove the commit under the tag was ever reviewed. Measured 2026-08-21: no ruleset or tag protection restricting who may create `refs/tags/v*`, `environments` total_count 0, and `main` carrying branch protection with `required_status_checks` absent. The two candidate controls are named there with their trade-off: a tag ruleset is one setting and closes today's gap but guards only the TRIGGER, so a future workflow publishing on something other than a v-tag is outside it; an `npm-publish` environment with a required reviewer, named in the registry's trusted-publisher configuration, survives a later edit to the workflow because a job that drops the environment mints an OIDC token the registry refuses - it fails closed. Recommendation to the owner: the environment, with the tag ruleset as the one-minute mitigation in the meantime. Neither is a change any file here can make.
>
> THE GUARD READ ONE FILENAME. `tests/security/publish-guard.test.ts` located the release path inside `.github/workflows/ci.yml` by name. That is not where this package was published from: all 32 versions on the registry came from a separate `.github/workflows/publish.yml`, which existed from the first release until it was deleted on 2026-06-27 in the move to OIDC trusted publishing. Restoring that file verbatim into the tree turns SIX of the eight assertions red - it had no `if:`, an `actions/checkout@v4` with no `ref:`, and no build job to depend on - and against the old guard it was invisible, because it was not called ci.yml. The scan is now over every file in the directory, and jobs are labelled `file:job` so a failure names which one. `needs:` candidates are scoped to the publisher's own file, since `needs:` cannot reach across workflows; that is what makes a second file fail rather than borrow ci.yml's build.
>
> THE TAG/VERSION CHECK WAS LOST IN THE MIGRATION. The deleted publish.yml refused to publish when `package.json` disagreed with the tag name. ci.yml did not bring that across, so today tagging `v1.3.0` on a tree whose package.json still reads `1.2.5` publishes 1.2.5 while the GitHub Release announces v1.3.0 - registry, tag and release naming three different things. Restored as a step in the publish job, and the new assertion EXECUTES that step rather than grepping for it: the script is run in a throwaway directory holding one package.json, against an agreeing tag and three disagreeing ones. The fourth scenario is a tag that is a PREFIX of the shipped version (`v1.2` against 1.2.5), which is what tells an equality test apart from a `startsWith` or `contains` one - the prefix-tolerant mutation passes the other three columns and only that row catches it. Selection of which steps to execute is a heuristic and is allowed to be, because selection cannot manufacture a pass; anything invoking a package manager is refused outright and reported as refused, so `npm ci` and `npm install -g npm@latest` are never run.
>
> Mutation-proved one at a time, fix committed first, tree restored between each: deleting the check step turned assertion 8 red with an empty script list; neutering its comparison turned it red reporting `agreeing:0, ahead:0, behind:0, prefix:0` - the guard-that-cannot-fire signature, visible in the diagnostic; making the comparison prefix-tolerant turned it red on `prefix:0` alone with the other three columns still correct; and restoring publish.yml turned assertions 2 through 7 red naming `publish.yml:publish` in each. Restored tree: `npm test` 151 pass 0 fail in 5.8s, `npm run typecheck` clean.
>
> ALSO CORRECTED, and it is the more urgent of the two findings. This repository is public and indexed, and sixteen places across six tracked files named a PRIVATE issue tracker by repository and issue number, plus two private sibling repositories by name and internal decision-register identifiers. A reader arriving at `.github/dependabot.yml` or either security test was told the missing half was tracked at a URL they cannot open. All sixteen are rewritten to say the same thing without the private reference, pointing at SECURITY.md where the same class of gap is now described in public. Verified by a whole-tree grep returning empty, and every workflow and dependabot config re-parsed afterwards. The same reference is still in the merged body of PR #59 and in this file's own earlier notes above; a PR body is public content and editing it is the owner's call, so it is raised rather than changed.
>
> NOT FIXED, AND IT IS A LIVE RISK FOR THE NEXT RELEASE: not one of the 32 published versions carries a provenance attestation. All of them predate the 2026-06-27 migration and came from the token-based publish.yml; `dist.attestations` is null for every version on the registry and `dist.signatures` is present for every one. The OIDC trusted-publishing path in ci.yml has therefore never actually published anything - the last release was 2026-04-15, four months before the workflow that would publish it was written. The next tag pushed will be that path's first exercise, and if trusted publishing is not configured for this package on the registry it will fail there. SECURITY.md says this in as many words rather than implying a provenance that no consumer can currently verify.

> Note (2026-08-21, claude-opus-5): Closed the publish path. `.github/workflows/ci.yml` gated the npm publish on `(startsWith(github.ref, 'refs/tags/v') && contains(github.ref, '.')) || github.event_name == 'workflow_dispatch'` and checked out with no `ref:`. `workflow_dispatch:` parses to null, so the Run-workflow dialog accepts ANY branch; the OR-branch satisfied the condition on its own, and a checkout with no `ref:` resolves `github.ref` - the dispatched branch. One dialog away from publishing an unreviewed branch tree to the public registry as `@elvatis_com/elvatis-mcp`, with provenance attesting it, in the estate's only public repository and its only public-registry publisher. Nothing else on that path holds it: measured 2026-08-21, `.private` is false, `environments` total_count is 0, `rulesets` is empty, tag protection is 404, and `branches/main/protection` returns 200 with `required_status_checks` ABSENT. Same shape as the deployment defect that got Landings PR 55 rejected - the publish was not bound to a reviewed commit.
>
> DELETING THE OR-BRANCH ALONE WOULD NOT HAVE FIXED IT, and that is the part worth carrying forward. The Run-workflow dropdown offers TAGS as well as branches, so with the clause merely removed, dispatching on `v9.9.9` still leaves `github.ref` at `refs/tags/v9.9.9`, `startsWith` still passes, and the manual path is open again - now through a ref anyone with push access can create and move, because tag protection is 404. The condition therefore asserts the EVENT, which a dialog cannot forge: `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && contains(github.ref, '.')`. `workflow_dispatch` stays among the `on:` triggers so CI can still be run by hand on a branch; it just no longer reaches `publish`. Both release-path jobs got the same condition and `ref: ${{ github.sha }}` on their checkout - `publish` (`id-token: write`, mints the provenance) and `release` (`contents: write`, cuts the GitHub Release) - binding the published tree to the commit `build` verified rather than to a ref that can move between the two jobs.
>
> `tests/security/publish-guard.test.ts` (7 assertions, new) EVALUATES the condition instead of pattern-matching it: the `if:` is parsed into a small GitHub-expression interpreter and run against eight trigger scenarios, so any rewrite that lets a dispatch through goes red however it is spelled, reordered or reformatted. This was a deliberate choice against a regex - four regex gates written across this estate on 2026-08-21 were all defeated without deleting a line any of them looked for. The interpreter THROWS on syntax or context it does not model, so an `if:` rewritten in terms of `github.actor` or `github.event.*` fails loudly and demands a human extend it, rather than quietly evaluating to the convenient answer. Release-path jobs are found by CAPABILITY (`npm publish`, `id-token: write`, `contents: write`), not by name, so moving the publish into a fresh job does not slip the guard. One assertion is pure LIVENESS - a pushed v-tag must still reach both jobs - because a guard that cannot fire is the 2026-08-18 failure mode and all seven negative scenarios stay green under it.
>
> Mutation-proved one at a time, fix committed first so `git checkout --` could not eat it: restoring the OR-branch turned the scenario assertion red naming all three dispatch scenarios; dropping only `github.event_name == 'push'` turned it red naming exactly one, the tag-dropdown dispatch, which is what proves that clause load-bearing; deleting `ref: ${{ github.sha }}` turned the checkout assertion red; deleting `needs: build` turned the ordering assertion red; deleting the `if:` outright turned four red; rewriting it as `github.actor == 'elvatis' && github.event.release.published` turned the readability assertion red as designed; and tightening it to `github.ref == 'refs/tags/v'` turned ONLY the liveness assertion red. Restored tree is green: 150 tests pass locally (143 existing + 7).
>
> ALSO CORRECTED, and it is the trap the protocol warns about: `MANIFEST.json` arrived on main from #58 (be723a8, merged earlier today) with `project` set to `elvatis-mcp-scg-pin` - the previous agent's worktree DIRECTORY name, which `aahp manifest` writes into that field from wherever it happens to run. It read `elvatis-mcp` at e23280a and every commit before. Set back to `elvatis-mcp` and re-read after regenerating, which is the only way to catch it.
>
> WHAT THIS DOES NOT FIX, and nothing in this repository can. The commit under a tag is still unreviewed: `main` has zero required status checks while `enforce_admins` is `true`, so admin enforcement currently enforces nothing; there are no environments to hold a reviewer; and with no tag protection any push-capable actor can point `v9.9.9` at any commit, which IS a pushed v-tag and therefore passes this guard. Four repository settings, unreachable from any file here, all open with the maintainer. This change closes the half that lives in the workflow: no path that is not a pushed v-tag, and no tree but the tagged commit's.

> Note (2026-08-21, claude-opus-5): Moved the supply-chain-guard pin from `be1d718b` (v5.2.37, 2026-06-27) to `fc8fb8f4989cd1960f48833fbaa1f726df897bbc` (v5.28.1), and built the bump lane that the last pin lacked. This repository was in no inventory of 2026-08-21 and was the estate's worst-drifted consumer: roughly 100 releases behind, with a green `Scan` check on every one of those 55 days, because a scanner pinned to an old release still runs - it just runs on that release's malware indicator set. The SHA was verified through both dereferences of the ANNOTATED tag (`releases/latest` -> `v5.28.1`, draft=false, target=main; `git/ref/tags/v5.28.1` -> tag object `0a6f9b34`; `git/tags/0a6f9b34` -> commit `fc8fb8f4`); asking `git/commits/0a6f9b34` returns a 404 that reads like a missing commit and is not one. `@v5` was not restored and must not be: there is no `v5` TAG in that repository, only the BRANCH `refs/heads/v5`, and the owner decided on 2026-08-21 that the moving ref is to be disabled. `.github/dependabot.yml` now carries the github-actions ecosystem on `interval: daily` with the scanner in a dedicated group of one, the catch-all group excluding it, and no `ignore` entry naming it - that last one is not hypothetical, a sibling repository was frozen eight releases behind for five days by exactly a pin-plus-ignore pair while every other signal stayed green. `tests/security/action-pin.test.ts` (8 assertions, new; `yaml` added as a devDependency so the config is PARSED, not grepped) turns red on each of those removals, mutation-proved one at a time: restoring `@v5`, dropping the `# vX.Y.Z` trailer, renaming the action, deleting the ecosystem block, reverting to `weekly`, merging the scanner into the catch-all group, adding `ignore: homeofe/*`, and removing the dependabot exemption from aahp-verify.yml each turned exactly the matching named subtest red, and the restored tree is green again. `npm test` now runs that file too, so the assertions can actually fire in CI; 143 tests pass locally (135 existing + 8). Also added `timeout-minutes: 10` to the scan job, mandatory after the 2026-07-21 runner-hang, and `min-severity: info` so a report that says "PARTIAL - coverage incomplete" also lists the info-severity finding that explains why.
> 
> AND THE TEST RUNNER ITSELF WAS THE SAME BUG ONE LEVEL DOWN. `npm test` ran `npx tsx`, and `tsx` was in NO dependency list and NO lockfile entry. So every CI run installed the locked ~99-package tree with `npm ci --ignore-scripts` and then fetched `tsx@latest` plus `esbuild` from the registry, unpinned, unreproducible, and invisible to the supply-chain scan - which reads `package-lock.json`. All 143 tests, including the new pin guard, executed inside a transpiler downloaded fresh from the network moments earlier, in the one repository whose gate is that nothing gating the supply chain may come from a moving pointer. Fixed by pinning `tsx` to `4.23.12` as an exact devDependency (the `@elvatis_com/aahp` idiom for gate-adjacent tooling) and switching both test scripts to `npx --no-install`, so a missing local copy now fails loudly instead of silently reaching for the registry. The lockfile grows 100 -> 129 entries: tsx, esbuild, and 26 optional platform stubs of which exactly one installs per platform (`npm install --ignore-scripts` reported "added 3 packages", and `@esbuild/linux-x64` is recorded for the Ubuntu runners). Proved both ways: with the local copy `npm test` exits 0 with 143 passing, and with `node_modules/tsx` moved aside it exits 1 with MODULE_NOT_FOUND rather than downloading a replacement.
> 
> WHAT THIS DOES NOT FIX, and nothing in this repository can. Dependabot already worked here: eight correct bump pull requests on eight consecutive Saturdays (#43, #45, #49, #52, #53, #54, #55), none ever merged, each closed by dependabot[bot] as superseded by the next. The missing fourth part is a way for a bump to LAND, and both levers are repository settings: `allow_auto_merge` is `false` here (measured 2026-08-21), and `main` has branch protection with `required_status_checks: null` - so no check on this repository is required and CI, Scan and AAHP Verify are all advisory today. `dependabot-auto-merge.yml` was deliberately NOT added, because with auto-merge off it could only fail loudly on every bump. Both are open with the maintainer with a recommendation. Two false claims were also removed from the aahp-verify.yml header: it said CodeQL gates dependabot PRs (code scanning is `not-configured`, zero analyses) and that Actions is off org-wide (CI, Scan and AAHP Verify all completed successfully on 2026-08-19).

> Note (2026-08-19, claude-opus-5): Cleared all 15 open Dependabot alerts (4 high, 9 moderate, 2 low). Every one of them is transitive under `@modelcontextprotocol/sdk`: `package.json` declares three runtime dependencies and none of the flagged packages is among them. `package.json` is therefore unchanged. Every parent range already permitted the patched version, so refreshing `package-lock.json` was sufficient and no `overrides` block was needed, unlike the sibling repos that do carry one. Resolved: `fast-uri` 3.1.2 to 3.1.5 (3 highs), `ip-address` 10.2.0 to 10.5.0 (1 high, 2 moderate), `hono` 4.12.25 to 4.13.3 (6 moderate, 1 low), `@hono/node-server` 1.19.14 to 2.1.1 (1 moderate), `body-parser` 2.2.2 to 2.3.0 (1 low). The `@hono/node-server` major is the SDK's own supported matrix rather than a forced upgrade: 1.30.0 declares `^1.19.9 || ^2.0.5`, and 2.x's `hono@^4` peer requirement is satisfied. Real exposure is lower than the counts suggest, and this is recorded so a future reader does not re-derive it. Only `fast-uri` loads on the default stdio path, reached by `ajv` through the SDK's schema validator, where it resolves first-party tool schemas rather than untrusted URLs, so the host-confusion advisories do not have an attacker-controlled input here. `hono` and `@hono/node-server` load only under `MCP_TRANSPORT=http`, and the flagged middleware (CORS, language, JSX, proxy helper, serve-static) is never instantiated by this server. `express` and `express-rate-limit`, the parents of `body-parser` and `ip-address`, are imported only by the SDK's OAuth router modules, which this server never imports, so those four alerts sit on code that is never loaded. All were bumped anyway because the cost was a single lockfile refresh. Build passes and all 135 tests in `tests/unit.test.ts` pass. `npm run typecheck` reports `TS2688 estree`, which is an artifact of the build location and not of this change: TypeScript collects implicit type libraries from `node_modules/@types` in every parent directory, and a parent of the temporary build directory used here holds an `@types/estree` entry consisting of a `package.json` with no declaration files. The identical failure reproduces in that same location with the original lockfile restored, and the repository checkout itself typechecks clean, so the earlier note calling it identical on `main` holds only for builds run from such a location.

> Note (2026-08-19, claude-opus-5): Closed a command injection in `src/tools/cron-manage.ts`. `handleCronCreate` builds a shell string and hands it to `sshExec`; ten of its eleven user-controlled values go in as `'${escapeShell(x)}'` or through `validateScheduleValue`, and `--channel` went in raw. `channel` is declared `z.string().optional()`, so the three names in its description are documentation rather than a constraint, and a value such as `whatsapp; <command>` reached the remote host as the SSH user. `src/validate.ts` opens by stating the contract this broke: all values that reach a shell command, even via SSH, are validated there before use. Fixed in two layers, because either alone would be thinner than the rest of the file: a new `validateChannel()` following `validateContainerName`'s idiom (charset allow-list, no leading hyphen so a value cannot smuggle in another flag, length bound), plus `escapeShell` at the call site so it reads like its ten siblings. Deliberately an allow-list of the channel-identifier shape rather than a hard enum of the three documented names: openclaw may gain channels, and a rule that must be edited for each one gets widened under pressure. 13 tests added to `tests/unit.test.ts`, including the reported payload. Mutation-proved: neutralising only `validateChannel`'s guard turns the block red, restoring it turns it green. `npm run typecheck` reports an unrelated pre-existing `TS2688 estree` error, identical on unmodified `main`, so it is environmental and not from this change.

> Note (2026-07-25, claude-opus-4-8): Untracked `.scg-history/` and added it to `.gitignore`. It holds supply-chain-guard scanner state, not project content. The scanner was fixed upstream so the directory now writes a self-ignore when created.

> Note (2026-07-18, claude-opus-4-8): Adopted CLI-based AAHP conformance v3.8.0. Switched the gate driver from vendored bash scripts to the pinned @elvatis_com/aahp CLI (devDependencies, exact 3.8.0) and removed the package-provided scripts (_aahp-lib.sh, aahp-manifest.sh, lint-handoff.sh, verify-handoff.sh, install-hooks.sh, verify-hooks.sh, scripts/hooks/). Added GROUNDING.md, TRUST.md (with a Provenance column), WORKFLOW.md, LOG-ARCHIVE.md, .aiignore, and aahp.config.json (pinnedDep + forbidden em-dash). aahp-verify.yml now runs the CLI (npm ci + npx aahp verify/doctor), keeping the dependabot exemption. Relocated the non-canonical handoff-session-resume note to .ai/notes/ so the handoff set is clean. Kept repo-specific validate-pii-allowlist.py. doctor: 6 gates, no failures.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical AAHP gate scripts from homeofe/improvements (v3.5.0 fixes: aahp-manifest.sh --phase documentation + cross_repo_ref preservation, lint-handoff.sh SC2034), AAHP_HANDOFF_FILES preserved, and refreshed the local hook tooling (scripts/hooks/, install-hooks.sh, verify-hooks.sh). Fleet re-sync.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical Layer 3 tolerance fix from homeofe/improvements. verify-handoff.sh now downgrades a non-ancestor MANIFEST.last_session.commit from FAIL to WARN so a squash-merge or rebase-merge no longer trips AAHP Verify Layer 3 on main; Layers 1-2 still gate real staleness.

# elvatis-mcp: Current State of the Nation

> Last updated: 2026-06-29 by claude-opus-4-8 (community-health sweep)
> Commit: pending
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
>
> **Note (2026-06-27):** Product-state sections below predate this sweep (last functional update 2026-03-31). This session is an AAHP gate-onboarding pass only (badge + manifest commit-pointer refresh); no source code changed. See the gate-log footer for the dated trail.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `build` | ✅ Passing (prev session) | 0.85s, 148 MB, 30k instantiations |
| `typecheck` | ⏳ Needs re-run | New files added this session (ssh.ts, openclaw.ts) |
| `lint` | - | Not configured yet |
| `integration test` | ✅ Passing (prev session) | Claude Desktop smoke test passed (2026-03-31) |

---

## Architecture Change (2026-03-31)

**Problem:** cron tools used REST (`/api/cron/jobs`) - OpenClaw has no REST API, only WebSocket. Memory tools read from local Windows filesystem - actual memory files are on the OpenClaw server.

**Solution:** SSH-based transport layer.

- New `src/ssh.ts`: SSH exec helper using `child_process.spawn('ssh', ...)`. No extra npm deps, uses built-in OpenSSH (available on Windows 10+, macOS, Linux).
- `src/tools/cron.ts`: Rewritten to read `~/.openclaw/cron/jobs.json` via SSH.
- `src/tools/memory.ts`: Rewritten to read/write `~/.openclaw/workspace/memory/` via SSH. Uses base64 encoding for safe writes.
- New `src/tools/openclaw.ts`: Sub-agent orchestration - SSH-executes `openclaw agents send --message "<prompt>" --local --timeout <seconds>` and returns the response synchronously. Also: `openclaw_status`, `openclaw_plugins`.
- `src/config.ts`: All IPs/hosts removed from hardcoded defaults. `SSH_HOST` and `HA_URL` are now required env vars. Dotenv loaded at startup.
- New `.env.example`: Template for all required env vars.

**Env vars required (must be set in .env or claude_desktop_config.json):**
- `HA_URL`: Home Assistant URL
- `SSH_HOST`: OpenClaw server IP/hostname
- Optional (have defaults): `SSH_PORT`, `SSH_USER`, `SSH_KEY_PATH`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_CLI_CMD`

---

## TS2589 Fix (resolved 2026-03-31)

**Solution:** `registerTool()` wrapper in `index.ts` casts `server` to `any` before calling `.tool()`. Build: 0.85s, 148 MB, 30k instantiations.

**Rule:** Never call `server.tool()` directly. Always use `registerTool()`.

---

## Components

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server (stdio) | ✅ Working | Claude Desktop tested 2026-03-31 |
| MCP Server (HTTP) | ✅ Skeleton | StreamableHTTPServerTransport |
| Config loader | ✅ Done | All secrets via env vars, dotenv support |
| SSH helper | ✅ Done | src/ssh.ts, child_process.spawn, no extra deps |
| Home tools (home.ts) | ✅ Working | 6 tools, HA REST API |
| Memory tools (memory.ts) | ✅ SSH-based | Reads/writes OpenClaw server files |
| Cron tools (cron.ts) | ✅ SSH-based | Reads ~/.openclaw/cron/jobs.json |
| OpenClaw tools (openclaw.ts) | ✅ New | openclaw_run, openclaw_status, openclaw_plugins |
| Trading tools | ⏳ Not started | T-005 |
| Camera tools | ⏳ Not started | T-006 |
| GitHub Actions CI | ⏳ Not started | T-004 |

---

## Current Version: 0.1.0 (unreleased)

| Platform | Status |
|---|---|
| GitHub (elvatis/elvatis-mcp) | ✅ Private repo, main branch |
| npm (@elvatis_com/elvatis-mcp) | ⏳ Not published |

---

## openclaw-cli-bridge-elvatis (Server Issue)

Plugin on the OpenClaw server crashes with `Cannot find module 'openclaw/plugin-sdk'`.
This is a server-side npm dependency issue, not an elvatis-mcp issue.

**To fix (SSH to server):**
```bash
# Find the plugin directory
find ~/.openclaw -name "package.json" | xargs grep -l "cli-bridge" 2>/dev/null
# cd into it and run:
npm install
# or check if the import path is wrong in the plugin's source
```

---

## Architecture

```
Claude Desktop / Cursor / Windsurf
  └─ MCP Protocol (stdio or HTTP)
       └─ elvatis-mcp server (Windows/Linux)
            ├─ home tools      ─────────────────────► Home Assistant REST API
            ├─ memory tools    ──► SSH exec ────────► ~/.openclaw/workspace/memory/*.md
            ├─ cron tools      ──► SSH exec ────────► ~/.openclaw/cron/jobs.json
            └─ openclaw tools  ──► SSH exec ────────► openclaw CLI (all plugins)
                                                            ├─ trading plugin
                                                            ├─ home plugin
                                                            ├─ custom workflows
                                                            └─ LLM backends
```

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, MCP server + tool registration |
| `src/config.ts` | Env var config (all secrets external) |
| `src/ssh.ts` | SSH exec helper (child_process.spawn) |
| `src/tools/home.ts` | Home Assistant tools (REST) |
| `src/tools/memory.ts` | Memory read/write/search (SSH) |
| `src/tools/cron.ts` | OpenClaw cron management (SSH) |
| `src/tools/openclaw.ts` | Sub-agent orchestration + status (SSH) |
| `.env.example` | Template - copy to .env and fill values |

<!-- aahp-gate -->
_AAHP verify gate: v3.0.2 synced 2026-06-20._

> 2026-06-21 install-hooks.sh: Windows drive-letter path fix propagated from AAHP.

> 2026-06-21 ci: add supply-chain-guard v5.2.35 Action workflow (fail-on critical).

> 2026-06-21 ci(aahp): fix unquoted next_task_id + lint-handoff noreply@ PII exclusion.

> 2026-06-27 ci: migrate npm publish to OIDC trusted publishing (publish + release jobs in ci.yml, semver-tag triggered, no NPM_TOKEN); removed old token-based publish.yml.

> 2026-06-27 ci: re-pin supply-chain-guard Action to v5.2.37 (be1d718b17cc38e4bce7fa48579b7112e557943b) and enable Dependabot github-actions weekly updates.

> 2026-06-27 aahp: onboard full AAHP gate. Added the AAHP Verify badge to README and regenerated MANIFEST so the commit-pointer tracks HEAD. Scripts and the aahp-verify workflow were already present and passing, so they were left intact (kept the repo's locally-hardened self-contained PII lint rather than swapping in AAHP's allowlist-file variant).

> 2026-06-28 security: fix 9 command-injection and secrets findings. New src/validate.ts provides allowlist validators (validateContainerName, validateServiceName, validateAgentName, validateScheduleValue, validateCronId) and shellQuote helper. All user-controlled values reaching SSH shell strings now go through a strict allowlist regex that rejects shell metacharacters, leading hyphens, and path traversal before use. sshReadFile/sshAppendFile in ssh.ts now single-quote paths. Hardcoded HA_TOKEN JWT removed from .env. 49 regression tests added covering all finding categories. Build and 99/99 tests pass.

> 2026-06-28 security (wave 3): fix 2 remaining command-injection sinks. Added validateDeployService() to src/validate.ts; openclaw-deploy.ts now calls it before interpolating service into SSH script paths; cron.ts handleCronRun now calls validateCronId() before interpolating job_id into the openclaw cron run command (mirrors existing pattern in cron-manage.ts). shellQuote applied to deployScriptDir as well. 23 new regression tests added. Build and 122/122 tests pass.

> 2026-06-29 by claude-opus-4-8 (community-health sweep): added
> .github/PULL_REQUEST_TEMPLATE.md and .github/ISSUE_TEMPLATE/{bug_report,feature_request}.md
> copied from canonical homeofe/aahp-swarm. No source code changed.

> 2026-06-30 by claude-opus-4-8 (verify): added reviewed expiring PII allowlist, rolled out from AAHP v3.2.0.

> 2026-06-30 ci: exempt Dependabot from the aahp-verify handoff gate (keep supply-chain-guard/codeql/build).

> Note (2026-07-19): Moved the AAHP conformance pin from 3.8.0 to 3.8.1 (picks up the v3.8.1 Windows/MSYS manifest-regen fix so tasks, next_task_id and cross_repo_ref survive regeneration). No runtime behavior change on Linux or CI. Handoff refreshed and MANIFEST regenerated.
