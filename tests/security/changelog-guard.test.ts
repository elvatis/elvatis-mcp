/**
 * The changelog gate that CONTRIBUTING.md and SECURITY.md describe actually
 * exists, runs, and can still say yes.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * Two documents asserted a control that had never been written. CONTRIBUTING.md
 * and SECURITY.md both said "the changelog gate requires the topmost dated
 * release heading to equal the version in package.json". Measured on `main` at
 * df66e15, the phrase "changelog gate" appeared exactly twice in 101 tracked
 * files, in those two sentences, and nothing under `scripts/`,
 * `.github/workflows/`, `tests/` or `aahp.config.json` read a heading out of
 * CHANGELOG.md at all. Two claims, zero implementations.
 *
 * The claim was not false about the tree. The topmost heading was
 * `## [1.3.1] - 2026-08-21` and package.json said `1.3.1`, so they agreed on
 * the day it was written. It was unenforced rather than violated, which is
 * exactly why it survived: an unenforced rule that happens to hold looks
 * identical to an enforced one until the day it stops holding, and on that day
 * nothing reports it.
 *
 * The SECURITY.md instance is the one that matters most, and it is not a
 * maintainer-facing problem. It sits in a PUBLIC `Release integrity` section
 * whose opening sentence invites the reader to check every claim in it against
 * `ci.yml` and says nothing depends on taking our word for it. A supply-chain
 * consumer who accepted that invitation would have found one of the listed
 * controls absent.
 *
 * WHY IMPLEMENT IT RATHER THAN DELETE THE SENTENCE
 * ---------------------------------------------------------------------------
 * Deleting it was the cheaper option and it was available. It was declined
 * because the property is worth having on its own terms: this repository spent
 * four months shipping nothing because a version number and the record of what
 * it contained were maintained by hand, separately, by someone remembering to.
 * The version half of that pair is now machine-checked by
 * `scripts/check-version-unpublished.mjs`; this is the other half.
 *
 * WHAT EACH GROUP OF ROWS BELOW GUARDS
 * ---------------------------------------------------------------------------
 *   - "agreement / disagreement": the gate's actual subject, both directions.
 *     A gate only ever demonstrated firing might fire on everything, and one
 *     only ever demonstrated silent might be incapable of firing.
 *   - "1.3.1 is not 1.3.10": the row that tells an exact comparison from
 *     `startsWith`, `includes` or a regex over the raw file. A substring
 *     comparison passes every other row here and then blocks a real release,
 *     which is the failure mode that gets a working gate deleted rather than
 *     fixed.
 *   - "topmost is structural": `## [Unreleased]` above a dated section. A
 *     script that scans downward for the first heading that parses reports
 *     agreement about a section nobody is editing. This is the single most
 *     likely way for this gate to end up green and meaningless.
 *   - "fenced code is not content": an example heading inside a ``` block,
 *     above the real one. Asserted in both directions, because a fence-blind
 *     parser fails one way and a parser that swallows the rest of the file
 *     after a fence fails the other.
 *   - the fail-closed rows: every one of them is a way for this script to exit
 *     0 while having learned nothing, and each is one line to introduce.
 *     `catch { return true }` reads as defensive and defeats the whole file.
 *   - the wiring rows: the script can be perfect and guard nothing. `aahp
 *     check` has been declared in `aahp.config.json` and invoked by no workflow
 *     for the entire life of this repository (issue #67), which is the same
 *     defect one layer down.
 *
 * THE SCRIPT IS EXECUTED, NOT READ
 * ---------------------------------------------------------------------------
 * Every scenario runs the real script as a real child process against real
 * fixture files and asserts its exact exit status. A regex over the source
 * would pass on a script that computes the right answer and then exits 0
 * regardless, which is the defeat four separate regex gates in this estate
 * suffered on 2026-08-21 without a line being deleted from any of them.
 *
 * Exit statuses are asserted EXACTLY, never as "non-zero". A script that has
 * been deleted or made unparseable exits 1 from node itself, and 1 is this
 * script's "they disagree" verdict; accepting any non-zero would let a missing
 * gate impersonate a working one on every negative row.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That the section under the heading is accurate, or complete, or that the date
 * is the right date. Nothing mechanical reads intent out of prose. It claims
 * that the number and its entry moved together.
 *
 * Nor that the gate BLOCKS a pull request. `required_status_checks` on this
 * repository's default branch is `null` (measured 2026-08-21, and SECURITY.md
 * says so in public), so on a pull request this check reports. The one place it
 * is load-bearing without a repository setting is `needs:` on the publish job,
 * and that is asserted below.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The gate itself. Renaming it without updating this constant fails loudly. */
