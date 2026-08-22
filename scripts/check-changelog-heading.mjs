#!/usr/bin/env node
/**
 * Refuse a tree whose CHANGELOG.md does not open a section for the version its
 * package.json declares.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Two documents in this repository told the reader that this check already
 * existed. CONTRIBUTING.md said "the changelog gate requires the topmost dated
 * release heading to equal the version in package.json", and SECURITY.md said
 * the same sentence inside its `Release integrity` section, whose opening claim
 * is that everything in it is checkable against the workflow and that nothing
 * depends on taking our word for it.
 *
 * Nothing implemented it. Measured on `main` at df66e15: the phrase "changelog
 * gate" appeared exactly twice, in those two sentences, and no file under
 * `scripts/`, `.github/workflows/`, `tests/` or `aahp.config.json` read a
 * heading out of CHANGELOG.md at all. The claim was not false about the tree -
 * the topmost heading and the version agreed on the day it was written - it was
 * simply unenforced, which is why nobody noticed. That is the same shape as
 * issue #67 (`forbiddenPatterns` declared and never evaluated) and issue #70
 * (`npm test` naming its files, so an unregistered test never runs), and it is
 * the worst placed of the three, because this one is asserted in public to
 * people deciding whether to depend on this package.
 *
 * The choice was to implement the sentence rather than delete it. This script
 * is the implementation.
 *
 * WHAT IT ASSERTS
 * ---------------------------------------------------------------------------
 * The TOPMOST second-level heading in CHANGELOG.md is a dated release heading,
 * and the version it names is exactly the version in package.json.
 *
 * "Topmost" is structural, not a search. The first `##` heading in the file has
 * to BE the dated release heading; a script that scanned downward for the first
 * heading that happens to parse would step over `## [Unreleased]` and report
 * agreement about a section further down that nobody is editing. That is the
 * single most likely way for this gate to end up green and meaningless, so it
 * is refused explicitly rather than tolerated.
 *
 * `[Unreleased]` therefore does not satisfy this gate. The convention in
 * SECURITY.md#release-integrity is that `main` always carries a real unreleased
 * NUMBER with its section already open, so a heading that names no number is a
 * tree that has not finished a release rather than one waiting to start.
 *
 * IT FAILS CLOSED, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * Exit 2 - "cannot determine" - is returned for a missing or unreadable
 * CHANGELOG.md, a file with no second-level heading at all, a topmost heading
 * that does not parse as `[<version>] - <YYYY-MM-DD>`, a heading carrying a
 * date that is not a real calendar date, a heading whose version is not a
 * version, the same released version heading more than once, and every unusable
 * package.json. None of those is evidence that the changelog and the version
 * agree. A gate that shrugs at a file it could not read is how every dead check
 * in this estate died: `catch { return true }` is one line, reads as defensive,
 * and turns "I could not tell" into "nothing is wrong".
 *
 * The only path to 0 is a positive answer: a parseable topmost dated release
 * heading whose version string is identical to package.json's.
 *
 * WHAT IT DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That the section has content, that the content is true, or that the date is
 * the right date. Nothing mechanical reads intent out of prose. It claims only
 * that the number and its entry moved together, which is the property the two
 * sentences in CONTRIBUTING.md and SECURITY.md promise a reader.
 *
 * Nor that anyone is obliged to look. `required_status_checks` on this
 * repository's default branch is `null` (measured 2026-08-21, and SECURITY.md
 * says so in public), so this job reports rather than blocks on a pull request.
 * The one place it is load-bearing is `needs:` on the publish job, which no
 * repository setting is required to make effective.
 *
 * EXIT CODES
 * ---------------------------------------------------------------------------
 *   0  the topmost dated release heading names the version in package.json
 *   1  it names a different version - the number and its entry have drifted
 *   2  cannot determine - treat as failure, never as permission
 *
 * USAGE
 * ---------------------------------------------------------------------------
 *   node scripts/check-changelog-heading.mjs
 *   node scripts/check-changelog-heading.mjs --changelog ./CHANGELOG.md
 *   node scripts/check-changelog-heading.mjs --package ./package.json
 *
 * Both flags exist so tests/security/changelog-guard.test.ts can point the real
 * script at fixture files and watch each branch actually run. CI passes
 * neither: the whole claim is about the files in this tree.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The topmost dated release heading names the version package.json declares. */
const EXIT_OK = 0;
/** It names a different one. The number and its changelog entry have drifted. */
const EXIT_MISMATCH = 1;
/** No answer was obtained. Never conflated with EXIT_OK. */
const EXIT_UNDETERMINED = 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

