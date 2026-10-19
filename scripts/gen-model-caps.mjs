#!/usr/bin/env node
/**
 * Regenerate src/host/model-caps.generated.ts from the installed pi-ai catalog.
 *
 * The plugin does not depend on pi-ai at runtime: a site route can serve any
 * model name, and pi-ai carries the only maintained table of what those models
 * can do. Reading it once at build time keeps the shipped plugin
 * self-contained while letting a model name be checked against real data
 * instead of a guess. Rerun this after bumping the dev dependency.
 *
 * The table is a default, not an authority: a site that declares
 * `context_window` in /api/pricing, or an operator who configured
 * `modelOverrides`, answers before this file does (see src/host/model-caps.ts).
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

/** Model id -> its reasoning levels (null when the catalog names none), smallest context window, and input modalities. */
const catalog = new Map()
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
      const contextWindow = typeof entry.contextWindow === 'number' && entry.contextWindow > 0
        ? entry.contextWindow
        : undefined
      const previous = catalog.get(id)
      // One model id appears under several providers and they disagree: a
      // gateway may list two of a model's levels where the vendor lists six,
      // and may state a smaller context window than the vendor. The most
      // complete level list wins and the smallest window wins, so the result
      // does not depend on which provider file happened to be read first and
      // never overstates a capacity.
      // Image support is a property of the model, not of one provider's listing,
      // and a gateway that omits it is the common case. Three model ids of 1101
      // dissented, so the union wins here while the capacity below takes the
      // smallest value.
      const modalities = new Set(previous?.input ?? [])
      for (const modality of entry.input ?? []) modalities.add(modality)
      catalog.set(id, {
        levels: previous === undefined || previous.levels === null || (levels !== null && levels.length > previous.levels.length)
          ? levels
          : previous.levels,
        contextWindow: previous?.contextWindow === undefined
          ? contextWindow
          : contextWindow === undefined ? previous.contextWindow : Math.min(previous.contextWindow, contextWindow),
        input: modalities,
      })
    }
  }
}

const models = [...catalog.keys()].sort()
const withTiers = models.filter(model => catalog.get(model).levels !== null)
const tierSets = [...new Set(withTiers.map(model => catalog.get(model).levels.join(",")))].sort()
const tierIndex = new Map(tierSets.map((set, index) => [set, index]))
const withWindow = models.filter(model => catalog.get(model).contextWindow !== undefined)

const quote = '\u0060'
const out = []
out.push('/**')
out.push(' * Generated from @earendil-works/pi-ai@' + version + '. Run node scripts/gen-model-caps.mjs; do not edit.')
out.push(' *')
out.push(' * CHAT_MODELS is every chat model the catalog describes. TIER_SETS holds each')
out.push(' * distinct reasoning level list once; MODEL_TIERS points models at one of them.')
out.push(' * Level names are the catalog own wire spellings. MODEL_CONTEXT_WINDOW is the')
out.push(' * smallest context window the catalog states for the model, used only when')
out.push(' * neither the site nor the plugin configuration answers.')
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
  out.push("  '" + model + "': " + tierIndex.get(catalog.get(model).levels.join(',')) + ',')
}
out.push('}')
out.push('')
out.push('/** Model id -> the smallest context window the catalog states for it, in tokens. */')
out.push('export const MODEL_CONTEXT_WINDOW: Readonly<Record<string, number>> = {')
for (const model of withWindow) {
  out.push("  '" + model + "': " + catalog.get(model).contextWindow + ',')
}
out.push('}')
out.push('')
out.push('/** Model id -> the input modalities the catalog states, for models that take images. */')
out.push('export const MODEL_INPUT: Readonly<Record<string, readonly string[]>> = {')
for (const model of models) {
  const modalities = [...catalog.get(model).input].sort()
  if (!modalities.includes('image')) continue
  out.push("  '" + model + "': [" + modalities.map(m => "'" + m + "'").join(', ') + '],')
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
console.log('wrote ' + models.length + ' chat models, ' + withTiers.length + ' with reasoning levels, '
  + withWindow.length + ' with a context window, ' + tierSets.length + ' distinct level sets')
