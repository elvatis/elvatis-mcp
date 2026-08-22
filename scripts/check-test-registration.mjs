#!/usr/bin/env node
/**
 * Every test file under `tests/` is executed by `npm test`, or is refused.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * The `test` script in package.json selects test files BY NAME. Nothing
 * compared that list against the directory, so the two drifted apart silently,
 * and they drifted in the dangerous direction: a file missing from the list was
 * not reported as missing, it was never run, and the suite still reported a
 * full pass. Measured on 2026-08-21: an always-failing probe placed in
 * `tests/security/` exited 1 when run directly and left `npm test` at exit 0,
 * with the probe's name appearing nowhere in the output.
 *
 * That is worse than a missing test, because a missing test looks missing. A
 * test written to protect something, landed green, and never executed, reads as
 * protection to everyone who comes after.
 *
 * WHY A SCRIPT AND A CI STEP, AND NOT ONLY A TEST FILE
 * ---------------------------------------------------------------------------
 * A guard that lives in the enumerated list is a guard that the enumerated list
 * can drop. It would be the only check in this repository whose removal is
 * accomplished by the same edit it exists to catch. So the deciding invocation
 * is a CI step of its own, which no change to `package.json` can reach, and
 * tests/security/test-registration.test.ts executes THIS script in both
 * directions rather than restating its logic.
 *
 * THE CONTRACT
 * ---------------------------------------------------------------------------
 *   exit 0  every discovered test file is enumerated in the `test` script or
 *           declared in `testRegistration.excluded`, and the script's shape
 *           still causes those files to run.
 *   exit 1  drift: a file exists and is neither enumerated nor excluded, an
 *           enumerated file does not exist, an exclusion names a file that does
 *           not exist, or a file is both enumerated and excluded.
 *   exit 2  cannot determine: package.json missing or unparseable, no `test`
 *           script, a `test` script this parser does not understand, a runner
 *           invocation carrying a filter that would silently narrow the run, or
 *           a tests directory that is absent.
 *
 * 2 IS NOT 0, AND THAT IS THE HALF THAT DOES THE WORK. An unreadable
 * `package.json` is not "nothing is wrong"; it is the moment a check that
 * shrugs lets the thing it guards through. Every branch below that cannot reach
 * a verdict exits 2.
 *
 * WHAT IT DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That the tests are good, or that they assert anything. Only that a file
 * placed under `tests/` is either run or explicitly and visibly not run, with a
 * reason recorded next to the list that omits it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_UNDETERMINED = 2;

/**
 * Flags that narrow which tests actually execute. A `test` script carrying one
 * of these runs a subset while still reporting a pass, which is the same defeat
 * this gate exists for, one level down: the file list would be correct and the
 * run would still skip things. `--test-only` is here because it turns every
 * test that is not marked `only` into a skip.
 */
const NARROWING_FLAGS = [
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-only',
  '--test-shard',
];

/** Shapes that discard the runner's exit status, so a red suite reports green. */
const STATUS_SWALLOWING = ['||', ';', '|'];

