/**
 * A caller-supplied model string cannot become a second command on Windows.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * On Windows `spawnLocal` does not pass an argv array. It joins the arguments
 * into ONE command string and hands it to cmd.exe (src/spawn.ts lines 74-85).
 * The escaper there wraps each argument in double quotes and rewrites an inner
 * `"` as `\"`, on the assumption that a backslash escapes a quote.
 *
 * It does not. cmd.exe has no backslash escape: it toggles quote state on every
 * `"` it meets, whatever precedes it. So `\"` ENDS the quoted region, and the
 * rest of the argument is parsed as command text, where `&`, `&&`, `|` and `>`
 * are operators.
 *
 * Measured on Windows 11 (10.0.26200), Node v22.12.0, against `main` at
 * 94d0418. With `model` set to
 *
 *   x" & echo INJECTED_MARKER & "
 *
 * the command string built for cmd.exe was
 *
 *   echo "exec" "--json" "--model" "x\" & echo INJECTED_MARKER & \""
 *
 * and `echo INJECTED_MARKER` ran as its OWN command. The marker appeared in the
 * output. This is not a theoretical parse: it executed.
 *
 * Nothing went red because every check in this repository asks about the tree,
 * not about what cmd.exe does with it. `src/validate.ts` has opened since it
 * was written with "All values that reach a shell command (even via SSH) must
 * be validated here before use", and its header even names `--model` as an
 * example of the option-value position that `--` cannot protect. There was no
 * model validator, and nothing compared the list of validators against the list
 * of values that reach a command string.
 *
 * WHY VALIDATION, AND NOT A BETTER ESCAPER
 * ---------------------------------------------------------------------------
 * Three routes were measured on this machine before choosing (probe output kept
 * with the pull request):
 *
 *   A. `spawn(shim, argv, {shell:false})` - the route the issue recommends.
 *      Fails EINVAL against a `.cmd` shim on Node v22.12.0. That is Node's
 *      CVE-2024-27980 mitigation, not a bug to work around, and the agent CLIs
 *      this repository drives (`claude.cmd`, `gemini.cmd`, `codex.cmd`) are all
 *      `.cmd` shims. The recommendation cannot be implemented as written.
 *   C. `cmd.exe /d /s /c` with `windowsVerbatimArguments` and `^` escaping.
 *      Blocks the injection, but the payload arrived at the target program
 *      split across six argv entries instead of one. Safe and wrong.
 *   D. today's escaper. Injects, as above.
 *
 * So the sink cannot currently be made both safe and faithful, and the value is
 * constrained enough that it does not need to be: model identifiers across all
 * three CLIs are drawn from a small alphabet. Refusing everything outside it
 * closes the vector at the boundary, which is the route `#73` already took for
 * `--channel` in this repository.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 * That `src/spawn.ts` is safe. It is not. `escapeWinArg` is still wrong for any
 * argument added later, and the prompt passed by `splitViaGemini` reaches the
 * same command string through `-p` rather than through stdin. Both are recorded
 * separately. This file asserts only that the values which reach the argv today
 * are refused when they are not model identifiers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateModel } from '../../src/validate.js';
import { handleClaudeRun } from '../../src/tools/claude.js';
import { handleGeminiRun } from '../../src/tools/gemini.js';
import { handleCodexRun } from '../../src/tools/codex.js';
import type { Config } from '../../src/config.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The value that actually executed a second command. */
const INJECTION = 'x" & echo INJECTED_MARKER & "';

/** Other shapes that reach cmd.exe as command text once quoting is broken. */
const HOSTILE = [
  INJECTION,
  'x" && calc & "',
  'x" | whoami & "',
  'x" > C:\\Windows\\Temp\\pwned.txt & "',
  'gemini-2.5-pro & echo after',
  'model with spaces',
  '"quoted"',
  'back\\slash',
  '-starts-with-a-flag',
  '--model',
  'a'.repeat(129),
  '',
  'x\ny',
  'x\ty',
  '..\\..\\etc\\passwd',
  'ok/../..',
];

/** Values the three CLIs legitimately accept. */
const LEGITIMATE = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5',
  'o3',
  'gpt-5-codex',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'default',
  'anthropic/claude-opus-4-6',
  'us.anthropic.claude:1',
  'phi-4-mini',
  'deepseek-r1-0528-qwen3-8b',
];

describe('validateModel refuses what cmd.exe would act on', () => {
  for (const value of HOSTILE) {
    it(`rejects ${JSON.stringify(value).slice(0, 48)}`, () => {
      assert.throws(() => validateModel(value), /model/i);
    });
  }
});

describe('validateModel accepts every model these CLIs actually take', () => {
  for (const value of LEGITIMATE) {
    it(`accepts ${value}`, () => {
      assert.equal(validateModel(value), value);
    });
  }
});

/**
 * THE DECIDING TESTS. A validator nothing calls is the same shape of defect as
 * the one this repository already found twice: a rule declared and never run.
 * These call the handlers themselves, so they fail if the wiring is removed
 * even though `validateModel` still passes its own unit tests.
 *
 * Only the REJECTION path is exercised. A handler given a valid model would
 * spawn the real agent CLI, which is not available on a CI runner and would
 * make the test depend on network and credentials. The rejection happens before
 * `spawnLocal` is reached, so no process is started here.
 */
describe('the handlers refuse a hostile model before spawning anything', () => {
  const config = {} as Config;

  it('claude_run rejects it', async () => {
    await assert.rejects(
      () => handleClaudeRun({ prompt: 'hi', model: INJECTION, timeout_seconds: 30 }),
      /Invalid model/,
    );
  });

  it('gemini_run rejects it', async () => {
    await assert.rejects(
      () => handleGeminiRun({ prompt: 'hi', model: INJECTION, timeout_seconds: 30 }, config),
      /Invalid model/,
    );
  });

  it('codex_run rejects it', async () => {
    await assert.rejects(
      () => handleCodexRun(
        { prompt: 'hi', model: INJECTION, sandbox: 'full-auto', timeout_seconds: 30 },
        config,
      ),
      /Invalid model/,
    );
  });
});

/**
 * The regression that would silently reopen this: pushing the RAW field into
 * the argv again next to a validated local. It reads almost identically at the
 * call site, and every test above except these would still pass, because the
 * validator would still be called - just not on the value that travels.
 */
describe('no --model site pushes an unvalidated value', () => {
  const sources = [
    'src/tools/claude.ts',
    'src/tools/codex.ts',
    'src/tools/gemini.ts',
    'src/tools/splitter.ts',
  ];

  const RAW_PUSH = /cliArgs\.push\(\s*'--model'\s*,\s*(?:args|config)\./;

  it('the scan can actually fire', () => {
    // Without this the test below passes just as well against a regex that
    // matches nothing, which is the failure mode this repository keeps hitting.
    assert.match("cliArgs.push('--model', args.model);", RAW_PUSH);
  });

  for (const rel of sources) {
    it(`${rel} pushes only a validated local`, () => {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      assert.doesNotMatch(text, RAW_PUSH);
    });
  }

  for (const rel of sources) {
    it(`${rel} imports the validator it depends on`, () => {
      const text = readFileSync(join(repoRoot, rel), 'utf8');
      assert.match(text, /import \{ validateModel \} from '\.\.\/validate\.js';/);
      assert.match(text, /validateModel\(/);
    });
  }
});