const GUARD_SCRIPT_NAME = 'check-changelog-heading.mjs';
const GUARD_SCRIPT = join(REPO_ROOT, 'scripts', GUARD_SCRIPT_NAME);

/** The script's contract. Asserted exactly, never as "non-zero". */
const OK = 0;
const MISMATCH = 1;
const UNDETERMINED = 2;

// ---------------------------------------------------------------------------
// Running the real thing
// ---------------------------------------------------------------------------

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const temporary: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-guard-'));
  temporary.push(dir);
  return dir;
}

function runGuard(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, [GUARD_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * A throwaway pair of files, and the guard's verdict on them. `pkg` is written
 * to package.json verbatim; a plain string is shorthand for a package.json
 * declaring that version, which is what most rows want.
 */
function verdict(changelog: string | null, pkg: unknown = '1.3.1'): Run {
  const dir = scratch();
  const args: string[] = [];

  if (changelog !== null) {
    const path = join(dir, 'CHANGELOG.md');
    writeFileSync(path, changelog, 'utf8');
    args.push('--changelog', path);
  } else {
    args.push('--changelog', join(dir, 'absent-CHANGELOG.md'));
  }

  const packagePath = join(dir, 'package.json');
  const body = typeof pkg === 'string' ? { name: 'x', version: pkg } : pkg;
  writeFileSync(packagePath, JSON.stringify(body), 'utf8');
  args.push('--package', packagePath);

  return runGuard(args);
}

function why(run: Run): string {
  return `\nexit ${run.code}\nstdout: ${run.stdout.trim()}\nstderr: ${run.stderr.trim()}`;
}

/** A minimal well-formed changelog opening at `version`. */
function changelogFor(version: string, date = '2026-08-21'): string {
  return [
    '# Changelog',
    '',
    `## [${version}] - ${date}`,
    '',
    '### Changed',
    '',
    '- something',
    '',
    '## [1.0.0] - 2026-01-01',
    '',
    '- the first one',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Reading the workflows
// ---------------------------------------------------------------------------

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string | boolean;
  readonly 'continue-on-error'?: unknown;
}

interface Job {
  readonly name?: string;
  readonly if?: string | boolean;
  readonly needs?: string | string[];
  readonly steps?: Step[];
  readonly permissions?: Record<string, string> | string;
  readonly 'continue-on-error'?: unknown;
}

interface Workflow {
  readonly on?: unknown;
  readonly jobs?: Record<string, Job>;
}

interface NamedJob {
  readonly file: string;
  readonly id: string;
  readonly job: Job;
  readonly workflow: Workflow;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
}

function jobs(): NamedJob[] {
  const found: NamedJob[] = [];
  for (const file of workflowFiles()) {
    const workflow = (parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) ?? {}) as Workflow;
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
      found.push({ file, id, job, workflow });
    }
  }
  return found;
}

function label(named: NamedJob): string {
  return `${named.file}:${named.id}`;
}

/**
 * Steps that run the gate BY PATH.
 *
 * Deliberately not following `npm run` indirection, which the version guard's
 * equivalent does allow. The acceptance criterion for this gate is that it is
 * invoked somewhere editing `package.json` alone cannot disable, and an npm
 * script is a line in `package.json`. Recognising only the literal path is what
 * makes that criterion checkable.
 */
function guardSteps(job: Job): Step[] {
  return (job.steps ?? []).filter(
    (step) => typeof step.run === 'string' && step.run.includes(`scripts/${GUARD_SCRIPT_NAME}`),
  );
}

function guardJobs(): NamedJob[] {
  return jobs().filter((named) => guardSteps(named.job).length > 0);
}

const NPM_PUBLISH = /(^|[\s;&|(])npm\s+publish(\s|$)/m;

function publishesToRegistry(job: Job): boolean {
  return (job.steps ?? []).some((step) => typeof step.run === 'string' && NPM_PUBLISH.test(step.run));
}

function triggers(workflow: Workflow): Record<string, unknown> {
  const on = workflow.on ?? (workflow as unknown as Record<string, unknown>)['true'];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((name) => [String(name), null]));
  if (on !== null && typeof on === 'object') return on as Record<string, unknown>;
  throw new Error(
    'a workflow carrying the changelog gate has an `on:` block this file cannot read. Extend ' +
      'triggers() rather than dropping the assertion: an unreadable trigger is exactly where a ' +
      '`paths:` filter would hide.',
  );
}

function npmScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

// ---------------------------------------------------------------------------

describe('the changelog heading and the declared version have to move together', () => {
  it('accepts a topmost dated release heading that names the declared version', () => {
    // The liveness half. Every negative row below stays green against a gate
    // that refuses everything, and a gate that blocks every release is removed
    // rather than repaired.
    const run = verdict(changelogFor('1.3.1'), '1.3.1');
    assert.equal(run.code, OK, `the gate refused a changelog that agrees with package.json.${why(run)}`);
  });

  it('refuses a topmost heading naming a different version', () => {
    const run = verdict(changelogFor('1.3.0'), '1.3.1');
    assert.equal(
      run.code,
      MISMATCH,
      'the gate accepted a version whose changelog section was never opened. This is the whole ' +
        `defect: two public documents promised this comparison and nothing performed it.${why(run)}`,
    );
  });

  it('tells 1.3.1 from 1.3.10, in both directions', () => {
    // The row that distinguishes an exact comparison from `includes()`,
    // `startsWith()` or a regex over the raw file.
    const shorterAgainstLonger = verdict(changelogFor('1.3.10'), '1.3.1');
    assert.equal(
      shorterAgainstLonger.code,
      MISMATCH,
      `a section for 1.3.10 is not a section for 1.3.1.${why(shorterAgainstLonger)}`,
    );

    const longerAgainstShorter = verdict(changelogFor('1.3.1'), '1.3.10');
    assert.equal(
      longerAgainstShorter.code,
      MISMATCH,
      `a section for 1.3.1 is not a section for 1.3.10.${why(longerAgainstShorter)}`,
    );

    // ...and the exact match still passes, so the two rows above are not green
    // because the comparison stopped working altogether.
    const exact = verdict(changelogFor('1.3.10'), '1.3.10');
    assert.equal(exact.code, OK, `an exact match must still be accepted.${why(exact)}`);
  });

  it('accepts a prerelease version, since npm does', () => {
    const run = verdict(changelogFor('2.0.0-rc.1'), '2.0.0-rc.1');
    assert.equal(run.code, OK, `a prerelease version is a version.${why(run)}`);
  });

  it('reads the heading with no link brackets too', () => {
    const bare = ['# Changelog', '', '## 1.3.1 - 2026-08-21', '', '- something', ''].join('\n');
    assert.equal(verdict(bare, '1.3.1').code, OK, 'an unbracketed dated heading is a release heading.');
    assert.equal(
      verdict(bare, '1.3.0').code,
      MISMATCH,
      'and it is still compared, rather than merely recognised.',
    );
  });
});

describe('"topmost" is the first release heading in the file, not the first one that parses', () => {
  it('refuses an [Unreleased] heading sitting above a dated section', () => {
    // A script that scans downward for the first heading that parses steps over
    // this and reports agreement about a section nobody is editing. It is the
    // most likely way for this gate to be green and mean nothing, and
    // `[Unreleased]` was this file's topmost heading until 2026-08-21.
    const withUnreleased = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '',
      '- something not yet numbered',
      '',
      '## [1.3.1] - 2026-08-21',
      '',
      '- shipped',
      '',
    ].join('\n');

    const run = verdict(withUnreleased, '1.3.1');
    assert.equal(
      run.code,
      UNDETERMINED,
      'the gate skipped past `[Unreleased]` to a dated section further down and called that ' +
        'agreement. The convention requires the default branch to carry a real unreleased ' +
        `NUMBER.${why(run)}`,
    );
  });

  it('refuses a dated [Unreleased] heading, which parses but names no version', () => {
    const run = verdict(changelogFor('Unreleased'), '1.3.1');
    assert.equal(
      run.code,
      UNDETERMINED,
      `\`[Unreleased] - 2026-08-21\` is a heading shape, not a release.${why(run)}`,
    );
  });

  it('refuses a topmost heading that is prose', () => {
    const prose = [
      '# Changelog',
      '',
      '## How to read this file',
      '',
      '- prose',
      '',
      '## [1.3.1] - 2026-08-21',
      '',
      '- shipped',
      '',
    ].join('\n');
    assert.equal(
      verdict(prose, '1.3.1').code,
      UNDETERMINED,
      'a prose section above the releases takes the topmost position, and the gate must say it ' +
        'cannot tell rather than search onward.',
    );
  });

  it('refuses the same version heading twice', () => {
    const duplicated = [
      '# Changelog',
      '',
      '## [1.3.1] - 2026-08-21',
      '',
      '- one',
      '',
      '## [1.3.1] - 2026-08-19',
      '',
      '- the other',
      '',
    ].join('\n');
    assert.equal(
      verdict(duplicated, '1.3.1').code,
      UNDETERMINED,
      'two sections for one version leave no answer to which one this release is, and a gate ' +
        'reading only the first heading waves the half-finished rename straight through.',
    );
  });
});