function fail(code, lines) {
  const label = code === EXIT_UNDETERMINED ? 'CANNOT DETERMINE' : 'DRIFT';
  process.stderr.write(`\ntest-registration: ${label}\n\n${lines.join('\n')}\n\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[i + 1];
      if (value === undefined) {
        fail(EXIT_UNDETERMINED, ['  --root was given without a path.']);
      }
      options.root = value;
      i += 1;
    } else {
      // An argument this script does not understand is not a reason to pass.
      fail(EXIT_UNDETERMINED, [`  Unrecognised argument: ${arg}`]);
    }
  }
  return options;
}

/** Every *.test.ts under dir, repo-relative, with forward slashes, sorted. */
function discover(root, dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        found.push(relative(root, full).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return found.sort();
}

/**
 * Split a shell-ish npm script into tokens, dropping quotes. Deliberately
 * simple: anything with a construct this cannot represent faithfully is sent to
 * exit 2 by the caller rather than guessed at.
 */
function tokenize(script) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of script) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) return null;
  if (started || current) tokens.push(current);
  return tokens;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root);
  const packagePath = join(root, 'package.json');

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (err) {
    fail(EXIT_UNDETERMINED, [
      `  ${packagePath} could not be read or parsed.`,
      `  ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }

  const script = pkg?.scripts?.test;
  if (typeof script !== 'string' || script.trim() === '') {
    fail(EXIT_UNDETERMINED, [
      '  package.json declares no `test` script, so there is no run to compare',
      '  the tests directory against.',
    ]);
  }

  const tokens = tokenize(script);
  if (tokens === null) {
    fail(EXIT_UNDETERMINED, ['  The `test` script has an unterminated quote.']);
  }

  const testFlag = tokens.indexOf('--test');
  if (testFlag === -1) {
    fail(EXIT_UNDETERMINED, [
      '  The `test` script does not pass --test to a runner, so its positional',
      '  arguments are not a test file list and this gate cannot read it.',
      `  script: ${script}`,
    ]);
  }

  for (const token of tokens) {
    const flag = token.split('=')[0];
    if (NARROWING_FLAGS.includes(flag)) {
      fail(EXIT_UNDETERMINED, [
        `  The \`test\` script carries ${flag}, which narrows the run.`,
        '  The file list could then be complete while the run still skips tests,',
        '  so a verdict from this gate would be misleading rather than wrong.',
      ]);
    }
    if (STATUS_SWALLOWING.includes(token)) {
      fail(EXIT_UNDETERMINED, [
        `  The \`test\` script chains with \`${token}\`, so the runner's exit status`,
        '  may not be the script\'s exit status. Whether a failing test fails the',
        '  run cannot be read from here.',
      ]);
    }
  }

  const enumerated = tokens
    .slice(testFlag + 1)
    .filter((token) => token.endsWith('.test.ts'))
    .map((token) => token.split(sep).join('/'));

  const excludedRaw = pkg?.testRegistration?.excluded ?? {};
  if (typeof excludedRaw !== 'object' || excludedRaw === null || Array.isArray(excludedRaw)) {
    fail(EXIT_UNDETERMINED, [
      '  `testRegistration.excluded` must be an object mapping each excluded',
      '  file to the reason it is not run.',
    ]);
  }
  for (const [file, reason] of Object.entries(excludedRaw)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      fail(EXIT_UNDETERMINED, [
        `  \`testRegistration.excluded\` gives no reason for ${file}.`,
        '  An exclusion without a stated reason is indistinguishable from an',
        '  oversight, which is the state this gate exists to end.',
      ]);
    }
  }
  const excluded = Object.keys(excludedRaw);

  const testsDir = join(root, 'tests');
  try {
    if (!statSync(testsDir).isDirectory()) throw new Error('not a directory');
  } catch {
    fail(EXIT_UNDETERMINED, [`  ${testsDir} is not a directory.`]);
  }

  const discovered = discover(root, testsDir);
  const enumeratedSet = new Set(enumerated);
  const excludedSet = new Set(excluded);
  const discoveredSet = new Set(discovered);

  const unregistered = discovered.filter((f) => !enumeratedSet.has(f) && !excludedSet.has(f));
  const missingEnumerated = enumerated.filter((f) => !discoveredSet.has(f));
  const missingExcluded = excluded.filter((f) => !discoveredSet.has(f));
  const both = enumerated.filter((f) => excludedSet.has(f));

  const problems = [];
  if (unregistered.length > 0) {
    problems.push(
      '  Test files that exist and are never run:',
      ...unregistered.map((f) => `    ${f}`),
      '',
      '  Add each to the `test` script in package.json, or declare it under',
      '  `testRegistration.excluded` with the reason it is not run.',
      '',
    );
  }
  if (missingEnumerated.length > 0) {
    problems.push(
      '  The `test` script names files that do not exist:',
      ...missingEnumerated.map((f) => `    ${f}`),
      '',
      '  The runner would fail on these, but a stale name is also how a real',
      '  file quietly leaves the run under a rename.',
      '',
    );
  }
  if (missingExcluded.length > 0) {
    problems.push(
      '  `testRegistration.excluded` names files that do not exist:',
      ...missingExcluded.map((f) => `    ${f}`),
      '',
      '  A stale exclusion is a standing permission for a future file to arrive',
      '  under that name and never run.',
      '',
    );
  }
  if (both.length > 0) {
    problems.push(
      '  Files that are both enumerated and excluded:',
      ...both.map((f) => `    ${f}`),
      '',
    );
  }

  if (problems.length > 0) {
    fail(EXIT_DRIFT, [
      `  ${discovered.length} test file(s) under tests/, ` +
        `${enumerated.length} enumerated, ${excluded.length} excluded.`,
      '',
      ...problems,
    ]);
  }

  process.stdout.write(
    `test-registration: OK. ${discovered.length} test file(s) under tests/; ` +
      `${enumerated.length} run by \`npm test\`, ${excluded.length} declared excluded` +
      (excluded.length > 0 ? ` (${excluded.join(', ')})` : '') +
      '.\n',
  );
  process.exit(EXIT_OK);
}

main();
