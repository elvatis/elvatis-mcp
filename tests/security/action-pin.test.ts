/**
 * The supply-chain scanner is consumed at a commit, and the mechanism that keeps
 * that pin from becoming a freeze still exists.
 *
 * WHY THIS FILE EXISTS IN *THIS* REPOSITORY IN PARTICULAR
 * ---------------------------------------------------------------------------
 * elvatis-mcp is where the estate proved that a pin alone is not enough, over
 * 55 days, with a green check every day:
 *
 *   - 2026-06-27  pinned to be1d718b (v5.2.37), Dependabot enabled in the SAME
 *                 commit, explicitly to move the pin
 *   - 2026-06-27  to 2026-08-15: eight correct bump pull requests (#43, #45,
 *                 #49, #52, #53, #54, #55), one per Saturday
 *   - none merged. dependabot[bot] closed each as superseded by the next
 *   - 2026-08-21  still on v5.2.37, roughly 100 releases behind
 *
 * Nothing was red. The scanner ran, on a two-month-old malware indicator set.
 * That is the failure mode these assertions are aimed at: not "the scan broke",
 * but "the scan kept passing while going quietly out of date".
 *
 * WHAT EACH TEST GUARDS, AND THE ONE-LINE MUTATION THAT TURNS IT RED
 * ---------------------------------------------------------------------------
 *   - "still referenced at all": delete the `uses:` line, or rename the action.
 *     Every other assertion here is vacuously true over an empty list, so this
 *     one has to come first.
 *   - "pinned to a commit": restore `@v5` or any other non-SHA ref. There is no
 *     `v5` TAG in homeofe/supply-chain-guard - `@v5` resolves to the BRANCH
 *     refs/heads/v5 - and by owner decision of 2026-08-21 that ref is to be
 *     disabled, so this stopped being hygiene and became availability.
 *   - "names the release": drop the trailing `# vX.Y.Z`. Written generically on
 *     purpose: naming the release of the day here would go stale one bump later.
 *   - "bump mechanism": remove the `github-actions` block from dependabot.yml.
 *   - "daily": put that block back on `weekly`.
 *   - "group of one": merge the scanner into the catch-all group.
 *   - "no ignore rule": add an `ignore` entry naming the action. THIS is the one
 *     that has actually happened in the estate - a sibling repository pinned
 *     this action on 2026-08-02 and was eight releases behind by 2026-08-07,
 *     because an `ignore` rule sat beside the pin while ecosystem, group and
 *     interval all stayed correct.
 *   - "bumps can land": delete the dependabot exemption from aahp-verify.yml,
 *     which would block every bump on a handoff gate a bot cannot satisfy.
 *
 * WHAT THIS FILE CANNOT PROVE, SO IT DOES NOT CLAIM IT: that a bump ever gets
 * MERGED. `allow_auto_merge` is `false` on this repository and `main` has no
 * required status checks (both measured 2026-08-21, both repository settings,
 * both unreachable from any file here). That gap is elvatis/ideabase#337.
 *
 * The YAML files are PARSED, never grepped. A `dependency-name` may be quoted,
 * a wildcard may match without spelling the action out, and the strings
 * "github-actions" and "homeofe/supply-chain-guard" both appear in this
 * repository's own prose and labels - six confident false readings in this
 * estate came from grepping structured files. Workflow `uses:` lines are read
 * with comment lines stripped first, because supply-chain-guard.yml deliberately
 * quotes the old `@v5` form while explaining it, and a check that could not tell
 * an explanation from a directive would force that history out of the file.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';

const REPO_ROOT = join(__dirname, '..', '..');
const GITHUB_DIR = join(REPO_ROOT, '.github');
const WORKFLOW_DIR = join(GITHUB_DIR, 'workflows');
const DEPENDABOT_FILE = join(GITHUB_DIR, 'dependabot.yml');

/**
 * The action this file is about. First-party to the estate, which describes who
 * may change it, not when the change lands - and a scanner that changes silently
 * under a release is the one component nobody re-reads.
 */
const GUARD_ACTION = 'homeofe/supply-chain-guard';

const SHA = /^[0-9a-f]{40}$/;

interface ActionRef {
  readonly workflow: string;
  readonly ref: string;
  /** The rest of the line after the ref, so a trailing `# vX.Y.Z` can be read. */
  readonly trailer: string;
}

interface DependabotUpdate {
  'package-ecosystem'?: string;
  schedule?: { interval?: string };
  ignore?: { 'dependency-name'?: string }[];
  groups?: Record<string, { patterns?: string[]; 'exclude-patterns'?: string[] }>;
}

function dependabotUpdates(): DependabotUpdate[] {
  const config = parse(readFileSync(DEPENDABOT_FILE, 'utf8')) as { updates?: DependabotUpdate[] };
  return config.updates ?? [];
}

function actionsEntry(): DependabotUpdate | undefined {
  return dependabotUpdates().find((u) => u['package-ecosystem'] === 'github-actions');
}

/**
 * Every `uses:` of GUARD_ACTION across the whole workflow directory, not just
 * supply-chain-guard.yml. Deliberate: moving the step into another workflow must
 * not slip the pin.
 */