describe('the file is parsed, so an example in a code block is not a release', () => {
  it('does not read a heading out of a fenced code block', () => {
    // Both directions in one row. A fence-blind parser takes 9.9.9 as topmost
    // and fails; a parser that never leaves the fence finds no heading at all
    // and also fails. Only a correct one returns OK here.
    const withFence = [
      '# Changelog',
      '',
      'Sections are written like this:',
      '',
      '```markdown',
      '## [9.9.9] - 2026-01-01',
      '```',
      '',
      '## [1.3.1] - 2026-08-21',
      '',
      '- shipped',
      '',
    ].join('\n');

    const run = verdict(withFence, '1.3.1');
    assert.equal(
      run.code,
      OK,
      `an example heading inside a fence was treated as a real section.${why(run)}`,
    );

    // ...and the same file still disagrees with a different version, so the row
    // above is not passing because the comparison was skipped.
    assert.equal(
      verdict(withFence, '9.9.9').code,
      MISMATCH,
      'the fenced example must not become the section the gate compares against.',
    );
  });

  it('refuses a file whose only release heading is inside a fence', () => {
    const onlyFenced = ['# Changelog', '', '```', '## [1.3.1] - 2026-08-21', '```', ''].join('\n');
    assert.equal(
      verdict(onlyFenced, '1.3.1').code,
      UNDETERMINED,
      'a changelog with no real release section must not pass because a code sample looks like one.',
    );
  });
});

