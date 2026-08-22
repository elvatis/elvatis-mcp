/**
 * The analysis prompt must reach the Gemini CLI over stdin, never in argv.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * `splitViaGemini` passed the multi-line analysis prompt as a command-line
 * ARGUMENT. On Windows `spawnLocal` does not pass an argv array: it joins the
 * arguments into ONE command string and hands it to cmd.exe. cmd.exe ends the
 * command at the first newline, and `buildAnalysisPrompt` returns a template
 * whose first line is "You are a task planner."
 *
 * So on EVERY Windows call the request was cut to that first line, and
 * `--output-format json` and `--model` - which sit after the prompt in the argv
 * list - never arrived at all. `splitViaGemini` then failed to parse a plan,
 * returned null, and `handlePromptSplit` fell back to the local-LLM strategy or
 * the heuristic without reporting anything. A strategy that cannot work on a
 * platform is indistinguishable, from the outside, from a strategy that looked
 * at the prompt and declined.
 *
 * Nothing went red because the existing tests ask what the tree says, and this
 * defect only exists once cmd.exe has parsed the string. The tests below ask a
 * real child process what it received.
 *
 * THE SECOND HALF: A LATENT INJECTION
 * ---------------------------------------------------------------------------
 * #69 closed `model` by validating it, and recorded that prompts are safe
 * because they travel over stdin. That was true of claude_run, codex_run and
 * gemini_run, and false of this one call site. `escapeWinArg` rewrites an inner
 * `"` as `\"`, and cmd.exe has no backslash escape, so `\"` CLOSES the quoted
 * region and the rest is parsed as command text. A prompt is free-form and
 * cannot be validated the way a model id can, so the only thing keeping this
 * shut was that `buildAnalysisPrompt` puts two newlines above the caller's
 * text: cmd.exe hit the newline before it hit anything injectable. Reordering
 * that template would have made it live, with no other change.
 *
 * Sending the prompt over stdin removes it from the command string entirely,
 * which is why the truncation and the latent injection are one fix.
 *
 * WHAT THESE TESTS ASSERT, AND ON WHICH PLATFORM
 * ---------------------------------------------------------------------------
 * The behavioural tests run everywhere and assert the platform-appropriate
 * outcome in BOTH directions, rather than skipping on Linux. On POSIX the argv
 * route works (an argv array, no shell), so the argv test asserts "intact"
 * there and "truncated" on Windows. Both are real assertions; neither platform
 * gets a test that passes by not running.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnLocal } from '../../src/spawn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const FIXTURE = join(REPO_ROOT, 'tests', 'fixtures', 'argv-report.js');
const SPLITTER = join(REPO_ROOT, 'src', 'tools', 'splitter.ts');

const IS_WIN = process.platform === 'win32';

/** A stand-in for buildAnalysisPrompt's output: multi-line, first line short. */
const MULTILINE = [
  'You are a task planner.',
  '',
  "User's prompt:",
  'do the thing',
  '',
  'Respond with ONLY valid JSON.',
].join('\n');

/** The four arguments that follow the prompt in the real call. */
const TRAILING = ['--output-format', 'json', '--model', 'gemini-2.5-flash'];

type Report = {
  argvCount: number;
  argv: string[];
  firstArgLines: number;
  firstArgLen: number;
  stdinLines: number;
  stdinLen: number;
};

async function ask(args: string[], stdinData?: string): Promise<Report> {
  const out = await spawnLocal('node', args, 20_000, undefined, stdinData);
  return JSON.parse(out.trim()) as Report;
}

