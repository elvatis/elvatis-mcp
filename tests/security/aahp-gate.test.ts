/**
 * The AAHP handoff gate can still fail, and the handoff state it guards is still
 * this project's.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * This repository was the ONE consumer the 2026-08-21 AAHP fleet rollout skipped.
 * It sat on @elvatis_com/aahp 3.8.1 while every sibling moved to 3.10.x, and that
 * single fact produced a defect visible estate-wide:
 *
 *   3.8.1 REWRITES MANIFEST.json's `project` to the name of the DIRECTORY it ran
 *   in. Reproduced here on 2026-08-21 in a worktree named `elvatis-mcp-aahp`:
 *   `"project": "elvatis-mcp"` became `"project": "elvatis-mcp-aahp"` on a plain
 *   `aahp manifest .`, and 3.10.0 left the same file alone under the same name.
 *
 * Both stray values seen in the estate - `elvatis-mcp-scg-pin` and `mcp-node-eol`
 * - are agent worktree directory names, and both came from here, because here was
 * the only repository still running 3.8.1. Nothing went red: a rewritten `project`
 * is a well-formed string in a well-formed file, and the checksum layer happily
 * re-blesses whatever the tool just wrote.
 *
 * WHAT EACH TEST GUARDS, AND THE MUTATION THAT TURNS IT RED
 * ---------------------------------------------------------------------------
 *   - "names this package": set `project` to anything but the package name - which
 *     is exactly what an old CLI does by itself, with no edit by anyone. This is
 *     the CONSEQUENCE assertion: it goes red for a stale pin, a re-introduced
 *     regression, or a hand-edit, without knowing which.
 *   - "pinned at or after 3.10.0": restore 3.8.1, or loosen the exact pin to a
 *     range. Below 3.10.0 `verify` has no `--base` flag at all, so the workflow
 *     below cannot run.
 *   - "passes an explicit base": drop `--base` from the verify command. From
 *     3.10.0 Layer 2 is FAIL-CLOSED, so this is not cosmetic - without it the
 *     drift gate refuses to run and the whole check is permanently red.
 *   - "every trigger names a base": add a trigger to `on:` without adding its arm
 *     to the base expression. That run would resolve the empty string.
 *   - "workflow_dispatch declares base": delete the input. Every manual run then
 *     fails closed and reads as a broken workflow rather than a missing argument.
 *   - "the guard runs at all": delete the `node scripts/require-layer2-base.mjs`
 *     line. The script would still pass its own tests while guarding nothing -
 *     the exact shape of a check that exists and is not wired in.
 *   - "refuses / accepts" (four cases): the guard is EXECUTED, both directions,
 *     as `tests/security/version-guard.test.ts` executes its script. A guard
 *     asserted only by grepping the workflow that contains it has never been run.
 *   - "nothing neuters the gate": add `continue-on-error`, a job-level `if:`, or
 *     `|| true`. Measured across this estate: six one-line edits of exactly this
 *     kind each left a gate reporting CLEAN with every required flag present.
 *   - "no paths filter": add `paths-ignore` to this workflow. A gate that can be
 *     skipped by touching only the files it does not watch is not a gate, and the
 *     workflow a gate lives in is the one place that filter is never noticed.
 *
 * WHAT THIS FILE CANNOT PROVE, SO IT DOES NOT CLAIM IT: that the gate BLOCKS a
 * merge. `main` has branch protection but `required_status_checks` is `null`
 * (measured 2026-08-21), so this check is advisory. That is a repository setting,
 * unreachable from any file here, and is open with the maintainer.
 *
 * The YAML is PARSED, never grepped, for the reasons `action-pin.test.ts` sets
 * out at length.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');
const WORKFLOW_FILE = join(REPO_ROOT, '.github', 'workflows', 'aahp-verify.yml');
const MANIFEST_FILE = join(REPO_ROOT, '.ai', 'handoff', 'MANIFEST.json');
const PACKAGE_FILE = join(REPO_ROOT, 'package.json');
const GUARD_SCRIPT = join(REPO_ROOT, 'scripts', 'require-layer2-base.mjs');

/** The release that made Layer 2 fail-closed and added `verify --base`. */
const MIN_AAHP = '3.10.0';

/** Exit code the guard uses for "unclassifiable", kept distinct from aahp's own 1. */
const REFUSE = 2;

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  'continue-on-error'?: unknown;
}

interface Job {
  if?: string;
  'continue-on-error'?: unknown;
  steps?: Step[];
}

interface Workflow {
  on?: unknown;
  jobs?: Record<string, Job>;
}

