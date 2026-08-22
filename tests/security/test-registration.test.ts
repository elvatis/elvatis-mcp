/**
 * A test file that exists under `tests/` is executed, or the build is refused.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * `package.json` selected test files by name, and nothing compared that list to
 * the directory. Measured on 2026-08-21 at c12c6e5: an always-failing probe
 * dropped into `tests/security/` exited 1 when run on its own and left
 * `npm test` at exit 0, reporting 175 passed and 0 failed, with the probe's
 * filename appearing nowhere in the output. A second instance was already in
 * the tree rather than hypothetical: `tests/integration.test.ts` is reached by
 * no CI step at all.
 *
 * The shape is the one this repository keeps meeting. A control is added, the
 * pull request is green, and nobody learns that the control never executed. It
 * is worse than a missing test, because a missing test looks missing, whereas
 * an unrun one reads as protection to every later reader.
 *
 * WHY THE GATE IS A SCRIPT WITH ITS OWN CI STEP
 * ---------------------------------------------------------------------------
 * A guard that lives only in the enumerated list can be removed by the same
 * edit it exists to catch: drop it from `package.json` and the guard stops
 * running, silently, which is the exact defeat. So the deciding invocation is
 * `node scripts/check-test-registration.mjs` as its own step in ci.yml, outside
 * the `test` script entirely. This file executes that script; it does not
 * restate its logic, because a re-implementation can agree with itself while
 * both copies are wrong.
 *
 * THE SCRIPT IS EXECUTED, NOT READ
 * ---------------------------------------------------------------------------
 * Every scenario below spawns the real script as a real child process against a
 * real fixture tree on disk, and asserts its EXACT exit status. A regex over
 * the source would pass on a script that computes the right answer and exits 0
 * regardless. Exit statuses are never asserted as "non-zero": a script that has
 * been deleted, renamed or made unparseable exits 1 from node itself, and 1 is
 * this script's drift verdict, so "non-zero" would let a missing gate
 * impersonate a working one on every drift row here.
 *
 * BOTH DIRECTIONS, EVERYWHERE
 * ---------------------------------------------------------------------------
 * A predicate only ever shown firing might fire on everything, and a gate that
 * refuses every repository is as useless as one that accepts every repository -
 * worse, because it gets switched off rather than fixed. So each rule is stated
 * twice: a tree that violates it, and a tree that satisfies it. The liveness
 * rows include this repository itself, which must exit 0.
 *
 * THE ONE-LINE MUTATIONS THIS FILE IS HERE TO CATCH
 * ---------------------------------------------------------------------------
 *   - the drift verdict softened to a warning, or `process.exit(EXIT_DRIFT)`
 *     turned into `process.exit(0)`: the unregistered-file rows.
 *   - any `fail(EXIT_UNDETERMINED, ...)` path relaxed to a pass. `catch { }`
 *     around the package.json read is one line and passes every other row here.
 *   - the exclusion map turned into a free pass: an exclusion that names a file
 *     which does not exist, or one with no stated reason, must not be accepted.
 *     A stale exclusion is a standing permission for a future file to arrive
 *     under that name and never run.
 *   - the narrowing-flag check removed, which would let the file list be
 *     complete while `--test-name-pattern` skips most of what it names.
 *   - the gate removed from CI, or neutered in place with `continue-on-error`,
 *     an `if:` that cannot be true, `|| true`, or a `paths:` filter on the
 *     workflow. Those shapes are enumerated over every job AND every step
 *     below, not looked for in one expected place.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That the tests are good, or that they assert anything at all. A file full of
 * `it('...', () => {})` satisfies every row here. It claims only that a file
 * placed under `tests/` is either run, or visibly and deliberately not run with
 * the reason recorded beside the list that omits it.
 *
 * Nor that anyone is obliged to look: `required_status_checks` on this
 * repository's default branch is still `null` (measured 2026-08-21, and
 * SECURITY.md says so in public), so this job reports rather than blocks. That
 * is a repository setting, unreachable from any file in this tree.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The gate itself. Renaming it without updating this constant fails loudly. */
const GUARD_SCRIPT_NAME = 'check-test-registration.mjs';
const GUARD_SCRIPT = join(REPO_ROOT, 'scripts', GUARD_SCRIPT_NAME);

/** The script's contract. Asserted exactly, never as "non-zero". */
const OK = 0;
const DRIFT = 1;
const UNDETERMINED = 2;

