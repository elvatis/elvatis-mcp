/**
 * The npm publish is reachable only from a pushed v-tag, and it builds the
 * commit that triggered the run rather than whatever a moving ref points at.
 *
 * WHY THIS FILE EXISTS IN *THIS* REPOSITORY IN PARTICULAR
 * ---------------------------------------------------------------------------
 * elvatis-mcp is the only PUBLIC repository in the estate and the only one that
 * publishes to the public npm registry, as `@elvatis_com/elvatis-mcp`. Measured
 * 2026-08-21: `.private` is false, `environments` total_count is 0, `rulesets`
 * is empty, tag protection is 404, and `branches/main/protection` returns 200
 * with `required_status_checks` ABSENT. So there is no approval gate, no
 * required check and no protected tag anywhere on the release path. The entire
 * binding between "a reviewed commit" and "a published tarball" was, and now is
 * again, the two lines this file guards.
 *
 * What was there before:
 *
 *   if: (startsWith(github.ref, 'refs/tags/v') && contains(github.ref, '.'))
 *       || github.event_name == 'workflow_dispatch'
 *   steps:
 *     - uses: actions/checkout@v7          # no `ref:`
 *
 * `workflow_dispatch:` parses to null, so the Run-workflow dialog accepts ANY
 * branch; the OR-branch then satisfied the job condition on its own, and a
 * checkout with no `ref:` takes `github.ref` - the dispatched branch. One dialog
 * away from publishing an unreviewed branch tree to the public registry under
 * the real package name, with provenance attesting it. Nothing in the tree said
 * so; each half reads as harmless on its own.
 *
 * WHY THE FIX IS NOT JUST "DELETE THE OR-BRANCH"
 * ---------------------------------------------------------------------------
 * The Run-workflow dropdown offers TAGS as well as branches. With the OR-branch
 * merely deleted, dispatching on `v9.9.9` still leaves `github.ref` at
 * `refs/tags/v9.9.9`, `startsWith` still passes, and the manual path is open
 * again - now through a ref that anyone with push access can create and move,
 * because tag protection is 404. The guard therefore asserts the EVENT
 * (`github.event_name == 'push'`), which is the thing a dialog cannot forge.
 * Scenario 3 below is exactly that mutation, and it is the one a reviewer who
 * only read the instruction "remove the workflow_dispatch clause" would ship.
 *
 * THE CONDITION IS EVALUATED, NOT PATTERN-MATCHED
 * ---------------------------------------------------------------------------
 * A regex over the `if:` string is the wrong instrument, and this estate has the
 * receipts: four separate regex gates written on 2026-08-21 were all defeated
 * without deleting a line any of them looked for. So the `if:` is parsed into a
 * small GitHub-expression interpreter and RUN against the scenario table, which
 * makes the assertion behavioural: any rewrite that lets a dispatch through goes
 * red no matter how it is spelled, reordered, parenthesised or reformatted.
 *
 * The interpreter THROWS on any syntax or context path it does not model. That
 * is deliberate and is the property that keeps it honest: an `if:` rewritten in
 * terms of `github.actor`, `github.event.*`, `!`, `&&` chains this file cannot
 * read, or a function it does not implement, fails loudly and demands a human
 * extend the interpreter - it never quietly evaluates to the convenient answer.
 * A silent default here would reproduce the exact class of defect the file is
 * about.
 *
 * WHAT EACH TEST GUARDS, AND THE ONE-LINE MUTATION THAT TURNS IT RED
 * ---------------------------------------------------------------------------
 *   - "still publishes at all": delete the `npm publish` step, or the job. Every
 *     per-job assertion below is vacuously true over an empty list, so this one
 *     has to come first.
 *   - "every release-path job is conditional": delete the `if:` line. An absent
 *     condition means the job runs on every trigger the workflow accepts.
 *   - "the condition is expressed in terms this file can evaluate": rewrite the
 *     `if:` using anything the interpreter does not model. Red by design.
 *   - "no scenario but a pushed v-tag reaches the registry": restore
 *     `|| github.event_name == 'workflow_dispatch'` (scenarios 1 and 2), or drop
 *     `github.event_name == 'push'` while keeping the tag test (scenario 3).
 *   - "a pushed v-tag still publishes": this is the LIVENESS half. Tighten the
 *     guard into something that can never fire - `github.ref == 'refs/tags/v'`,
 *     say - and the release path is dead while all seven negative scenarios stay
 *     green. A guard that cannot fire is the failure mode of 2026-08-18.
 *   - "checkout is bound to the triggering commit": delete the
 *     `ref: ${{ github.sha }}` line, or change it to `${{ github.ref }}`.
 *   - "publish waits for the build job": delete `needs: build`, which would let
 *     a tag publish a tree whose typecheck and tests never ran. The candidate
 *     build jobs are scoped to the publisher's OWN file, because `needs:` cannot
 *     name a job in another workflow.
 *   - "the tag agrees with the version it would publish": delete the check step,
 *     or make its comparison prefix-tolerant. That last mutation is why the
 *     scenario set includes a tag which is a PREFIX of the shipped version: a
 *     `startsWith` or `contains` comparison accepts `v1.2` for 1.2.5 and an
 *     equality test does not, and only the prefix row tells them apart.
 *
 * EVERY WORKFLOW FILE, NOT ONE FILENAME
 * ---------------------------------------------------------------------------
 * All 32 published versions of this package came from a SEPARATE
 * `.github/workflows/publish.yml`, deleted on 2026-06-27 when the publish moved
 * into ci.yml. Restoring that file verbatim turns six of the eight assertions
 * below red - it had no `if:`, no `ref:` on its checkout and no build job to
 * depend on - and a guard keyed to the string "ci.yml" would have had nothing to
 * say about any of it. The release path is therefore located by CAPABILITY
 * across the whole directory: any file, any job name.
 *
 * WHAT THIS FILE CANNOT PROVE, SO IT DOES NOT CLAIM IT: that the commit under
 * the tag was ever reviewed. There is no required status check on the default
 * branch, no environment to hold a reviewer, and no restriction on who may
 * create `refs/tags/v*`, so an actor with push access can point `v9.9.9` at any
 * commit - and that IS a pushed v-tag, so it passes every assertion here. Those
 * are repository settings, unreachable from any file in this tree; SECURITY.md
 * describes the residual exposure and the two controls that would close it. This
 * file closes the half that lives in the workflow: no path that is not a pushed
 * v-tag, no tree but the tagged commit's, and no version but the one the tag
 * names.
 *
 * The workflow is PARSED, never grepped. `npm publish` appears in this
 * repository's own prose, `workflow_dispatch` legitimately remains among the
 * `on:` triggers so CI can still be run by hand on a branch, and the string
 * `refs/tags/v` now appears inside explanatory comments in ci.yml itself - a
 * check that could not tell a comment from a directive would force those
 * explanations back out of the file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');

/**
 * EVERY workflow file, not just ci.yml. This repository shipped all 32 of its
 * published versions from a SEPARATE `.github/workflows/publish.yml`, deleted on
 * 2026-06-27 when the publish moved into ci.yml. A guard keyed to one filename
 * would have been silent for that file's entire life, and goes silent again the
 * moment a `release.yml` appears beside it. The release path is therefore located
 * by capability across the whole directory.
 */
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The one command that puts a tarball on the public registry. */
const NPM_PUBLISH = /(^|[\s;&|(])npm\s+publish(\s|$)/m;

/** Accepted verbatim, modulo whitespace inside the interpolation braces. */
const PINNED_CHECKOUT_REF = '${{ github.sha }}';

// ---------------------------------------------------------------------------
// Workflow shape
// ---------------------------------------------------------------------------

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

interface Job {
  readonly name?: string;
  readonly if?: string | boolean;
  readonly needs?: string | string[];
  readonly steps?: Step[];
  readonly permissions?: Record<string, string> | string;
}

interface Workflow {
  readonly jobs?: Record<string, Job>;
}

interface NamedJob {
  /** Basename of the workflow file the job lives in, e.g. `ci.yml`. */
  readonly file: string;
  /** Job id as written inside that file, which is what `needs:` refers to. */
  readonly id: string;
  readonly job: Job;
}

/** How a job is named in an assertion message. Never fed back into `needs:`. */
function label(named: NamedJob): string {
  return `${named.file}:${named.id}`;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
}

function jobs(): NamedJob[] {
  const found: NamedJob[] = [];
  for (const file of workflowFiles()) {
    const parsed = parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as Workflow | null;
    for (const [id, job] of Object.entries(parsed?.jobs ?? {})) {
      found.push({ file, id, job });
    }
  }
  return found;
}

function permission(job: Job, scope: string): string | undefined {
  const perms = job.permissions;
  return typeof perms === 'object' && perms !== null ? perms[scope] : undefined;
}

function publishesToRegistry(job: Job): boolean {
  return (job.steps ?? []).some((step) => typeof step.run === 'string' && NPM_PUBLISH.test(step.run));
}

/**
 * Every job on the release path, found by CAPABILITY rather than by name, so
 * renaming a job or moving the publish into a fresh one does not slip the guard.
 * `id-token: write` is what mints the provenance attestation and `contents:
 * write` is what cuts the GitHub Release; a step that can ship an artefact
 * without at least one of these three marks does not exist in this workflow.
 */
function releasePathJobs(): NamedJob[] {
  return jobs().filter(
    ({ job }) =>
      publishesToRegistry(job) ||
      permission(job, 'id-token') === 'write' ||
      permission(job, 'contents') === 'write',
  );
}

/**
 * Steps whose shell script this file is willing to EXECUTE while looking for the
 * tag/version gate.
 *
 * Selection is a heuristic and is allowed to be, because selection cannot
 * manufacture a pass: the verdict comes from running the script. What selection
 * must do is stay SAFE. A publish job also contains `npm ci`, `npm run build`
 * and `npm install -g npm@latest`; running those here would hit the network and
 * mutate the machine, so anything invoking a package manager is refused outright
 * and reported as refused. A gate expressed as `npm pkg get version` therefore
 * cannot be checked and must be rewritten with `node -p`.
 */
const PACKAGE_MANAGER = /\b(?:npm|npx|yarn|pnpm)\b/;

function versionGateCandidates(job: Job): { script: string; refused: boolean }[] {
  return (job.steps ?? [])
    .map((step) => step.run)
    .filter((run): run is string => typeof run === 'string' && run.includes('package.json'))
    .map((script) => ({ script, refused: PACKAGE_MANAGER.test(script) }));
}

/** `${{ github.ref_name }}` and friends, resolved from a scenario context. */
function interpolate(script: string, context: Readonly<Record<string, string>>): string {
  return script.replace(/\$\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g, (whole, path: string) => {
    const value = context[path];
    if (value === undefined) {
      throw new Error(
        `a candidate release step interpolates \`${path}\`, which tests/security/publish-guard.test.ts ` +
          'does not model. Add it to githubContext() rather than dropping the assertion.',
      );
    }
    return value;
  });
}

/**
 * Run one step's script in a throwaway directory holding nothing but a
 * package.json at `version`, and return its exit status. A shell that cannot be
 * started returns -1, which is not 0, so a script that never ran is never
 * credited as a passing gate.
 */
function runShell(script: string, env: Record<string, string>, version: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'publish-guard-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version }), 'utf8');
    // GitHub runs `run:` steps under `bash -e` on ubuntu-latest; `-e` is the half
    // that decides an exit status, so it is the half modelled here.
    const result = spawnSync('sh', ['-e', '-c', script], {
      cwd: dir,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (result.error || result.status === null) return -1;
    return result.status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function checkoutSteps(job: Job): Step[] {
  return (job.steps ?? []).filter((step) => (step.uses ?? '').startsWith('actions/checkout@'));
}

// ---------------------------------------------------------------------------
// A deliberately small GitHub expression interpreter.
//
// It models only what a job condition on a release path has any business using.
// Everything else throws. See the header: the throw is the feature.
// ---------------------------------------------------------------------------

type Value = string | number | boolean | null;

interface Token {
  readonly kind: 'str' | 'num' | 'word' | 'op';
  readonly value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let literal = '';
      for (;;) {
        if (j >= input.length) throw new Error(`unterminated string literal in: ${input}`);
        if (input[j] === "'") {
          // GitHub escapes a quote by doubling it.
          if (input[j + 1] === "'") {
            literal += "'";
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        literal += input[j];
        j += 1;
      }
      tokens.push({ kind: 'str', value: literal });
      i = j;
      continue;
    }
    const pair = input.slice(i, i + 2);
    if (pair === '&&' || pair === '||' || pair === '==' || pair === '!=') {
      tokens.push({ kind: 'op', value: pair });
      i += 2;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === ',' || ch === '!') {
      tokens.push({ kind: 'op', value: ch });
      i += 1;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(input.slice(i));
    if (word) {
      tokens.push({ kind: 'word', value: word[0] });
      i += word[0].length;
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?/.exec(input.slice(i));
    if (num) {
      tokens.push({ kind: 'num', value: num[0] });
      i += num[0].length;
      continue;
    }
    throw new Error(
      `unsupported character ${JSON.stringify(ch)} at offset ${i} in job condition: ${input}. ` +
        'Extend tests/security/publish-guard.test.ts rather than loosening the guard.',
    );
  }
  return tokens;
}

/** GitHub's falsy set. */
function truthy(value: Value): boolean {
  return !(value === false || value === 0 || value === '' || value === null);
}

/** GitHub compares strings case-insensitively; modelling that keeps the interpreter honest. */
function looseEquals(left: Value, right: Value): boolean {
  if (typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

function evaluate(expression: string, context: Readonly<Record<string, string>>): boolean {
  const raw = expression.trim();
  // `if:` may or may not be wrapped in `${{ }}`; both forms are legal.
  const body = /^\$\{\{([\s\S]*)\}\}$/.exec(raw)?.[1] ?? raw;
  const tokens = tokenize(body);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const eat = (value: string): boolean => {
    if (peek()?.kind === 'op' && peek()?.value === value) {
      pos += 1;
      return true;
    }
    return false;
  };
  const expect = (value: string): void => {
    if (!eat(value)) throw new Error(`expected ${value} at token ${pos} in: ${body}`);
  };

  const parseOr = (): Value => {
    let left = parseAnd();
    while (eat('||')) {
      const right = parseAnd();
      left = truthy(left) ? left : right;
    }
    return left;
  };

  const parseAnd = (): Value => {
    let left = parseComparison();
    while (eat('&&')) {
      const right = parseComparison();
      left = truthy(left) ? right : left;
    }
    return left;
  };

  const parseComparison = (): Value => {
    const left = parseUnary();
    if (eat('==')) return looseEquals(left, parseUnary());
    if (eat('!=')) return !looseEquals(left, parseUnary());
    return left;
  };

  const parseUnary = (): Value => {
    if (eat('!')) return !truthy(parseUnary());
    return parsePrimary();
  };

  const parsePrimary = (): Value => {
    const token = peek();
    if (!token) throw new Error(`unexpected end of job condition: ${body}`);
    if (token.kind === 'str') {
      pos += 1;
      return token.value;
    }
    if (token.kind === 'num') {
      pos += 1;
      return Number(token.value);
    }
    if (token.kind === 'op' && token.value === '(') {
      pos += 1;
      const inner = parseOr();
      expect(')');
      return inner;
    }
    if (token.kind !== 'word') {
      throw new Error(`unexpected token ${JSON.stringify(token.value)} in job condition: ${body}`);
    }
    pos += 1;
    // A function call.
    if (peek()?.kind === 'op' && peek()?.value === '(') {
      pos += 1;
      const args: Value[] = [];
      if (!eat(')')) {
        do {
          args.push(parseOr());
        } while (eat(','));
        expect(')');
      }
      return callFunction(token.value, args, body);
    }
    if (token.value === 'true') return true;
    if (token.value === 'false') return false;
    if (token.value === 'null') return null;
    if (!(token.value in context)) {
      throw new Error(
        `job condition reads the unmodelled context \`${token.value}\`: ${body}. ` +
          'tests/security/publish-guard.test.ts cannot decide whether that condition is safe, ' +
          'so it refuses to guess. Model the value in SCENARIOS, or express the guard in terms ' +
          'this file already evaluates.',
      );
    }
    return context[token.value] as string;
  };

  const result = parseOr();
  if (pos !== tokens.length) {
    throw new Error(`trailing tokens after a complete job condition: ${body}`);
  }
  return truthy(result);
}

function callFunction(name: string, args: Value[], body: string): Value {
  const text = (value: Value | undefined): string => String(value ?? '').toLowerCase();
  switch (name) {
    // All three are case-insensitive in GitHub expressions.
    case 'startsWith':
      return text(args[0]).startsWith(text(args[1]));
    case 'endsWith':
      return text(args[0]).endsWith(text(args[1]));
    case 'contains':
      return text(args[0]).includes(text(args[1]));
    case 'always':
      return true;
    case 'success':
      return true;
    case 'cancelled':
    case 'failure':
      return false;
    default:
      throw new Error(
        `job condition calls the unmodelled function \`${name}()\`: ${body}. ` +
          'Implement it in tests/security/publish-guard.test.ts before relying on it here.',
      );
  }
}

// ---------------------------------------------------------------------------
// The scenario table. One row per way this workflow can be started.
// ---------------------------------------------------------------------------

interface Scenario {
  readonly name: string;
  readonly context: Readonly<Record<string, string>>;
  /** Whether a release-path job is ALLOWED to run under this trigger. */
  readonly reaches: boolean;
}

function githubContext(
  eventName: string,
  ref: string,
  refName: string,
  refType: string,
): Record<string, string> {
  return {
    'github.event_name': eventName,
    'github.ref': ref,
    'github.ref_name': refName,
    'github.ref_type': refType,
    'github.repository': 'elvatis/elvatis-mcp',
    'github.repository_owner': 'elvatis',
    'github.sha': '0'.repeat(40),
  };
}

const SCENARIOS: Scenario[] = [
  {
    // THE DEFECT, exactly as measured on 2026-08-21.
    name: 'a manual dispatch of an unreviewed topic branch',
    context: githubContext('workflow_dispatch', 'refs/heads/topic/publish-me', 'topic/publish-me', 'branch'),
    reaches: false,
  },
  {
    name: 'a manual dispatch of main',
    context: githubContext('workflow_dispatch', 'refs/heads/main', 'main', 'branch'),
    reaches: false,
  },
  {
    // The half that deleting the OR-branch alone would leave open: the
    // Run-workflow dropdown lists tags too, and tag protection is 404 here.
    name: 'a manual dispatch of a v-tag from the Run-workflow dropdown',
    context: githubContext('workflow_dispatch', 'refs/tags/v9.9.9', 'v9.9.9', 'tag'),
    reaches: false,
  },
  {
    name: 'an ordinary push to main',
    context: githubContext('push', 'refs/heads/main', 'main', 'branch'),
    reaches: false,
  },
  {
    name: 'a pull request',
    context: githubContext('pull_request', 'refs/pull/61/merge', '61/merge', 'branch'),
    reaches: false,
  },
  {
    name: 'a pull_request_target from a fork',
    context: githubContext('pull_request_target', 'refs/heads/main', 'main', 'branch'),
    reaches: false,
  },
  {
    name: 'a push of a tag that is not a version',
    context: githubContext('push', 'refs/tags/nightly-2026-08-21', 'nightly-2026-08-21', 'tag'),
    reaches: false,
  },
  {
    // LIVENESS. Without this row every assertion above is satisfied by a guard
    // that can never fire, and the release path would be quietly dead.
    name: 'a push of a v-tag, the one intended release path',
    context: githubContext('push', 'refs/tags/v1.2.5', 'v1.2.5', 'tag'),
    reaches: true,
  },
];

// ---------------------------------------------------------------------------

describe('the npm publish is reachable only from a pushed v-tag', () => {
  it('still publishes at all (guard the guard)', () => {
    const publishing = jobs().filter(({ job }) => publishesToRegistry(job));

    assert.ok(
      publishing.length > 0,
      `No job under .github/workflows/ runs \`npm publish\` (scanned: ${workflowFiles().join(', ')}). ` +
        'If publishing moved out of this repository, this file must move with it; every assertion ' +
        'below is vacuously true over an empty job list.',
    );
  });

  it('marks every release-path job with a condition', () => {
    const unconditional = releasePathJobs()
      .filter(({ job }) => typeof job.if !== 'string' || job.if.trim() === '')
      .map(label);

    assert.deepEqual(
      unconditional,
      [],
      `A release-path job with no \`if:\` runs on every trigger its workflow accepts, including ` +
        `a manual dispatch of any branch. Offenders: ${unconditional.join(', ')}`,
    );
  });

  it('states that condition in terms this file can actually evaluate', () => {
    // Separated from the scenario assertions so that an unreadable condition
    // reports itself as unreadable rather than as an unrelated failure.
    for (const named of releasePathJobs()) {
      assert.doesNotThrow(
        () => evaluate(String(named.job.if), SCENARIOS[0]?.context ?? {}),
        `The \`if:\` on job \`${label(named)}\` uses syntax or context this guard does not model, so ` +
          'the scenario table below cannot decide whether it is safe.',
      );
    }
  });

  it('lets no trigger but a pushed v-tag reach a release-path job', () => {
    const escapes: string[] = [];
    for (const named of releasePathJobs()) {
      for (const scenario of SCENARIOS.filter((s) => !s.reaches)) {
        if (evaluate(String(named.job.if), scenario.context)) {
          escapes.push(`${label(named)} runs on ${scenario.name}`);
        }
      }
    }

    assert.deepEqual(
      escapes,
      [],
      'A release-path job is reachable from a trigger that is not a pushed v-tag. `workflow_dispatch:` ' +
        'parses to null, so the Run-workflow dialog accepts any branch AND any tag; the condition must ' +
        'therefore assert `github.event_name == \'push\'`, which no dialog can forge, and not only the ' +
        `shape of github.ref. Escapes: ${escapes.join('; ')}`,
    );
  });

  it('still lets a pushed v-tag publish, so the guard is not a wall', () => {
    const release = SCENARIOS.find((s) => s.reaches);
    assert.ok(release, 'the scenario table lost its liveness row');

    const dead = releasePathJobs()
      .filter(({ job }) => !evaluate(String(job.if), release.context))
      .map(label);

    assert.deepEqual(
      dead,
      [],
      'Every negative scenario passes and the release path is dead: a pushed v-tag no longer reaches ' +
        `these jobs, so cutting a release would silently do nothing. Unreachable: ${dead.join(', ')}`,
    );
  });

  it('checks out the commit that triggered the run, not a moving ref', () => {
    // `actions/checkout` with no `ref:` resolves `github.ref`. On a tag push that
    // is the tag, which can be moved between the build job and this one; under
    // the old dispatch path it was the dispatched branch outright.
    const unbound: string[] = [];
    for (const named of releasePathJobs()) {
      for (const step of checkoutSteps(named.job)) {
        const ref = String(step.with?.['ref'] ?? '').replace(/\s+/g, ' ').trim();
        if (ref !== PINNED_CHECKOUT_REF) {
          unbound.push(`${label(named)}: ${step.uses} with ref=${ref === '' ? '(absent)' : ref}`);
        }
      }
    }

    assert.deepEqual(
      unbound,
      [],
      `Every checkout in a release-path job must pin \`ref: ${PINNED_CHECKOUT_REF}\`, so the tree that ` +
        'gets published is the tree the build job verified. Offenders: ' +
        unbound.join(', '),
    );
  });

  it('publishes only after the build job, so the tagged tree was typechecked and tested', () => {
    // `needs:` names a job in the SAME file, so the candidate build jobs are
    // scoped to the publishing job's own workflow. That is also what makes a
    // second workflow file fail here rather than borrow ci.yml's build: the
    // deleted publish.yml had no typecheck job at all, it ran `npm run build`
    // inline and published whatever came out.
    for (const publisher of jobs().filter(({ job }) => publishesToRegistry(job))) {
      const buildJobs = jobs()
        .filter(
          (candidate) =>
            candidate.file === publisher.file &&
            (candidate.job.steps ?? []).some((step) => step.run === 'npm run typecheck'),
        )
        .map((candidate) => candidate.id);

      assert.ok(
        buildJobs.length > 0,
        `\`${publisher.file}\` publishes to the public registry but contains no job running ` +
          '`npm run typecheck`, so there is nothing in that workflow for the publish to depend on.',
      );

      const needs =
        typeof publisher.job.needs === 'string' ? [publisher.job.needs] : (publisher.job.needs ?? []);
      assert.ok(
        buildJobs.some((build) => needs.includes(build)),
        `Job \`${label(publisher)}\` publishes to the public registry without \`needs:\` on a job ` +
          `that typechecks and tests the tree. Expected one of ${JSON.stringify(buildJobs)}, found ` +
          `${JSON.stringify(needs)}.`,
      );
    }
  });

  it('refuses a tag whose name disagrees with the version it would publish', () => {
    // EXECUTED, not pattern-matched, for the same reason the `if:` is: a regex
    // looking for `GITHUB_REF_NAME` passes on a script that reads the variable
    // and then ignores it. Each publishing job's own shell script is run against
    // an agreeing pair and three disagreeing ones, in a throwaway directory
    // holding nothing but a package.json.
    assert.equal(
      spawnSync('sh', ['-c', 'exit 0']).status,
      0,
      'this assertion EXECUTES the workflow step, and `sh` could not be started. It is present on ' +
        'ubuntu-latest and in Git Bash; without it this file cannot decide the question and ' +
        'deliberately refuses to pass rather than assume.',
    );

    const publishing = jobs().filter(({ job }) => publishesToRegistry(job));
    assert.ok(publishing.length > 0, 'no publishing job to check; see the first assertion');

    for (const publisher of publishing) {
      const candidates = versionGateCandidates(publisher.job);
      const runnable = candidates.filter((c) => !c.refused);

      const verdicts = runnable.map(({ script }) => {
        const shipped = '1.2.5';
        const attempt = (tag: string): number =>
          runShell(interpolate(script, githubContext('push', `refs/tags/${tag}`, tag, 'tag')), {
            GITHUB_REF_NAME: tag,
            GITHUB_REF: `refs/tags/${tag}`,
          }, shipped);
        return {
          first: script.split('\n')[0],
          // The tag names the version that would actually ship.
          agreeing: attempt(`v${shipped}`),
          // The tag announces a version the tree does not carry.
          ahead: attempt('v1.3.0'),
          behind: attempt('v1.2.4'),
          // A tag that is a PREFIX of the shipped version - what a `startsWith`
          // or `contains` comparison waves through and an equality test does not.
          prefix: attempt('v1.2'),
        };
      });

      const gate = verdicts.find(
        (v) => v.agreeing === 0 && v.ahead !== 0 && v.behind !== 0 && v.prefix !== 0,
      );

      assert.ok(
        gate,
        `Job \`${label(publisher)}\` publishes to the public registry with no step that fails when ` +
          'the tag and package.json disagree, so nothing ties the version on the registry to the tag ' +
          'that produced it or to the GitHub Release announcing it: tagging `v1.3.0` on a tree whose ' +
          'package.json still reads `1.2.5` ships 1.2.5 under a release called v1.3.0. publish.yml ' +
          'carried this check until it was deleted on 2026-06-27 and the move into ci.yml did not ' +
          `bring it across. Scripts executed (0 = accepted the tag): ${JSON.stringify(verdicts)}. ` +
          `Refused as unsafe to execute here: ${JSON.stringify(
            candidates.filter((c) => c.refused).map((c) => c.script.split('\n')[0]),
          )}.`,
      );
    }
  });
});
