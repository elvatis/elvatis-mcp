## 2026-08-21 - The handoff docs named the workstation, and the benchmark tables still do

`.ai/handoff/LOG.md` and `.claude/commands/build.md` carried the exact CPU and
GPU model of the machine this is worked from. Both are internal documents that
happen to sit on a public repository, and in neither does the part number serve
a reader: "use the dev PC" is the same instruction as "use the <model> dev PC".
Removed. The maintainer's name and email stay, which was already decided.

REMOVING IT DOES NOT MAKE THE HARDWARE PRIVATE, and this entry exists mostly to
say so. `README.md` carries a Reference Hardware table with the same CPU and
GPU, and `BENCHMARKS.md` carries the same table plus the model in roughly ten
result headings. That is deliberate: they are the specs the published benchmark
numbers were measured on, and a benchmark that does not say what it ran on is
not a benchmark. So the hardware remains publicly readable here on purpose, and
anyone reading the handoff edit as "that detail is no longer public" would be
wrong. Recommendation is to keep the benchmark tables as they are; it is a
maintainer decision, not a cleanup, and it stays open.

THE LOCAL DRIFT GATE COMPARES A PUSHED BRANCH AGAINST ITSELF, so it passed
locally and then failed on the pull request. This is worth knowing before it
wastes someone's afternoon.

`verify-handoff.sh` picks its base for Layer 2 as the branch's UPSTREAM
tracking ref (`@{u}`), falling back to `origin/main` only when there is none.
Once a branch has been pushed with `-u`, `@{u}` is that branch's own remote
head, so `@{u}...HEAD` shows only the commits made since the last push - not
the change set the pull request actually proposes. Measured on this branch:

    git diff --name-only @{u}...HEAD        -> .ai/handoff/ only
    git diff --name-only origin/main...HEAD -> also .claude/commands/build.md

CI has no such upstream and diffs against the base branch, so it saw
`.claude/commands/build.md` and correctly demanded a STATUS.md update. Both of
the local runs here were vacuous, for two different reasons: the first ran
before the edits were staged or committed (nothing in the diff at all), the
second ran after the push (base had moved to the branch itself).

So a green local `aahp verify` on a pushed branch is close to no evidence about
Layer 2. To reproduce what CI will decide, compare against the base explicitly
rather than trusting the default. Layers 1, 3 and 4 are unaffected - they do not
depend on a diff range - and Layer 2 counts everything outside `.ai/handoff/` as
source, `.claude/` included.

## 2026-08-21 - Node 18 und 20 sind end of life, und der publish-Job lief auf einem davon

Der v1.3.0-Release ist heute gescheitert, nicht am Paket und nicht am neuen
version-guard (der meldete 1.3.0 korrekt als frei), sondern an der Laufzeit:

    npm error code EBADENGINE
    npm error notsup Required: {"node":"^22.22.2 || ^24.15.0 || >=26.0.0"}
    npm error notsup Actual:   {"npm":"10.8.2","node":"v20.20.2"}

Der publish-Job holt `npm@latest` fuer OIDC Trusted Publishing. npm 12 hat Node
20 fallen gelassen. Der Schritt, der das Veroeffentlichen ermoeglichen soll, ist
also der, der es verweigert - bei JEDEM Release-Versuch seit npm 12. Gesehen hat
es niemand, weil seit April nichts veroeffentlicht wurde.

Gleichzeitig lief die Matrix auf [18, 20, 22] und `engines.node` versprach
oeffentlich `>=18` - eine Laufzeit ohne Sicherheits-Patches seit 16 Monaten.

Geaendert: Matrix -> [22, 24], drei Einzel-Pins '20' -> '24', engines '>=22'.

**Der Mutationsbeweis hat einen Fehler in der eigenen Zusicherung gefunden.** Die
erste Fassung der Leerlauf-Sperre prueft die GLOBALE Pin-Liste; das Leeren der
Matrix liess sie gruen, weil die Einzel-Pins der anderen Jobs die Liste nicht
leer werden liessen. Die Mehr-Laufzeit-Abdeckung verschwand lautlos. `matrixPins()`
liest jetzt ausschliesslich `strategy.matrix`. Vier Mutationen, alle rot bewiesen.

Offen und Emres: Tag-Schutz fehlt weiterhin (`tags/protection` -> 404, rulesets
leer), also kann ein v-Tag weiterhin auf einen beliebigen Commit zeigen.