describe('the gate fails closed, because a file it could not read is not agreement', () => {
  it('gives no verdict when CHANGELOG.md is missing', () => {
    const run = verdict(null, '1.3.1');
    assert.equal(
      run.code,
      UNDETERMINED,
      `deleting CHANGELOG.md must not read as "nothing to check".${why(run)}`,
    );
  });

  it('gives no verdict on a changelog with no release heading at all', () => {
    for (const [described, body] of [
      ['empty', ''],
      ['title only', '# Changelog\n'],
      ['all headings demoted', '# Changelog\n\n### [1.3.1] - 2026-08-21\n'],
    ] as const) {
      const run = verdict(body, '1.3.1');
      assert.equal(
        run.code,
        UNDETERMINED,
        `a changelog that is ${described} declares no release section.${why(run)}`,
      );
    }
  });

  it('gives no verdict on a release heading carrying no date', () => {
    const undated = ['# Changelog', '', '## [1.3.1]', '', '- something', ''].join('\n');
    assert.equal(
      verdict(undated, '1.3.1').code,
      UNDETERMINED,
      'the version half agreeing is not the whole heading parsing. An undated heading is the ' +
        'shape a half-written section has, and it must not be accepted on the strength of the ' +
        'number alone.',
    );
  });

  it('gives no verdict on a date that is not a real day', () => {
    for (const date of ['2026-02-30', '2026-13-01', '2026-00-10', '0000-00-00']) {
      const run = verdict(changelogFor('1.3.1', date), '1.3.1');
      assert.equal(
        run.code,
        UNDETERMINED,
        `\`${date}\` matches the digit shape and is not a calendar date.${why(run)}`,
      );
    }
  });

  it('gives no verdict when package.json cannot be read or does not say', () => {
    // Each of these is a plausible accident in a script that rewrites the file,
    // and each would otherwise buy a silent pass from a gate whose entire
    // subject is the field being compared.
    const dir = scratch();
    const notJson = join(dir, 'package.json');
    writeFileSync(notJson, '{ not json', 'utf8');
    const changelog = join(dir, 'CHANGELOG.md');
    writeFileSync(changelog, changelogFor('1.3.1'), 'utf8');

    const missing = join(scratch(), 'package.json');

    for (const [described, path] of [
      ['not JSON', notJson],
      ['missing', missing],
    ] as const) {
      const run = runGuard(['--changelog', changelog, '--package', path]);
      assert.equal(
        run.code,
        UNDETERMINED,
        `a package.json ${described} left the gate with nothing to compare.${why(run)}`,
      );
    }

    for (const [described, value] of [
      ['carrying no `version`', { name: 'x' }],
      ['carrying an empty version', { name: 'x', version: '' }],
      ['carrying a range instead of a version', { name: 'x', version: '^1.3.1' }],
      ['carrying an array', ['not', 'an', 'object']],
      ['carrying a bare null', null],
    ] as const) {
      const run = verdict(changelogFor('1.3.1'), value);
      assert.equal(
        run.code,
        UNDETERMINED,
        `a package.json ${described} is not a version to compare against.${why(run)}`,
      );
    }
  });

  it('gives no verdict on an argument it does not understand', () => {
    // A typo'd flag that is silently ignored is a gate running on defaults while
    // its author believes it is running on their arguments, which is how a CI
    // invocation and the thing asserted about it drift apart.
    for (const args of [['--nonsense', 'x'], ['positional'], ['--changelog'], ['--package']]) {
      const run = runGuard(args);
      assert.equal(
        run.code,
        UNDETERMINED,
        `\`${args.join(' ')}\` was accepted rather than refused.${why(run)}`,
      );
    }
  });
});

