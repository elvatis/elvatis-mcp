#!/usr/bin/env node
/**
 * Refuse to run the AAHP handoff gate without a usable Layer 2 base commit.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * From @elvatis_com/aahp 3.10.0 the content-drift gate (Layer 2) is FAIL-CLOSED
 * at `--level ci`: it refuses to run without an explicit `--base SHA` /
 * `AAHP_BASE_SHA` instead of quietly diffing against nothing. That is the right
 * behaviour, and it moves the burden into the workflow: every event
 * `aahp-verify.yml` triggers on has to name its own base, and an event that
 * names none has to STOP the job rather than sail past it.
 *
 * The failure this guards is not "the gate broke". It is the gate reporting
 * green while comparing a commit to itself, which is the shape every neutered
 * check in this estate has taken. `aahp verify` already rejects a base equal to
 * HEAD for exactly that reason ("would make Layer 2 vacuous"); this script
 * covers the cases that never reach it, where the base is absent, empty, the
 * all-zero SHA, or not a SHA at all.
 *
 * WHY A SCRIPT AND NOT AN INLINE `run:` BLOCK
 * ---------------------------------------------------------------------------
 * So it can be EXECUTED by a test in both directions rather than pattern-matched
 * in YAML. `scripts/check-version-unpublished.mjs` is consumed the same way by
 * `tests/security/version-guard.test.ts`. A guard asserted only by grepping the
 * workflow that contains it is a guard nobody has ever run.
 *
 * EXIT CODES
 * ---------------------------------------------------------------------------
 *   0  a usable base was resolved; the caller may run `aahp verify --level ci`
 *   2  no usable base. Deliberately NOT 1: 1 is what `aahp verify` itself exits
 *      when the gate legitimately fails, and the two must stay distinguishable.
 *      An unclassifiable state is never 0.
 *
 * Reads AAHP_BASE_SHA (the resolved base) and GITHUB_EVENT_NAME (for the
 * message only - it never widens what is accepted).
 */

const ALL_ZERO = '0'.repeat(40);
const FULL_SHA = /^[0-9a-f]{40}$/i;

const base = (process.env.AAHP_BASE_SHA ?? '').trim();
const event = (process.env.GITHUB_EVENT_NAME ?? '').trim() || '(unknown event)';

/** @param {string} reason */
function refuse(reason) {
  console.error(`Layer 2 base commit unusable for event '${event}': ${reason}.`);
  console.error(
    'AAHP >= 3.10.0 fails the content-drift gate closed without an explicit base. ' +
      'Each trigger in .github/workflows/aahp-verify.yml must supply one: ' +
      'pull_request -> github.event.pull_request.base.sha, ' +
      'push -> github.event.before, ' +
      'workflow_dispatch -> the required `base` input.',
  );
  process.exit(2);
}

if (base === '') {
  refuse('AAHP_BASE_SHA is empty or unset, so the gate would compare against nothing');
}

if (base === ALL_ZERO) {
  refuse(
    'the base is the all-zero SHA, which is what a branch-creation push reports and ' +
      'names no commit at all',
  );
}

if (!FULL_SHA.test(base)) {
  refuse(
    `the base is not a 40-character commit SHA (got ${JSON.stringify(base)}). ` +
      'A short SHA, a branch name or a tag can move, and a moving base is not a base',
  );
}

console.log(`Layer 2 base commit: ${base} (event: ${event})`);