// ---------------------------------------------------------------------------
// Running the real thing
// ---------------------------------------------------------------------------

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runGuard(root: string, extraArgs: string[] = []): Run {
  const result = spawnSync(process.execPath, [GUARD_SCRIPT, '--root', root, ...extraArgs], {
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, `spawning the guard failed: ${result.error}`);
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

interface Fixture {
  /** Written verbatim as package.json. */
  pkg: unknown;
  /** Repo-relative paths created as empty-ish test files. */
  files?: string[];
  /** Skip creating tests/ at all. */
  noTestsDir?: boolean;
  /** Written verbatim instead of JSON.stringify(pkg). */
  rawPkg?: string;
}

const tempRoots: string[] = [];

function makeFixture(f: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), 'elvatis-testreg-'));
  tempRoots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    f.rawPkg ?? JSON.stringify(f.pkg, null, 2),
    'utf8',
  );
  if (!f.noTestsDir) mkdirSync(join(root, 'tests'), { recursive: true });
  for (const rel of f.files ?? []) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "import { it } from 'node:test';\nit('x', () => {});\n", 'utf8');
  }
  return root;
}

process.on('exit', () => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* a leftover temp dir is not worth failing a test run over */
    }
  }
});

/** A `test` script naming exactly the files given. */
function testScript(files: string[]): string {
  return `npm run build && npx --no-install tsx --test ${files.join(' ')}`;
}

// ---------------------------------------------------------------------------
// The gate exists and is wired where it cannot be dropped by editing the list
// ---------------------------------------------------------------------------