> Note (2026-08-21, claude-opus-5): THE RELEASE PATH WAS GUARDED AND UNWALKABLE. `package.json` last moved its version on 2026-03-31 (b6d4c17, the initial skeleton). `1.2.4` was published on 2026-04-15. `main` then took 35 commits without the number changing, two of them security fixes: the command-injection remediation of 2026-06-28 (fb7b76a, 9 findings) and the `--channel` escaping fix of 2026-08-19 (ef82cb5, PR 56). Both are correct, both are merged, and neither could ever be installed by anyone. npm refuses a duplicate version, and `v1.2.4` already exists and points at the April tree, so re-tagging is not a way out either. An April tarball cannot contain a June fix, so for four months every `npm install` of the estate's only public package served the vulnerable code while the tree said it was fixed. Bumped to 1.3.0, in `package.json` and in both root entries of `package-lock.json`.
>
> MINOR, NOT PATCH, AND THE REASON IS IN THE DIFF RATHER THAN IN THE SEVERITY. Reading what the 35 commits actually contain: `src/validate.ts` is a new 165-line module exporting eight validators plus `shellQuote`, which is additive public surface that ships in `dist`; `src/index.ts` stops reporting `0.1.0` in the MCP initialize handshake and reports the real version, so a client sees a different string; and every hardened call site now REFUSES input that 1.2.4 accepted and passed to a remote shell. That last one is the load-bearing part. A patch release says "nothing you can observe has changed", and that is false here - a caller passing a channel or a cron id containing shell metacharacters gets an error where they previously got execution. It is not a major either: nothing documented was withdrawn, and the only inputs that stop working are the ones the option was never meant to carry. Minor is the honest signal, and it is the one that tells a consumer to read before upgrading.
>
> THE CHECK IS ON THE CONSEQUENCE, NOT THE CONFIGURATION. `scripts/check-version-unpublished.mjs` asks the public registry whether the version in `package.json` has already been issued, and exits 1 if it has. The registry is the only authority on that question: a git tag can be missing, moved, or created for a version that was never published; a CHANGELOG heading is prose; `dist-tags.latest` moves under `npm dist-tag` with no publish at all. None of them is what npm consults when it accepts or rejects a tarball. Presence is decided by an exact key lookup in the returned `versions` map, and a key whose value is null still counts as spent, because npm never re-issues a number even after an unpublish.
>
> IT FAILS CLOSED, WHICH IS THE HALF THAT DOES THE WORK. Exit 2, "cannot determine", covers a refused connection, a request timeout, a 5xx, a body that is not JSON, a package.json that is missing or says nothing, an argument the script does not understand, and - the subtle one - a 200 carrying no `versions` map. That last shape is what a proxy error page, a captive portal and a truncated response all arrive as, and `const versions = doc.versions ?? {}` is one line, reads as defensive, and turns every one of them into "nothing is published, ship it". An unreachable registry is not a neutral moment; it is precisely the moment a bad publish slips past a check that shrugged.
>
> WIRED SO IT CAN ACTUALLY HOLD SOMETHING UP. A new `version-guard` job in ci.yml, separate from `build` and outside the release path it protects - a gate living inside the publish job is only consulted once someone has pushed a v-tag, which is months after the moment the version should have moved. It has to fire on the pull request that lands the change. `publish` now carries `needs: [build, version-guard]`, because with `required_status_checks` still absent on this repository (measured 2026-08-21, unchanged) `needs:` is the only place a check can be made consequential rather than advisory.
>
> `tests/security/version-guard.test.ts` (20 assertions, new; wired into `npm test`) EXECUTES the script as a real child process against a real local HTTP server, one per scenario, and asserts EXACT exit statuses rather than "non-zero" - a script that has been deleted or renamed exits 1 from node itself, and 1 is this script's already-published verdict, so accepting any non-zero would let a missing gate impersonate a working one on eight rows. Both directions everywhere: it refuses a published version AND accepts an unpublished one, so neither a gate that always fires nor one that cannot fire survives. The row that distinguishes an exact key lookup from `body.includes(v)` is 1.2.4 against a registry serving 1.2.40, in both orderings, with the exact match still firing - a substring comparison passes every other assertion in the file and then blocks a legitimate release, and a false positive is what gets a working check deleted rather than fixed. The workflow side enumerates `continue-on-error` and `if:` over the guard job AND every one of its steps, `paths`/`paths-ignore` over every trigger of the workflow the guard lives in, `|| true`-shaped exit-status swallowing in the step's own script, and `--registry` on the command line, which is the quiet way to point the gate at something that decides nothing. Anything it cannot classify throws rather than passing.
>
> Mutation-proved one at a time, fix committed first so `git checkout --` could not eat it, tree restored and re-verified between each. Recorded as measured, because two of these landed narrower than expected and the narrowness is the point. (1) Defaulting the `versions` map to `{}` when the registry answers 200 without one - `document?.versions ?? {}`, the one-line "defensive" edit - turned exactly ONE row red, `gives no verdict on a 200 that carries no versions map`, with the script cheerfully reporting `exit 0 ... 0 version(s) published; this tree is releasable` off a body containing no versions at all. Every other row stayed green, including the four other fail-closed rows, which is why that scenario has to be its own assertion rather than being assumed to ride along with the network-failure ones. (2) Softening the exact key lookup to a substring test turned exactly ONE row red, `tells 1.2.4 from 1.2.40, in both directions`; rows 1 and 3 stayed green because a substring test still fires on a true match, so no assertion about firing can catch this and only the 1.2.40 row can. (3) Returning `EXIT_OK` instead of `EXIT_ALREADY_PUBLISHED` turned THREE rows red at once - 1, 3 and 5, every row that needs the guard to actually fire - which is the gate-that-cannot-fire signature and is what tells this mutation apart from the two above. (4) `continue-on-error: true` on the version-guard job turned `carries no continue-on-error and no if:` red, naming `ci.yml:version-guard`. (5) `paths: ['package.json']` on the workflow's `pull_request` trigger turned `runs on pull requests, unfiltered by path` red - and that filter is the one that would have made this very gate silent for all 35 commits at issue, since not one of them touched package.json. Restored tree: `npm test` 171 pass 0 fail in 5.9s (151 existing + 20 new), `npm run typecheck` clean, `aahp verify --level ci` passes with Layer 3 the tolerated WARN. And the gate was proved live before any mutation: run unchanged against the real registry with `main`'s package.json it exits 1, reporting 1.2.4 already published with 32 versions; after the bump to 1.3.0 it exits 0.
>
> ALSO CORRECTED. `CHANGELOG.md` did not exist, and the GitHub Release step announced every release with "See the README changelog" while the README had no changelog section either - so the register a public reader was pointed at had never existed. Created, starting at 1.3.0, with the upgrade advice a 1.2.4 user needs and the release-integrity story stated plainly; the release note and the README install section now point at it, and it is added to `files` so it ships in the tarball. The security entry describes the hardening at the level of what changed and why to upgrade, deliberately without restating the parameter and payload shape.
>
> AND CREATING IT WOKE A THIRD GATE THAT HAD NEVER BEEN ABLE TO FIRE HERE. `aahp doctor` carries a `changelog-format` gate, and `check-changelog-format.mjs` opens with "a repo with no CHANGELOG.md is a clean skip (exit 0)". So for this repository's whole life that gate reported clean about an artifact that did not exist. The moment the file appeared it went FAIL on CI, and its rule R6 is: the topmost release heading must equal `package.json`'s version. That is a second, independent lever on precisely today's defect - it forces the changelog and the version to move together - and it had been dormant for the entire four months in which the version did not move. It is the same shape as the finding this whole change is about, one level up: not a check that was wrong, a check whose subject was absent, reporting the absence as health. Worth carrying to the other repositories in the fleet, since a skip-when-missing gate reads as PASS in any dashboard that counts failures. Conformance is now 6 gates, no failures, with `version-sync` still SKIP for want of `versionSites` in `aahp.config.json` - which is the next lever of the same kind and is left for the owner to aim.
>
> RAISED, NOT CHANGED, AND IT NEEDS A DECISION BEFORE THE RELEASE. `.ai/handoff/STATUS.md` on this public default branch describes the vulnerable function, the exact parameter and the payload shape, in the 2026-08-19 note. The fix for it is unpublished, so the exploit is public and the remedy is not, and has been for two days. Trimming it is a judgement call about a handoff record and is not made unilaterally here; the cheapest resolution is to publish 1.3.0, after which the note is history rather than a live recipe. Note also that the same detail is in the merged commit subject of ef82cb5 and in the body of PR 56, so redacting this file alone would not close it.
>
> WHAT THIS DOES NOT FIX. The check nags rather than blocks: once 1.3.0 is released, `main` carries a published number again and `version-guard` goes red on the next pull request until someone bumps. That is the intended reading - at that moment `main` genuinely cannot ship anything - but it means the version bump has to travel with the change rather than being remembered at release time, which is a workflow the maintainer should agree to rather than discover. And nothing here makes anyone look: `required_status_checks` is still absent on `main`, so CI, Scan, AAHP Verify and now version-guard are all advisory, which is the same repository setting already open from the last three changes.

