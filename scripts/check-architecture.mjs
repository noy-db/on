#!/usr/bin/env node
//
// check-architecture — the hub subpaths this family imports, stated from its side.
//
// WHY THIS IS A LOCAL SCRIPT. family-tools' `architecture` gate keys its rules
// off `binds` ('@noy-db/hub/on'), and that row is `storeOnly`: it refuses a
// runtime store import and nothing else. It does not limit WHICH hub subpaths
// `on-*` imports — and measured on main (family#131), the runtime coupling is
// hub's ROOT BARREL (`checkGate`, `mintPaperRecoveryEntry`, `generateULID`, …),
// not `/on`. Ruled by the user 2026-10-12: the seam-registry row is WIDENED to
// that measured set rather than narrowing imports here, and this file holds the
// set so a new subpath goes red instead of arriving unnoticed.
//
//   hub-subpaths — src imports `@noy-db/hub` only at:
//     ''            the root barrel (values and types)
//     '/on'         the port (values and types)
//     '/to'         types only (on-magic-link: `NoydbStore`)
//     '/share-link' types only (on-magic-link: `ShareLink`)
//   Adding a subpath, or a VALUE import from a types-only one, is a SEAM
//   CHANGE: coordinated at the family root, never slipped in with a feature.
//   Tests are not checked — they may compose any published mixin.
//
// Wired through `localChecks` in family.config.json, which the rail's CI runs.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED_HUB = new Map([['', 'any'], ['/on', 'any'], ['/to', 'type'], ['/share-link', 'type']])
const pkgDirs = readdirSync(ROOT).filter((d) => d.startsWith('on-') && existsSync(join(ROOT, d, 'package.json')))
const failures = []

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.ts$/.test(e) && !/\.test\./.test(e)) out.push(p)
  }
  return out
}

// Static import/export (incl. side-effect imports) and dynamic import().
const IMPORT_RE = /(?:(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?|import\s*\(\s*)['"](@noy-db\/hub(?:\/[^'"]*)?)['"]/g
const allowedList = [...ALLOWED_HUB].map(([s, k]) => `'@noy-db/hub${s}'${k === 'type' ? ' (types)' : ''}`).join(', ')

for (const dir of pkgDirs) {
  for (const file of walk(join(ROOT, dir, 'src'))) {
    // Comments are stripped first: an `import` quoted in a JSDoc block is prose, not an edge.
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const rel = relative(ROOT, file)
    for (const m of code.matchAll(IMPORT_RE)) {
      const typeOnly = m[1] !== undefined
      const sub = m[2].slice('@noy-db/hub'.length)
      const kind = ALLOWED_HUB.get(sub)
      if (kind === undefined) failures.push(`${rel} imports '${m[2]}'; this family binds hub at ${allowedList} only — a new subpath is a seam change`)
      else if (kind === 'type' && !typeOnly) failures.push(`${rel} value-imports '${m[2]}'; that subpath is bound for types only — use \`import type\`, or coordinate the seam change`)
    }
  }
}

if (failures.length) {
  console.error(`✗ check-architecture: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`  • hub-subpaths: ${f}`)
  process.exit(1)
}
console.log(`✓ check-architecture: ${pkgDirs.length} packages, hub bound at ${allowedList}`)
