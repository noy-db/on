#!/usr/bin/env node
/**
 * Compiles every fenced `ts` block in every shipped README against the built
 * `dist` of the package that ships it.
 *
 * Ported from `noy-db-as`'s gate (which credits noy-db's original) and adapted
 * to the PREAMBLE CONVENTION ruled in noy-db/family#16, whose reference
 * implementation is core's `check-prose-examples` (noy-db/core#1310). Tracked
 * for this repo at noy-db/on#7.
 *
 * ⛔ INTERIM BY DESIGN. noy-db/family#26 may converge these into family-tools.
 * If it does, DELETE this file rather than maintaining a fourth copy — the
 * counter-arguments below were expensive to measure once and forking them is
 * how one copy silently loses one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS CHECK VACUOUS, all measured, all of which look like a pass:
 *
 * 1. RUN FROM INSIDE THE PACKAGE. A probe compiled from the repo root resolves
 *    no `@noy-db/*` and reports TS2307 for every import. TS2307 is ignored by
 *    design (see below), so every family object becomes `any` and the whole
 *    program typechecks while examining nothing.
 *
 * 2. ONE SYNTACTIC DIAGNOSTIC SILENCES A WHOLE PROGRAM. `tsc` skips semantic
 *    checking entirely on any TS1xxx. ⭐ MEASURED HERE, NOT INHERITED: on
 *    2026-09-15 `on-recovery/README.md` fenced a submit handler with a
 *    top-level `return`; two TS1108s hid FOUR other blocks in that package, one
 *    of which carried a real defect (`rotateRecovery`'s `newCodes` is optional
 *    and the example used it unguarded). The family ruling says "compile in TWO
 *    programs"; this compiles ONE PER PACKAGE, which is finer, and reports a
 *    syntactic hit as POISONED — naming the package and refusing to report its
 *    other blocks as clean. The failure mode the ruling guards against is
 *    SILENCE, and poisoning is loud.
 *
 * 3. `types: []` REPO-WIDE IS A TRAP. It strips ambient globals, so a package
 *    correctly declaring `@types/node` cannot use `process` in a shipped
 *    example. ⛔ Do not "simplify" the two-program split below into one.
 *
 * 4. AN UNBUILT PACKAGE PASSES VACUOUSLY. Its own imports become TS2307,
 *    which is filtered, so every symbol is `any`. The build-order guard below
 *    asserts the `types` entry exists; run this AFTER `pnpm build`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PREAMBLE, and one deliberate DIVERGENCE from core.
 *
 * A README whose blocks elide their setup carries it once, in an HTML comment
 * that renders nowhere and whose body is real TypeScript. It TYPES the elided
 * bindings rather than asserting them. Four READMEs here carry one.
 *
 * ⛔ Core IGNORES `TS2304` (cannot find name) as a property of the probe. THIS
 * GATE DOES NOT, and the reason is a measured case: `on-shamir`'s composability
 * recipe called `webAuthn.enrollWithPayload(...)`, an API that exists in NO
 * package in this family. Under core's rule that is TS2304, ignored, and the
 * preamble convention would then have the author `declare const webAuthn` with
 * a fabricated method — documenting an ambient that is not ambient, and
 * cementing the defect as documentation. Counting it forces the author to
 * either name the real symbol or declare it honestly as the reader's own code.
 * ⚠️ The cost is real: every genuinely elided binding must be declared. That is
 * the intended cost. A block referencing an undeclared name is a README that
 * does not say where the name comes from.
 *
 * ⚠️ PREAMBLE DISCIPLINE, measured in noy-db-as: adding four convenience names
 * took that repo from 12 findings to 9. Every entry must be an object the
 * READMEs genuinely write against, at its REAL type. Prefer fixing the README.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const PROBE = '.prose-probe'

/**
 * Ambient objects the READMEs write against, at their REAL types.
 * Adding a name here weakens the gate; prefer fixing the README.
 */
const PREAMBLE = `import type { Vault, Noydb } from '@noy-db/hub'
declare global {
  const vault: Vault
  const db: Noydb
}
export {}
`

const packages = readdirSync('.').filter((d) => d.startsWith('on-') && existsSync(join(d, 'README.md')))
if (packages.length === 0) {
  console.error('check:prose-examples: no as-* package with a README was found — refusing to pass vacuously')
  process.exit(1)
}

/** Fenced ```ts blocks, with the README line their fence sits on. */
function extract(md) {
  const lines = md.split('\n')
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '```ts') continue
    let j = i + 1
    while (j < lines.length && lines[j].trim() !== '```') j++
    blocks.push({ fence: i + 1, body: lines.slice(i + 1, j) })
    i = j
  }
  return blocks
}

let totalBlocks = 0
let totalErrors = 0
let poisoned = 0
const unbuilt = []
const summary = []