describe('the gate is wired into CI, where editing package.json alone cannot disable it', () => {
  it('exists at the path this file executes', () => {
    assert.ok(
      existsSync(GUARD_SCRIPT),
      `${GUARD_SCRIPT} is missing. Every scenario above would then be asserting the exit status ` +
        'of a node process that could not find its entry point.',
    );
  });

  it('agrees with the files in this repository right now', () => {
    // The gate pointed at the real tree. This is the row that goes red the day
    // somebody raises `version` and forgets the section, which is the entire
    // reason the check exists.
    const run = runGuard([]);
    assert.equal(
      run.code,
      OK,
      'CHANGELOG.md and package.json in this tree disagree. Open the section for the version ' +
        `package.json declares, at the top of CHANGELOG.md.${why(run)}`,
    );
  });

  it('is invoked by literal path in a CI job, not through an npm script', () => {
    const found = guardJobs();
    assert.ok(
      found.length > 0,
      `No job in ${JSON.stringify(workflowFiles())} runs scripts/${GUARD_SCRIPT_NAME} by path. An ` +
        'npm script would not satisfy this: the gate has to be reachable without depending on a ' +
        'line in the file it is checking. `aahp check` has been declared in aahp.config.json and ' +
        'invoked by nothing for the life of this repository (issue #67) - a gate that exists and ' +
        'is not wired in is indistinguishable from no gate.',
    );

    for (const named of found) {
      for (const step of guardSteps(named.job)) {
        assert.equal(
          /npm\s+run\b/.test(step.run as string),
          false,
          `\`${label(named)}\` reaches the gate through an npm script. Editing package.json would ` +
            `then switch it off:\n${step.run}`,
        );
      }
    }
  });

  it('runs on pull requests, unfiltered by path', () => {
    // A gate scoped to `paths: [CHANGELOG.md, package.json]` would be silent on
    // exactly the pull request that raises a version and forgets the section,
    // because that one touches package.json and the filter would let it in but
    // a pull request touching neither is the one that inherits the drift.
    for (const named of guardJobs()) {
      const on = triggers(named.workflow);
      assert.ok(
        Object.prototype.hasOwnProperty.call(on, 'pull_request'),
        `\`${named.file}\` hosts the changelog gate but does not run on \`pull_request\`.`,
      );

      for (const [trigger, config] of Object.entries(on)) {
        if (config === null || config === undefined) continue;
        if (typeof config !== 'object' || Array.isArray(config)) {
          throw new Error(
            `\`${named.file}\` configures trigger \`${trigger}\` in a shape this file cannot read ` +
              `(${JSON.stringify(config)}). Extend the assertion rather than removing it.`,
          );
        }
        for (const filter of ['paths', 'paths-ignore']) {
          assert.equal(
            Object.prototype.hasOwnProperty.call(config, filter),
            false,
            `\`${named.file}\` filters \`${trigger}\` by \`${filter}\`, so the changelog gate does ` +
              'not run on every change.',
          );
        }
      }
    }
  });

  it('carries no `continue-on-error` and no `if:`, on the job or on any of its steps', () => {
    // Six one-line edits left a contract gate elsewhere in this estate reporting
    // CLEAN with every required flag still in place. Both keys are enumerated at
    // both levels rather than looked for where they are expected.
    for (const named of guardJobs()) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(named.job, 'continue-on-error'),
        false,
        `\`${label(named)}\` is \`continue-on-error\`, so the gate reports its verdict and the run ` +
          'succeeds regardless.',
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(named.job, 'if'),
        false,
        `\`${label(named)}\` is conditional. A condition on the job hosting a gate decides when the ` +
          'gate is allowed to have an opinion, which is the property it must not have.',
      );

      for (const step of named.job.steps ?? []) {
        const where = `step \`${step.name ?? step.run ?? step.uses ?? '(unnamed)'}\` of \`${label(named)}\``;
        assert.equal(
          Object.prototype.hasOwnProperty.call(step, 'continue-on-error'),
          false,
          `${where} is \`continue-on-error\`.`,
        );
        assert.equal(
          Object.prototype.hasOwnProperty.call(step, 'if'),
          false,
          `${where} is conditional, so it can be skipped into silence.`,
        );
      }
    }
  });

  it('is invoked with its exit status intact', () => {
    // `|| true`, `|| exit 0`, `; true` and a trailing `exit 0` all leave the
    // command in the file and every flag on the command line.
    const SWALLOWED = /\|\|\s*(true|:|exit\s+0)|;\s*(true|exit\s+0)\s*$/m;

    for (const named of guardJobs()) {
      for (const step of guardSteps(named.job)) {
        assert.equal(
          SWALLOWED.test(step.run as string),
          false,
          `\`${label(named)}\` runs the changelog gate but discards its exit status:\n${step.run}`,
        );
      }
    }
  });

  it('holds up the publish job, since no status check on this repository is required', () => {
    // `required_status_checks` is `null` on `main`, so a red check blocks
    // nothing by itself. `needs:` is the one place a gate can be made
    // load-bearing from inside this tree, and it is what makes the sentence in
    // SECURITY.md#release-integrity true rather than aspirational.
    const guardIds = new Set(guardJobs().map((named) => `${named.file}:${named.id}`));
    const publishers = jobs().filter((named) => publishesToRegistry(named.job));

    assert.ok(
      publishers.length > 0,
      'No job publishes to the registry, so this assertion is aimed at nothing. If the release ' +
        'path moved, aim it at the new one rather than deleting it.',
    );

    for (const publisher of publishers) {
      const needs =
        typeof publisher.job.needs === 'string' ? [publisher.job.needs] : (publisher.job.needs ?? []);
      const satisfied = needs.some((id) => guardIds.has(`${publisher.file}:${id}`));
      assert.ok(
        satisfied,
        `\`${label(publisher)}\` publishes without \`needs:\` on the changelog gate. Its \`needs:\` ` +
          `is ${JSON.stringify(needs)}; the gate lives in ${JSON.stringify([...guardIds])}. Without ` +
          'that edge a release can ship while the section describing it was never opened.',
      );
    }
  });

  it('runs somewhere other than the release path it protects', () => {
    // A gate inside the job it guards is only reached once someone has pushed a
    // v-tag, which is after the moment the section should have been opened.
    for (const named of guardJobs()) {
      assert.equal(
        publishesToRegistry(named.job),
        false,
        `\`${label(named)}\` both publishes and hosts the changelog gate, so the gate can only ` +
          'ever speak after the fact.',
      );
    }
  });

  it('stays wired into `npm test`, so this file is not the only thing asserting it', () => {
    // Modest claim: it catches the half-edit that drops this file from the test
    // line while leaving it on disk. It cannot catch deletion of the file
    // itself, and it is not the load-bearing wiring - the CI job running the
    // script by path is, and neither depends on the other.
    const testScript = npmScripts()['test'] ?? '';
    assert.ok(
      testScript.includes('tests/security/changelog-guard.test.ts'),
      `\`npm test\` no longer runs this file: ${JSON.stringify(testScript)}. node:test only runs ` +
        'the files it is handed, so a file dropped from that line goes quiet without failing.',
    );
  });
});

process.on('exit', () => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});
