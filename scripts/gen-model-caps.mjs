#!/usr/bin/env node
/**
 * Regenerate src/host/model-caps.generated.ts from the installed pi-ai catalog.
 *
 * The plugin does not depend on pi-ai at runtime: a site route can serve any
 * model name, and pi-ai carries the only maintained table of what those models
 * can do. Reading it once at build time keeps the shipped plugin self-contained
 * while letting a model name be checked against real data instead of a guess.
 * Rerun this after bumping the dev dependency.
 *
 * Usage: node scripts/gen-model-caps.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

let entryPath
try {
  // The package is ESM-only and its exports map has no ./package.json entry: a
  // CommonJS require.resolve cannot see the "." condition, so resolution runs
  // through the ESM resolver and the root is taken from the entry module.
  entryPath = fileURLToPath(import.meta.resolve('@earendil-works/pi-ai'))
} catch (_error) {
  console.error('install @earendil-works/pi-ai (a dev dependency) before running this script')
  process.exit(1)
}

const packageRoot = dirname(dirname(entryPath))
const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), "utf8")).version
const dataDir = join(packageRoot, 'dist', 'providers', 'data')

/** Model id -> its reasoning levels, or null when the catalog names none. */
const chat = new Map()
for (const file of readdirSync(dataDir).filter(name => name.endsWith('.json'))) {
  const parsed = JSON.parse(readFileSync(join(dataDir, file), 'utf8'))
  for (const bucket of Object.values(parsed)) {
    for (const [key, entry] of Object.entries(bucket)) {
      if (key.slice(0, 5) !== 'chat:') continue
      const id = entry.id === undefined ? key.slice(5) : entry.id
      const named = entry.thinkingLevelMap === undefined || entry.thinkingLevelMap === null
        ? []
        : Object.keys(entry.thinkingLevelMap).filter(level => level !== 'off')
      // A map that only switches thinking off declares no selectable level, and
      // an empty list is rejected downstream as an invalid offering.
      const levels = named.length === 0 ? null : named
      const previous = chat.get(id)
      // One model id appears under several providers and they disagree: a
      // gateway may list two of a model's levels where the vendor lists six.
      // The most complete list wins, so the result does not depend on which
      // provider file happened to be read first.
      if (previous === undefined || previous === null || (levels !== null && levels.length > previous.length)) {
        chat.set(id, levels)
      }
    }
  }
}

const models = [...chat.keys()].sort()
const withTiers = models.filter(model => chat.get(model) !== null)
const tierSets = [...new Set(withTiers.map(model => chat.get(model).join(",")))].sort()
const tierIndex = new Map(tierSets.map((set, index) => [set, index]))

const quote = '\u0060'
const out = []
out.push('/**')
out.push(' * Generated from @earendil-works/pi-ai@' + version + '. Run node scripts/gen-model-caps.mjs; do not edit.')
out.push(' *')
out.push(' * CHAT_MODELS is every chat model the catalog describes: a name outside it has no')
out.push(' * known capabilities, and the provider hides it rather than guess. TIER_SETS holds')
out.push(' * each distinct reasoning level list once; MODEL_TIERS points models at one of')
out.push(' * them. Level names are the catalog own wire spellings.')
out.push(' */')
out.push('')
out.push('/** Distinct reasoning level lists. */')
out.push('export const TIER_SETS: readonly (readonly string[])[] = [')
for (const set of tierSets) {
  out.push('  [' + set.split(',').map(level => "'" + level + "'").join(', ') + '],')
}
out.push(']')
out.push('')
out.push('/** Model id -> the index in TIER_SETS describing its reasoning levels. */')
out.push('export const MODEL_TIERS: Readonly<Record<string, number>> = {')
for (const model of withTiers) {
  out.push("  '" + model + "': " + tierIndex.get(chat.get(model).join(',')) + ',')
}
out.push('}')
out.push('')
out.push('/** Every chat model the catalog describes, one per line. */')
out.push('export const CHAT_MODELS: ReadonlySet<string> = new Set(' + quote)
for (const model of models) out.push(model)
out.push(quote + ".split('\\n'))")
out.push('')

const target = join(here, '..', 'src', 'host', 'model-caps.generated.ts')
writeFileSync(target, out.join('\n'), 'utf8')
console.log('wrote ' + models.length + ' chat models, ' + withTiers.length + ' with reasoning levels, ' + tierSets.length + ' distinct level sets')