describe('the prompt reaches the CLI whole, and so does everything after it', () => {
  it('stdin delivers the full multi-line prompt on this platform', async () => {
    const r = await ask([FIXTURE, '', ...TRAILING], MULTILINE);

    assert.equal(
      r.stdinLen,
      MULTILINE.length,
      `stdin delivered ${r.stdinLen} of ${MULTILINE.length} characters. The ` +
      'prompt must arrive whole; this is the channel splitViaGemini now uses.',
    );
    assert.equal(r.stdinLines, 6, 'all six lines of the prompt must survive');
  });

  it('every argument after the prompt still arrives when stdin carries it', async () => {
    const r = await ask([FIXTURE, '', ...TRAILING], MULTILINE);

    assert.equal(
      r.argvCount,
      1 + TRAILING.length,
      `expected the empty -p value plus ${TRAILING.length} trailing ` +
      `arguments, got ${r.argvCount}: ${JSON.stringify(r.argv)}`,
    );
    assert.deepEqual(
      r.argv.slice(1),
      TRAILING,
      '--output-format and --model must reach the CLI. When the prompt sat in ' +
      'argv on Windows these were silently dropped, so the request carried ' +
      'neither the output format nor the model.',
    );
  });

  it(
    IS_WIN
      ? 'documents the defect: a multi-line argv value IS truncated by cmd.exe here'
      : 'documents the defect: a multi-line argv value survives on POSIX, which is why this hid',
    async () => {
      const r = await ask([FIXTURE, MULTILINE, ...TRAILING]);

      if (IS_WIN) {
        // cmd.exe ends the command at the first newline.
        assert.ok(
          r.argvCount < 1 + TRAILING.length,
          'expected cmd.exe to cut the command at the first newline and lose ' +
          `the trailing arguments, but all ${r.argvCount} arrived. If this ` +
          'ever passes on Windows, spawnLocal stopped building a command ' +
          'string and this whole file should be re-read.',
        );
        assert.ok(
          r.firstArgLines <= 1,
          'the prompt argument should have been cut to its first line',
        );
      } else {
        // An argv array with no shell: nothing is parsed, so nothing is lost.
        assert.equal(
          r.argvCount,
          1 + TRAILING.length,
          'on POSIX spawnLocal passes an argv array with no shell, so every ' +
          'argument must arrive intact',
        );
        assert.equal(
          r.firstArgLen,
          MULTILINE.length,
          'on POSIX the multi-line argument must arrive whole. This is exactly ' +
          'why the Windows truncation was never noticed: the same code is ' +
          'correct here.',
        );
      }
    },
  );
});

describe('splitViaGemini keeps the prompt out of the command string', () => {
  const source = readFileSync(SPLITTER, 'utf8');

  // Guards every assertion below: if the call site is renamed or moved, the
  // scan would find nothing and every test after it would pass vacuously.
  it('the scan can actually fire', () => {
    assert.ok(
      /async function splitViaGemini\s*\(/.test(source),
      'splitViaGemini not found in src/tools/splitter.ts. The assertions in ' +
      'this block match on that function body; if it was renamed they would ' +
      'pass by finding nothing. Update the matcher rather than deleting it.',
    );
    assert.ok(
      source.includes('spawnLocal('),
      'no spawnLocal call found in the splitter',
    );
  });

  const body = (() => {
    const start = source.indexOf('async function splitViaGemini');
    const next = source.indexOf('\n}', start);
    return start === -1 ? '' : source.slice(start, next);
  })();

  it('passes an EMPTY -p value, so no prompt text enters argv', () => {
    assert.ok(
      /const cliArgs = \['-p', ''/.test(body),
      "splitViaGemini must build its argv as ['-p', '', ...]. Putting the " +
      'analysis prompt in argv truncates the request at the first newline on ' +
      'Windows and drops every argument after it.',
    );
    assert.ok(
      !/\['-p', analysisPrompt/.test(body),
      'the analysis prompt is back in argv position',
    );
  });

  it('passes the analysis prompt as the stdin argument of spawnLocal', () => {
    assert.ok(
      /spawnLocal\(\s*'gemini',\s*cliArgs,\s*30_000,\s*undefined,\s*analysisPrompt\s*\)/.test(body),
      'spawnLocal must receive analysisPrompt in its stdinData position ' +
      '(the 5th argument). Found instead: ' +
      (body.match(/spawnLocal\([^)]*\)/)?.[0] ?? '(no call)'),
    );
  });

  it('matches the shape gemini_run already uses, so the two agree', () => {
    const geminiRun = readFileSync(
      join(REPO_ROOT, 'src', 'tools', 'gemini.ts'),
      'utf8',
    );
    assert.ok(
      /'-p', ''/.test(geminiRun),
      "gemini_run is the reference implementation for this shape and no longer " +
      "passes '-p', ''. If it changed deliberately, this call site should " +
      'change with it rather than drifting apart again.',
    );
  });
});