> Note (2026-08-21, claude-opus-5): Documented the residual release-path exposure that #59 could not close from a file, and closed two gaps in the guard itself that were found while measuring it. SECURITY.md gains a `## Release integrity` section: how a release happens, the four properties the workflow now enforces, and - stated plainly, because this is the estate's only public repository and its only public publisher - that none of them prove the commit under the tag was ever reviewed. Measured 2026-08-21: no ruleset or tag protection restricting who may create `refs/tags/v*`, `environments` total_count 0, and `main` carrying branch protection with `required_status_checks` absent. The two candidate controls are named there with their trade-off: a tag ruleset is one setting and closes today's gap but guards only the TRIGGER, so a future workflow publishing on something other than a v-tag is outside it; an `npm-publish` environment with a required reviewer, named in the registry's trusted-publisher configuration, survives a later edit to the workflow because a job that drops the environment mints an OIDC token the registry refuses - it fails closed. Recommendation to the owner: the environment, with the tag ruleset as the one-minute mitigation in the meantime. Neither is a change any file here can make.
>
> THE GUARD READ ONE FILENAME. `tests/security/publish-guard.test.ts` located the release path inside `.github/workflows/ci.yml` by name. That is not where this package was published from: all 32 versions on the registry came from a separate `.github/workflows/publish.yml`, which existed from the first release until it was deleted on 2026-06-27 in the move to OIDC trusted publishing. Restoring that file verbatim into the tree turns SIX of the eight assertions red - it had no `if:`, an `actions/checkout@v4` with no `ref:`, and no build job to depend on - and against the old guard it was invisible, because it was not called ci.yml. The scan is now over every file in the directory, and jobs are labelled `file:job` so a failure names which one. `needs:` candidates are scoped to the publisher's own file, since `needs:` cannot reach across workflows; that is what makes a second file fail rather than borrow ci.yml's build.
>
> THE TAG/VERSION CHECK WAS LOST IN THE MIGRATION. The deleted publish.yml refused to publish when `package.json` disagreed with the tag name. ci.yml did not bring that across, so today tagging `v1.3.0` on a tree whose package.json still reads `1.2.5` publishes 1.2.5 while the GitHub Release announces v1.3.0 - registry, tag and release naming three different things. Restored as a step in the publish job, and the new assertion EXECUTES that step rather than grepping for it: the script is run in a throwaway directory holding one package.json, against an agreeing tag and three disagreeing ones. The fourth scenario is a tag that is a PREFIX of the shipped version (`v1.2` against 1.2.5), which is what tells an equality test apart from a `startsWith` or `contains` one - the prefix-tolerant mutation passes the other three columns and only that row catches it. Selection of which steps to execute is a heuristic and is allowed to be, because selection cannot manufacture a pass; anything invoking a package manager is refused outright and reported as refused, so `npm ci` and `npm install -g npm@latest` are never run.
>
> Mutation-proved one at a time, fix committed first, tree restored between each: deleting the check step turned assertion 8 red with an empty script list; neutering its comparison turned it red reporting `agreeing:0, ahead:0, behind:0, prefix:0` - the guard-that-cannot-fire signature, visible in the diagnostic; making the comparison prefix-tolerant turned it red on `prefix:0` alone with the other three columns still correct; and restoring publish.yml turned assertions 2 through 7 red naming `publish.yml:publish` in each. Restored tree: `npm test` 151 pass 0 fail in 5.8s, `npm run typecheck` clean.
>
> ALSO CORRECTED, and it is the more urgent of the two findings. This repository is public and indexed, and sixteen places across six tracked files named a PRIVATE issue tracker by repository and issue number, plus two private sibling repositories by name and internal decision-register identifiers. A reader arriving at `.github/dependabot.yml` or either security test was told the missing half was tracked at a URL they cannot open. All sixteen are rewritten to say the same thing without the private reference, pointing at SECURITY.md where the same class of gap is now described in public. Verified by a whole-tree grep returning empty, and every workflow and dependabot config re-parsed afterwards. The same reference is still in the merged body of PR #59 and in this file's own earlier notes above; a PR body is public content and editing it is the owner's call, so it is raised rather than changed.
>
> NOT FIXED, AND IT IS A LIVE RISK FOR THE NEXT RELEASE: not one of the 32 published versions carries a provenance attestation. All of them predate the 2026-06-27 migration and came from the token-based publish.yml; `dist.attestations` is null for every version on the registry and `dist.signatures` is present for every one. The OIDC trusted-publishing path in ci.yml has therefore never actually published anything - the last release was 2026-04-15, four months before the workflow that would publish it was written. The next tag pushed will be that path's first exercise, and if trusted publishing is not configured for this package on the registry it will fail there. SECURITY.md says this in as many words rather than implying a provenance that no consumer can currently verify.