describe('the guard script and its CI step exist', () => {
  it('the script is present at the path the CI step names', () => {
    assert.ok(
      existsSync(GUARD_SCRIPT),
      `${GUARD_SCRIPT_NAME} is missing. The CI step invokes it by path, so a rename ` +
        'without updating ci.yml leaves a step that fails for the wrong reason.',
    );
  });

  it('ci.yml invokes the guard by path, in a step of its own', () => {
    const ci = parse(readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8'));
    const steps = Object.values(ci.jobs as Record<string, { steps?: { run?: string }[] }>)
      .flatMap((job) => job.steps ?? [])
      .filter((step) => typeof step.run === 'string');

    // Comments are stripped before matching. A `run:` body whose only mention of
    // the script is inside a `#` comment names the gate without running it, and
    // that is precisely how a matcher anchored to a substring gets defeated in
    // the safe-looking direction.
    const executable = (run: string) =>
      run
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line.length > 0);

    const invocations = steps.filter((step) =>
      executable(step.run!).some((line) =>
        new RegExp(String.raw`(^|\s)node\s+scripts/${GUARD_SCRIPT_NAME}(\s|$)`).test(line),
      ),
    );
    assert.equal(
      invocations.length,
      1,
      `Expected exactly one ci.yml step running \`node scripts/${GUARD_SCRIPT_NAME}\`, ` +
        `found ${invocations.length}. It must be invoked by path rather than through ` +
        '`npm run`: an npm script lives in package.json, the file this guard audits, ' +
        'so the gate would sit inside its own subject.',
    );
    for (const step of invocations) {
      for (const line of executable(step.run!)) {
        assert.ok(
          !/\|\|\s*true/.test(line),
          'The guard step swallows its exit status with `|| true`.',
        );
      }
    }
  });

  it('the guard step is not neutered by if:, continue-on-error or a paths filter', () => {
    const ci = parse(readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8')) as {
      on?: Record<string, { paths?: unknown; 'paths-ignore'?: unknown }>;
      jobs: Record<
        string,
        {
          if?: unknown;
          'continue-on-error'?: unknown;
          steps?: { run?: string; if?: unknown; 'continue-on-error'?: unknown }[];
        }
      >;
    };

    // A paths filter on any trigger of this workflow makes the gate skippable
    // by touching nothing it watches, which is exactly the change that adds an
    // unregistered test file.
    for (const [event, cfg] of Object.entries(ci.on ?? {})) {
      if (cfg && typeof cfg === 'object') {
        assert.equal(
          (cfg as Record<string, unknown>).paths,
          undefined,
          `trigger \`${event}\` carries a paths: filter`,
        );
        assert.equal(
          (cfg as Record<string, unknown>)['paths-ignore'],
          undefined,
          `trigger \`${event}\` carries a paths-ignore: filter`,
        );
      }
    }

    for (const [name, job] of Object.entries(ci.jobs)) {
      const steps = job.steps ?? [];
      const owns = steps.some((s) => typeof s.run === 'string' && s.run.includes(GUARD_SCRIPT_NAME));
      if (!owns) continue;
      assert.equal(job.if, undefined, `job \`${name}\` carries an if: over the guard`);
      assert.equal(
        job['continue-on-error'],
        undefined,
        `job \`${name}\` is continue-on-error, so the guard cannot fail anything`,
      );
      for (const step of steps) {
        if (typeof step.run !== 'string' || !step.run.includes(GUARD_SCRIPT_NAME)) continue;
        assert.equal(step.if, undefined, 'the guard step carries an if:');
        assert.equal(
          step['continue-on-error'],
          undefined,
          'the guard step is continue-on-error',
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Liveness: the real repository, and a well-formed fixture, both pass
// ---------------------------------------------------------------------------

describe('the guard accepts a repository that is in order', () => {
  it('exits 0 on this repository', () => {
    const run = runGuard(REPO_ROOT);
    assert.equal(
      run.status,
      OK,
      `the guard rejects its own repository:\n${run.stderr}${run.stdout}`,
    );
    assert.match(run.stdout, /test-registration: OK\./);
  });

  it('exits 0 when every file is enumerated and none is excluded', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/a.test.ts', 'tests/b.test.ts']) } },
      files: ['tests/a.test.ts', 'tests/b.test.ts'],
    });
    assert.equal(runGuard(root).status, OK);
  });

  it('exits 0 when the only unenumerated file is a declared exclusion', () => {
    const root = makeFixture({
      pkg: {
        scripts: { test: testScript(['tests/a.test.ts']) },
        testRegistration: { excluded: { 'tests/live.test.ts': 'needs a live host' } },
      },
      files: ['tests/a.test.ts', 'tests/live.test.ts'],
    });
    assert.equal(runGuard(root).status, OK);
  });

  it('exits 0 for a nested file that is enumerated', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/deep/nested/a.test.ts']) } },
      files: ['tests/deep/nested/a.test.ts'],
    });
    assert.equal(runGuard(root).status, OK);
  });
});

// ---------------------------------------------------------------------------
// Drift: exit 1, and the exact shapes that produced the 2026-08-21 measurement
// ---------------------------------------------------------------------------

describe('the guard refuses a test file that would never run', () => {
  it('exits 1 on the measured case: a probe dropped into tests/security/', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/unit.test.ts']) } },
      files: ['tests/unit.test.ts', 'tests/security/zz-mutation-probe.test.ts'],
    });
    const run = runGuard(root);
    assert.equal(run.status, DRIFT);
    assert.match(run.stderr, /zz-mutation-probe\.test\.ts/);
    assert.match(run.stderr, /never run/);
  });

  it('exits 1 for an unregistered file nested below tests/', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/a.test.ts']) } },
      files: ['tests/a.test.ts', 'tests/deep/nested/orphan.test.ts'],
    });
    assert.equal(runGuard(root).status, DRIFT);
  });

  it('exits 1 when the list names a file that does not exist', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/a.test.ts', 'tests/gone.test.ts']) } },
      files: ['tests/a.test.ts'],
    });
    const run = runGuard(root);
    assert.equal(run.status, DRIFT);
    assert.match(run.stderr, /gone\.test\.ts/);
  });

  it('exits 1 when an exclusion names a file that does not exist', () => {
    const root = makeFixture({
      pkg: {
        scripts: { test: testScript(['tests/a.test.ts']) },
        testRegistration: { excluded: { 'tests/vanished.test.ts': 'was live once' } },
      },
      files: ['tests/a.test.ts'],
    });
    const run = runGuard(root);
    assert.equal(run.status, DRIFT);
    assert.match(run.stderr, /vanished\.test\.ts/);
  });

  it('exits 1 when a file is both enumerated and excluded', () => {
    const root = makeFixture({
      pkg: {
        scripts: { test: testScript(['tests/a.test.ts']) },
        testRegistration: { excluded: { 'tests/a.test.ts': 'contradictory' } },
      },
      files: ['tests/a.test.ts'],
    });
    assert.equal(runGuard(root).status, DRIFT);
  });
});

// ---------------------------------------------------------------------------
// Fail closed: exit 2, and 2 is not 0
// ---------------------------------------------------------------------------

