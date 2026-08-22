/**
 * The forbidden-pattern rule is evaluated, and it can see the code.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * `aahp.config.json` has declared a `forbiddenPatterns` rule banning U+2014
 * since this repository was created. Nothing ever ran it. The two AAHP commands
 * in `.github/workflows/aahp-verify.yml` were `aahp verify --level ci` and
 * `aahp doctor --json`, and neither evaluates forbidden patterns; the command
 * that does is `aahp check`, which no workflow called and no npm script wrapped.
 *
 * Measured on `main` at df66e15: 112 occurrences of U+2014 across 35 of 101
 * tracked files, including `src/index.ts` (9), `tests/unit.test.ts` (10) and
 * `.ai/notes/handoff-session-resume.md` (23). CONTRIBUTING.md stated the same
 * rule in prose. So the repository published a rule, declared it in a config
 * file that reads like enforcement, violated it 112 times, and stayed green.
 *
 * THE SECOND DEFECT, WHICH ONLY APPEARS ONCE THE FIRST IS FIXED
 * ---------------------------------------------------------------------------
 * Wiring `aahp check` in is not sufficient, and this is the part worth reading.
 * The gate's default file list is:
 *
 *   *.md *.mjs *.js *.json *.sh *.bash *.bats *.yml *.yaml *.txt
 *
 * `*.ts` is not in it. This is a TypeScript project. So the gate, once wired,
 * would have reported CLEAN over the entire `src/` tree by construction: 49 of
 * the 112 occurrences sat in files it could not open, and the em dash could
 * never be caught in the place it is actually written. A gate that runs, passes,
 * and is structurally incapable of seeing its subject is worse than one that
 * never runs, because the passing tick is now evidence.
 *
 * `aahp.config.json` therefore declares an explicit `include` that restates the
 * default list and adds `*.ts` and `.env.example`. That is a WIDENING. The
 * acceptance criterion for issue #67 is that the gate is green because the
 * matches were removed, not because the rule was relaxed, so the direction
 * matters and the rows below assert it.
 *
 * WHAT EACH GROUP OF ROWS GUARDS
 * ---------------------------------------------------------------------------
 *   - "no em dash survives": the CONSEQUENCE, asserted here without asking
 *     `aahp check` anything. It enumerates every tracked file itself. If the
 *     config were narrowed, the CLI replaced, or the gate deleted from CI, this
 *     row still goes red on the first reintroduced character. It is deliberately
 *     independent of the machinery it is defending, because every dead gate in
 *     this repository was defended by something that shared its blind spot.
 *   - "the gate can see the code": the include list, expanded through
 *     `git ls-files`, must cover every tracked text file. This is what catches
 *     the narrowing that the row above cannot: dropping `*.ts` from `include`
 *     leaves the tree clean today and reopens `src/` to the next edit.
 *   - "the rule is still the rule": pattern, id, and the absence of `exclude`.
 *     Relaxing the pattern into something unmatchable is the one-line way to
 *     make a denylist pass forever with every visible sign of it intact.
 *   - the wiring rows: a job runs `aahp check`, with no `if:`, no
 *     `continue-on-error`, no `|| true`, on pull requests, unfiltered by path.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That the gate blocks a merge. `required_status_checks` on this repository's
 * default branch is `null` (measured 2026-08-21, and SECURITY.md says so in
 * public), so this check reports. That is a repository setting, unreachable
 * from any file here.
 *
 * Nor that `aahp check`'s other gates are asserted here. This file is about
 * `forbiddenPatterns`. The changelog gates that `aahp check` also runs have
 * their own repository-local implementation in
 * `scripts/check-changelog-heading.mjs`, which owns its exit codes rather than
 * inheriting them from a dependency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');
const CONFIG_FILE = join(REPO_ROOT, 'aahp.config.json');

/**
 * The banned codepoint, constructed rather than typed, so the file asserting
 * the ban does not itself violate it. A literal in the source would make this
 * file the 113th match, and a `\u` escape can be normalised back to a literal
 * by an editor; a character code cannot.
 */
const EM_DASH = String.fromCharCode(0x2014);

/** The rule this file is about. */
const RULE_ID = 'em-dash';

/** The command that evaluates `forbiddenPatterns`. `verify` and `doctor` do not. */
const CHECK_COMMAND = /\baahp\s+check\b/;

interface Rule {
  readonly id?: string;
  readonly pattern?: string;
  readonly flags?: string;
  readonly include?: string[];
  readonly exclude?: string[];
  readonly message?: string;
}

function config(): { forbiddenPatterns?: Rule[] } {
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as { forbiddenPatterns?: Rule[] };
}

function emDashRule(): Rule {
  const rules = config().forbiddenPatterns ?? [];
  const rule = rules.find((candidate) => candidate.id === RULE_ID);
  assert.ok(
    rule,
    `aahp.config.json declares no \`${RULE_ID}\` rule. Found: ${JSON.stringify(rules.map((r) => r.id))}. ` +
      'Deleting the rule is one way to make this gate pass forever.',
  );
  return rule;
}

