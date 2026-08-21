#!/usr/bin/env node
/**
 * Refuse a tree whose package.json version is ALREADY on the public registry.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `package.json` last changed its version on 2026-03-31. `1.2.4` went to the
 * public registry on 2026-04-15. Since then `main` accumulated 35 commits,
 * two of them security fixes:
 *
 *   2026-06-28  remediate 9 command-injection findings
 *   2026-08-19  --channel reached the remote shell unescaped and unvalidated
 *
 * Both are correct, both are merged, and neither could ever be installed. npm
 * refuses a duplicate version, and `v1.2.4` already exists so re-tagging cannot
 * help either. An April tarball cannot contain a June or an August fix, so for
 * four months every `npm install` served the vulnerable code while the tree
 * said it was fixed. Nothing anywhere went red: CI typechecks, builds, tests
 * and publish-guards a release path that was simply never reachable.
 *
 * That is the failure this script is here to make loud, at the moment a change
 * lands rather than at the moment someone finally tries to cut a release.
 *
 * WHAT IT ASSERTS
 * ---------------------------------------------------------------------------
 * The version in package.json is NOT among the versions the registry already
 * knows. Presence is decided by an exact key lookup in the registry's own
 * `versions` map, which is authoritative in a way no file in this tree is: a
 * local tag, a CHANGELOG heading or a git history can all be wrong or absent,
 * and none of them is what npm consults when it accepts or rejects a publish.
 *
 * A key present with a null value still counts as taken. npm never re-issues a
 * version number, not even one that has been unpublished, so "it was withdrawn"
 * is not a route back to a number the registry has seen.
 *
 * IT FAILS CLOSED, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * Exit 2 - "cannot determine" - is returned for a refused connection, a
 * timeout, a 5xx, a body that is not JSON, and a 200 whose payload carries no
 * `versions` map. None of those is evidence that the version is free, and an
 * unreachable registry is precisely the moment a bad publish would slip past a
 * check that shrugged. The only paths to 0 are a positive answer from the
 * registry (the map exists and does not contain this version) or a 404 (the
 * package has never been published at all, so no version of it is taken).
 *
 * Read that list again as a list of one-line mutations: every one of them is a
 * way to make this script exit 0 while learning nothing, and each has its own
 * both-directions assertion in tests/security/version-guard.test.ts.
 *
 * EXIT CODES
 * ---------------------------------------------------------------------------
 *   0  the version is free - this tree can still be released as it stands
 *   1  the version is already on the registry - a change here is unshippable
 *   2  cannot determine - treat as failure, never as permission
 *
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/check-version-unpublished.mjs
 *   node scripts/check-version-unpublished.mjs --package ./package.json
 *
 * `--registry` exists so the test suite can point this script at a local
 * server and watch each branch actually run. CI must NOT pass it: the whole
 * claim is that the answer comes from the real registry, and a `--registry`
 * in a workflow would be the quiet way to retire this gate without deleting a
 * line of it. tests/security/version-guard.test.ts asserts no workflow does.
 */

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version is free. This tree can still be released as it stands. */
const EXIT_OK = 0;
/** The version is already on the registry. Nothing here can ever be installed. */
const EXIT_ALREADY_PUBLISHED = 1;
/** No answer was obtained. Never conflated with EXIT_OK. */
const EXIT_UNDETERMINED = 2;

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

/**
 * Abbreviated packument. Smaller than the full document by roughly an order of
 * magnitude and it still carries both fields consulted here, `versions` and
 * `dist-tags`.
 */
const ACCEPT = 'application/vnd.npm.install-v1+json';

function usage() {
  return [
    'usage: node scripts/check-version-unpublished.mjs [options]',
    '',
    '  --package <path>    package.json to read   (default: <repo root>/package.json)',
    '  --registry <base>   registry base URL      (default: ' + DEFAULT_REGISTRY + ')',
    '  --timeout-ms <n>    per-attempt timeout    (default: ' + DEFAULT_TIMEOUT_MS + ')',
    '  --attempts <n>      transient-error retries (default: ' + DEFAULT_ATTEMPTS + ')',
    '',
    'exit 0 version is free | exit 1 version already published | exit 2 cannot determine',
  ].join('\n');
}