/**
 * The heading level release sections live at, as CHANGELOG.md is written and as
 * Keep a Changelog specifies. Hardcoded on purpose: if the file is restructured
 * so that releases stop being `##`, this gate stops being able to find them and
 * must say so rather than guess a new level.
 */
const RELEASE_HEADING_LEVEL = 2;

/** `## [1.3.1] - 2026-08-21`, the form this file and Keep a Changelog use. */
const BRACKETED_RELEASE = /^\[([^[\]]+)\]\s+-\s+(\d{4}-\d{2}-\d{2})$/;
/** `## 1.3.1 - 2026-08-21`, the same statement without the link reference. */
const BARE_RELEASE = /^([^\s[\]]+)\s+-\s+(\d{4}-\d{2}-\d{2})$/;

/**
 * A version number, in the shape npm will accept. Deliberately narrower than
 * the heading grammar: `[Unreleased] - 2026-08-22` parses as a heading and is
 * still not a release, and saying which of the two failed is the difference
 * between a usable error message and "changelog check failed".
 */
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function usage() {
  return [
    'usage: node scripts/check-changelog-heading.mjs [options]',
    '',
    '  --changelog <path>  CHANGELOG.md to read   (default: <repo root>/CHANGELOG.md)',
    '  --package <path>    package.json to read   (default: <repo root>/package.json)',
    '',
    'exit 0 heading matches version | exit 1 they disagree | exit 2 cannot determine',
  ].join('\n');
}

/**
 * Give up without a verdict. Everything that is not a clear reading of both
 * files lands here, and it is never exit 0.
 */
function undetermined(message, hint) {
  process.stderr.write(`CANNOT DETERMINE: ${message}\n`);
  if (hint) process.stderr.write(`  ${hint}\n`);
  process.stderr.write(
    '  Exiting 2. A changelog this script could not read is not evidence that the version\n' +
      '  and its entry moved together; it is the condition under which they drift unnoticed.\n',
  );
  process.exit(EXIT_UNDETERMINED);
}

function parseArgs(argv) {
  const options = {
    changelogPath: join(REPO_ROOT, 'CHANGELOG.md'),
    packagePath: join(REPO_ROOT, 'package.json'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];

    if (flag === '--help' || flag === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(EXIT_OK);
    }

    // An unknown or valueless flag is unclassifiable input, so it exits 2 rather
    // than being ignored. A typo'd flag that is silently dropped is a gate
    // running on defaults while its author believes it is running on their
    // arguments, which is how a CI invocation and the thing asserted about it
    // drift apart without either changing.
    if (!flag.startsWith('--')) undetermined(`unexpected argument \`${flag}\`.`, usage());
    if (value === undefined) undetermined(`\`${flag}\` needs a value.`, usage());

    switch (flag) {
      case '--changelog':
        options.changelogPath = resolve(value);
        break;
      case '--package':
        options.packagePath = resolve(value);
        break;
      default:
        undetermined(`unknown flag \`${flag}\`.`, usage());
    }
    i += 1;
  }

  return options;
}

function read(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    undetermined(
      `cannot read ${what} at \`${path}\`: ${err instanceof Error ? err.message : err}`,
      'A deleted or renamed file must not read as "nothing to check".',
    );
  }
}

/**
 * The version package.json declares. Missing, unreadable, not JSON, carrying no
 * `version`, or carrying one that is not a version number are all undetermined.
 * Emptying that field must not buy a pass from a gate whose entire subject is
 * what it contains.
 */
function declaredVersion(packagePath) {
  const raw = read(packagePath, 'package.json');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    undetermined(`\`${packagePath}\` is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    undetermined(`\`${packagePath}\` does not contain a JSON object.`);
  }
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    undetermined(`\`${packagePath}\` has no \`version\`, so there is nothing to compare against.`);
  }
  if (!VERSION.test(parsed.version)) {
    undetermined(
      `\`${packagePath}\` declares \`${parsed.version}\`, which is not a version number.`,
      'The comparison below is an exact string match, so an unparseable version could only ever ' +
        'agree with an equally unparseable heading.',
    );
  }

  return parsed.version;
}

/**
 * Every ATX heading in a Markdown document, in order, with fenced code blocks
 * excluded.
 *
 * The fences matter more than they look. A README-style block inside the
 * changelog that shows an example heading would otherwise be read as a real
 * one, and a block placed above the first release section would take over the
 * "topmost" position from a document that is perfectly correct. Parse the file;
 * do not grep it.
 */