/**
 * Tracked files, from git rather than a directory walk, because that is what
 * the gate itself enumerates: an untracked file is not scanned by either.
 *
 * `execFileSync` with an argument array, never a shell string. The pathspecs
 * below come from a config file, and a shell would be one editable string away
 * from running something else.
 */
function tracked(pathspecs: readonly string[] = []): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split('\0').filter((name) => name.length > 0);
}

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string | boolean;
  readonly 'continue-on-error'?: unknown;
}

interface Job {
  readonly if?: string | boolean;
  readonly steps?: Step[];
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
  return tracked(['.github/workflows/*.yml', '.github/workflows/*.yaml']).map((path) =>
    path.slice('.github/workflows/'.length),
  );
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

function checkSteps(job: Job): Step[] {
  return (job.steps ?? []).filter(
    (step) => typeof step.run === 'string' && CHECK_COMMAND.test(step.run),
  );
}

function checkJobs(): NamedJob[] {
  return jobs().filter((named) => checkSteps(named.job).length > 0);
}

function triggers(workflow: Workflow): Record<string, unknown> {
  const on = workflow.on ?? (workflow as unknown as Record<string, unknown>)['true'];
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((name) => [String(name), null]));
  if (on !== null && typeof on === 'object') return on as Record<string, unknown>;
  throw new Error(
    'a workflow carrying `aahp check` has an `on:` block this file cannot read. Extend triggers() ' +
      'rather than dropping the assertion.',
  );
}

// ---------------------------------------------------------------------------