/**
 * Give up without a verdict. Everything that is not a clear answer from the
 * registry lands here, and it is never exit 0.
 */
function undetermined(message, hint) {
  process.stderr.write(`CANNOT DETERMINE: ${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.stderr.write(
    '  Exiting 2. An unreachable or unreadable registry is not evidence that a version is\n' +
      '  free; it is the exact condition under which an unpublishable tree would slip past.\n',
  );
  process.exit(EXIT_UNDETERMINED);
}

function parseArgs(argv) {
  const options = {
    packagePath: join(REPO_ROOT, 'package.json'),
    registry: DEFAULT_REGISTRY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    attempts: DEFAULT_ATTEMPTS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === '--help' || flag === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(EXIT_OK);
    }

    // An unknown flag is unclassifiable input, so it exits 2 rather than being
    // ignored. A typo'd flag that is silently dropped is a gate running on
    // defaults while its author believes it is running on their arguments.
    if (!flag.startsWith('--')) undetermined(`unexpected argument \`${flag}\`.`, usage());
    if (value === undefined) undetermined(`\`${flag}\` needs a value.`, usage());

    switch (flag) {
      case '--package':
        options.packagePath = resolve(value);
        break;
      case '--registry':
        options.registry = value.replace(/\/+$/, '');
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(value);
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          undetermined(`\`--timeout-ms\` must be a positive number, got \`${value}\`.`);
        }
        break;
      case '--attempts':
        options.attempts = Number(value);
        if (!Number.isInteger(options.attempts) || options.attempts < 1) {
          undetermined(`\`--attempts\` must be a positive integer, got \`${value}\`.`);
        }
        break;
      default:
        undetermined(`unknown flag \`${flag}\`.`, usage());
    }
    i += 1;
  }

  return options;
}

/**
 * Name and version as the registry would see them. A package.json that is
 * missing, unreadable, not JSON, or missing either field is undetermined - not
 * a pass. Deleting package.json must not read as "no version is taken".
 */
function readPackage(packagePath) {
  let raw;
  try {
    raw = readFileSync(packagePath, 'utf8');
  } catch (err) {
    undetermined(`cannot read \`${packagePath}\`: ${err instanceof Error ? err.message : err}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    undetermined(`\`${packagePath}\` is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    undetermined(`\`${packagePath}\` does not contain a JSON object.`);
  }
  if (typeof parsed.name !== 'string' || parsed.name === '') {
    undetermined(`\`${packagePath}\` has no \`name\`, so there is no package to ask about.`);
  }
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    undetermined(`\`${packagePath}\` has no \`version\`, so there is nothing to check.`);
  }

  return { name: parsed.name, version: parsed.version };
}

/**
 * One HTTP attempt. Resolves to a status and body; rejects only on transport
 * failure, which the caller retries and then reports as undetermined.
 */
function fetchOnce(url, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      rejectPromise(new Error(`\`${url}\` is not a URL`));
      return;
    }

    const send =
      target.protocol === 'https:' ? httpsRequest : target.protocol === 'http:' ? httpRequest : null;
    if (send === null) {
      rejectPromise(new Error(`unsupported registry protocol \`${target.protocol}\``));
      return;
    }

    const req = send(
      target,
      { method: 'GET', headers: { accept: ACCEPT, 'user-agent': 'elvatis-mcp-version-guard' } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
        res.on('error', rejectPromise);
      },
    );

    // A hung socket is the failure mode a naive check sleeps through and then
    // gets killed by the job timeout, which some workflows treat as skippable.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`no response within ${timeoutMs}ms`));
    });
    req.on('error', rejectPromise);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The set of version numbers the registry has already issued for this package.
 *
 * Returns `{ published: Set, latest }` on a positive answer, or `{ absent: true }`
 * when the registry says the package does not exist. Every other outcome exits 2
 * from inside this function; there is no third return shape for callers to get
 * wrong.
 */