function workflow(): Workflow {
  return parse(readFileSync(WORKFLOW_FILE, 'utf8')) as Workflow;
}

/**
 * `on` is a YAML 1.1 boolean. The `yaml` package parses this repository's files
 * under the 1.2 core schema, where it stays the string "on", but a parser or
 * schema change would silently move the key to `true` and make every trigger
 * assertion below vacuous. Read both and fail loudly if neither is there.
 */
function triggers(wf: Workflow): Record<string, unknown> {
  const raw = (wf.on ?? (wf as unknown as Record<string, unknown>)['true']) as
    | Record<string, unknown>
    | undefined;
  assert.ok(raw, 'aahp-verify.yml has no `on:` block, or it parsed under an unexpected key.');
  return raw;
}

function verifyStep(): Step {
  const jobs = workflow().jobs ?? {};
  const steps = Object.values(jobs).flatMap((job) => job.steps ?? []);
  const found = steps.filter((s) => typeof s.run === 'string' && /\baahp\s+verify\b/.test(s.run));

  assert.equal(
    found.length,
    1,
    `Expected exactly one step running \`aahp verify\` in aahp-verify.yml, found ${found.length}. If the gate moved or was duplicated, this whole file is aimed at the wrong place.`,
  );
  return found[0] as Step;
}