> Note (2026-08-21, claude-opus-5): Closed the publish path. `.github/workflows/ci.yml` gated the npm publish on `(startsWith(github.ref, 'refs/tags/v') && contains(github.ref, '.')) || github.event_name == 'workflow_dispatch'` and checked out with no `ref:`. `workflow_dispatch:` parses to null, so the Run-workflow dialog accepts ANY branch; the OR-branch satisfied the condition on its own, and a checkout with no `ref:` resolves `github.ref` - the dispatched branch. One dialog away from publishing an unreviewed branch tree to the public registry as `@elvatis_com/elvatis-mcp`, with provenance attesting it, in the estate's only public repository and its only public-registry publisher. Nothing else on that path holds it: measured 2026-08-21, `.private` is false, `environments` total_count is 0, `rulesets` is empty, tag protection is 404, and `branches/main/protection` returns 200 with `required_status_checks` ABSENT. Same shape as the deployment defect that got Landings PR 55 rejected - the publish was not bound to a reviewed commit.
>
> DELETING THE OR-BRANCH ALONE WOULD NOT HAVE FIXED IT, and that is the part worth carrying forward. The Run-workflow dropdown offers TAGS as well as branches, so with the clause merely removed, dispatching on `v9.9.9` still leaves `github.ref` at `refs/tags/v9.9.9`, `startsWith` still passes, and the manual path is open again - now through a ref anyone with push access can create and move, because tag protection is 404. The condition therefore asserts the EVENT, which a dialog cannot forge: `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && contains(github.ref, '.')`. `workflow_dispatch` stays among the `on:` triggers so CI can still be run by hand on a branch; it just no longer reaches `publish`. Both release-path jobs got the same condition and `ref: ${{ github.sha }}` on their checkout - `publish` (`id-token: write`, mints the provenance) and `release` (`contents: write`, cuts the GitHub Release) - binding the published tree to the commit `build` verified rather than to a ref that can move between the two jobs.
>
> `tests/security/publish-guard.test.ts` (7 assertions, new) EVALUATES the condition instead of pattern-matching it: the `if:` is parsed into a small GitHub-expression interpreter and run against eight trigger scenarios, so any rewrite that lets a dispatch through goes red however it is spelled, reordered or reformatted. This was a deliberate choice against a regex - four regex gates written across this estate on 2026-08-21 were all defeated without deleting a line any of them looked for. The interpreter THROWS on syntax or context it does not model, so an `if:` rewritten in terms of `github.actor` or `github.event.*` fails loudly and demands a human extend it, rather than quietly evaluating to the convenient answer. Release-path jobs are found by CAPABILITY (`npm publish`, `id-token: write`, `contents: write`), not by name, so moving the publish into a fresh job does not slip the guard. One assertion is pure LIVENESS - a pushed v-tag must still reach both jobs - because a guard that cannot fire is the 2026-08-18 failure mode and all seven negative scenarios stay green under it.
>
> Mutation-proved one at a time, fix committed first so `git checkout --` could not eat it: restoring the OR-branch turned the scenario assertion red naming all three dispatch scenarios; dropping only `github.event_name == 'push'` turned it red naming exactly one, the tag-dropdown dispatch, which is what proves that clause load-bearing; deleting `ref: ${{ github.sha }}` turned the checkout assertion red; deleting `needs: build` turned the ordering assertion red; deleting the `if:` outright turned four red; rewriting it as `github.actor == 'elvatis' && github.event.release.published` turned the readability assertion red as designed; and tightening it to `github.ref == 'refs/tags/v'` turned ONLY the liveness assertion red. Restored tree is green: 150 tests pass locally (143 existing + 7).
>
> ALSO CORRECTED, and it is the trap the protocol warns about: `MANIFEST.json` arrived on main from #58 (be723a8, merged earlier today) with `project` set to `elvatis-mcp-scg-pin` - the previous agent's worktree DIRECTORY name, which `aahp manifest` writes into that field from wherever it happens to run. It read `elvatis-mcp` at e23280a and every commit before. Set back to `elvatis-mcp` and re-read after regenerating, which is the only way to catch it.
>
> WHAT THIS DOES NOT FIX, and nothing in this repository can. The commit under a tag is still unreviewed: `main` has zero required status checks while `enforce_admins` is `true`, so admin enforcement currently enforces nothing; there are no environments to hold a reviewer; and with no tag protection any push-capable actor can point `v9.9.9` at any commit, which IS a pushed v-tag and therefore passes this guard. Four repository settings, unreachable from any file here, all open with the maintainer. This change closes the half that lives in the workflow: no path that is not a pushed v-tag, and no tree but the tagged commit's.