function guardReferences(): ActionRef[] {
  const found: ActionRef[] = [];
  const files = readdirSync(WORKFLOW_DIR).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'));
  for (const name of files) {
    const source = readFileSync(join(WORKFLOW_DIR, name), 'utf8');
    for (const rawLine of source.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (/^\s*#/.test(line)) continue;
      const match = line.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
      if (!match?.[1]) continue;
      const uses = match[1];
      if (!uses.startsWith(`${GUARD_ACTION}@`)) continue;
      found.push({
        workflow: name,
        ref: uses.slice(`${GUARD_ACTION}@`.length),
        trailer: match[2] ?? '',
      });
    }
  }
  return found;
}

describe('the supply-chain scanner is pinned, and the pin can still be bumped', () => {
  it('is still referenced at all (guard the guard)', () => {
    assert.ok(
      guardReferences().length > 0,
      `no workflow in .github/workflows references ${GUARD_ACTION}. If it moved, update GUARD_ACTION here; if it was removed, this repository lost its supply-chain scan.`,
    );
  });

  it('is pinned to a commit, never to a branch or a floating major', () => {
    const unpinned = guardReferences()
      .filter((r) => !SHA.test(r.ref))
      .map((r) => `${r.workflow}: ${GUARD_ACTION}@${r.ref}`);

    assert.deepEqual(
      unpinned,
      [],
      `There is no \`v5\` tag in ${GUARD_ACTION}; \`@v5\` resolves to the BRANCH refs/heads/v5 and moves under this workflow. Pin the full 40-character commit SHA and name the release in a trailing comment. Offenders: ${unpinned.join(', ')}`,
    );
  });

  it('names the release the pinned commit is, so the SHA stays readable', () => {
    // Without this a correct pin is an opaque 40-hex string and the next reader
    // cannot tell a current pin from a two-month-old one without a network call.
    // That is exactly how `# v5.2.37` sat here unread for 55 days.
    const unlabelled = guardReferences()
      .filter((r) => !/#\s*v\d+\.\d+\.\d+/.test(r.trailer))
      .map((r) => `${r.workflow}: ${GUARD_ACTION}@${r.ref}`);

    assert.deepEqual(
      unlabelled,
      [],
      `A SHA-pinned action must carry a trailing \`# vX.Y.Z\` comment naming the release it points at; Dependabot rewrites the SHA and that comment together. Offenders: ${unlabelled.join(', ')}`,
    );
  });

  it('has a bump mechanism: dependabot watches the github-actions ecosystem', () => {
    const ecosystems = dependabotUpdates().map((u) => u['package-ecosystem']);

    assert.ok(
      ecosystems.includes('github-actions'),
      `Without this entry the SHA pin never moves again. Found ecosystems: ${JSON.stringify(ecosystems)}`,
    );
  });

  it('bumps that ecosystem daily, because under a pin the schedule is the feed', () => {
    // D-065. The action carries its malware indicator set inside the release the
    // SHA names, so the interval IS the indicator freshness. v5.26.4 through
    // v5.26.7 shipped on four consecutive days, 2026-08-16 to -19.
    assert.equal(
      actionsEntry()?.schedule?.interval,
      'daily',
      'D-065 sets the github-actions ecosystem to daily. On weekly the pinned scanner runs on indicators up to six days old and nothing anywhere goes red about it.',
    );
  });

  it('keeps the scanner in a group of its own, so its bump arrives alone', () => {
    // A group of one makes the routine case a one-file, one-line diff: reviewable
    // in seconds, and the only shape the estate's auto-merge job will take.
    const groups = actionsEntry()?.groups ?? {};

    assert.deepEqual(
      groups['supply-chain-guard']?.patterns,
      [GUARD_ACTION],
      'The scanner needs a dedicated group named `supply-chain-guard` matching exactly this action.',
    );
    assert.ok(
      (groups['actions-minor-and-patch']?.['exclude-patterns'] ?? []).includes(GUARD_ACTION),
      'Without the exclusion the scanner also lands inside the catch-all group and its bump stops being a one-file diff.',
    );
  });

  it('has no dependabot ignore entry for the scanner, quoted or wildcarded', () => {
    // The half that actually failed in the estate. Wildcards are EXPANDED rather
    // than compared literally: `*` and `homeofe/*` freeze this action just as
    // completely as its own name does.
    const freezesGuard = (raw: string): boolean => {
      const pattern = raw.trim().toLowerCase();
      if (!pattern) return false;
      const source = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp(`^${source}$`).test(GUARD_ACTION);
    };

    const offenders = dependabotUpdates().flatMap((update) =>
      (update.ignore ?? [])
        .map((entry) => String(entry['dependency-name'] ?? ''))
        .filter(freezesGuard)
        .map((name) => `${update['package-ecosystem']}: ignore ${name}`),
    );

    assert.deepEqual(
      offenders,
      [],
      `An \`ignore\` entry matching ${GUARD_ACTION} makes the SHA pin unbumpable while every other check in this file still passes. That combination - pin plus ignore - is what left a sibling repository eight releases behind between 2026-08-02 and 2026-08-07. Offenders: ${offenders.join(', ')}`,
    );
  });

  it('lets those bumps actually land: the AAHP gate still exempts dependabot', () => {
    // The ecosystem entry opens the pull requests; this is what stops a gate from
    // sitting on every one of them forever. Both halves or neither.
    const aahp = readFileSync(join(WORKFLOW_DIR, 'aahp-verify.yml'), 'utf8');
    const active = aahp
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

    assert.ok(
      active.includes('dependabot[bot]'),
      'aahp-verify.yml no longer exempts dependabot[bot], so every action-bump pull request is blocked by a handoff gate a bot cannot satisfy.',
    );
  });
});