function headings(markdown) {
  const found = [];
  let fence = null;

  const lines = markdown.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    // CommonMark: a fence is 3+ backticks or tildes, indented at most 3 spaces,
    // and is closed by a run of the same character at least as long.
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = { char: marker[0], length: marker.length };
        continue;
      }
      if (marker[0] === fence.char && marker.length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    // Four or more leading spaces is an indented code block, not a heading.
    const headingMatch = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/.exec(line);
    if (headingMatch === null) continue;

    // Strip an optional ATX closing sequence: `## Title ##`.
    const text = (headingMatch[2] ?? '').replace(/\s+#+\s*$/, '').trim();
    found.push({ level: headingMatch[1].length, text, line: index + 1 });
  }

  return found;
}

/**
 * `{ version, date }` if this heading text is a dated release heading, else
 * null. A date that parses syntactically but is not a real calendar day
 * (`2026-02-30`, `2026-13-01`) is not a date.
 */
function asDatedRelease(text) {
  const match = BRACKETED_RELEASE.exec(text) ?? BARE_RELEASE.exec(text);
  if (match === null) return null;

  const [, version, date] = match;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;

  return { version, date };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = declaredVersion(options.packagePath);
  const changelog = read(options.changelogPath, 'CHANGELOG.md');

  const all = headings(changelog);
  const sections = all.filter((heading) => heading.level === RELEASE_HEADING_LEVEL);

  if (sections.length === 0) {
    undetermined(
      `\`${options.changelogPath}\` has no level-${RELEASE_HEADING_LEVEL} heading, so it declares no ` +
        'release section at all.',
      `Release sections are written as \`${'#'.repeat(RELEASE_HEADING_LEVEL)} [${version}] - YYYY-MM-DD\`.`,
    );
  }

  const topmost = sections[0];
  const release = asDatedRelease(topmost.text);

  if (release === null) {
    undetermined(
      `the topmost release heading in \`${options.changelogPath}\` is ` +
        `\`${'#'.repeat(RELEASE_HEADING_LEVEL)} ${topmost.text}\` (line ${topmost.line}), which is not a ` +
        'dated release heading.',
      'Expected `[<version>] - <YYYY-MM-DD>`. `[Unreleased]` does not satisfy this gate: ' +
        'SECURITY.md#release-integrity requires `main` to carry a real unreleased NUMBER with its ' +
        'section already open, so a heading naming no number means a release finished without ' +
        'vacating the one it shipped.',
    );
  }

  if (!VERSION.test(release.version)) {
    undetermined(
      `the topmost release heading names \`${release.version}\`, which is not a version number ` +
        `(line ${topmost.line}).`,
    );
  }

  // The same released version heading twice leaves no answer to "which section
  // is this release", and the duplicate is usually a half-finished rename that
  // a gate reading only the first heading would wave straight through.
  const duplicates = sections
    .map((heading) => ({ heading, release: asDatedRelease(heading.text) }))
    .filter((entry) => entry.release !== null && entry.release.version === release.version);

  if (duplicates.length > 1) {
    undetermined(
      `\`${release.version}\` has ${duplicates.length} dated release headings in ` +
        `\`${options.changelogPath}\` (lines ${duplicates.map((d) => d.heading.line).join(', ')}).`,
      'Which one is the section for this release cannot be decided from the file.',
    );
  }

  // Exact string comparison. Not `startsWith`, not `includes`: `1.3.1` does not
  // match a heading that reads `1.3.10`, and a false positive here is how a
  // working gate gets switched off instead of fixed.
  if (release.version !== version) {
    process.stderr.write(
      `FAIL: package.json declares ${version}, but the topmost dated release heading in ` +
        `${options.changelogPath} is \`${'#'.repeat(RELEASE_HEADING_LEVEL)} ${topmost.text}\` ` +
        `(line ${topmost.line}).\n` +
        '\n' +
        '  The version number and its changelog entry are supposed to move in the same change.\n' +
        '  When they do not, the release that eventually ships carries a section describing a\n' +
        '  different version, and the GitHub Release notes point readers at it.\n' +
        '\n' +
        `  Fix: open a \`${'#'.repeat(RELEASE_HEADING_LEVEL)} [${version}] - <YYYY-MM-DD>\` section at the ` +
        'top of\n' +
        `  ${options.changelogPath}, or correct \`version\` in ${options.packagePath}. The convention\n` +
        '  is in SECURITY.md#release-integrity: as soon as a version ships, the number is raised\n' +
        '  past it and that number\'s section is opened in the same step.\n',
    );
    process.exit(EXIT_MISMATCH);
  }

  process.stdout.write(
    `OK: CHANGELOG.md opens \`${topmost.text}\` at line ${topmost.line}, matching ` +
      `package.json version ${version}.\n`,
  );
  process.exit(EXIT_OK);
}

try {
  main();
} catch (err) {
  // A throw that escaped every branch above is, by definition, unclassified.
  undetermined(`unexpected failure: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
}