> Note (2026-08-21, claude-opus-5): Moved the supply-chain-guard pin from `be1d718b` (v5.2.37, 2026-06-27) to `fc8fb8f4989cd1960f48833fbaa1f726df897bbc` (v5.28.1), and built the bump lane that the last pin lacked. This repository was in no inventory of 2026-08-21 and was the estate's worst-drifted consumer: roughly 100 releases behind, with a green `Scan` check on every one of those 55 days, because a scanner pinned to an old release still runs - it just runs on that release's malware indicator set. The SHA was verified through both dereferences of the ANNOTATED tag (`releases/latest` -> `v5.28.1`, draft=false, target=main; `git/ref/tags/v5.28.1` -> tag object `0a6f9b34`; `git/tags/0a6f9b34` -> commit `fc8fb8f4`); asking `git/commits/0a6f9b34` returns a 404 that reads like a missing commit and is not one. `@v5` was not restored and must not be: there is no `v5` TAG in that repository, only the BRANCH `refs/heads/v5`, and the owner decided on 2026-08-21 that the moving ref is to be disabled. `.github/dependabot.yml` now carries the github-actions ecosystem on `interval: daily` with the scanner in a dedicated group of one, the catch-all group excluding it, and no `ignore` entry naming it - that last one is not hypothetical, a sibling repository was frozen eight releases behind for five days by exactly a pin-plus-ignore pair while every other signal stayed green. `tests/security/action-pin.test.ts` (8 assertions, new; `yaml` added as a devDependency so the config is PARSED, not grepped) turns red on each of those removals, mutation-proved one at a time: restoring `@v5`, dropping the `# vX.Y.Z` trailer, renaming the action, deleting the ecosystem block, reverting to `weekly`, merging the scanner into the catch-all group, adding `ignore: homeofe/*`, and removing the dependabot exemption from aahp-verify.yml each turned exactly the matching named subtest red, and the restored tree is green again. `npm test` now runs that file too, so the assertions can actually fire in CI; 143 tests pass locally (135 existing + 8). Also added `timeout-minutes: 10` to the scan job, mandatory after the 2026-07-21 runner-hang, and `min-severity: info` so a report that says "PARTIAL - coverage incomplete" also lists the info-severity finding that explains why.
> 
> AND THE TEST RUNNER ITSELF WAS THE SAME BUG ONE LEVEL DOWN. `npm test` ran `npx tsx`, and `tsx` was in NO dependency list and NO lockfile entry. So every CI run installed the locked ~99-package tree with `npm ci --ignore-scripts` and then fetched `tsx@latest` plus `esbuild` from the registry, unpinned, unreproducible, and invisible to the supply-chain scan - which reads `package-lock.json`. All 143 tests, including the new pin guard, executed inside a transpiler downloaded fresh from the network moments earlier, in the one repository whose gate is that nothing gating the supply chain may come from a moving pointer. Fixed by pinning `tsx` to `4.23.12` as an exact devDependency (the `@elvatis_com/aahp` idiom for gate-adjacent tooling) and switching both test scripts to `npx --no-install`, so a missing local copy now fails loudly instead of silently reaching for the registry. The lockfile grows 100 -> 129 entries: tsx, esbuild, and 26 optional platform stubs of which exactly one installs per platform (`npm install --ignore-scripts` reported "added 3 packages", and `@esbuild/linux-x64` is recorded for the Ubuntu runners). Proved both ways: with the local copy `npm test` exits 0 with 143 passing, and with `node_modules/tsx` moved aside it exits 1 with MODULE_NOT_FOUND rather than downloading a replacement.
> 
> WHAT THIS DOES NOT FIX, and nothing in this repository can. Dependabot already worked here: eight correct bump pull requests on eight consecutive Saturdays (#43, #45, #49, #52, #53, #54, #55), none ever merged, each closed by dependabot[bot] as superseded by the next. The missing fourth part is a way for a bump to LAND, and both levers are repository settings: `allow_auto_merge` is `false` here (measured 2026-08-21), and `main` has branch protection with `required_status_checks: null` - so no check on this repository is required and CI, Scan and AAHP Verify are all advisory today. `dependabot-auto-merge.yml` was deliberately NOT added, because with auto-merge off it could only fail loudly on every bump. Both are open with the maintainer with a recommendation. Two false claims were also removed from the aahp-verify.yml header: it said CodeQL gates dependabot PRs (code scanning is `not-configured`, zero analyses) and that Actions is off org-wide (CI, Scan and AAHP Verify all completed successfully on 2026-08-19).

> Note (2026-08-19, claude-opus-5): Cleared all 15 open Dependabot alerts (4 high, 9 moderate, 2 low). Every one of them is transitive under `@modelcontextprotocol/sdk`: `package.json` declares three runtime dependencies and none of the flagged packages is among them. `package.json` is therefore unchanged. Every parent range already permitted the patched version, so refreshing `package-lock.json` was sufficient and no `overrides` block was needed, unlike the sibling repos that do carry one. Resolved: `fast-uri` 3.1.2 to 3.1.5 (3 highs), `ip-address` 10.2.0 to 10.5.0 (1 high, 2 moderate), `hono` 4.12.25 to 4.13.3 (6 moderate, 1 low), `@hono/node-server` 1.19.14 to 2.1.1 (1 moderate), `body-parser` 2.2.2 to 2.3.0 (1 low). The `@hono/node-server` major is the SDK's own supported matrix rather than a forced upgrade: 1.30.0 declares `^1.19.9 || ^2.0.5`, and 2.x's `hono@^4` peer requirement is satisfied. Real exposure is lower than the counts suggest, and this is recorded so a future reader does not re-derive it. Only `fast-uri` loads on the default stdio path, reached by `ajv` through the SDK's schema validator, where it resolves first-party tool schemas rather than untrusted URLs, so the host-confusion advisories do not have an attacker-controlled input here. `hono` and `@hono/node-server` load only under `MCP_TRANSPORT=http`, and the flagged middleware (CORS, language, JSX, proxy helper, serve-static) is never instantiated by this server. `express` and `express-rate-limit`, the parents of `body-parser` and `ip-address`, are imported only by the SDK's OAuth router modules, which this server never imports, so those four alerts sit on code that is never loaded. All were bumped anyway because the cost was a single lockfile refresh. Build passes and all 135 tests in `tests/unit.test.ts` pass. `npm run typecheck` reports `TS2688 estree`, which is an artifact of the build location and not of this change: TypeScript collects implicit type libraries from `node_modules/@types` in every parent directory, and a parent of the temporary build directory used here holds an `@types/estree` entry consisting of a `package.json` with no declaration files. The identical failure reproduces in that same location with the original lockfile restored, and the repository checkout itself typechecks clean, so the earlier note calling it identical on `main` holds only for builds run from such a location.

> Note (2026-08-19, claude-opus-5): Closed a command injection in `src/tools/cron-manage.ts`. `handleCronCreate` builds a shell string and hands it to `sshExec`; ten of its eleven user-controlled values go in as `'${escapeShell(x)}'` or through `validateScheduleValue`, and `--channel` went in raw. `channel` is declared `z.string().optional()`, so the three names in its description are documentation rather than a constraint, and a value such as `whatsapp; <command>` reached the remote host as the SSH user. `src/validate.ts` opens by stating the contract this broke: all values that reach a shell command, even via SSH, are validated there before use. Fixed in two layers, because either alone would be thinner than the rest of the file: a new `validateChannel()` following `validateContainerName`'s idiom (charset allow-list, no leading hyphen so a value cannot smuggle in another flag, length bound), plus `escapeShell` at the call site so it reads like its ten siblings. Deliberately an allow-list of the channel-identifier shape rather than a hard enum of the three documented names: openclaw may gain channels, and a rule that must be edited for each one gets widened under pressure. 13 tests added to `tests/unit.test.ts`, including the reported payload. Mutation-proved: neutralising only `validateChannel`'s guard turns the block red, restoring it turns it green. `npm run typecheck` reports an unrelated pre-existing `TS2688 estree` error, identical on unmodified `main`, so it is environmental and not from this change.

> Note (2026-07-25, claude-opus-4-8): Untracked `.scg-history/` and added it to `.gitignore`. It holds supply-chain-guard scanner state, not project content. The scanner was fixed upstream so the directory now writes a self-ignore when created.

> Note (2026-07-18, claude-opus-4-8): Adopted CLI-based AAHP conformance v3.8.0. Switched the gate driver from vendored bash scripts to the pinned @elvatis_com/aahp CLI (devDependencies, exact 3.8.0) and removed the package-provided scripts (_aahp-lib.sh, aahp-manifest.sh, lint-handoff.sh, verify-handoff.sh, install-hooks.sh, verify-hooks.sh, scripts/hooks/). Added GROUNDING.md, TRUST.md (with a Provenance column), WORKFLOW.md, LOG-ARCHIVE.md, .aiignore, and aahp.config.json (pinnedDep + forbidden em-dash). aahp-verify.yml now runs the CLI (npm ci + npx aahp verify/doctor), keeping the dependabot exemption. Relocated the non-canonical handoff-session-resume note to .ai/notes/ so the handoff set is clean. Kept repo-specific validate-pii-allowlist.py. doctor: 6 gates, no failures.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical AAHP gate scripts from homeofe/improvements (v3.5.0 fixes: aahp-manifest.sh --phase documentation + cross_repo_ref preservation, lint-handoff.sh SC2034), AAHP_HANDOFF_FILES preserved, and refreshed the local hook tooling (scripts/hooks/, install-hooks.sh, verify-hooks.sh). Fleet re-sync.

> Note (2026-07-14, claude-opus-4-8): Synced the canonical Layer 3 tolerance fix from homeofe/improvements. verify-handoff.sh now downgrades a non-ancestor MANIFEST.last_session.commit from FAIL to WARN so a squash-merge or rebase-merge no longer trips AAHP Verify Layer 3 on main; Layers 1-2 still gate real staleness.

# elvatis-mcp: Current State of the Nation

> Last updated: 2026-06-29 by claude-opus-4-8 (community-health sweep)
> Commit: pending
>
> **Rule:** This file is rewritten (not appended) at the end of every session.
>
> **Note (2026-06-27):** Product-state sections below predate this sweep (last functional update 2026-03-31). This session is an AAHP gate-onboarding pass only (badge + manifest commit-pointer refresh); no source code changed. See the gate-log footer for the dated trail.

---

## Build Health

| Check | Result | Notes |
|-------|--------|-------|
| `build` | ✅ Passing (prev session) | 0.85s, 148 MB, 30k instantiations |
| `typecheck` | ⏳ Needs re-run | New files added this session (ssh.ts, openclaw.ts) |
| `lint` | — | Not configured yet |
| `integration test` | ✅ Passing (prev session) | Claude Desktop smoke test passed (2026-03-31) |

---

## Architecture Change (2026-03-31)

**Problem:** cron tools used REST (`/api/cron/jobs`) — OpenClaw has no REST API, only WebSocket. Memory tools read from local Windows filesystem — actual memory files are on the OpenClaw server.

**Solution:** SSH-based transport layer.

- New `src/ssh.ts`: SSH exec helper using `child_process.spawn('ssh', ...)`. No extra npm deps, uses built-in OpenSSH (available on Windows 10+, macOS, Linux).
- `src/tools/cron.ts`: Rewritten to read `~/.openclaw/cron/jobs.json` via SSH.
- `src/tools/memory.ts`: Rewritten to read/write `~/.openclaw/workspace/memory/` via SSH. Uses base64 encoding for safe writes.
- New `src/tools/openclaw.ts`: Sub-agent orchestration — SSH-executes `openclaw agents send --message "<prompt>" --local --timeout <seconds>` and returns the response synchronously. Also: `openclaw_status`, `openclaw_plugins`.
- `src/config.ts`: All IPs/hosts removed from hardcoded defaults. `SSH_HOST` and `HA_URL` are now required env vars. Dotenv loaded at startup.
- New `.env.example`: Template for all required env vars.

**Env vars required (must be set in .env or claude_desktop_config.json):**
- `HA_URL`: Home Assistant URL
- `SSH_HOST`: OpenClaw server IP/hostname
- Optional (have defaults): `SSH_PORT`, `SSH_USER`, `SSH_KEY_PATH`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_CLI_CMD`

---

## TS2589 Fix (resolved 2026-03-31)

**Solution:** `registerTool()` wrapper in `index.ts` casts `server` to `any` before calling `.tool()`. Build: 0.85s, 148 MB, 30k instantiations.

**Rule:** Never call `server.tool()` directly. Always use `registerTool()`.

---

## Components

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server (stdio) | ✅ Working | Claude Desktop tested 2026-03-31 |
| MCP Server (HTTP) | ✅ Skeleton | StreamableHTTPServerTransport |
| Config loader | ✅ Done | All secrets via env vars, dotenv support |
| SSH helper | ✅ Done | src/ssh.ts, child_process.spawn, no extra deps |
| Home tools (home.ts) | ✅ Working | 6 tools, HA REST API |
| Memory tools (memory.ts) | ✅ SSH-based | Reads/writes OpenClaw server files |
| Cron tools (cron.ts) | ✅ SSH-based | Reads ~/.openclaw/cron/jobs.json |
| OpenClaw tools (openclaw.ts) | ✅ New | openclaw_run, openclaw_status, openclaw_plugins |
| Trading tools | ⏳ Not started | T-005 |
| Camera tools | ⏳ Not started | T-006 |
| GitHub Actions CI | ⏳ Not started | T-004 |

---

## Current Version: 0.1.0 (unreleased)

| Platform | Status |
|---|---|
| GitHub (elvatis/elvatis-mcp) | ✅ Private repo, main branch |
| npm (@elvatis_com/elvatis-mcp) | ⏳ Not published |

---

## openclaw-cli-bridge-elvatis (Server Issue)

Plugin on the OpenClaw server crashes with `Cannot find module 'openclaw/plugin-sdk'`.
This is a server-side npm dependency issue, not an elvatis-mcp issue.

**To fix (SSH to server):**
```bash
# Find the plugin directory
find ~/.openclaw -name "package.json" | xargs grep -l "cli-bridge" 2>/dev/null
# cd into it and run:
npm install
# or check if the import path is wrong in the plugin's source
```

---

## Architecture

```
Claude Desktop / Cursor / Windsurf
  └─ MCP Protocol (stdio or HTTP)
       └─ elvatis-mcp server (Windows/Linux)
            ├─ home tools      ─────────────────────► Home Assistant REST API
            ├─ memory tools    ──► SSH exec ────────► ~/.openclaw/workspace/memory/*.md
            ├─ cron tools      ──► SSH exec ────────► ~/.openclaw/cron/jobs.json
            └─ openclaw tools  ──► SSH exec ────────► openclaw CLI (all plugins)
                                                            ├─ trading plugin
                                                            ├─ home plugin
                                                            ├─ custom workflows
                                                            └─ LLM backends
```

## Key Files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, MCP server + tool registration |
| `src/config.ts` | Env var config (all secrets external) |
| `src/ssh.ts` | SSH exec helper (child_process.spawn) |
| `src/tools/home.ts` | Home Assistant tools (REST) |
| `src/tools/memory.ts` | Memory read/write/search (SSH) |
| `src/tools/cron.ts` | OpenClaw cron management (SSH) |
| `src/tools/openclaw.ts` | Sub-agent orchestration + status (SSH) |
| `.env.example` | Template — copy to .env and fill values |

<!-- aahp-gate -->
_AAHP verify gate: v3.0.2 synced 2026-06-20._

> 2026-06-21 install-hooks.sh: Windows drive-letter path fix propagated from AAHP.

> 2026-06-21 ci: add supply-chain-guard v5.2.35 Action workflow (fail-on critical).

> 2026-06-21 ci(aahp): fix unquoted next_task_id + lint-handoff noreply@ PII exclusion.

> 2026-06-27 ci: migrate npm publish to OIDC trusted publishing (publish + release jobs in ci.yml, semver-tag triggered, no NPM_TOKEN); removed old token-based publish.yml.

> 2026-06-27 ci: re-pin supply-chain-guard Action to v5.2.37 (be1d718b17cc38e4bce7fa48579b7112e557943b) and enable Dependabot github-actions weekly updates.

> 2026-06-27 aahp: onboard full AAHP gate. Added the AAHP Verify badge to README and regenerated MANIFEST so the commit-pointer tracks HEAD. Scripts and the aahp-verify workflow were already present and passing, so they were left intact (kept the repo's locally-hardened self-contained PII lint rather than swapping in AAHP's allowlist-file variant).

> 2026-06-28 security: fix 9 command-injection and secrets findings. New src/validate.ts provides allowlist validators (validateContainerName, validateServiceName, validateAgentName, validateScheduleValue, validateCronId) and shellQuote helper. All user-controlled values reaching SSH shell strings now go through a strict allowlist regex that rejects shell metacharacters, leading hyphens, and path traversal before use. sshReadFile/sshAppendFile in ssh.ts now single-quote paths. Hardcoded HA_TOKEN JWT removed from .env. 49 regression tests added covering all finding categories. Build and 99/99 tests pass.

> 2026-06-28 security (wave 3): fix 2 remaining command-injection sinks. Added validateDeployService() to src/validate.ts; openclaw-deploy.ts now calls it before interpolating service into SSH script paths; cron.ts handleCronRun now calls validateCronId() before interpolating job_id into the openclaw cron run command (mirrors existing pattern in cron-manage.ts). shellQuote applied to deployScriptDir as well. 23 new regression tests added. Build and 122/122 tests pass.

> 2026-06-29 by claude-opus-4-8 (community-health sweep): added
> .github/PULL_REQUEST_TEMPLATE.md and .github/ISSUE_TEMPLATE/{bug_report,feature_request}.md
> copied from canonical homeofe/aahp-swarm. No source code changed.

> 2026-06-30 by claude-opus-4-8 (verify): added reviewed expiring PII allowlist, rolled out from AAHP v3.2.0.

> 2026-06-30 ci: exempt Dependabot from the aahp-verify handoff gate (keep supply-chain-guard/codeql/build).

> Note (2026-07-19): Moved the AAHP conformance pin from 3.8.0 to 3.8.1 (picks up the v3.8.1 Windows/MSYS manifest-regen fix so tasks, next_task_id and cross_repo_ref survive regeneration). No runtime behavior change on Linux or CI. Handoff refreshed and MANIFEST regenerated.