describe('the em dash is actually gone, which is the only thing the gate is for', () => {
  it('finds no U+2014 in any tracked file', () => {
    // The consequence row. It asks git, reads the files, and counts. It does not
    // consult aahp.config.json, so narrowing the config cannot make it pass, and
    // it does not consult the workflow, so deleting the job cannot either.
    const offenders: string[] = [];
    let total = 0;

    for (const rel of tracked()) {
      let text: string;
      try {
        text = readFileSync(join(REPO_ROOT, rel), 'utf8');
      } catch {
        continue;
      }
      let count = 0;
      for (const character of text) if (character === EM_DASH) count += 1;
      if (count > 0) {
        offenders.push(`${rel} (${count})`);
        total += count;
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `${total} occurrence(s) of U+2014 in ${offenders.length} tracked file(s): ` +
        `${offenders.join(', ')}. CONTRIBUTING.md bans the character and aahp.config.json declares ` +
        'the rule; use a hyphen. If the text is a recorded value that must not change, escape it ' +
        'rather than editing it, as benchmarks/results/ does.',
    );
  });
});

describe('the gate can see the code, which the default file list does not', () => {
  it('scans every tracked TypeScript file', () => {
    // The defect that only appears once the gate is wired. The AAHP default
    // include list has no `*.ts` entry, so on this project the gate would have
    // reported CLEAN over all of `src/` by construction. 49 of the 112
    // occurrences on `main` were in files it could not open.
    const scanned = new Set(tracked(emDashRule().include ?? []));
    const typescript = tracked(['*.ts']);

    assert.ok(
      typescript.length > 0,
      'No tracked .ts files found, so this assertion is aimed at nothing and would pass on an ' +
        'empty repository.',
    );

    const invisible = typescript.filter((rel) => !scanned.has(rel));
    assert.deepEqual(
      invisible,
      [],
      `${invisible.length} of ${typescript.length} tracked TypeScript files are outside the ` +
        `\`include\` list in aahp.config.json, so the em-dash gate cannot open them: ` +
        `${invisible.slice(0, 5).join(', ')}. The AAHP default list has no \`*.ts\` entry, which ` +
        'is why this repository restates the defaults explicitly and adds it.',
    );
  });

  it('scans every tracked text file, not only the ones it started with', () => {
    // Wider than the row above, and it is what catches a NEW kind of file
    // arriving that nobody adds to the list. Binary and asset files are
    // excluded by extension rather than by guessing at their content.
    const BINARY = /\.(png|jpe?g|gif|ico|webp|pdf|zip|gz|woff2?|ttf|eot|mp[34]|wasm)$/i;
    const scanned = new Set(tracked(emDashRule().include ?? []));

    const unscanned = tracked().filter(
      (rel) => !scanned.has(rel) && !BINARY.test(rel) && !rel.endsWith('/.gitkeep'),
    );

    assert.deepEqual(
      unscanned,
      [],
      `${unscanned.length} tracked text file(s) are outside the em-dash gate's \`include\` list: ` +
        `${unscanned.join(', ')}. Either add the pattern to aahp.config.json, or extend the BINARY ` +
        'exclusion here with the reason. A file type the gate cannot open is a file type the rule ' +
        'does not apply to, whatever CONTRIBUTING.md says.',
    );
  });
});

describe('the rule is still the rule, and was not relaxed into one that cannot match', () => {
  it('still bans U+2014', () => {
    const rule = emDashRule();
    assert.equal(
      rule.pattern,
      '\\u2014',
      `The \`${RULE_ID}\` rule's pattern is ${JSON.stringify(rule.pattern)}. Changing it to ` +
        'something unmatchable makes the gate pass forever with the job, the config entry and the ' +
        'CONTRIBUTING.md sentence all still in place.',
    );

    // The pattern has to actually match the character it names. A typo'd escape
    // is a valid regex that matches nothing, and every other row here would
    // stay green.
    assert.match(
      EM_DASH,
      new RegExp(rule.pattern as string, rule.flags || 'gm'),
      `The configured pattern ${JSON.stringify(rule.pattern)} does not match U+2014 itself.`,
    );
  });

  it('carves nothing out with `exclude`', () => {
    const rule = emDashRule();
    assert.equal(
      rule.exclude,
      undefined,
      `The \`${RULE_ID}\` rule excludes ${JSON.stringify(rule.exclude)}. Nothing needs an exclusion: ` +
        'the one recorded value that legitimately contains the character, a captured model response ' +
        'under benchmarks/results/, stores it as a JSON escape, so its parsed value is unchanged and ' +
        'the file carries no literal. An exclusion list is where the next real violation goes to hide.',
    );
  });
});

describe('the gate runs, which for its entire life it did not', () => {
  it('is invoked by a CI job', () => {
    const found = checkJobs();
    assert.ok(
      found.length > 0,
      `No job in ${JSON.stringify(workflowFiles())} runs \`aahp check\`. \`aahp verify\` and ` +
        '`aahp doctor` do not evaluate forbiddenPatterns; only `check` does. This is exactly the ' +
        'state issue #67 describes: a rule declared in aahp.config.json that nothing executes.',
    );
  });

  it('runs on pull requests, unfiltered by path', () => {
    for (const named of checkJobs()) {
      const on = triggers(named.workflow);
      assert.ok(
        Object.prototype.hasOwnProperty.call(on, 'pull_request'),
        `\`${named.file}\` hosts \`aahp check\` but does not run on \`pull_request\`.`,
      );

      for (const [trigger, cfg] of Object.entries(on)) {
        if (cfg === null || cfg === undefined) continue;
        if (typeof cfg !== 'object' || Array.isArray(cfg)) {
          throw new Error(
            `\`${named.file}\` configures trigger \`${trigger}\` in a shape this file cannot read ` +
              `(${JSON.stringify(cfg)}). Extend the assertion rather than removing it.`,
          );
        }
        for (const filter of ['paths', 'paths-ignore']) {
          assert.equal(
            Object.prototype.hasOwnProperty.call(cfg, filter),
            false,
            `\`${named.file}\` filters \`${trigger}\` by \`${filter}\`. A denylist that only runs ` +
              'when certain files change is not a denylist.',
          );
        }
      }
    }
  });

  it('carries no `if:` and no `continue-on-error`, on the job or on any of its steps', () => {
    // The Dependabot exemption on the `aahp-verify` job is why `aahp check` got
    // its own job rather than a step there: inheriting that `if:` would make a
    // denylist conditional on who opened the pull request.
    for (const named of checkJobs()) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(named.job, 'if'),
        false,
        `\`${label(named)}\` is conditional, so it decides when the gate is allowed to have an ` +
          'opinion. A skipped job does not report failure.',
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(named.job, 'continue-on-error'),
        false,
        `\`${label(named)}\` is \`continue-on-error\`, so the gate reports and the run succeeds.`,
      );

      for (const step of named.job.steps ?? []) {
        const where = `step \`${step.name ?? step.run ?? step.uses ?? '(unnamed)'}\` of \`${label(named)}\``;
        assert.equal(
          Object.prototype.hasOwnProperty.call(step, 'if'),
          false,
          `${where} is conditional, so it can be skipped into silence.`,
        );
        assert.equal(
          Object.prototype.hasOwnProperty.call(step, 'continue-on-error'),
          false,
          `${where} is \`continue-on-error\`.`,
        );
      }
    }
  });

  it('is invoked with its exit status intact', () => {
    const SWALLOWED = /\|\|\s*(true|:|exit\s+0)|;\s*(true|exit\s+0)\s*$/m;

    for (const named of checkJobs()) {
      for (const step of checkSteps(named.job)) {
        assert.equal(
          SWALLOWED.test(step.run as string),
          false,
          `\`${label(named)}\` runs \`aahp check\` and discards its exit status:\n${step.run}`,
        );
      }
    }
  });

  it('stays wired into `npm test`', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const testScript = pkg.scripts?.test ?? '';
    assert.ok(
      testScript.includes('tests/security/forbidden-patterns.test.ts'),
      `\`npm test\` no longer runs this file: ${JSON.stringify(testScript)}. node:test only runs the ` +
        'files it is handed.',
    );
  });
});
