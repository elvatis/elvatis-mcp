/**
 * A credential cannot reach this repository's history without something looking.
 *
 * WHAT WENT WRONG, AND WHY NOTHING WENT RED
 * ---------------------------------------------------------------------------
 * There are two independent layers that can catch a credential committed to a
 * public repository, and this one had zero of two. Measured on 2026-08-22:
 *
 *   secret_scanning                      disabled
 *   secret_scanning_push_protection      disabled
 *   secret_scanning_non_provider_patterns disabled
 *   secret_scanning_validity_checks      disabled
 *   dependabot_security_updates          disabled
 *
 * and `.github/workflows/` held aahp-verify.yml, ci.yml and
 * supply-chain-guard.yml, none of which looks for a credential.
 * supply-chain-guard.yml is a DEPENDENCY scanner; it reads as coverage from a
 * distance and has never scanned for a secret.
 *
 * The class is worth naming because it repeats: each of the two layers looks
 * like the other one's backstop. A repository with one usually reads as
 * covered, and a repository with neither reads exactly the same from inside any
 * single file. Only a query that asks both at once tells them apart.
 *
 * WHAT THIS FILE CAN AND CANNOT ASSERT
 * ---------------------------------------------------------------------------
 * It cannot run GitHub Actions, so it cannot prove the scan finds a planted
 * credential. What it CAN do is refuse the specific edits that would turn the
 * workflow into a check that cannot fire, because that is how every gate in
 * this repository has failed so far: not deleted, but narrowed until nothing
 * reaches it.
 *
 * The workflow is PARSED as YAML rather than grepped. A regex over the source
 * would pass just as well against a `paths-ignore` written in flow style, or a
 * commented-out one, and this repository has already shipped one gate that was
 * defeated without a line being deleted.
 *
 * Every scan below carries a control asserting it can actually fire against a
 * synthetic bad input. A check that silently matches nothing is the thing being
 * guarded against, so it must not be the thing doing the guarding.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = join(repoRoot, '.github', 'workflows', 'secret-scan.yml');
const CONFIG = join(repoRoot, '.gitleaks.toml');

interface Step { uses?: string; run?: string; with?: Record<string, unknown>; 'continue-on-error'?: unknown }
interface Job { steps?: Step[]; if?: unknown; 'continue-on-error'?: unknown; 'runs-on'?: unknown }

function workflow(): Record<string, any> {
  assert.ok(existsSync(WORKFLOW), 'secret-scan.yml is missing: the only secret-scanning layer this tree controls is gone.');
  return parse(readFileSync(WORKFLOW, 'utf8')) as Record<string, any>;
}

function gitleaksJob(): Job {
  const wf = workflow();
  const job = wf['jobs']?.['gitleaks'] as Job | undefined;
  assert.ok(job, 'the `gitleaks` job is gone from secret-scan.yml');
  return job;
}

function steps(): Step[] {
  const s = gitleaksJob().steps;
  assert.ok(Array.isArray(s) && s.length > 0, 'the gitleaks job has no steps');
  return s;
}

/** The step that actually runs the scanner. */
function scanStep(): Step {
  const s = steps().find((x) => typeof x.run === 'string' && /gitleaks["'\s]*\s+detect|gitleaks\}?"?\s+detect/.test(x.run));
  assert.ok(s, 'no step invokes `gitleaks detect`');
  return s;
}

describe('the secret scan exists and is reachable', () => {
  it('the workflow file parses as YAML', () => {
    assert.doesNotThrow(() => workflow());
  });

  it('the gitleaks config it names is actually present', () => {
    const run = scanStep().run as string;
    assert.match(run, /--config\s+\.gitleaks\.toml/);
    assert.ok(existsSync(CONFIG), '.gitleaks.toml is referenced by the workflow and does not exist');
  });

  it('runs on pull requests, pushes to main, and tag pushes', () => {
    const on = workflow()['on'];
    assert.ok(on && typeof on === 'object', '`on:` is missing');
    assert.ok('pull_request' in on, 'the scan no longer runs on pull requests');
    assert.ok('push' in on, 'the scan no longer runs on push');

    // A push block carrying only `branches:` does not match a tag push at all.
    // That is how the ref which publishes to npm became the one ref no
    // supply-chain gate ever saw (#79). Same trap, same file shape.
    const push = on['push'];
    assert.ok(push?.branches, 'push has no branches filter');
    assert.ok(push?.tags, 'push carries a branches filter and NO tags filter, so a tag push matches nothing and is never scanned');
  });

  it('does not filter pull requests by base branch', () => {
    // A base filter makes a stacked pull request run nothing, and GitHub shows
    // that identically to a run that has not started.
    const pr = workflow()['on']?.['pull_request'];
    if (pr !== null && typeof pr === 'object') {
      assert.equal(pr.branches, undefined,
        'pull_request carries a branches filter: a pull request based on a topic branch would not be scanned');
    }
  });
});

describe('the scan cannot be narrowed into a check that never fires', () => {
  it('the control: a paths filter is detectable where one exists', () => {
    const withFilter = parse('on:\n  pull_request:\n    paths-ignore: ["**/*.md"]\n');
    const pr = withFilter['on']?.['pull_request'] ?? withFilter['pull_request'];
    assert.ok(pr && ('paths-ignore' in pr),
      'the detection below is vacuous: it cannot see a paths-ignore that is present');
  });

  it('no trigger carries paths or paths-ignore', () => {
    const on = workflow()['on'];
    for (const [event, spec] of Object.entries(on as Record<string, any>)) {
      if (spec === null || typeof spec !== 'object') continue;
      assert.equal(spec['paths'], undefined,
        `${event} carries a paths filter. Markdown and handoff notes are where a credential gets pasted first.`);
      assert.equal(spec['paths-ignore'], undefined,
        `${event} carries a paths-ignore filter. This is elvatis-security-platform#647 exactly.`);
    }
  });

  it('the job is unconditional and does not swallow its own failure', () => {
    const job = gitleaksJob();
    assert.equal(job['if'], undefined,
      'a job-level `if:` is the one-line edit that disables a gate while leaving every visible sign of it in place');
    assert.equal(job['continue-on-error'], undefined,
      'continue-on-error makes a finding advisory, which is the same as not scanning');
    for (const step of steps()) {
      assert.equal(step['continue-on-error'], undefined, 'a step swallows its own failure');
    }
  });

  it('the scanner fails the job on a finding', () => {
    const run = scanStep().run as string;
    assert.match(run, /--exit-code\s+1/, 'the scan no longer exits non-zero on a finding');
    assert.doesNotMatch(run, /\|\|\s*true/, 'the scan result is discarded by `|| true`');
    assert.doesNotMatch(run, /\|\|\s*exit\s+0/, 'the scan result is discarded');
  });

  it('the checkout is not shallow', () => {
    // A shallow clone reduces a full-history scan to the tip commit and still
    // passes, which is indistinguishable from finding nothing.
    const checkout = steps().find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
    assert.ok(checkout, 'no checkout step');
    assert.equal(String(checkout.with?.['fetch-depth']), '0',
      'fetch-depth is not 0, so the scan walks only the tip commit while still reporting a pass');
  });

  it('the finding is redacted, so the run log does not publish the credential', () => {
    assert.match(scanStep().run as string, /--redact/);
  });
});

describe('the gitleaks config allowlists by value, never by path', () => {
  /** The `paths = [ ... ]` array inside [allowlist], as written. */
  function allowlistPaths(source: string): string {
    const section = source.split(/^\[allowlist\]$/m)[1];
    assert.ok(section, '[allowlist] section not found in .gitleaks.toml');
    const m = section.match(/^\s*paths\s*=\s*\[([\s\S]*?)\]/m);
    assert.ok(m, '`paths` key not found in [allowlist]: a missing key is not the same as an empty one, and gitleaks would take its default');
    return m[1] as string;
  }

  it('the control: a non-empty paths array is detectable', () => {
    const bad = '[allowlist]\npaths = [\n  "docs/.*",\n]\n';
    assert.notEqual(allowlistPaths(bad).trim(), '',
      'the check below is vacuous: it cannot see a populated paths array');
  });

  it('paths is present and empty', () => {
    const source = readFileSync(CONFIG, 'utf8');
    assert.equal(allowlistPaths(source).trim(), '',
      'a paths entry deletes the file from the scan entirely, including the credential pasted into it next year');
  });

  it('the upstream rule set is extended, not replaced', () => {
    const source = readFileSync(CONFIG, 'utf8');
    assert.match(source, /useDefault\s*=\s*true/,
      'useDefault is off, so only the rules written here apply and the upstream provider rules are gone');
  });
});