async function publishedVersions({ name, registry, timeoutMs, attempts }) {
  // `encodeURIComponent` turns `@scope/pkg` into `%40scope%2Fpkg`, which is the
  // form the registry expects for a scoped package.
  const url = `${registry}/${encodeURIComponent(name)}`;
  const failures = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchOnce(url, timeoutMs);
    } catch (err) {
      failures.push(`attempt ${attempt}: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < attempts) await sleep(attempt * 500);
      continue;
    }

    if (response.status === 404) {
      // A real answer: nothing has ever been published under this name, so no
      // version of it can be taken.
      return { absent: true };
    }

    if (response.status !== 200) {
      failures.push(`attempt ${attempt}: HTTP ${response.status}`);
      // 4xx other than 404 will not improve on a retry; 5xx and 429 might.
      if (response.status < 500 && response.status !== 429) break;
      if (attempt < attempts) await sleep(attempt * 500);
      continue;
    }

    let document;
    try {
      document = JSON.parse(response.body);
    } catch (err) {
      undetermined(
        `the registry answered 200 for \`${name}\` with a body that is not JSON.`,
        err instanceof Error ? err.message : String(err),
      );
    }

    const versions = document?.versions;
    if (versions === null || typeof versions !== 'object' || Array.isArray(versions)) {
      // A 200 carrying no version map is the dangerous shape: a proxy error
      // page, a truncated body or an unrelated document all land here, and all
      // of them would read as "no version is taken" to anything less strict.
      undetermined(
        `the registry answered 200 for \`${name}\` with no \`versions\` map.`,
        'That is not the same as "no versions are published"; it means the answer was not usable.',
      );
    }

    return {
      absent: false,
      published: new Set(Object.keys(versions)),
      latest: typeof document?.['dist-tags']?.latest === 'string' ? document['dist-tags'].latest : null,
    };
  }

  undetermined(
    `could not read \`${name}\` from ${registry} in ${attempts} attempt(s).`,
    failures.join('; '),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { name, version } = readPackage(options.packagePath);

  const registry = await publishedVersions({
    name,
    registry: options.registry,
    timeoutMs: options.timeoutMs,
    attempts: options.attempts,
  });

  if (registry.absent) {
    process.stdout.write(
      `OK: ${name} has never been published to ${options.registry}, so ${version} is free.\n`,
    );
    process.exit(EXIT_OK);
  }

  // Exact key lookup. Not `includes`, not `startsWith`, not a substring of the
  // raw body: `1.2.4` is not published merely because `1.2.40` is, and a
  // false positive here is how a working gate gets switched off.
  if (registry.published.has(version)) {
    process.stderr.write(
      `FAIL: ${name}@${version} is already on the registry ` +
        `(${registry.published.size} version(s) published${
          registry.latest ? `, latest ${registry.latest}` : ''
        }).\n` +
        '\n' +
        '  Every change in this tree is therefore unshippable as it stands. npm rejects a\n' +
        '  duplicate version, and the tag for a released version already exists, so\n' +
        '  re-tagging cannot help either - what consumers install predates this commit.\n' +
        '  This is not a warning about a future release; it is a statement that the code\n' +
        '  here, including any security fix in it, cannot reach anyone.\n' +
        '\n' +
        '  This check runs on every pull request, so the number it objects to usually\n' +
        '  did not come from the branch under review: it is whatever `main` carries. The\n' +
        '  convention that prevents this is in SECURITY.md#release-integrity - a version\n' +
        '  is raised past a number as soon as that number ships, so `main` always holds\n' +
        '  an unreleased one. Reaching this message means a release finished without\n' +
        '  that step, and the fix belongs on `main` rather than here.\n' +
        '\n' +
        `  Fix: raise \`version\` in ${options.packagePath} above ${registry.latest ?? version},\n` +
        '  and say what changed in CHANGELOG.md.\n',
    );
    process.exit(EXIT_ALREADY_PUBLISHED);
  }

  process.stdout.write(
    `OK: ${name}@${version} is not on ${options.registry} ` +
      `(${registry.published.size} version(s) published${
        registry.latest ? `, latest ${registry.latest}` : ''
      }); this tree is releasable.\n`,
  );
  process.exit(EXIT_OK);
}

main().catch((err) => {
  // A throw that escaped every branch above is, by definition, unclassified.
  undetermined(`unexpected failure: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});