describe('the guard fails closed on anything it cannot read', () => {
  it('exits 2 when package.json is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'elvatis-testreg-'));
    tempRoots.push(root);
    mkdirSync(join(root, 'tests'), { recursive: true });
    assert.equal(runGuard(root).status, UNDETERMINED);
  });

  it('exits 2 when package.json is not JSON', () => {
    const root = makeFixture({ pkg: {}, rawPkg: '{ this is not json', files: [] });
    assert.equal(runGuard(root).status, UNDETERMINED);
  });

  it('exits 2 when there is no test script', () => {
    const root = makeFixture({ pkg: { scripts: { build: 'tsc' } }, files: [] });
    assert.equal(runGuard(root).status, UNDETERMINED);
  });

  it('exits 2 when the test script passes no --test flag', () => {
    const root = makeFixture({
      pkg: { scripts: { test: 'npx tsx tests/a.test.ts' } },
      files: ['tests/a.test.ts'],
    });
    const run = runGuard(root);
    assert.equal(run.status, UNDETERMINED);
    assert.match(run.stderr, /--test/);
  });

  it('exits 2 when tests/ does not exist', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/a.test.ts']) } },
      noTestsDir: true,
    });
    assert.equal(runGuard(root).status, UNDETERMINED);
  });

  it('exits 2 on an unrecognised argument rather than ignoring it', () => {
    const root = makeFixture({
      pkg: { scripts: { test: testScript(['tests/a.test.ts']) } },
      files: ['tests/a.test.ts'],
    });
    assert.equal(runGuard(root, ['--assume-yes']).status, UNDETERMINED);
  });

  it('exits 2 when an exclusion carries no reason', () => {
    const root = makeFixture({
      pkg: {
        scripts: { test: testScript(['tests/a.test.ts']) },
        testRegistration: { excluded: { 'tests/live.test.ts': '' } },
      },
      files: ['tests/a.test.ts', 'tests/live.test.ts'],
    });
    const run = runGuard(root);
    assert.equal(run.status, UNDETERMINED);
    assert.match(run.stderr, /reason/);
  });

  it('exits 2 when the exclusion map is an array rather than a reasoned map', () => {
    const root = makeFixture({
      pkg: {
        scripts: { test: testScript(['tests/a.test.ts']) },
        testRegistration: { excluded: ['tests/live.test.ts'] },
      },
      files: ['tests/a.test.ts', 'tests/live.test.ts'],
    });
    assert.equal(runGuard(root).status, UNDETERMINED);
  });
});

// ---------------------------------------------------------------------------
// A complete file list is not a complete run
// ---------------------------------------------------------------------------

describe('the guard refuses a run that would silently narrow itself', () => {
  for (const flag of [
    '--test-name-pattern=security',
    '--test-skip-pattern=slow',
    '--test-only',
    '--test-shard=1/2',
  ]) {
    it(`exits 2 when the test script carries ${flag.split('=')[0]}`, () => {
      const root = makeFixture({
        pkg: {
          scripts: {
            test: `npx --no-install tsx --test ${flag} tests/a.test.ts`,
          },
        },
        files: ['tests/a.test.ts'],
      });
      const run = runGuard(root);
      assert.equal(
        run.status,
        UNDETERMINED,
        `${flag} narrows the run but the guard returned a verdict anyway`,
      );
    });
  }

  for (const chain of ['||', ';', '|']) {
    it(`exits 2 when the test script chains with \`${chain}\``, () => {
      const root = makeFixture({
        pkg: {
          scripts: { test: `npx --no-install tsx --test tests/a.test.ts ${chain} echo done` },
        },
        files: ['tests/a.test.ts'],
      });
      assert.equal(runGuard(root).status, UNDETERMINED);
    });
  }

  it('accepts `&&`, which propagates failure rather than swallowing it', () => {
    const root = makeFixture({
      pkg: { scripts: { test: 'npm run build && npx --no-install tsx --test tests/a.test.ts' } },
      files: ['tests/a.test.ts'],
    });
    assert.equal(runGuard(root).status, OK);
  });
});

// ---------------------------------------------------------------------------
// The exclusion this repository actually declares
// ---------------------------------------------------------------------------

describe('this repository declares its one exclusion, with a reason', () => {
  it('tests/integration.test.ts is excluded and says why', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      testRegistration?: { excluded?: Record<string, string> };
      scripts?: Record<string, string>;
    };
    const reason = pkg.testRegistration?.excluded?.['tests/integration.test.ts'];
    assert.ok(
      typeof reason === 'string' && reason.trim().length > 0,
      'tests/integration.test.ts must be declared under testRegistration.excluded ' +
        'with the reason it is not run by npm test.',
    );
    assert.ok(
      existsSync(join(REPO_ROOT, 'tests', 'integration.test.ts')),
      'the exclusion names a file that no longer exists',
    );
    assert.ok(
      typeof pkg.scripts?.['test:integration'] === 'string',
      'the excluded file must remain reachable through a named script, or the ' +
        'exclusion is a deletion in disguise',
    );
  });
});
