/**
 * A change cannot land on `main` under a version number the registry has
 * already issued.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * `package.json` last changed its version on 2026-03-31. `1.2.4` was published
 * on 2026-04-15. `main` then took 35 further commits, two of them security
 * fixes - the command-injection remediation of 2026-06-28 and the `--channel`
 * escaping fix of 2026-08-19 - without the number ever moving. Both fixes are
 * correct. Both are merged. Neither can be installed by anybody, because npm
 * refuses a duplicate version and `v1.2.4` already exists, so re-tagging is not
 * a way out either. For four months `npm install` served the vulnerable April
 * tarball while the tree said the bug was fixed.
 *
 * Every check in this repository stayed green throughout, and each was right to:
 * the tree typechecks, builds, tests, and its release path is guarded. What no
 * check asked was whether that release path could ever be walked. The guard in
 * publish-guard.test.ts proves the publish is reachable only from a pushed
 * v-tag; it says nothing about a version that a pushed v-tag could not publish.
 *
 * So this is the 2026-08-18 failure mode again, in its purest form: a gate that
 * cannot fire. The remedy is a check whose subject is the CONSEQUENCE - can the
 * code in this tree reach a user, yes or no - rather than the configuration
 * that is supposed to deliver it.
 *
 * WHY THE REGISTRY, AND NOT A FILE IN THIS TREE
 * ---------------------------------------------------------------------------
 * The authority on which numbers are taken is the registry, and only the
 * registry. A git tag can be missing, moved, or created for a version that was
 * never published; a CHANGELOG heading is prose; `dist-tags.latest` moves under
 * `npm dist-tag` without a publish. None of them is what npm consults when it
 * accepts or rejects a tarball. scripts/check-version-unpublished.mjs asks the
 * registry over the network and decides on an exact key lookup in the `versions`
 * map it returns.
 *
 * THE FAIL-CLOSED HALF IS THE HALF THAT MATTERS
 * ---------------------------------------------------------------------------
 * A version check that answers "sure, go ahead" when it could not reach the
 * registry is worse than no check, because it launders an absence of evidence
 * into a green tick. An unreachable registry is not a neutral moment - it is
 * exactly the moment a bad publish slips through. So every unreadable outcome
 * exits 2 and 2 is not 0: refused connection, timeout, 5xx, a body that is not
 * JSON, and - the subtle one - a 200 that carries no `versions` map at all. A
 * proxy error page, a captive portal and a truncated response all arrive as
 * "200 with a body", and to anything less strict they read as "no version is
 * taken, publish away".
 *
 * Each assertion below is stated in BOTH directions. A predicate only ever
 * demonstrated firing might fire on everything; one only ever demonstrated
 * silent might be incapable of firing. Both halves, or it proves nothing.
 *
 * THE SCRIPT IS EXECUTED, NOT READ
 * ---------------------------------------------------------------------------
 * Every scenario below runs the real script as a real child process against a
 * real HTTP server, and asserts its exact exit status. A regex over the source
 * would pass on a script that computes the right answer and then exits 0
 * regardless, which is the defeat that four separate regex gates in this estate
 * suffered on 2026-08-21 without a single line being deleted from any of them.
 *
 * Exit statuses are asserted EXACTLY, never as "non-zero". A script that has
 * been deleted, renamed or made unparseable exits 1 from node itself, and 1 is
 * this script's "already published" verdict; accepting any non-zero would let a
 * missing gate impersonate a working one on eight of the rows below.
 *
 * THE ONE-LINE MUTATIONS THIS FILE IS HERE TO CATCH
 * ---------------------------------------------------------------------------
 *   - `process.exit(EXIT_ALREADY_PUBLISHED)` softened to a warning, or the
 *     comparison inverted: "refuses a version the registry has already issued".
 *   - the comparison loosened from an exact key lookup to `includes()` on the
 *     response body: "1.2.4 and 1.2.40 are different versions" is the row that
 *     tells an exact match from a substring one, and nothing else does.
 *   - any `undetermined()` path relaxed to exit 0: the five fail-closed rows.
 *     `catch { return { published: new Set() } }` is one line and passes every
 *     other test in this file.
 *   - the gate removed from CI, or neutered in place with `continue-on-error`,
 *     an `if:` that cannot be true, `|| true`, or a `paths:` filter on the
 *     workflow so the job never runs on the pull request that needed it. Those
 *     are the six shapes that left a contract gate reporting CLEAN elsewhere in
 *     this estate on 2026-08-21, and they are enumerated over every job AND
 *     every step, not looked for in one expected place.
 *   - `--registry` added to the CI invocation, which would point the gate at
 *     something other than the registry that actually decides.
 *   - the whole thing made vacuous by tightening it into a wall: the liveness
 *     rows assert the gate still says yes to a free version, so a mutation that
 *     makes it always fail is as red as one that makes it always pass.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That the version is CORRECT - that a breaking change took a major. Nothing
 * mechanical can read intent out of a diff. It claims only that the number is
 * unused, which is the property that decides whether this tree can be installed
 * by anyone at all.
 *
 * Nor that anyone is obliged to look. There is no required status check on this
 * repository's default branch (measured 2026-08-21, and SECURITY.md says so in
 * public), so this job reports rather than blocks. That is a repository setting,
 * unreachable from any file in this tree.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

/** The gate itself. Renaming it without updating this constant fails loudly. */
const GUARD_SCRIPT_NAME = 'check-version-unpublished.mjs';
const GUARD_SCRIPT = join(REPO_ROOT, 'scripts', GUARD_SCRIPT_NAME);