/** -1 | 0 | 1, numeric per component, no dependency. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function runGuard(base: string | undefined): { status: number; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_EVENT_NAME: 'pull_request' };
  if (base === undefined) delete env.AAHP_BASE_SHA;
  else env.AAHP_BASE_SHA = base;

  const result = spawnSync(process.execPath, [GUARD_SCRIPT], { env, encoding: 'utf8' });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('the AAHP handoff gate is wired, runnable, and still guards this project', () => {
  it('MANIFEST.json still names this package, not the directory a tool ran in', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as { project?: string };
    const pkg = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')) as { name?: string };
    const expected = String(pkg.name ?? '').replace(/^@[^/]+\//, '');

    assert.ok(expected, 'package.json has no `name`, so there is nothing to compare against.');
    assert.equal(
      manifest.project,
      expected,
      `MANIFEST.json \`project\` is ${JSON.stringify(manifest.project)} but this package is ${JSON.stringify(expected)}. @elvatis_com/aahp 3.8.1 rewrites this field to the name of the DIRECTORY it ran in, so a value that looks like a worktree name (elvatis-mcp-scg-pin, mcp-node-eol) means an out-of-date CLI wrote the handoff state. Restore the value and check the pin below.`,
    );
  });

  it('pins @elvatis_com/aahp exactly, at or after the release Layer 2 needs', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    const pin = pkg.devDependencies?.['@elvatis_com/aahp'];

    assert.ok(pin, '@elvatis_com/aahp is not in devDependencies; the gate has no CLI to run.');
    assert.match(
      pin,
      /^\d+\.\d+\.\d+$/,
      `The AAHP CLI must be pinned exactly (aahp.config.json sets \`allowRange: false\`); found ${JSON.stringify(pin)}. A range lets the protocol driving the gate change without a commit.`,
    );
    assert.ok(
      compareSemver(pin, MIN_AAHP) >= 0,
      `@elvatis_com/aahp is pinned at ${pin}; this repository requires >= ${MIN_AAHP}. Below that, \`verify\` has no \`--base\` flag, so the workflow cannot run - and 3.8.1 in particular rewrites MANIFEST.json's \`project\` to the directory name.`,
    );
  });

  it('passes an explicit Layer 2 base to a fail-closed verify', () => {
    const step = verifyStep();
    const run = step.run ?? '';

    assert.match(
      run,
      /--level\s+ci\b/,
      'The gate must run at `--level ci`, the one level with no AAHP_SKIP_VERIFY escape hatch.',
    );
    assert.match(
      run,
      /--base\s+"?\$(\{)?AAHP_BASE_SHA/,
      'From AAHP 3.10.0 Layer 2 is fail-closed: without `--base "$AAHP_BASE_SHA"` the drift gate refuses to run and this check is permanently red rather than merely unbased.',
    );
    assert.ok(
      typeof step.env?.AAHP_BASE_SHA === 'string' && step.env.AAHP_BASE_SHA.length > 0,
      'The verify step sets no AAHP_BASE_SHA, so `--base` would expand to the empty string.',
    );
  });

  it('gives every trigger it declares a base of its own', () => {
    const wf = workflow();
    const declared = Object.keys(triggers(wf));
    const expression = verifyStep().env?.AAHP_BASE_SHA ?? '';

    const unhandled = declared.filter(
      (name) => !expression.includes(`github.event_name == '${name}'`),
    );

    assert.deepEqual(
      unhandled,
      [],
      `Every trigger in \`on:\` must contribute its own base to the AAHP_BASE_SHA expression, or that run resolves the empty string. Unhandled: ${unhandled.join(', ')}. Declared: ${declared.join(', ')}.`,
    );
  });

  it('declares the workflow_dispatch base input, since a manual run has no event base', () => {
    const dispatch = triggers(workflow()).workflow_dispatch as
      | { inputs?: Record<string, { required?: boolean }> }
      | undefined;

    assert.ok(dispatch, '`workflow_dispatch` is no longer declared; drop it from the expression too.');
    const input = dispatch.inputs?.base;
    assert.ok(
      input,
      'workflow_dispatch declares no `base` input. `github.event.before` and `pull_request.base.sha` are both absent on a manual run, so every dispatch would fail closed on a missing argument.',
    );
    assert.equal(
      input.required,
      true,
      'The `base` input must be `required: true`; an optional one resolves to the empty string and fails closed anyway, one dialog later.',
    );
  });

  it('actually invokes the guard before reaching aahp verify', () => {
    // Without this the executable guard below is dead code that passes its own
    // tests forever while protecting nothing.
    const run = verifyStep().run ?? '';
    const guardLine = run.indexOf('scripts/require-layer2-base.mjs');
    const verifyLine = run.indexOf('aahp verify');

    assert.ok(guardLine >= 0, 'The verify step no longer runs scripts/require-layer2-base.mjs.');
    assert.ok(
      guardLine < verifyLine,
      'The guard must run BEFORE `aahp verify`, otherwise the unbased run has already happened.',
    );
  });

  it('refuses an absent, empty, all-zero or non-SHA base (executed)', () => {
    const cases: ReadonlyArray<readonly [string, string | undefined]> = [
      ['unset', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['all-zero', '0'.repeat(40)],
      ['short SHA', 'c12c6e5'],
      ['branch name', 'origin/main'],
    ];

    for (const [label, value] of cases) {
      const { status, output } = runGuard(value);
      assert.equal(
        status,
        REFUSE,
        `Base ${label} (${JSON.stringify(value)}) must exit ${REFUSE}, got ${status}. Output: ${output}`,
      );
    }
  });

  it('accepts a full commit SHA (executed, the other direction)', () => {
    // Without this the test above passes just as well against a guard that
    // refuses everything, which would be a gate nobody can ever get through.
    const { status, output } = runGuard('c12c6e5812c36845066b15f52a2fd6e2b829d1e0');

    assert.equal(status, 0, `A full 40-character SHA must be accepted, got ${status}. ${output}`);
    assert.match(output, /Layer 2 base commit/, 'The guard should say which base it accepted.');
  });

  it('has nothing that neuters the gate: no continue-on-error, no job if, no || true', () => {
    const wf = workflow();
    const jobs = wf.jobs ?? {};
    const offenders: string[] = [];

    for (const [jobName, job] of Object.entries(jobs)) {
      if (job['continue-on-error'] !== undefined) offenders.push(`job ${jobName}: continue-on-error`);
      // A job-level `if:` disables the ENTIRE gate in one line, and a skipped
      // job does not report failure. The per-step dependabot exemption is the
      // only conditioning this workflow is allowed to carry.
      if (job.if !== undefined) offenders.push(`job ${jobName}: job-level if`);

      for (const step of job.steps ?? []) {
        const where = `job ${jobName} / step ${step.name ?? step.uses ?? '(unnamed)'}`;
        if (step['continue-on-error'] !== undefined) offenders.push(`${where}: continue-on-error`);
        if (typeof step.run === 'string' && /\|\|\s*true\b/.test(step.run)) {
          offenders.push(`${where}: || true`);
        }
        if (typeof step.run === 'string' && /\bexit\s+0\b/.test(step.run)) {
          offenders.push(`${where}: unconditional exit 0`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `Each of these leaves the workflow reporting success with the gate not enforced: ${offenders.join('; ')}`,
    );
  });

  it('is not skippable by a paths filter on the workflow the gate lives in', () => {
    const declared = triggers(workflow());
    const offenders: string[] = [];

    for (const [name, config] of Object.entries(declared)) {
      if (!config || typeof config !== 'object') continue;
      for (const key of ['paths', 'paths-ignore']) {
        if (key in (config as Record<string, unknown>)) offenders.push(`${name}.${key}`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `A paths filter on this workflow lets a change skip the handoff gate entirely - and a required check that never runs reports as passed, not as missing. Offenders: ${offenders.join(', ')}`,
    );
  });
});
