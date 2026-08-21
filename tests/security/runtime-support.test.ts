/**
 * The runtimes this package is TESTED on, and the runtimes it CLAIMS to support,
 * must be the same set - and neither may be end-of-life.
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-21 the v1.3.0 release failed, and the reason was a Node version
 * nobody had looked at since the workflow was written:
 *
 *     npm error code EBADENGINE
 *     npm error Not compatible with your version of node/npm: npm@12.0.2
 *     npm error notsup Required: {"node":"^22.22.2 || ^24.15.0 || >=26.0.0"}
 *     npm error notsup Actual:   {"npm":"10.8.2","node":"v20.20.2"}
 *
 * The publish job ran `npm install -g npm@latest` on Node 20 to enable OIDC
 * trusted publishing. npm 12 dropped Node 20. So the step that exists to make
 * publishing possible is the step that refused - and it would have refused on
 * every release attempt since npm 12 shipped. Nothing surfaced it, because
 * nothing had been released since April.
 *
 * At the same moment the test matrix was `[18, 20, 22]` - two runtimes that had
 * been dead for sixteen months and four months - and `engines.node` publicly
 * claimed `>=18`. The package therefore advertised support for a runtime it
 * could not have security-patched, and proved that support with a green check.
 *
 * THE INVARIANT, AND WHY IT IS A PROPERTY RATHER THAN A DATE
 * ---------------------------------------------------------------------------
 * A hardcoded list of dead versions rots: it is correct on the day it is written
 * and wrong every day after. The durable half is a RELATION - every runtime CI
 * exercises must satisfy the range the package publishes. That cannot go stale,
 * because both sides move together or the test goes red.
 *
 * Only ONE dated fact is kept, in SUPPORTED_FLOOR below, and it is a single
 * constant with the date it was true written next to it.
 *
 * WHAT EACH TEST GUARDS, AND THE MUTATION THAT TURNS IT RED
 * ---------------------------------------------------------------------------
 *   - "every workflow pins at least one runtime": empty the matrix, or delete
 *     every `node-version:`. Every other assertion here is vacuously true over
 *     an empty list, so this one has to come first. This is not hypothetical:
 *     a sibling gate in this estate passed for months because its STALE case
 *     asserted on a value the tool it tested could never emit.
 *   - "CI runtimes satisfy engines.node": set one job back to '20' while leaving
 *     engines at '>=22', or widen engines to '>=18' while CI stays on 22.
 *   - "the floor is not end-of-life": set engines.node to '>=20'.
 *   - "the publish job is not older than the rest": put the publish job on an
 *     older major than the matrix - which is exactly the shape that broke
 *     v1.3.0, where build ran on 22 and publish ran on 20.
 */
import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const ROOT = join(import.meta.dirname, '..', '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')

/**
 * The oldest Node major still receiving security patches.
 *
 * Measured 2026-08-21: 18.x EOL 2025-04-30, 20.x EOL 2026-04-30, 22.x Active LTS
 * until 2027-04, 24.x Active LTS. When 22 reaches end of life this constant is
 * the ONE thing to change - and this test going red is the reminder.
 */
const SUPPORTED_FLOOR = 22

interface Pin {
  file: string
  job: string
  majors: number[]
}

/** Every Node major any workflow asks for, with where it came from. */
function collectPins(): Pin[] {
  const pins: Pin[] = []
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const doc = parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as Record<string, any>
    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      const matrix = (job as any)?.strategy?.matrix?.['node-version']
      const fromMatrix: number[] = Array.isArray(matrix)
        ? matrix.map((v: unknown) => majorOf(String(v), `${file}:${jobName} matrix`))
        : []

      const fromSteps: number[] = []
      for (const step of ((job as any)?.steps ?? []) as any[]) {
        const raw = step?.with?.['node-version']
        if (raw === undefined || raw === null) continue
        const text = String(raw)
        // A matrix reference is already covered by fromMatrix. Anything else
        // containing an expression is a value this test cannot evaluate, and an
        // unevaluatable pin must fail rather than be skipped - a check that
        // silently drops what it cannot parse reports a clean repo it never read.
        if (/\$\{\{\s*matrix\./.test(text)) continue
        assert.ok(
          !text.includes('${{'),
          `${file}:${jobName} pins node-version to an expression this test cannot evaluate (${text}). ` +
            `Use a literal, or a matrix reference.`,
        )
        fromSteps.push(majorOf(text, `${file}:${jobName} step`))
      }

      const majors = [...fromMatrix, ...fromSteps]
      if (majors.length > 0) pins.push({ file, job: jobName, majors })
    }
  }
  return pins
}

function majorOf(value: string, where: string): number {
  const m = /^v?(\d+)/.exec(value.trim())
  assert.ok(m, `${where}: cannot read a Node major out of ${JSON.stringify(value)}`)
  return Number(m![1])
}

/** The floor `engines.node` publishes, e.g. '>=22' -> 22. */
function enginesFloor(): number {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const range: unknown = pkg?.engines?.node
  assert.equal(
    typeof range,
    'string',
    'package.json must declare engines.node - without it the package makes no support claim at all, ' +
      'and this whole file has nothing to compare CI against.',
  )
  const m = /^>=\s*v?(\d+)/.exec((range as string).trim())
  assert.ok(
    m,
    `engines.node is ${JSON.stringify(range)}, which this test cannot read as a floor. ` +
      `It understands '>=N' only; a more complex range needs this test taught about it, ` +
      `not skipped past.`,
  )
  return Number(m![1])
}

test('every workflow that sets up Node pins at least one runtime', () => {
  const pins = collectPins()
  assert.ok(
    pins.length > 0,
    'no node-version found in any workflow. Every other assertion in this file is ' +
      'vacuously true over an empty list, so this failing means the file is asserting nothing.',
  )
})

test('every runtime CI exercises satisfies the range the package publishes', () => {
  const floor = enginesFloor()
  for (const { file, job, majors } of collectPins()) {
    for (const major of majors) {
      assert.ok(
        major >= floor,
        `${file}:${job} runs on Node ${major}, below the engines.node floor of ${floor}. ` +
          `CI would then prove the package works on a runtime it does not claim to support, ` +
          `or - as in the v1.3.0 failure - on one that tooling has already dropped.`,
      )
    }
  }
})

test('the published support floor is not an end-of-life runtime', () => {
  const floor = enginesFloor()
  assert.ok(
    floor >= SUPPORTED_FLOOR,
    `engines.node claims support from Node ${floor}, but the oldest runtime still ` +
      `receiving security patches is ${SUPPORTED_FLOOR} (measured 2026-08-21). ` +
      `Publishing a support claim for an unpatched runtime is the state this repository ` +
      `was in when v1.3.0 failed to release.`,
  )
})

test('the release path does not run on an older runtime than the build path', () => {
  const pins = collectPins()
  const lowest = (names: RegExp) =>
    pins.filter((p) => names.test(p.job)).flatMap((p) => p.majors).sort((a, b) => a - b)[0]

  const build = lowest(/^build$/)
  const release = lowest(/^(publish|release|version-guard)$/)
  if (build === undefined || release === undefined) return // shape changed; other tests still bind

  assert.ok(
    release >= build,
    `the release path runs on Node ${release} while build runs on ${build}. ` +
      `That is exactly the v1.3.0 failure: build was green on 22 and publish died on 20, ` +
      `so every check passed and nothing shipped.`,
  )
})