/** The script's contract. Asserted exactly, never as "non-zero". */
const OK = 0;
const ALREADY_PUBLISHED = 1;
const UNDETERMINED = 2;

const PACKAGE_NAME = '@elvatis_com/elvatis-mcp';

// ---------------------------------------------------------------------------
// Running the real thing
// ---------------------------------------------------------------------------

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn the guard as a child process and wait for its exit status.
 *
 * Asynchronous on purpose. `spawnSync` would block this process's event loop,
 * and the fake registry each scenario talks to lives in this very process - a
 * synchronous spawn deadlocks against its own server and every row would time
 * out into a uniform, meaningless failure.
 */
function runGuard(args: readonly string[]): Promise<Run> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [GUARD_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));

    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (code === null) {
        rejectPromise(new Error(`the guard was killed by ${signal} instead of exiting`));
        return;
      }
      resolvePromise({ code, stdout, stderr });
    });
  });
}

/** A throwaway package.json at a chosen name and version. */
function fixturePackage(version: string, name: string = PACKAGE_NAME): string {
  const dir = mkdtempSync(join(tmpdir(), 'version-guard-'));
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify({ name, version }, null, 2), 'utf8');
  return path;
}

/** Whatever a fixture wrote, gone, whether the assertion passed or threw. */
const fixtures: string[] = [];
function fixture(version: string, name?: string): string {
  const path = fixturePackage(version, name);
  fixtures.push(path);
  return path;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Stand up a fake registry, run the guard against it, tear it down. Sockets are
 * tracked and destroyed because the hung-response scenario deliberately leaves
 * one open, and an untracked socket keeps `server.close()` waiting forever.
 */
async function withRegistry(handler: Handler, use: (base: string) => Promise<void>): Promise<void> {
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;

  try {
    await use(`http://127.0.0.1:${port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** A registry that publishes exactly these versions and nothing else. */
function serving(versions: readonly string[], latest?: string): Handler {
  return (_req, res) => {
    const body = JSON.stringify({
      name: PACKAGE_NAME,
      'dist-tags': { latest: latest ?? versions[versions.length - 1] },
      versions: Object.fromEntries(versions.map((v) => [v, { name: PACKAGE_NAME, version: v }])),
    });
    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
  };
}

/** A registry that answers with a literal body and status, whatever they are. */
function answering(status: number, body: string): Handler {
  return (_req, res) => res.writeHead(status, { 'content-type': 'application/json' }).end(body);
}

/** One attempt, a short timeout: scenarios assert a verdict, not patience. */
const FAST = ['--attempts', '1', '--timeout-ms', '1500'];

async function verdict(
  handler: Handler,
  version: string,
  extra: readonly string[] = [],
): Promise<Run> {
  let run: Run | undefined;
  await withRegistry(handler, async (base) => {
    run = await runGuard(['--package', fixture(version), '--registry', base, ...FAST, ...extra]);
  });
  return run as Run;
}

function why(run: Run): string {
  return `\nexit ${run.code}\nstdout: ${run.stdout.trim()}\nstderr: ${run.stderr.trim()}`;
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

/** package.json `scripts`, so indirect wiring via `npm run x` is still found. */
function npmScripts(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

/**
 * Does this shell script reach the guard - directly, or through an npm script
 * that does? Indirection is followed rather than rejected, because `npm run
 * version-guard` is the more readable way to write it and a check that only
 * recognised the literal path would quietly stop seeing the gate the day
 * somebody tidied it.
 */
function invokesGuard(run: string): boolean {
  if (run.includes(GUARD_SCRIPT_NAME)) return true;
  const scripts = npmScripts();
  for (const [name, body] of Object.entries(scripts)) {
    if (!body.includes(GUARD_SCRIPT_NAME)) continue;
    if (new RegExp(String.raw`\bnpm\s+run\s+${name}\b`).test(run)) return true;
  }
  return false;
}

function guardSteps(job: Job): Step[] {
  return (job.steps ?? []).filter((step) => typeof step.run === 'string' && invokesGuard(step.run));
}

function guardJobs(): NamedJob[] {
  return jobs().filter((named) => guardSteps(named.job).length > 0);
}

/** `npm publish`, `id-token: write`, `contents: write` - the release path. */
const NPM_PUBLISH = /(^|[\s;&|(])npm\s+publish(\s|$)/m;

function permission(job: Job, scope: string): string | undefined {
  const perms = job.permissions;
  return typeof perms === 'object' && perms !== null ? perms[scope] : undefined;
}

function isReleasePathJob(job: Job): boolean {
  return (
    (job.steps ?? []).some((step) => typeof step.run === 'string' && NPM_PUBLISH.test(step.run)) ||
    permission(job, 'id-token') === 'write' ||
    permission(job, 'contents') === 'write'
  );
}

/** The `on:` block, normalised to the set of trigger names it declares. */
function triggers(workflow: Workflow): Record<string, unknown> {
  const on = workflow.on;
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((name) => [String(name), null]));
  if (on !== null && typeof on === 'object') return on as Record<string, unknown>;
  throw new Error(
    'a workflow carrying the version guard has an `on:` block this file cannot read. ' +
      'Extend triggers() rather than dropping the assertion - an unreadable trigger is ' +
      'exactly where a `paths:` filter would hide.',
  );
}

// ---------------------------------------------------------------------------

describe('a version already on the registry cannot carry a change', () => {
  it('refuses a version the registry has already issued', async () => {
    const run = await verdict(serving(['1.2.3', '1.2.4']), '1.2.4');
    assert.equal(
      run.code,
      ALREADY_PUBLISHED,
      'the guard accepted a version the registry already lists. This is the whole defect: ' +
        'two merged security fixes sat on `main` under a published number for four months, ' +
        `unshippable and unnoticed.${why(run)}`,
    );
  });

  it('accepts a version the registry has never issued, so the gate is not a wall', async () => {
    // The liveness half. A guard that refuses everything blocks the release it
    // exists to make possible, and every negative row above stays green while
    // it does - which is how a gate that cannot fire and a gate that always
    // fires both end up switched off.
    const run = await verdict(serving(['1.2.3', '1.2.4']), '1.3.0');
    assert.equal(
      run.code,
      OK,
      `the guard refused a version the registry does not list, so no release is possible.${why(run)}`,
    );
  });

  it('treats a version number the registry lists but has withdrawn as taken', async () => {
    // npm never re-issues a number, not even an unpublished one. Its entry can
    // be null in the packument; the key's PRESENCE is the fact that matters,
    // and a check reading values rather than keys would wave this through and
    // then fail at `npm publish` with the release already announced.
    const withdrawn: Handler = (_req, res) =>
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ name: PACKAGE_NAME, 'dist-tags': {}, versions: { '1.2.4': null } }));
    const run = await verdict(withdrawn, '1.2.4');
    assert.equal(
      run.code,
      ALREADY_PUBLISHED,
      `a withdrawn version number is still spent, and the guard treated it as free.${why(run)}`,
    );
  });

  it('publishes nothing about a package the registry has never seen', async () => {
    // 404 is a real answer, not a failure: nothing is published, so no version
    // is taken. This row is what keeps the fail-closed rows below honest -
    // without it, "exit 2 on anything unexpected" could be satisfied by a
    // script that never returns 0 at all.
    const run = await verdict(answering(404, JSON.stringify({ error: 'Not found' })), '0.0.1');
    assert.equal(
      run.code,
      OK,
      `the registry said the package does not exist, which frees every version.${why(run)}`,
    );
  });

  it('tells 1.2.4 from 1.2.40, in both directions', async () => {
    // The row that distinguishes an exact key lookup from `body.includes(v)`,
    // `startsWith` or a regex over the raw JSON. A substring comparison passes
    // every other assertion in this file and then blocks a legitimate release
    // - and a false positive is the failure mode that gets a working check
    // deleted rather than fixed.
    const shorterAgainstLonger = await verdict(serving(['1.2.40']), '1.2.4');
    assert.equal(
      shorterAgainstLonger.code,
      OK,
      `1.2.4 is not published merely because 1.2.40 is.${why(shorterAgainstLonger)}`,
    );

    const longerAgainstShorter = await verdict(serving(['1.2.4']), '1.2.40');
    assert.equal(
      longerAgainstShorter.code,
      OK,
      `1.2.40 is not published merely because 1.2.4 is.${why(longerAgainstShorter)}`,
    );

    // ...and the exact match still fires, so the two rows above are not passing
    // because the comparison stopped working altogether.
    const exact = await verdict(serving(['1.2.4']), '1.2.4');
    assert.equal(exact.code, ALREADY_PUBLISHED, `an exact match must still fire.${why(exact)}`);
  });

  it('asks the registry for the name in package.json, not a name of its own', async () => {
    // A guard hardcoding the package name keeps answering about the old package
    // after a rename, and answers about someone else's package after a fork.
    const asked: string[] = [];
    const recording: Handler = (req, res) => {
      asked.push(req.url ?? '');
      serving(['9.9.9'])(req, res);
    };
    const run = await verdict(recording, '1.0.0', []);
    assert.equal(run.code, OK, `expected a clean verdict from the recording registry.${why(run)}`);
    assert.deepEqual(
      asked,
      [`/${encodeURIComponent(PACKAGE_NAME)}`],
      'the guard did not request the scoped name from package.json in the form the registry ' +
        `expects (%40scope%2Fname). Asked for: ${JSON.stringify(asked)}.`,
    );
  });
});

describe('the guard fails closed, because an unreadable registry is when a bad publish slips through', () => {
  it('gives no verdict when the registry refuses the connection', async () => {
    // A port that was listening and is not any more: the shape of a registry
    // outage, a blocked egress rule, or a DNS answer pointing nowhere.
    let base = '';
    await withRegistry(serving([]), async (url) => {
      base = url;
    });
    const run = await runGuard(['--package', fixture('1.3.0'), '--registry', base, ...FAST]);
    assert.equal(
      run.code,
      UNDETERMINED,
      `a refused connection is not evidence that 1.3.0 is free.${why(run)}`,
    );
  });

  it('gives no verdict when the registry never answers', async () => {
    // Accepts the socket, then nothing. Distinct from a refusal: this is the
    // path through the request timeout, and a guard without one hangs until the
    // job's own timeout kills it - which some workflows treat as skippable.
    const hang: Handler = () => {
      /* deliberately no response */
    };
    const run = await verdict(hang, '1.3.0', []);
    assert.equal(run.code, UNDETERMINED, `a hung registry is not a green light.${why(run)}`);
  });

  it('gives no verdict on a server error', async () => {
    const run = await verdict(answering(500, 'upstream unavailable'), '1.3.0');
    assert.equal(run.code, UNDETERMINED, `HTTP 500 is not "no versions published".${why(run)}`);
  });

  it('gives no verdict on a body that is not JSON', async () => {
    // What a captive portal, a proxy error page or a truncated response looks
    // like: status 200, body meaningless.
    const run = await verdict(answering(200, '<html>proxy error</html>'), '1.3.0');
    assert.equal(
      run.code,
      UNDETERMINED,
      `a 200 whose body is not JSON told the guard nothing.${why(run)}`,
    );
  });

  it('gives no verdict on a 200 that carries no versions map', async () => {
    // The most dangerous shape in the file, and the easiest to get wrong:
    // `const versions = doc.versions ?? {}` is one line, reads as defensive,
    // and turns every malformed answer into "nothing is published, ship it".
    for (const [described, body] of [
      ['no `versions` key at all', JSON.stringify({ name: PACKAGE_NAME })],
      ['`versions` explicitly null', JSON.stringify({ name: PACKAGE_NAME, versions: null })],
      ['`versions` as an array', JSON.stringify({ name: PACKAGE_NAME, versions: [] })],
      ['an empty object', '{}'],
    ] as const) {
      const run = await verdict(answering(200, body), '1.3.0');
      assert.equal(
        run.code,
        UNDETERMINED,
        `a 200 with ${described} is not the same as "no versions are published".${why(run)}`,
      );
    }
  });

  it('gives no verdict when package.json cannot be read or does not say', async () => {
    // Deleting package.json, or emptying its `version`, must not read as "no
    // version is taken". Each of these is a plausible accident in a script that
    // rewrites the file, and each would otherwise buy a silent pass.
    const missing = join(mkdtempSync(join(tmpdir(), 'version-guard-')), 'package.json');
    const notJson = join(mkdtempSync(join(tmpdir(), 'version-guard-')), 'package.json');
    writeFileSync(notJson, '{ not json', 'utf8');
    const noVersion = join(mkdtempSync(join(tmpdir(), 'version-guard-')), 'package.json');
    writeFileSync(noVersion, JSON.stringify({ name: PACKAGE_NAME }), 'utf8');
    const noName = join(mkdtempSync(join(tmpdir(), 'version-guard-')), 'package.json');
    writeFileSync(noName, JSON.stringify({ version: '1.3.0' }), 'utf8');

    for (const [described, path] of [
      ['missing', missing],
      ['not JSON', notJson],
      ['carrying no `version`', noVersion],
      ['carrying no `name`', noName],
    ] as const) {
      let run: Run | undefined;
      await withRegistry(serving(['1.2.4']), async (base) => {
        run = await runGuard(['--package', path, '--registry', base, ...FAST]);
      });
      assert.equal(
        (run as Run).code,
        UNDETERMINED,
        `a package.json ${described} left the guard with nothing to check, and it passed anyway.${why(
          run as Run,
        )}`,
      );
    }
  });

  it('gives no verdict on an argument it does not understand', async () => {
    // A typo'd flag that is silently ignored is a gate running on defaults while
    // its author believes it is running on their arguments - which is how the
    // CI invocation and the thing being asserted here drift apart.
    for (const args of [['--nonsense', 'x'], ['positional'], ['--registry']]) {
      const run = await runGuard(['--package', fixture('1.3.0'), ...args]);
      assert.equal(
        run.code,
        UNDETERMINED,
        `\`${args.join(' ')}\` was accepted rather than refused.${why(run)}`,
      );
    }
  });
});