for (const pkg of packages) {
  const mdText = readFileSync(join(pkg, 'README.md'), 'utf8')
  // Per-README preamble (core's convention, #1310): an HTML comment that
  // renders nowhere and whose body is real TypeScript.
  const pre = mdText.match(/<!--\s*prose-preamble\n([\s\S]*?)-->/)
  const blocks = extract(mdText)
  if (blocks.length === 0) {
    summary.push(`  ${pkg.padEnd(11)} 0 blocks`)
    continue
  }
  totalBlocks += blocks.length

  const dir = join(pkg, PROBE)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  let pre2 = PREAMBLE
  if (pre) {
    const lines = pre[1].split('\n')
    const imports = lines.filter((l) => /^\s*import /.test(l))
    const rest = lines.filter((l) => !/^\s*import /.test(l)).map((l) => l.replace(/^declare /, ''))
    pre2 = `${imports.join('\n')}\ndeclare global {\n${rest.join('\n')}\n}\nexport {}\n`
  }
  writeFileSync(join(dir, 'preamble.ts'), pre2)

  for (const b of blocks) {
    // Pad so a probe line number IS the README line number. Without this every
    // diagnostic points at a line the reader has to compute.
    const src = [...Array(b.fence).fill(''), ...b.body, 'export {}'].join('\n')
    writeFileSync(join(dir, `block-${b.fence}.ts`), src)
  }

  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'))

  // BUILD-ORDER VACUITY GUARD. `TS2307` is filtered below, so a package with no
  // `dist` yields `any` for its own exports and the blocks typecheck against
  // nothing. Measured: with `as-zip/dist` removed this run failed only
  // INCIDENTALLY, on one `noImplicitAny` in a callback — a README without a
  // callback would have passed, green, examining nothing. So assert the
  // artefact the blocks compile against actually exists, rather than relying on
  // a diagnostic that happens to fire. Run this AFTER `pnpm build`.
  const typesEntry = manifest.exports?.['.']?.types ?? manifest.types
  if (!typesEntry || !existsSync(join(pkg, typesEntry))) {
    console.error(`\n${pkg}: ${typesEntry ?? 'no types entry'} does not exist — run \`pnpm build\` first.`)
    console.error('  Refusing to compile examples against a package that has not been built:')
    console.error('  every import would resolve to `any` and this check would pass having examined nothing.')
    unbuilt.push(pkg)
    continue
  }

  const hasNode = '@types/node' in { ...manifest.dependencies, ...manifest.devDependencies }
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: { noEmit: true, types: hasNode ? ['node'] : [] },
        include: ['*.ts'],
      },
      null,
      2,
    ),
  )

  let out = ''
  try {
    execFileSync('npx', ['tsc', '-p', join(dir, 'tsconfig.json')], { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }

  const diagnostics = out
    .split('\n')
    .filter((l) => /error TS\d+:/.test(l))
    // TS2307 is ignored ON PURPOSE: a missing framework module must not turn
    // this into a test of the probe host's dependency list. NOTE the recorded
    // hazard — an ignored diagnostic is scoped to what it NAMES, but its
    // CONSEQUENCE is not: suppressing "cannot find module 'vue'" also un-types
    // every family object flowing through vue's API. No `as-*` README imports a
    // framework today; if one starts to, symlink that package's own dependency
    // into the probe rather than widening this filter.
    .filter((l) => !/error TS2307:/.test(l))
    .map((l) => l.replace(new RegExp(`${pkg}/${PROBE}/block-(\\d+)\\.ts`), `${pkg}/README.md`))

  const syntactic = diagnostics.filter((l) => /error TS1\d{3}:/.test(l))
  totalErrors += diagnostics.length

  if (syntactic.length > 0) {
    poisoned++
    summary.push(
      `  ${pkg.padEnd(11)} ${String(blocks.length).padEnd(2)} blocks  POISONED — ${syntactic.length} syntax errors`,
    )
    console.error(`\n${pkg}: SYNTAX ERROR — semantic checking was SKIPPED for all ${blocks.length} blocks.`)
    console.error('  A block that is not TypeScript must not be fenced ```ts (use ```jsonc, ```json, ```text).')
    console.error('  Nothing else reported for this package means anything until these are cleared.')
    for (const l of syntactic) console.error(`    ${l}`)
    continue
  }

  summary.push(
    `  ${pkg.padEnd(11)} ${String(blocks.length).padEnd(2)} blocks  types=[${hasNode ? 'node' : ''}]  ${diagnostics.length} errors`,
  )
  if (diagnostics.length > 0) {
    console.error(`\n${pkg}:`)
    for (const l of diagnostics) console.error(`    ${l}`)
  }
}

for (const pkg of packages) rmSync(join(pkg, PROBE), { recursive: true, force: true })

console.log(`\ncheck:prose-examples — ${totalBlocks} fenced ts blocks across ${packages.length} packages`)
for (const l of summary) console.log(l)

// Vacuity guard. A run that compiled nothing must not report success — the
// extraction is exactly the event that silently empties a scope like this one.
if (totalBlocks === 0) {
  console.error('\nNo fenced ts block was found in any README. That is not a pass; the extractor is wrong.')
  process.exit(1)
}
if (unbuilt.length > 0) {
  console.error(`\nFAIL — ${unbuilt.length} package(s) not built: ${unbuilt.join(', ')}.`)
  process.exit(1)
}
if (totalErrors > 0 || poisoned > 0) {
  console.error(`\nFAIL — ${totalErrors} diagnostics${poisoned > 0 ? `, ${poisoned} package(s) poisoned by syntax errors` : ''}.`)
  process.exit(1)
}
console.log('\nOK — every shipped example compiles against its own package dist.')