describe('the gate is wired into CI, and into a different check from the one it protects', () => {
  it('exists at the path this file executes', () => {
    assert.ok(
      existsSync(GUARD_SCRIPT),
      `${GUARD_SCRIPT} is missing. Every scenario above would then be asserting the exit status ` +
        'of a node process that could not find its entry point.',
    );
  });

  it('is reached by at least one CI job', () => {
    const found = guardJobs();
    assert.ok(
      found.length > 0,
      `No job in ${JSON.stringify(workflowFiles())} runs ${GUARD_SCRIPT_NAME}, directly or via an ` +
        'npm script. The script can be perfect and still guard nothing: this repository went four ' +
        'months with a correct fix that no path could deliver.',
    );
  });

  it('runs somewhere other than the release path it protects', () => {
    // A gate living inside the job it guards is checked only once that job has
    // already been reached - here, only once someone has pushed a v-tag, which
    // is months after the moment the version should have moved. It has to fire
    // on the pull request that lands the change.
    for (const named of guardJobs()) {
      assert.equal(
        isReleasePathJob(named.job),
        false,
        `\`${label(named)}\` both publishes (or holds release-path permissions) and hosts the ` +
          'version guard. The guard must report from a check the release path does not contain, ' +
          'or it can only ever speak after the fact.',
      );
    }
  });

  it('runs on pull requests, unfiltered by path', () => {
    // `paths:`/`paths-ignore:` on the workflow is the quietest of the six ways
    // a gate keeps every required flag and still never runs. A guard scoped to
    // `package.json` would have been silent for all 35 commits at issue here,
    // because not one of them touched the version.
    for (const named of guardJobs()) {
      const on = triggers(named.workflow);
      assert.ok(
        Object.prototype.hasOwnProperty.call(on, 'pull_request'),
        `\`${named.file}\` hosts the version guard but does not run on \`pull_request\`, so no ` +
          'pull request can be told that the version it carries is already spent.',
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
            `\`${named.file}\` filters \`${trigger}\` by \`${filter}\`, so the version guard does ` +
              'not run on every change. A commit outside the filter lands under a spent version ' +
              'with nothing red anywhere.',
          );
        }
      }
    }
  });

  it('carries no `continue-on-error` and no `if:`, on the job or on any of its steps', () => {
    // Six one-line edits left a contract gate elsewhere in this estate reporting
    // CLEAN with every required flag still in place: `|| true`, a second
    // `--exit-code 0`, and `continue-on-error` or `if:` on either a step or a
    // job. So both keys are enumerated at both levels rather than looked for
    // where they are expected.
    for (const named of guardJobs()) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(named.job, 'continue-on-error'),
        false,
        `\`${label(named)}\` is \`continue-on-error\`, so the version guard reports its verdict ` +
          'and the run succeeds regardless.',
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(named.job, 'if'),
        false,
        `\`${label(named)}\` is conditional. A condition on the job hosting this gate decides ` +
          'when the gate is allowed to have an opinion, which is the property it must not have.',
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

  it('is invoked with its exit status intact, and against the real registry', () => {
    // `|| true`, `|| exit 0`, `; true` and a trailing `exit 0` all leave the
    // command in the file and the flag on the command line. `--registry` is the
    // other shape: the gate still runs, still fails closed, still reports - and
    // answers about a registry that decides nothing.
    const SWALLOWED = /\|\|\s*(true|:|exit\s+0)|;\s*(true|exit\s+0)\s*$/m;

    for (const named of guardJobs()) {
      for (const step of guardSteps(named.job)) {
        const script = step.run as string;
        assert.equal(
          SWALLOWED.test(script),
          false,
          `\`${label(named)}\` runs the version guard but discards its exit status:\n${script}`,
        );
        assert.equal(
          /--registry\b/.test(script),
          false,
          `\`${label(named)}\` passes \`--registry\` to the version guard, pointing it at ` +
            'something other than the registry that actually accepts or rejects a publish. That ' +
            `flag exists for this test file and for nothing else.\n${script}`,
        );
      }
    }
  });

  it('stays wired into `npm test`, so this file is not the only thing asserting it', () => {
    // Self-reference, and a modest claim: it catches the half-edit that drops
    // this file from the test line while leaving it on disk. It cannot catch
    // deletion of the file itself - the CI job running the script is the other
    // half of that pair, and neither depends on the other.
    const testScript = npmScripts()['test'] ?? '';
    assert.ok(
      testScript.includes('tests/security/version-guard.test.ts'),
      `\`npm test\` no longer runs this file: ${JSON.stringify(testScript)}. node:test only runs ` +
        'the files it is handed, so a file dropped from that line goes quiet without failing.',
    );
  });
});

process.on('exit', () => {
  for (const path of fixtures) rmSync(join(path, '..'), { recursive: true, force: true });
});
